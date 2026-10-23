/**
 * LineTool.ts — 两点直线工具
 *
 * 同时支持两种习惯：按住拖拽画线，以及点击起点后再点击终点（AutoCAD / SketchUp）。
 * 单击不拖动时保留锚点，供第二次点击或动态输入提交。
 */

import type { CanvasTool } from "./BaseTool";
import { createElementId, isDragBeyond } from "./BaseTool";

const LineTool: CanvasTool = {
    onMouseDown(ctx) {
        // 已有锚点：这次按下是终点，直接提交
        if (ctx.dragMode === "DRAW" && ctx.drawStart) {
            if (isDragBeyond(ctx.drawStart, ctx.point)) {
                ctx.addElement({
                    id: createElementId(),
                    type: "LINE",
                    layer: ctx.currentLayer,
                    color: ctx.currentLayerColor,
                    start: ctx.drawStart,
                    end: ctx.point,
                });
            }
            ctx.setDragMode(null);
            ctx.setDrawStart(null);
            return;
        }

        ctx.setDragMode("DRAW");
        ctx.setDrawStart(ctx.point);
        ctx.setCurrentPoint(ctx.point);
    },

    onMouseUp(ctx) {
        if (ctx.dragMode !== "DRAW" || !ctx.drawStart || !ctx.currentPoint) return;
        if (!isDragBeyond(ctx.drawStart, ctx.point)) {
            return { keepDragState: true };
        }

        ctx.addElement({
            id: createElementId(),
            type: "LINE",
            layer: ctx.currentLayer,
            color: ctx.currentLayerColor,
            start: ctx.drawStart,
            end: ctx.point,
        });
    },
};

export default LineTool;
