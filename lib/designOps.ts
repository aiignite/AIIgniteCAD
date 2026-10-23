/**
 * designOps.ts — AI 设计操作的确定性几何实现
 *
 * 对齐、分布、图层与删除都不依赖模型：输入目标图元，输出新的图元数组与
 * 变更 id。上层仍走 computeAIActionOutcome → 预览 → 单次提交。
 */

import type { CADElement } from "../types";
import { getElementBoundingBox } from "./geometry";
import * as Transform from "./transform";

export type AlignMode = "left" | "right" | "top" | "bottom" | "centerX" | "centerY";
export type DistributeAxis = "horizontal" | "vertical";

export interface DesignOpOutcome {
    elements: CADElement[];
    changedIds: string[];
}

export const ALIGN_MODES: readonly AlignMode[] = [
    "left",
    "right",
    "top",
    "bottom",
    "centerX",
    "centerY",
];

export const DISTRIBUTE_AXES: readonly DistributeAxis[] = ["horizontal", "vertical"];

/** 只替换发生变化的图元，保持其余图元引用不变 */
const applyUpdates = (
    base: readonly CADElement[],
    updates: Map<string, CADElement>,
): CADElement[] => base.map((element) => updates.get(element.id) ?? element);

export function alignElements(
    base: CADElement[],
    targets: CADElement[],
    mode: AlignMode,
): DesignOpOutcome | null {
    if (!ALIGN_MODES.includes(mode) || targets.length < 2) return null;

    const boxes = targets.map((element) => ({
        element,
        box: getElementBoundingBox(element),
    }));
    const minX = Math.min(...boxes.map(({ box }) => Math.min(box.minX, box.maxX)));
    const minY = Math.min(...boxes.map(({ box }) => Math.min(box.minY, box.maxY)));
    const maxX = Math.max(...boxes.map(({ box }) => Math.max(box.minX, box.maxX)));
    const maxY = Math.max(...boxes.map(({ box }) => Math.max(box.minY, box.maxY)));

    const updates = new Map<string, CADElement>();
    for (const { element, box } of boxes) {
        const left = Math.min(box.minX, box.maxX);
        const top = Math.min(box.minY, box.maxY);
        const right = Math.max(box.minX, box.maxX);
        const bottom = Math.max(box.minY, box.maxY);
        let dx = 0;
        let dy = 0;
        if (mode === "left") dx = minX - left;
        if (mode === "right") dx = maxX - right;
        if (mode === "centerX") dx = (minX + maxX) / 2 - (left + right) / 2;
        if (mode === "top") dy = minY - top;
        if (mode === "bottom") dy = maxY - bottom;
        if (mode === "centerY") dy = (minY + maxY) / 2 - (top + bottom) / 2;
        if (dx === 0 && dy === 0) continue;
        updates.set(element.id, Transform.moveElements([element], { x: dx, y: dy })[0]);
    }

    return {
        elements: applyUpdates(base, updates),
        changedIds: [...updates.keys()],
    };
}

export function distributeElements(
    base: CADElement[],
    targets: CADElement[],
    axis: DistributeAxis,
): DesignOpOutcome | null {
    if (!DISTRIBUTE_AXES.includes(axis) || targets.length < 3) return null;

    const horizontal = axis === "horizontal";
    const boxes = targets.map((element) => {
        const box = getElementBoundingBox(element);
        return {
            element,
            min: horizontal ? Math.min(box.minX, box.maxX) : Math.min(box.minY, box.maxY),
            max: horizontal ? Math.max(box.minX, box.maxX) : Math.max(box.minY, box.maxY),
        };
    });
    boxes.sort((a, b) => a.min - b.min || a.element.id.localeCompare(b.element.id));

    const spanStart = boxes[0].min;
    const spanEnd = boxes[boxes.length - 1].max;
    const occupied = boxes.reduce((sum, item) => sum + (item.max - item.min), 0);
    const gap = (spanEnd - spanStart - occupied) / (boxes.length - 1);
    if (!Number.isFinite(gap) || gap < 0) return null;

    const updates = new Map<string, CADElement>();
    let cursor = boxes[0].max;
    for (let index = 1; index < boxes.length - 1; index += 1) {
        const item = boxes[index];
        const targetMin = cursor + gap;
        const delta = targetMin - item.min;
        if (delta !== 0) {
            updates.set(
                item.element.id,
                Transform.moveElements(
                    [item.element],
                    horizontal ? { x: delta, y: 0 } : { x: 0, y: delta },
                )[0],
            );
        }
        cursor = targetMin + (item.max - item.min);
    }

    return {
        elements: applyUpdates(base, updates),
        changedIds: [...updates.keys()],
    };
}

export function assignLayer(
    base: CADElement[],
    targets: CADElement[],
    layer: string,
): DesignOpOutcome | null {
    const name = layer.trim();
    if (!name) return null;
    const updates = new Map<string, CADElement>();
    for (const element of targets) {
        if (element.layer === name) continue;
        updates.set(element.id, { ...element, layer: name });
    }
    return {
        elements: applyUpdates(base, updates),
        changedIds: [...updates.keys()],
    };
}

export function deleteElements(base: CADElement[], targets: CADElement[]): DesignOpOutcome {
    const ids = new Set(targets.map((element) => element.id));
    return {
        elements: base.filter((element) => !ids.has(element.id)),
        changedIds: [...ids],
    };
}
