/**
 * aiActions.ts — AI 动作的纯计算层
 *
 * 把工具调用 / 文本 JSON 产生的动作应用到图元数组，但不写入 store。
 * 上层可先用它计算结果做预览，确认后再一次性提交（单次撤销）。
 */

import type { CADElement } from "../types";
import * as Transform from "./transform";
import { generateSineWave, validateCurve } from "../services/curveGenerationService";
import { offsetElements } from "../services/offsetService";
import {
    alignElements,
    assignLayer,
    deleteElements,
    distributeElements,
    type AlignMode,
    type DistributeAxis,
} from "./designOps";

export interface AIActionOutcome {
    elements: CADElement[];
    /** 动作完成后应选中的图元 id；未提供时保持原选择 */
    selection?: string[];
}

const createElementId = (): string =>
    `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/** 兼容旧动作：LINE 若带 points 则按多段线处理，并修正异常曲线 */
const normalizeAIElements = (aiElements?: CADElement[]): CADElement[] | undefined => {
    if (!aiElements) return undefined;
    return aiElements.map((element) => {
        if (element.type === "LINE" && element.points && element.points.length > 0) {
            return { ...element, type: "LWPOLYLINE" as const };
        }
        if (element.type === "LWPOLYLINE" && element.points && element.points.length > 0) {
            const validation = validateCurve(element.points);
            if (!validation.valid) {
                console.warn("Curve validation issues:", validation.issues);
                if (element.points.length > 10) {
                    const xs = element.points.map((point) => point.x);
                    const ys = element.points.map((point) => point.y);
                    const xMin = Math.min(...xs);
                    const xMax = Math.max(...xs);
                    const yMin = Math.min(...ys);
                    const yMax = Math.max(...ys);
                    const yRange = yMax - yMin;
                    const xRange = xMax - xMin;
                    if (yRange > 50 && xRange > 200) {
                        try {
                            const correctedPoints = generateSineWave({
                                startX: xMin,
                                endX: xMax,
                                centerY: (yMin + yMax) / 2,
                                amplitude: yRange / 2,
                                wavelength: xRange / 1.5,
                                pointCount: Math.max(element.points.length - 1, 50),
                            });
                            return { ...element, points: correctedPoints };
                        } catch (error) {
                            console.error("Error correcting curve:", error);
                        }
                    }
                }
            }
        }
        return element;
    });
};

const selectTargets = (
    normalizedElements: CADElement[] | undefined,
    selected: CADElement[],
    baseElements: CADElement[],
): CADElement[] => {
    const raw =
        normalizedElements && normalizedElements.length > 0
            ? normalizedElements
            : selected.length > 0
              ? selected
              : baseElements;
    return raw.map((target) => baseElements.find((element) => element.id === target.id) ?? target);
};

const appendWithFreshIds = (
    baseElements: CADElement[],
    copies: CADElement[],
): { elements: CADElement[]; selection: string[] } => {
    const fresh = copies.map((element) => ({ ...element, id: createElementId() }));
    return { elements: [...baseElements, ...fresh], selection: fresh.map((element) => element.id) };
};

export function computeAIActionOutcome(
    operation: string,
    aiElements: CADElement[] | undefined,
    params: Record<string, any> | undefined,
    baseElements: CADElement[],
    selected: CADElement[],
): AIActionOutcome | null {
    // 副作用类动作不改画布，图元保持不变；由预览确认后由宿主执行
    if (operation === "SAVE_BLOCK" || operation === "SAVE_VERSION") {
        return { elements: baseElements };
    }
    const normalizedElements = normalizeAIElements(aiElements);

    if (operation === "CLEAR") {
        return { elements: [] };
    }
    if (operation === "DELETE_LAST") {
        return baseElements.length > 0 ? { elements: baseElements.slice(0, -1) } : null;
    }
    if (operation === "ADD" && normalizedElements && normalizedElements.length > 0) {
        return { elements: [...baseElements, ...normalizedElements] };
    }
    if (operation === "COPY") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        if (targets.length === 0) return null;
        const dx = params?.dx ?? 50;
        const dy = params?.dy ?? 50;
        return appendWithFreshIds(baseElements, Transform.copyElements(targets, { x: dx, y: dy }));
    }
    if (operation === "MOVE") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        if (targets.length === 0) return null;
        const dx = params?.dx ?? params?.x ?? 0;
        const dy = params?.dy ?? params?.y ?? 0;
        if (dx !== 0 || dy !== 0) {
            const moved = Transform.moveElements(targets, { x: dx, y: dy });
            const updates = new Map(moved.map((element) => [element.id, element]));
            const existingIds = new Set(baseElements.map((element) => element.id));
            return {
                elements: [
                    ...baseElements.map((element) => updates.get(element.id) ?? element),
                    ...moved.filter((element) => !existingIds.has(element.id)),
                ],
            };
        }
        if (normalizedElements && normalizedElements.length > 0) {
            const updates = new Map(normalizedElements.map((element) => [element.id, element]));
            const existingIds = new Set(baseElements.map((element) => element.id));
            return {
                elements: [
                    ...baseElements.map((element) =>
                        updates.has(element.id)
                            ? { ...element, ...updates.get(element.id)! }
                            : element,
                    ),
                    ...normalizedElements.filter((element) => !existingIds.has(element.id)),
                ],
            };
        }
        return null;
    }
    if (operation === "ROTATE") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        if (targets.length === 0) return null;
        const angle = params?.angle ?? 90;
        const center = params?.center || Transform.getElementsCentroid(targets);
        const rotated = Transform.rotateElements(targets, center, angle);
        const updates = new Map(rotated.map((element) => [element.id, element]));
        const existingIds = new Set(baseElements.map((element) => element.id));
        return {
            elements: [
                ...baseElements.map((element) => updates.get(element.id) ?? element),
                ...rotated.filter((element) => !existingIds.has(element.id)),
            ],
        };
    }
    if (operation === "MIRROR") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        if (targets.length === 0) return null;
        const p1 = params?.p1 || { x: 400, y: 0 };
        const p2 = params?.p2 || { x: 400, y: 600 };
        const mirrored = Transform.mirrorElements(targets, { start: p1, end: p2 });
        return appendWithFreshIds(baseElements, mirrored);
    }
    if (operation === "SCALE") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        if (targets.length === 0) return null;
        const factor = Number(params?.factor ?? params?.scale ?? 2);
        if (!Number.isFinite(factor) || factor <= 0) return null;
        const base = params?.center || Transform.getElementsCentroid(targets);
        const scaledById = new Map(
            Transform.scaleElements(targets, base, factor, factor).map((element) => [
                element.id,
                element,
            ]),
        );
        return {
            elements: baseElements.map((element) => scaledById.get(element.id) ?? element),
        };
    }
    if (operation === "OFFSET") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        const distance = Number(params?.distance ?? 20);
        if (targets.length === 0 || !Number.isFinite(distance) || distance === 0) return null;
        return appendWithFreshIds(baseElements, offsetElements(targets, distance));
    }
    if (operation === "ARRAY") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        if (targets.length === 0) return null;
        const rows = Math.max(1, Math.floor(Number(params?.rows ?? 2)));
        const columns = Math.max(1, Math.floor(Number(params?.columns ?? 2)));
        const rowSpacing = Number(params?.rowSpacing ?? 100);
        const columnSpacing = Number(params?.columnSpacing ?? 100);
        if (
            !Number.isFinite(rows) ||
            !Number.isFinite(columns) ||
            !Number.isFinite(rowSpacing) ||
            !Number.isFinite(columnSpacing)
        ) {
            return null;
        }
        return appendWithFreshIds(
            baseElements,
            Transform.rectangularArray(targets, rows, columns, rowSpacing, columnSpacing),
        );
    }
    if (operation === "ALIGN") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        const mode = String(params?.mode ?? "left") as AlignMode;
        const result = alignElements(baseElements, targets, mode);
        return result ? { elements: result.elements } : null;
    }
    if (operation === "DISTRIBUTE") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        const axis = String(params?.axis ?? "horizontal") as DistributeAxis;
        const result = distributeElements(baseElements, targets, axis);
        return result ? { elements: result.elements } : null;
    }
    if (operation === "SET_LAYER") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        const layer = typeof params?.layer === "string" ? params.layer : "";
        const result = assignLayer(baseElements, targets, layer);
        return result ? { elements: result.elements } : null;
    }
    if (operation === "DELETE") {
        const targets = selectTargets(normalizedElements, selected, baseElements);
        if (targets.length === 0) return null;
        return { elements: deleteElements(baseElements, targets).elements, selection: [] };
    }

    return null;
}
