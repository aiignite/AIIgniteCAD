/**
 * crossDrawing.ts — 跨图纸快照引用
 *
 * 把另一张图纸的内容**一次性**复制进当前图纸，而不是持续引用：
 * 与块的「符号展开复制」保持同一取舍——避免外部引用的加载失败、循环引用
 * 与版本漂移；复制后的图元共享一个 groupId，可整体移动或删除，
 * 新 id 带来源前缀，便于在图纸里追溯是哪张图来的。
 */

import type { CADElement, Point } from "../types";
import type { BoundingBox } from "./geometry";
import { getElementBoundingBox } from "./geometry";
import * as Transform from "./transform";

/** 复制进来的图元 id 前缀 */
export const XREF_ID_PREFIX = "xref";
/** 单次插入的图元上限：与 AI 补丁上限一致，避免一次操作把画布撑爆 */
export const MAX_XREF_ELEMENTS = 2000;
/** 块引用依赖来源图纸的块定义，目标图纸不一定有，复制时跳过 */
const UNSUPPORTED_TYPES: ReadonlySet<CADElement["type"]> = new Set(["BLOCK_REFERENCE"]);

export interface XrefSource {
    id: string;
    name: string;
    elements: readonly CADElement[];
}

export interface XrefInsertOptions {
    /** 插入目标点：源图包围盒左下角会落在该点；缺省保持原位 */
    target?: Point;
    /** 覆盖分组 id；缺省按来源图纸生成，同一张图的多次插入仍是同一组 */
    groupId?: string;
}

export interface XrefInsertResult {
    /** 平移并重新编号后的副本，可直接并入当前图纸 */
    elements: CADElement[];
    selection: string[];
    /** 插入后副本的包围盒 */
    bounds: BoundingBox | null;
    /** 因类型不支持被跳过的数量 */
    skipped: number;
    /** 因超出上限被截断的数量 */
    truncated: number;
}

/** 源图纸的包围盒；空图纸返回 null */
export function xrefBounds(elements: readonly CADElement[]): BoundingBox | null {
    let box: BoundingBox | null = null;
    for (const element of elements) {
        const current = getElementBoundingBox(element);
        const minX = Math.min(current.minX, current.maxX);
        const maxX = Math.max(current.minX, current.maxX);
        const minY = Math.min(current.minY, current.maxY);
        const maxY = Math.max(current.minY, current.maxY);
        if (!Number.isFinite(minX) || !Number.isFinite(minY)) continue;
        box = box
            ? {
                  minX: Math.min(box.minX, minX),
                  minY: Math.min(box.minY, minY),
                  maxX: Math.max(box.maxX, maxX),
                  maxY: Math.max(box.maxY, maxY),
              }
            : { minX, minY, maxX, maxY };
    }
    return box;
}

/** 默认分组：同一来源图纸的多次插入归为一组，便于整体管理 */
export const xrefGroupId = (sourceId: string): string => `grp-xref-${sourceId}`;

/**
 * 生成跨图纸插入的副本。
 *
 * 基点固定取源图包围盒左下角：用原点作基点时，远离原点的图纸会跳到画布外，
 * 用户看到的现象是「插入后什么都没出现」。
 */
export function buildXrefInsert(
    source: XrefSource,
    options: XrefInsertOptions = {},
): XrefInsertResult {
    const supported = source.elements.filter((element) => !UNSUPPORTED_TYPES.has(element.type));
    const skipped = source.elements.length - supported.length;
    const kept = supported.slice(0, MAX_XREF_ELEMENTS);
    const truncated = supported.length - kept.length;

    if (kept.length === 0) {
        return { elements: [], selection: [], bounds: null, skipped, truncated };
    }

    const box = xrefBounds(kept);
    const base = box ? { x: box.minX, y: box.minY } : { x: 0, y: 0 };
    const target = options.target ?? base;
    const dx = target.x - base.x;
    const dy = target.y - base.y;
    const groupId = options.groupId ?? xrefGroupId(source.id);

    const moved = dx === 0 && dy === 0 ? kept : Transform.moveElements(kept, { x: dx, y: dy });
    const elements = moved.map((element, index) => ({
        ...element,
        id: `${XREF_ID_PREFIX}:${source.id}:${index + 1}`,
        groupId,
    }));

    return {
        elements,
        selection: elements.map((element) => element.id),
        bounds: xrefBounds(elements),
        skipped,
        truncated,
    };
}
