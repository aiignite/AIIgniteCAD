/**
 * quickSelect.ts — 快速选择（QSELECT）的纯过滤逻辑
 *
 * 三个维度（类型 / 图层 / 颜色）之间是「与」关系，同一维度内是「或」关系；
 * 某一维度一个值都不选，就表示该维度不限制。
 * 计数按其余维度过滤后的结果统计，因此勾选类型后图层计数会随之收敛。
 */

import type { CADElement } from "../types";

export interface QuickSelectFilter {
    /** 选中的图元类型；空数组表示不限 */
    types: string[];
    /** 选中的图层；空数组表示不限 */
    layers: string[];
    /** 选中的颜色；空数组表示不限 */
    colors: string[];
}

export interface QuickSelectFacetValue {
    value: string;
    count: number;
}

export interface QuickSelectFacets {
    types: QuickSelectFacetValue[];
    layers: QuickSelectFacetValue[];
    colors: QuickSelectFacetValue[];
}

export const EMPTY_QUICK_SELECT_FILTER: QuickSelectFilter = {
    types: [],
    layers: [],
    colors: [],
};

/** 颜色统一大写比较，避免 #FF0000 与 #ff0000 被当成两种颜色 */
const normalizeColor = (color: string): string => color.trim().toUpperCase();

/** 空图层名归一到 "0"，与图层可见性判定保持同一口径 */
const normalizeLayer = (layer: string | undefined): string => layer?.trim() || "0";

const matchesDimension = (value: string, wanted: string[] | null): boolean =>
    wanted === null || wanted.includes(value);

/** 归一化后的过滤条件：null 表示该维度不限 */
interface NormalizedFilter {
    types: string[] | null;
    layers: string[] | null;
    colors: string[] | null;
}

const normalizeFilter = (filter: QuickSelectFilter): NormalizedFilter => ({
    types: filter.types.length > 0 ? filter.types : null,
    layers: filter.layers.length > 0 ? filter.layers.map(normalizeLayer) : null,
    colors: filter.colors.length > 0 ? filter.colors.map(normalizeColor) : null,
});

/** skip 用于统计某一维度的分面：跳过该维度自身的限制 */
const matchesFilter = (
    element: CADElement,
    filter: NormalizedFilter,
    skip?: keyof QuickSelectFilter,
): boolean => {
    if (skip !== "types" && !matchesDimension(element.type, filter.types)) return false;
    if (skip !== "layers" && !matchesDimension(normalizeLayer(element.layer), filter.layers)) {
        return false;
    }
    if (skip !== "colors" && !matchesDimension(normalizeColor(element.color), filter.colors)) {
        return false;
    }
    return true;
};

const countBy = (
    elements: CADElement[],
    pick: (element: CADElement) => string,
): QuickSelectFacetValue[] => {
    const counts = new Map<string, number>();
    for (const element of elements) {
        const key = pick(element);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};

/** 各维度可选值及其在当前过滤条件下的数量 */
export function quickSelectFacets(
    elements: CADElement[],
    filter: QuickSelectFilter,
): QuickSelectFacets {
    const normalized = normalizeFilter(filter);
    const subset = (skip: keyof QuickSelectFilter) =>
        elements.filter((element) => matchesFilter(element, normalized, skip));

    return {
        types: countBy(subset("types"), (element) => element.type),
        layers: countBy(subset("layers"), (element) => normalizeLayer(element.layer)),
        colors: countBy(subset("colors"), (element) => normalizeColor(element.color)),
    };
}

/** 命中的图元 */
export function filterQuickSelect(
    elements: CADElement[],
    filter: QuickSelectFilter,
): CADElement[] {
    const normalized = normalizeFilter(filter);
    return elements.filter((element) => matchesFilter(element, normalized));
}

/** 命中的图元 id */
export function quickSelectIds(elements: CADElement[], filter: QuickSelectFilter): string[] {
    return filterQuickSelect(elements, filter).map((element) => element.id);
}

/** 勾选 / 取消某个取值 */
export function toggleQuickSelectValue(values: string[], value: string): string[] {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
