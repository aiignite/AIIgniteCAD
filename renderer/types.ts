/**
 * types.ts — 渲染器接口
 *
 * 当前只有 SVG 实现。抽出接口的目的是把坐标换算与命中测试从组件中剥离，
 * 为将来评估 Canvas 2D 渲染保留替换点，而不是提前重写渲染层。
 */

import type { CADElement, Point } from "../types";
import type { ViewBox } from "../lib/viewport";

export interface RenderViewport {
    viewBox: ViewBox;
    /** 画布 CSS 像素尺寸 */
    width: number;
    height: number;
}

export interface Renderer {
    /** 世界坐标 → 画布内屏幕坐标 */
    toScreen(point: Point, viewport: RenderViewport): Point;
    /** 画布内屏幕坐标 → 世界坐标 */
    toWorld(point: Point, viewport: RenderViewport): Point;
    /** 命中测试：返回候选中最上层（后绘制）的图元 */
    hitTest(
        point: Point,
        candidates: readonly CADElement[],
        tolerance: number,
    ): CADElement | null;
    /** 命中测试：按从上到下顺序返回全部命中，供点击循环使用 */
    hitTestAll(
        point: Point,
        candidates: readonly CADElement[],
        tolerance: number,
    ): CADElement[];
}
