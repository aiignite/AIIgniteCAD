/**
 * CircleTool.ts — 圆心 + 半径圆工具
 *
 * 支持拖拽与"点击圆心-移动-点击确定半径"，单击后也可直接键入半径。
 */

import { dist } from "../lib/canvasGeometry";
import type { CanvasTool } from "./BaseTool";
import { createElementId, isDragBeyond } from "./BaseTool";

const CircleTool: CanvasTool = {
    onMouseDown(ctx) {
        if (ctx.dragMode === "DRAW" && ctx.drawStart) {
            if (isDragBeyond(ctx.drawStart, ctx.point)) {
                ctx.addElement({
                    id: createElementId(),
                    type: "CIRCLE",
                    layer: ctx.currentLayer,
                    color: ctx.currentLayerColor,
                    center: ctx.drawStart,
                    radius: dist(ctx.drawStart, ctx.point),
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
            type: "CIRCLE",
            layer: ctx.currentLayer,
            color: ctx.currentLayerColor,
            center: ctx.drawStart,
            radius: dist(ctx.drawStart, ctx.point),
        });
    },
};

export default CircleTool;
