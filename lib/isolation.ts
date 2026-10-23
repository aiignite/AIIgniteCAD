/**
 * isolation.ts — 隔离 / 隐藏对象的纯函数
 *
 * 隐藏集是独立的瞬态视图状态：既不改图元字段，也不改图层可见性，
 * 撤销历史与版本快照因此完全不受影响。
 */

import type { CADElement } from "../types";

/** 当前可显示图元：排除隐藏图层上的图元与被临时隐藏的图元 */
export function displayableElements(
    elements: CADElement[],
    hiddenLayers: readonly string[],
    hiddenIds: ReadonlySet<string>,
): CADElement[] {
    return elements.filter(
        (element) => !hiddenLayers.includes(element.layer || "0") && !hiddenIds.has(element.id),
    );
}

/** 隔离：只保留选择集，其余图层可见图元的 id 进入隐藏集 */
export function isolateIds(
    elements: CADElement[],
    hiddenLayers: readonly string[],
    keepIds: ReadonlySet<string>,
): string[] {
    return elements
        .filter(
            (element) => !hiddenLayers.includes(element.layer || "0") && !keepIds.has(element.id),
        )
        .map((element) => element.id);
}

/** 叠加隐藏：保留既有顺序，只追加尚未隐藏的 id */
export function mergeHiddenIds(hiddenIds: Iterable<string>, toHide: Iterable<string>): string[] {
    const merged = new Set(hiddenIds);
    Array.from(toHide).forEach((id) => merged.add(id));
    return [...merged];
}

/** 与已选图元类型相同、且位于候选集合中的图元 id */
export function selectSimilarIds(candidates: CADElement[], selected: CADElement[]): string[] {
    if (selected.length === 0) return [];
    const types = new Set(selected.map((element) => element.type));
    return candidates.filter((element) => types.has(element.type)).map((element) => element.id);
}

/** 仍然存在的隐藏图元数量；删图或撤销后不计入失效 id */
export function countHiddenObjects(elements: CADElement[], hiddenIds: ReadonlySet<string>): number {
    return elements.reduce((count, element) => (hiddenIds.has(element.id) ? count + 1 : count), 0);
}
