/**
 * minimap.ts — 迷你导航图的纯几何
 *
 * 导航图只做"全局示意"：把全部可显示图元压缩到一块小区域，
 * 再叠一个当前视口矩形。坐标换算与视口跟随都在这里完成，组件只负责绘制。
 */

import type { CADElement, Point } from "../types";
import { getElementBoundingBox, type BoundingBox } from "./geometry";

export interface MiniMapSize {
    width: number;
    height: number;
}

/** 世界坐标 → 导航图像素的等比变换 */
export interface MiniMapTransform {
    scale: number;
    offsetX: number;
    offsetY: number;
}

/** 导航图里每个图元只画一个简化图形 */
export type MiniMapShape =
    | { kind: "line"; from: Point; to: Point }
    | { kind: "circle"; center: Point; radius: number }
    | { kind: "rect"; box: BoundingBox }
    | { kind: "polyline"; points: Point[] };

export interface MiniMapEntry {
    id: string;
    shape: MiniMapShape;
}

/** 图元 → 导航图简化图形；无法还原几何时退化为包围盒 */
export function minimapShapes(elements: CADElement[]): MiniMapEntry[] {
    const entries: MiniMapEntry[] = [];

    for (const element of elements) {
        if (element.type === "LINE" && element.start && element.end) {
            entries.push({ id: element.id, shape: { kind: "line", from: element.start, to: element.end } });
            continue;
        }
        if (element.type === "CIRCLE" && element.center && element.radius) {
            entries.push({
                id: element.id,
                shape: { kind: "circle", center: element.center, radius: element.radius },
            });
            continue;
        }
        if (element.type === "LWPOLYLINE" && element.points && element.points.length > 1) {
            entries.push({ id: element.id, shape: { kind: "polyline", points: element.points } });
            continue;
        }
        entries.push({ id: element.id, shape: { kind: "rect", box: getElementBoundingBox(element) } });
    }

    return entries;
}

/** 全部图元的包围盒；空图纸返回 null */
export function minimapBounds(elements: CADElement[]): BoundingBox | null {
    if (elements.length === 0) return null;
    const boxes = elements.map(getElementBoundingBox);
    return {
        minX: Math.min(...boxes.map((box) => box.minX)),
        minY: Math.min(...boxes.map((box) => box.minY)),
        maxX: Math.max(...boxes.map((box) => box.maxX)),
        maxY: Math.max(...boxes.map((box) => box.maxY)),
    };
}

/** 等比缩放并居中：内容与导航图比例不同时取较小者，避免变形 */
export function minimapTransform(
    bounds: BoundingBox,
    size: MiniMapSize,
    padding = 4,
): MiniMapTransform {
    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1e-6);
    const usableWidth = Math.max(size.width - padding * 2, 1);
    const usableHeight = Math.max(size.height - padding * 2, 1);
    const scale = Math.min(usableWidth / contentWidth, usableHeight / contentHeight);

    return {
        scale,
        offsetX: (size.width - contentWidth * scale) / 2 - bounds.minX * scale,
        offsetY: (size.height - contentHeight * scale) / 2 - bounds.minY * scale,
    };
}

export function worldToMiniMap(point: Point, transform: MiniMapTransform): Point {
    return {
        x: point.x * transform.scale + transform.offsetX,
        y: point.y * transform.scale + transform.offsetY,
    };
}

export function miniMapToWorld(point: Point, transform: MiniMapTransform): Point {
    return {
        x: (point.x - transform.offsetX) / transform.scale,
        y: (point.y - transform.offsetY) / transform.scale,
    };
}
