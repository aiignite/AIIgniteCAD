// Block Service for AIIgniteCAD Frontend
// Manages block operations with backend API for Definitions, and IndexedDB for local References

import { BlockDefinition, BlockCategory, BlockReference, CADElement, Point } from '../types';
import { indexedDBService } from './indexedDBService';
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

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3410/api";

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

/**
 * Get full block tree (categories and blocks) for user/project
 */
export async function getBlockTree(projectId?: string): Promise<{categories: BlockCategory[], rootBlocks: BlockDefinition[]}> {
     try {
        const res = await fetch(`${API_BASE_URL}/blocks/tree?projectId=${projectId || ''}`, {
            headers: getHeaders()
        });
        if (!res.ok) throw new Error("Failed to fetch blocks");
        return await res.json();
     } catch (e) {
         console.error(e);
         return { categories: [], rootBlocks: [] };
     }
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
    let blocks: BlockDefinition[] = [];
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

