/**
 * measurement.ts — 只读几何测量
 *
 * 供 AI 在回答"多长 / 多大 / 间距多少"前读取真实数值，
 * 避免模型根据坐标心算。全部为纯函数。
 */

import type { CADElement, Point } from "../types";
import type { BoundingBox } from "./geometry";
import { getElementBoundingBox } from "./geometry";

export type MeasureKind = "distance" | "length" | "area" | "bbox";

export interface MeasureRequest {
    kind: MeasureKind;
    ids?: string[];
    p1?: Point;
    p2?: Point;
}

export interface MeasureResult {
    ok: boolean;
    kind: MeasureKind;
    value?: number;
    area?: number;
    bounds?: BoundingBox;
    detail?: string;
    error?: string;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function elementLength(element: CADElement): number {
    switch (element.type) {
        case "LINE":
            return element.start && element.end ? distance(element.start, element.end) : 0;
        case "CIRCLE":
            return 2 * Math.PI * Math.abs(element.radius ?? 0);
        case "ARC": {
            const radius = Math.abs(element.radius ?? 0);
            const span = Math.abs((element.endAngle ?? 0) - (element.startAngle ?? 0));
            return (radius * (Math.min(span, 360) * Math.PI)) / 180;
        }
        case "RECTANGLE":
            return 2 * (Math.abs(element.width ?? 0) + Math.abs(element.height ?? 0));
        case "LWPOLYLINE": {
            const points = element.points ?? [];
            let total = 0;
            for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
            if (element.closed && points.length > 2) {
                total += distance(points[points.length - 1], points[0]);
            }
            return total;
        }
        default:
            return 0;
    }
}

/** 多边形面积（鞋带公式），点序无关，取绝对值 */
function polygonArea(points: readonly Point[]): number {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        sum += current.x * next.y - next.x * current.y;
    }
    return Math.abs(sum) / 2;
}

function elementArea(element: CADElement): { area: number; exact: boolean } {
    switch (element.type) {
        case "CIRCLE":
            return { area: Math.PI * Math.abs(element.radius ?? 0) ** 2, exact: true };
        case "RECTANGLE":
            return {
                area: Math.abs((element.width ?? 0) * (element.height ?? 0)),
                exact: true,
            };
        case "LWPOLYLINE":
            return element.closed && (element.points?.length ?? 0) >= 3
                ? { area: polygonArea(element.points ?? []), exact: true }
                : { area: 0, exact: false };
        default: {
            const box = getElementBoundingBox(element);
            return {
                area: Math.abs((box.maxX - box.minX) * (box.maxY - box.minY)),
                exact: false,
            };
        }
    }
}

const combinedBounds = (elements: readonly CADElement[]): BoundingBox | null => {
    if (elements.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const element of elements) {
        const box = getElementBoundingBox(element);
        minX = Math.min(minX, box.minX, box.maxX);
        minY = Math.min(minY, box.minY, box.maxY);
        maxX = Math.max(maxX, box.minX, box.maxX);
        maxY = Math.max(maxY, box.minY, box.maxY);
    }
    return { minX, minY, maxX, maxY };
};

/**
 * 测量入口。
 * ids 为空时使用当前选择集；选择集也为空时，length/area/bbox 作用于全图。
 */
export function measureGeometry(
    elements: readonly CADElement[],
    selectedIds: readonly string[],
    request: MeasureRequest,
): MeasureResult {
    if (!["distance", "length", "area", "bbox"].includes(request.kind)) {
        return { ok: false, kind: "bbox", error: `不支持的测量类型 ${String(request.kind)}` };
    }
    const providedIds = request.ids && request.ids.length > 0 ? request.ids : null;
    const requestedIds = providedIds ?? selectedIds;
    const known = new Set(elements.map((element) => element.id));
    const missing = requestedIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
        return {
            ok: false,
            kind: request.kind,
            error: `找不到图元 ${missing.slice(0, 5).join(", ")}`,
        };
    }
    const targets =
        requestedIds.length > 0
            ? elements.filter((element) => requestedIds.includes(element.id))
            : elements;

    if (request.kind === "distance") {
        if (request.p1 && request.p2) {
            return {
                ok: true,
                kind: "distance",
                value: round(distance(request.p1, request.p2)),
                detail: `两点距离 ${round(distance(request.p1, request.p2))}`,
            };
        }
        if (targets.length !== 2) {
            return {
                ok: false,
                kind: "distance",
                error: "distance 需要两个点，或恰好两个图元（按几何中心计算）",
            };
        }
        const [a, b] = targets.map((element) => getElementBoundingBox(element));
        const centerA = { x: (a.minX + a.maxX) / 2, y: (a.minY + a.maxY) / 2 };
        const centerB = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        const value = round(distance(centerA, centerB));
        return {
            ok: true,
            kind: "distance",
            value,
            detail: `两个图元中心间距 ${value}`,
        };
    }

    if (request.kind === "length") {
        if (targets.length === 0) {
            return { ok: false, kind: "length", error: "没有可测量的图元" };
        }
        const value = round(targets.reduce((sum, element) => sum + elementLength(element), 0));
        return {
            ok: true,
            kind: "length",
            value,
            detail: `${targets.length} 个图元总长度 ${value}`,
        };
    }

    if (request.kind === "area") {
        if (targets.length === 0) {
            return { ok: false, kind: "area", error: "没有可测量的图元" };
        }
        let total = 0;
        let allExact = true;
        for (const element of targets) {
            const result = elementArea(element);
            total += result.area;
            if (!result.exact) allExact = false;
        }
        return {
            ok: true,
            kind: "area",
            area: round(total),
            detail: allExact
                ? `${targets.length} 个闭合图元总面积 ${round(total)}`
                : `${targets.length} 个图元总面积约 ${round(total)}（部分图元按包围盒估算）`,
        };
    }

    const bounds = combinedBounds(targets);
    if (!bounds) return { ok: false, kind: "bbox", error: "没有可测量的图元" };
    return {
        ok: true,
        kind: "bbox",
        bounds: {
            minX: round(bounds.minX),
            minY: round(bounds.minY),
            maxX: round(bounds.maxX),
            maxY: round(bounds.maxY),
        },
        detail: `包围盒 ${round(bounds.minX)},${round(bounds.minY)} → ${round(bounds.maxX)},${round(
            bounds.maxY,
        )}`,
    };
}
