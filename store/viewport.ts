/**
 * viewport.ts — 视口状态的瞬态外部 store
 *
 * 视图与文档分离：缩放 / 平移不进撤销历史，也不触发文档脏标记。
 * 用外部 store + useSyncExternalStore，只有订阅视口的组件随缩放重渲染。
 */

import type { BoundingBox } from "../lib/geometry";
import { DEFAULT_VIEWBOX, fitViewBox, zoomViewBoxAt, type ViewBox } from "../lib/viewport";

let viewBox: ViewBox = DEFAULT_VIEWBOX;
let aspect = 4 / 3;
const listeners = new Set<() => void>();

export function getViewBox(): ViewBox {
    return viewBox;
}

export function subscribeViewBox(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function apply(next: ViewBox): void {
    if (
        next.x === viewBox.x &&
        next.y === viewBox.y &&
        next.w === viewBox.w &&
        next.h === viewBox.h
    ) {
        return;
    }
    viewBox = next;
    listeners.forEach((listener) => listener());
}

/** 设置视口；支持函数式更新 */
export function setViewBox(next: ViewBox | ((prev: ViewBox) => ViewBox)): void {
    apply(typeof next === "function" ? next(viewBox) : next);
}

/** 记录画布像素宽高比，缩放到范围时用它匹配视口比例 */
export function setViewportAspect(value: number): void {
    if (Number.isFinite(value) && value > 0) aspect = value;
}

/** 以视口中心为锚点按倍率缩放 */
export function zoomViewportBy(factor: number): void {
    setViewBox((prev) =>
        zoomViewBoxAt(prev, { x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 }, factor),
    );
}

/** 缩放到给定包围盒；空包围盒回到默认视口 */
export function zoomViewportToBounds(bounds: BoundingBox | null): void {
    setViewBox(fitViewBox(bounds, aspect));
}

/** 窗口缩放：两点确定矩形 */
export function zoomViewportToRect(x1: number, y1: number, x2: number, y2: number): void {
    zoomViewportToBounds({
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2),
    });
}

/** 回到初始视口 */
export function resetViewport(): void {
    setViewBox(DEFAULT_VIEWBOX);
}
