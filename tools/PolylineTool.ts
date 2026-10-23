/**
 * PolylineTool.ts — 逐点拾取的多段线工具
 *
 * 点击追加顶点，Enter 完成（由 useCanvasInteraction 的键盘处理调用 finishPolyline）。
 */

import type { CADElement, DragMode, Point } from "../types";
import type { CanvasTool, StateSetter } from "./BaseTool";
import { createElementId } from "./BaseTool";

/** 完成多段线所需的状态与动作，便于键盘处理复用 */
export interface PolylineFinishContext {
    polyPoints: Point[];
    currentLayer: string;
    currentLayerColor: string;
    addElement: (element: CADElement) => void;
    setPolyPoints: StateSetter<Point[]>;
    setDragMode: StateSetter<DragMode | null>;
}

/** 将已拾取的顶点提交为 LWPOLYLINE 并清理多步状态 */
export function finishPolyline(ctx: PolylineFinishContext): void {
    ctx.addElement({
        id: createElementId(),
        type: "LWPOLYLINE",
        layer: ctx.currentLayer,
        color: ctx.currentLayerColor,
        points: ctx.polyPoints,
    });
    ctx.setPolyPoints([]);
    ctx.setDragMode(null);
}

const PolylineTool: CanvasTool = {
    onMouseDown(ctx) {
        ctx.setPolyPoints(prev => [...prev, ctx.point]);
        ctx.setDragMode("POLYLINE_ADD");
    },

    onMouseUp() {
        return { keepDragState: true };
    },
};

export default PolylineTool;
