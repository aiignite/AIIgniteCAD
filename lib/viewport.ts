/**
 * viewport.ts — 视口（viewBox）纯计算工具
 *
 * 缩放、缩放范围限制与 Zoom Extents 都保持纯函数，
 * 便于单测，也避免交互层散落边界判断。
 */

import { Point } from "../types";
import { BoundingBox } from "./geometry";

export interface ViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export const DEFAULT_VIEWBOX: ViewBox = { x: 0, y: 0, w: 800, h: 600 };

/** 视口最小宽度（世界单位）：限制最大放大倍率 */
export const MIN_VIEW_WIDTH = 0.5;
/** 视口最大宽度（世界单位）：限制最大缩小倍率 */
export const MAX_VIEW_WIDTH = 200000;
/** 按钮/键盘缩放的固定步长 */
export const ZOOM_STEP = 1.2;

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

/** 合并多个包围盒；空数组返回 null */
export function unionBounds(bounds: BoundingBox[]): BoundingBox | null {
    if (bounds.length === 0) return null;
    return bounds.reduce<BoundingBox>((acc, box) => ({
        minX: Math.min(acc.minX, box.minX),
        minY: Math.min(acc.minY, box.minY),
        maxX: Math.max(acc.maxX, box.maxX),
        maxY: Math.max(acc.maxY, box.maxY),
    }), { ...bounds[0] });
}

/**
 * 以 anchor 为不动点缩放视口。
 * 始终保持 viewBox 宽高比；超出范围时只限制缩放，不改变锚点。
 */
export function zoomViewBoxAt(
    viewBox: ViewBox,
    anchor: Point,
    factor: number,
): ViewBox {
    if (!Number.isFinite(factor) || factor <= 0 || viewBox.w <= 0) {
        return viewBox;
    }

    const targetWidth = clamp(viewBox.w * factor, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH);
    const applied = targetWidth / viewBox.w;
    if (Math.abs(applied - 1) < 1e-9) return viewBox;

    return {
        x: anchor.x - (anchor.x - viewBox.x) * applied,
        y: anchor.y - (anchor.y - viewBox.y) * applied,
        w: viewBox.w * applied,
        h: viewBox.h * applied,
    };
}

/**
 * 计算包含指定范围的视口（Zoom Extents）。
 * @param bounds 内容包围盒；空图纸传 null
 * @param aspect 视口宽高比（像素宽 / 像素高）
 * @param paddingRatio 四周留白比例
 */
export function fitViewBox(
    bounds: BoundingBox | null,
    aspect: number,
    paddingRatio = 0.08,
): ViewBox {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;

    if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxY)) {
        return { ...DEFAULT_VIEWBOX };
    }

    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1e-6);
    const paddedWidth = contentWidth * (1 + paddingRatio * 2);
    const paddedHeight = contentHeight * (1 + paddingRatio * 2);

    // 同时容纳内容宽高，并匹配视口比例
    let width = Math.max(paddedWidth, paddedHeight * safeAspect);
    width = clamp(width, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH);
    const height = width / safeAspect;

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    return {
        x: centerX - width / 2,
        y: centerY - height / 2,
        w: width,
        h: height,
    };
}

/** 相对初始 800 宽的缩放百分比，用于状态栏展示 */
export function zoomPercent(viewBox: ViewBox, baseWidth = DEFAULT_VIEWBOX.w): number {
    if (viewBox.w <= 0) return 100;
    return Math.round((baseWidth / viewBox.w) * 100);
}
