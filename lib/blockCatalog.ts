/**
 * blockCatalog.ts — 块库目录与插入展开
 *
 * 块定义来自服务端块库（分类树），AI 工具循环是同步纯函数，
 * 因此每轮对话前把块库拍平成目录注入草稿，工具执行时不再做 IO。
 */

import type { BlockCategory, BlockDefinition, CADElement, Point } from "../types";
import { getBlockBoundingBox } from "./block";
import { moveElements, rotateElements, scaleElements } from "./transform";

export interface BlockCatalogEntry {
    id: string;
    name: string;
    description?: string;
    category?: string;
    elementCount: number;
    width: number;
    height: number;
    basePoint: Point;
    elements: CADElement[];
}

export interface BlockSummary {
    id: string;
    name: string;
    category?: string;
    description?: string;
    elementCount: number;
    width: number;
    height: number;
}

export interface BlockSearchResult {
    total: number;
    blocks: BlockSummary[];
}

/**
 * 块目录读取结果。ok=false 表示块库请求失败，此时 entries 是空数组，
 * 但模型必须知道「读不到」和「库里没有块」是两件事，否则会用绘图工具绕过块库。
 */
export interface BlockCatalogResult {
    entries: BlockCatalogEntry[];
    ok: boolean;
}

export interface BlockInsertOptions {
    x: number;
    y: number;
    scale?: number;
    rotation?: number;
}

export const MAX_BLOCK_CATALOG_ENTRIES = 500;
export const MAX_BLOCK_CANDIDATES = 50;

const createBlockElementId = (): string =>
    `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const round = (value: number): number => Math.round(value * 100) / 100;

const toEntry = (block: BlockDefinition, category?: string): BlockCatalogEntry => {
    const elements = Array.isArray(block.elements) ? block.elements : [];
    const bounds = getBlockBoundingBox({ ...block, elements } as BlockDefinition);
    return {
        id: block.id,
        name: block.name,
        ...(block.description ? { description: block.description } : {}),
        ...(category ? { category } : {}),
        elementCount: elements.length,
        width: round(Math.max(0, bounds.maxX - bounds.minX)),
        height: round(Math.max(0, bounds.maxY - bounds.minY)),
        basePoint: block.basePoint ?? { x: 0, y: 0 },
        elements,
    };
};

export function buildBlockCatalog(
    rootBlocks: readonly BlockDefinition[] = [],
    categories: readonly BlockCategory[] = [],
): BlockCatalogEntry[] {
    const entries: BlockCatalogEntry[] = [];
    const seen = new Set<string>();

    const push = (block: BlockDefinition, category?: string) => {
        if (!block?.id || !block.name || seen.has(block.id)) return;
        if (entries.length >= MAX_BLOCK_CATALOG_ENTRIES) return;
        seen.add(block.id);
        entries.push(toEntry(block, category));
    };

    const walk = (list: readonly BlockCategory[], depth: number) => {
        if (depth > 8) return;
        for (const category of list) {
            for (const block of category.blocks ?? []) push(block, category.name);
            walk(category.children ?? [], depth + 1);
        }
    };

    for (const block of rootBlocks) push(block);
    walk(categories, 0);
    return entries;
}

const toSummary = (entry: BlockCatalogEntry): BlockSummary => ({
    id: entry.id,
    name: entry.name,
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.description ? { description: entry.description.slice(0, 120) } : {}),
    elementCount: entry.elementCount,
    width: entry.width,
    height: entry.height,
});

export function findBlockEntry(
    catalog: readonly BlockCatalogEntry[],
    blockId: string,
): BlockCatalogEntry | undefined {
    return catalog.find((entry) => entry.id === blockId);
}

export function searchBlockCatalog(
    catalog: readonly BlockCatalogEntry[],
    options: { keyword?: string; limit?: number } = {},
): BlockSearchResult {
    const keyword = options.keyword?.trim().toLowerCase() ?? "";
    const matched = keyword
        ? catalog.filter((entry) =>
              [entry.id, entry.name, entry.description ?? "", entry.category ?? ""].some((field) =>
                  field.toLowerCase().includes(keyword),
              ),
          )
        : catalog;
    const rawLimit = Number.isFinite(options.limit) ? Number(options.limit) : 8;
    const limit = Math.min(MAX_BLOCK_CANDIDATES, Math.max(1, Math.trunc(rawLimit)));
    return { total: matched.length, blocks: matched.slice(0, limit).map(toSummary) };
}

/** 把块定义平移到插入点，再按需绕插入点旋转与等比缩放；块内图层保持不变 */
export function expandBlockAt(entry: BlockCatalogEntry, options: BlockInsertOptions): CADElement[] {
    if (entry.elements.length === 0) return [];
    const rotation = Number.isFinite(options.rotation) ? Number(options.rotation) : 0;
    // RECTANGLE 只能表达轴对齐矩形，旋转前先转成闭合多段线，避免插入后形状失真
    const rotateRectangles = rotation % 360 !== 0;
    const clones = entry.elements.map((element) => {
        const clone: CADElement = { ...structuredClone(element), id: createBlockElementId() };
        if (rotateRectangles && clone.type === "RECTANGLE" && clone.start) {
            const { start, width = 0, height = 0 } = clone;
            clone.type = "LWPOLYLINE";
            clone.points = [
                { x: start.x, y: start.y },
                { x: start.x + width, y: start.y },
                { x: start.x + width, y: start.y + height },
                { x: start.x, y: start.y + height },
            ];
            clone.closed = true;
            delete clone.start;
            delete clone.width;
            delete clone.height;
        }
        return clone;
    });
    const position = { x: options.x, y: options.y };
    const delta = {
        x: position.x - entry.basePoint.x,
        y: position.y - entry.basePoint.y,
    };

    let expanded = moveElements(clones, delta);
    if (rotateRectangles) expanded = rotateElements(expanded, position, rotation);
    const scale = Number.isFinite(options.scale) ? Number(options.scale) : 1;
    if (scale !== 1) expanded = scaleElements(expanded, position, scale, scale);
    return expanded;
}
