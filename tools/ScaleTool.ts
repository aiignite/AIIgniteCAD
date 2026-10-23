/**
 * ScaleTool.ts — 两次点击的缩放工具
 *
 * 第一次点击确定基点，第二次点击按光标到基点的距离计算倍率并应用。
 */

import { getScaleFactor } from "../lib/canvasGeometry";
import * as Transform from "../lib/transform";
import type { CanvasTool } from "./BaseTool";
import { getSelectedElements } from "./BaseTool";

const ScaleTool: CanvasTool = {
    onMouseDown(ctx) {
        const targets = getSelectedElements(ctx);
        if (targets.length === 0) {
            ctx.onNotification("Select objects first to scale.");
            return;
        }

        if (ctx.dragMode !== "SCALE_ITEMS" || !ctx.drawStart) {
            ctx.setDrawStart(ctx.point);
            ctx.setCurrentPoint(ctx.point);
            ctx.setDragMode("SCALE_ITEMS");
            ctx.onNotification("Scale base point set. Move and click to apply.");
            return;
        }

        const factor = getScaleFactor(ctx.drawStart, ctx.point, targets);
        const scaledById = new Map(
            Transform.scaleElements(targets, ctx.drawStart, factor, factor).map(element => [
                element.id,
                element,
            ]),
        );

        ctx.commitAction(ctx.elements.map(element => scaledById.get(element.id) ?? element));
        ctx.onNotification(`Scaled selection ×${factor.toFixed(2)}`);
        ctx.setDragMode(null);
        ctx.setDrawStart(null);
        ctx.setCurrentPoint(null);
    },

    onMouseUp(ctx) {
        // 基点点击的 mouseup 需要保留拖拽态，等待第二次点击
        if (ctx.dragMode === "SCALE_ITEMS") return { keepDragState: true };
    },
};

export default ScaleTool;
