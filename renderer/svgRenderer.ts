/**
 * svgRenderer.ts — SVG 渲染器的坐标换算与命中测试
 *
 * viewBox 按短边适配并居中，与 <svg preserveAspectRatio> 的默认行为一致；
 * 命中测试沿用 lib/canvasGeometry 的精确几何判断。
 */

import type { CADElement, Point } from "../types";
import type { BoundingBox } from "../lib/geometry";
import { isPointOnElement } from "../lib/canvasGeometry";
import type { Renderer, RenderViewport } from "./types";

/** viewBox 在一屏内的像素比例（短边适配） */
export function computePixelsPerUnit(viewport: RenderViewport): number {
    const { viewBox, width, height } = viewport;
    const scale = Math.min(
        viewBox.w > 0 ? width / viewBox.w : 1,
        viewBox.h > 0 ? height / viewBox.h : 1,
    );
    return scale > 0 ? scale : 1;
}

/** 视口包围盒：按比例外扩，避免边缘图元在平移时闪烁 */
export function bufferedViewportBounds(
    viewport: RenderViewport,
    bufferRatio = 0.1,
): BoundingBox {
    const { viewBox } = viewport;
    const padX = viewBox.w * bufferRatio;
    const padY = viewBox.h * bufferRatio;
    return {
        minX: viewBox.x - padX,
        minY: viewBox.y - padY,
        maxX: viewBox.x + viewBox.w + padX,
        maxY: viewBox.y + viewBox.h + padY,
    };
}

class SvgRenderer implements Renderer {
    toScreen(point: Point, viewport: RenderViewport): Point {
        const scale = computePixelsPerUnit(viewport);
        const { viewBox, width, height } = viewport;
        return {
            x: (width - viewBox.w * scale) / 2 + (point.x - viewBox.x) * scale,
            y: (height - viewBox.h * scale) / 2 + (point.y - viewBox.y) * scale,
        };
    }

    toWorld(point: Point, viewport: RenderViewport): Point {
        const scale = computePixelsPerUnit(viewport);
        const { viewBox, width, height } = viewport;
        return {
            x: viewBox.x + (point.x - (width - viewBox.w * scale) / 2) / scale,
            y: viewBox.y + (point.y - (height - viewBox.h * scale) / 2) / scale,
        };
    }

    hitTest(
        point: Point,
        candidates: readonly CADElement[],
        tolerance: number,
    ): CADElement | null {
        for (let i = candidates.length - 1; i >= 0; i--) {
            if (isPointOnElement(point, candidates[i], tolerance)) return candidates[i];
        }
        return null;
    }

    hitTestAll(
        point: Point,
        candidates: readonly CADElement[],
        tolerance: number,
    ): CADElement[] {
        const hits: CADElement[] = [];
        for (let i = candidates.length - 1; i >= 0; i--) {
            if (isPointOnElement(point, candidates[i], tolerance)) hits.push(candidates[i]);
        }
        return hits;
    }
}

export const svgRenderer: Renderer = new SvgRenderer();
