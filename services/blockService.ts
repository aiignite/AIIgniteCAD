// Block Service for AIIgniteCAD Frontend
// Manages block operations with backend API for Definitions, and IndexedDB for local References

import { BlockDefinition, BlockCategory, BlockReference, CADElement, Point } from '../types';
import { indexedDBService } from './indexedDBService';
import {
    buildBlockCatalog,
    type BlockCatalogEntry,
    type BlockCatalogResult
} from '../lib/blockCatalog';
import {
    createBlockReference,
    explodeBlockReference,
    getBlockReferenceElements,
    updateBlockDefinition,
    validateBlockDefinition,
    isBlockNameUnique,
    generateBlockThumbnail, // Keep usage
    hasCircularReference,
    cloneBlockDefinition
} from '../lib/block';

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3225/api";

const getHeaders = () => {
    const token = localStorage.getItem("auth_token");
    return {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {})
    };
};

// ============================================================================
// API OPERATIONS (Block Definitions & Categories)
// ============================================================================

interface BlockTree {
    categories: BlockCategory[];
    rootBlocks: BlockDefinition[];
}

const EMPTY_TREE: BlockTree = { categories: [], rootBlocks: [] };

/** 块目录缓存有效期：AI 每轮都会取目录，短 TTL 足够挡住重复请求又不至于长期陈旧 */
const CATALOG_TTL_MS = 60_000;
const catalogCache = new Map<string, { at: number; entries: BlockCatalogEntry[] }>();

/** 块或分类发生增删改后清空缓存，避免 AI 继续看到旧目录 */
export function clearBlockCatalogCache(): void {
    catalogCache.clear();
}

async function fetchBlockTree(projectId?: string): Promise<{ ok: boolean; tree: BlockTree }> {
     try {
        const res = await fetch(`${API_BASE_URL}/blocks/tree?projectId=${projectId || ''}`, {
            headers: getHeaders()
        });
        if (!res.ok) throw new Error("Failed to fetch blocks");
        return { ok: true, tree: await res.json() };
     } catch (e) {
         console.error(e);
         return { ok: false, tree: EMPTY_TREE };
     }
}

/**
 * Get full block tree (categories and blocks) for user/project
 */
export async function getBlockTree(projectId?: string): Promise<BlockTree> {
     const { tree } = await fetchBlockTree(projectId);
     return tree;
}

/**
 * 供 AI 工具循环使用：把块库拍平成目录，失败时退回空目录而不是中断对话。
 * ok 字段保留失败信号，让工具结果能说清「块库不可用」而不是「块库为空」。
 * 目录按项目缓存，避免每一轮 AI 请求都重新拉一次整棵块树。
 */
export async function getBlockCatalog(projectId?: string): Promise<BlockCatalogResult> {
    const key = projectId ?? "";
    const cached = catalogCache.get(key);
    if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
        return { entries: cached.entries, ok: true };
    }

    const { ok, tree } = await fetchBlockTree(projectId);
    const entries = buildBlockCatalog(tree.rootBlocks ?? [], tree.categories ?? []);
    // 失败或空目录不缓存，避免一次网络抖动让 AI 在一段时间内拿不到任何块
    if (ok && entries.length > 0) catalogCache.set(key, { at: Date.now(), entries });
    return { entries, ok };
}

/**
 * Create a new block category
 */
export async function createCategory(name: string, parentId?: string, projectId?: string): Promise<BlockCategory> {
    const res = await fetch(`${API_BASE_URL}/blocks/category`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name, parentId, projectId })
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to create category" }));
        if (res.status === 401) {
            throw new Error("请先登录后才能创建文件夹");
        }
        throw new Error(errorData.error || errorData.message || "Failed to create category");
    }

    clearBlockCatalogCache();
    return res.json();
}

/**
 * Create a new block definition
 */
export async function createBlock(
    name: string,
    elements: CADElement[],
    basePoint: Point,
    description?: string,
    projectId?: string,
    categoryId?: string
): Promise<BlockDefinition> {
    // Generate thumbnail locally
    const blockForThumb = { elements, basePoint } as BlockDefinition;
    const thumbnail = generateBlockThumbnail(blockForThumb);

    const body = {
        name,
        description,
        elements,
        basePoint,
        projectId,
        categoryId,
        thumbnail
    };

    const res = await fetch(`${API_BASE_URL}/blocks/definition`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to create block" }));
        if (res.status === 401) {
            throw new Error("请先登录后才能创建块");
        }
        throw new Error(errorData.error || errorData.message || "Failed to create block");
    }

    clearBlockCatalogCache();
    return res.json();
}

/**
 * Move block or category to another category
 */
export async function moveItem(type: 'block' | 'category', id: string, targetCategoryId?: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/blocks/move`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ type, id, targetCategoryId })
    });
     if (!res.ok) throw new Error("Failed to move item");
    clearBlockCatalogCache();
}

/**
 * Delete block or category
 */
export async function deleteItem(type: 'block' | 'category', id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/blocks/${type}/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
     if (!res.ok) throw new Error("Failed to delete item");
    clearBlockCatalogCache();
}

// ============================================================================
// LOCAL / HYBRID OPERATIONS (References)
// ============================================================================

/**
 * Get block definition by ID (from API)
 */
export async function getBlock(blockId: string): Promise<BlockDefinition | undefined> {
     try {
        const res = await fetch(`${API_BASE_URL}/blocks/${blockId}`, {
            headers: getHeaders()
        });
        if (!res.ok) return undefined;
        return await res.json();
     } catch (e) {
         console.error(e);
         return undefined;
     }
}

/**
 * Insert a block reference into a project (Local IndexedDB for now)
 */
export async function insertBlockReference(
    projectId: string,
    blockDefinition: BlockDefinition, // Changed to take full definition object
    insertionPoint: Point,
    layer: string = '0',
    rotation: number = 0,
    scaleX: number = 1,
    scaleY: number = 1
): Promise<BlockReference> {

    const blockRef = createBlockReference(
        blockDefinition.id,
        insertionPoint,
        layer,
        rotation,
        scaleX,
        scaleY
    );

    blockRef.blockDefinition = blockDefinition; // Include definition for rendering

    await indexedDBService.saveBlockReference(blockRef, projectId);

    return blockRef;
}

/**
 * Get all block references in a project
 */
export async function getProjectBlockReferences(
    projectId: string
): Promise<BlockReference[]> {
    const blockRefs = await indexedDBService.getBlockReferencesByProject(projectId);

    // We need to re-attach definitions. 
    // If definitions are on server, we need to fetch them.
    // This could be slow N+1. 
    // Ideally, we fetch all blocks for the project once.
    // For now, let's assume the frontend manages linking or we don't link here.
    // If we don't link, rendering fails.
    
    // Simplest: `getBlockTree` gets all blocks. We can use that.
    const { rootBlocks, categories } = await getBlockTree(projectId);
    const allBlocks = [...rootBlocks, ...flattenCategories(categories)];

    return blockRefs.map(ref => {
        const def = allBlocks.find(b => b.id === ref.blockDefinitionId);
        return { ...ref, blockDefinition: def };
    });
}

function flattenCategories(categories: BlockCategory[]): BlockDefinition[] {
    const blocks: BlockDefinition[] = [];
    for (const cat of categories) {
        if (cat.blocks) blocks.push(...cat.blocks);
        if (cat.children) blocks.push(...flattenCategories(cat.children));
    }
    return blocks;
}

// ... Keep other reference utils ...
export async function deleteBlockReference(projectId: string, blockRefId: string): Promise<void> {
    await indexedDBService.delete('blockReferences', blockRefId);
}

export async function getSuggestedBlockName(baseName: string): Promise<string> {
    const { categories, rootBlocks } = await getBlockTree();
    const allBlocks = [...rootBlocks, ...flattenCategories(categories)];
    
    // Check exact match
    if (!allBlocks.some(b => b.name === baseName)) return baseName;
    
    let i = 1;
    while (allBlocks.some(b => b.name === `${baseName}_${i}`)) {
        i++;
    }
    return `${baseName}_${i}`;
}

