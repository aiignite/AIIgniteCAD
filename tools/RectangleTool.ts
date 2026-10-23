/**
 * RectangleTool.ts — 对角点矩形工具
 *
 * 支持拖拽与"点击-移动-点击"两种方式；单击不拖动时等待第二次点击或键入宽高。
 */

import type { CanvasTool } from "./BaseTool";
import { createElementId, isDragBeyond } from "./BaseTool";

const RectangleTool: CanvasTool = {
    onMouseDown(ctx) {
        if (ctx.dragMode === "DRAW" && ctx.drawStart) {
            if (isDragBeyond(ctx.drawStart, ctx.point)) {
                ctx.addElement({
                    id: createElementId(),
                    type: "RECTANGLE",
                    layer: ctx.currentLayer,
                    color: ctx.currentLayerColor,
                    start: ctx.drawStart,
                    width: ctx.point.x - ctx.drawStart.x,
                    height: ctx.point.y - ctx.drawStart.y,
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
            type: "RECTANGLE",
            layer: ctx.currentLayer,
            color: ctx.currentLayerColor,
            start: ctx.drawStart,
            width: ctx.point.x - ctx.drawStart.x,
            height: ctx.point.y - ctx.drawStart.y,
        });
    },
};

export default RectangleTool;
