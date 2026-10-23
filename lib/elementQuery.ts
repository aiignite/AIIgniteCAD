/**
 * elementQuery.ts — 按条件查询图元
 *
 * AI 需要"找到某层上的圆"或"看看这个范围内的线"时，先查询再编辑，
 * 而不是靠猜测 id。结果只带轻量摘要，避免把完整几何塞回模型。
 */

import type { CADElement } from "../types";
import type { BoundingBox } from "./geometry";
import { getElementBoundingBox } from "./geometry";

export interface ElementQuery {
    types?: string[];
    layers?: string[];
    bounds?: BoundingBox;
    text?: string;
    limit?: number;
}

export interface ElementQueryMatch {
    id: string;
    type: string;
    layer: string;
    bbox: BoundingBox;
    description: string;
}

export interface ElementQueryResult {
    count: number;
    returned: number;
    elements: ElementQueryMatch[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const round = (value: number): number => Math.round(value * 100) / 100;

function describe(element: CADElement): string {
    switch (element.type) {
        case "LINE":
            return `LINE (${round(element.start?.x ?? 0)},${round(element.start?.y ?? 0)})→(${round(
                element.end?.x ?? 0,
            )},${round(element.end?.y ?? 0)})`;
        case "CIRCLE":
            return `CIRCLE r=${round(element.radius ?? 0)} @(${round(
                element.center?.x ?? 0,
            )},${round(element.center?.y ?? 0)})`;
        case "RECTANGLE":
            return `RECT ${round(Math.abs(element.width ?? 0))}×${round(
                Math.abs(element.height ?? 0),
            )} @(${round(element.start?.x ?? 0)},${round(element.start?.y ?? 0)})`;
        case "TEXT":
            return `TEXT "${(element.text ?? "").slice(0, 40)}"`;
        case "LWPOLYLINE":
            return `LWPOLYLINE ${element.points?.length ?? 0}pts${element.closed ? " closed" : ""}`;
        case "ARC":
            return `ARC r=${round(element.radius ?? 0)} ${round(
                element.startAngle ?? 0,
            )}°→${round(element.endAngle ?? 0)}°`;
        case "DIMENSION":
            return "DIMENSION";
        default:
            return element.type;
    }
}

const intersects = (a: BoundingBox, b: BoundingBox): boolean =>
    Math.max(a.minX, a.maxX) >= Math.min(b.minX, b.maxX) &&
    Math.min(a.minX, a.maxX) <= Math.max(b.minX, b.maxX) &&
    Math.max(a.minY, a.maxY) >= Math.min(b.minY, b.maxY) &&
    Math.min(a.minY, a.maxY) <= Math.max(b.minY, b.maxY);

export function queryElements(
    elements: readonly CADElement[],
    query: ElementQuery,
): ElementQueryResult {
    const types = new Set((query.types ?? []).map((type) => type.toUpperCase()));
    const layers = new Set((query.layers ?? []).map((layer) => layer.toLowerCase()));
    const text = query.text?.trim().toLowerCase();
    const limit = Math.min(Math.max(1, Math.trunc(query.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);

    const matches = elements.filter((element) => {
        if (types.size > 0 && !types.has(element.type)) return false;
        if (layers.size > 0 && !layers.has((element.layer || "0").toLowerCase())) return false;
        if (text) {
            const haystack = `${element.text ?? ""} ${element.id}`.toLowerCase();
            if (!haystack.includes(text)) return false;
        }
        if (query.bounds && !intersects(getElementBoundingBox(element), query.bounds)) {
            return false;
        }
        return true;
    });

    return {
        count: matches.length,
        returned: Math.min(matches.length, limit),
        elements: matches.slice(0, limit).map((element) => {
            const box = getElementBoundingBox(element);
            return {
                id: element.id,
                type: element.type,
                layer: element.layer || "0",
                bbox: {
                    minX: round(Math.min(box.minX, box.maxX)),
                    minY: round(Math.min(box.minY, box.maxY)),
                    maxX: round(Math.max(box.minX, box.maxX)),
                    maxY: round(Math.max(box.minY, box.maxY)),
                },
                description: describe(element),
            };
        }),
    };
}
