/**
 * MeasureTool.ts — 两点测距工具
 *
 * 按住拖动测量，松开后在状态栏通知距离。
 */

import { dist } from "../lib/canvasGeometry";
import type { CanvasTool } from "./BaseTool";

const MeasureTool: CanvasTool = {
    onMouseDown(ctx) {
        ctx.setDragMode("MEASURE");
        ctx.setDrawStart(ctx.point);
        ctx.setCurrentPoint(ctx.point);
    },

    onMouseUp(ctx) {
        if (ctx.dragMode !== "MEASURE" || !ctx.drawStart) return;
        const distance = dist(ctx.drawStart, ctx.point);
        ctx.onNotification(
            `Distance: ${distance.toFixed(ctx.drawingSettings.dimPrecision)} ${ctx.drawingSettings.units}`,
        );
    },
};

export default MeasureTool;
