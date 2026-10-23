/**
 * RotateTool.ts — 围绕基点拖拽旋转选中对象
 *
 * 支持动态输入：基点按下后键入角度并回车，按该角度精确旋转。
 */

import * as Transform from "../lib/transform";
import { dist } from "../lib/canvasGeometry";
import type { CanvasTool, ToolContext } from "./BaseTool";
import { getSelectedElements } from "./BaseTool";

function applyRotation(ctx: ToolContext, base: { x: number; y: number }, angle: number): void {
    const targets = getSelectedElements(ctx);
    if (targets.length === 0) return;

    const rotated = Transform.rotateElements(targets, base, angle);
    const rotatedById = new Map(rotated.map(element => [element.id, element]));

    ctx.commitAction(ctx.elements.map(element => rotatedById.get(element.id) ?? element));
    ctx.onNotification(`Rotated ${targets.length} objects by ${angle.toFixed(1)}°.`);
    ctx.setDragMode(null);
    ctx.setDrawStart(null);
    ctx.setCurrentPoint(null);
}

const RotateTool: CanvasTool = {
    onMouseDown(ctx) {
        if (getSelectedElements(ctx).length === 0) {
            ctx.onNotification("Select objects first to rotate.");
            return;
        }
        ctx.setDragMode("ROTATE_ITEMS");
        ctx.setDrawStart(ctx.point);
    },

    onMouseUp(ctx) {
        if (ctx.dragMode !== "ROTATE_ITEMS" || !ctx.drawStart) return;
        // 只点击基点：保留状态等待拖拽或键入角度（与 SCALE 一致）
        if (dist(ctx.drawStart, ctx.point) <= 2) return { keepDragState: true };

        const angle = (Math.atan2(ctx.point.y - ctx.drawStart.y, ctx.point.x - ctx.drawStart.x) * 180) / Math.PI;
        applyRotation(ctx, ctx.drawStart, angle);
    },

    onDynamicSubmit(ctx, values) {
        if (ctx.dragMode !== "ROTATE_ITEMS" || !ctx.drawStart) return;
        // 未键入角度时交给拖拽路径，不做无意义的零角旋转
        if (typeof values.angle !== "number" || !Number.isFinite(values.angle)) return;
        applyRotation(ctx, ctx.drawStart, values.angle);
    },
};

export default RotateTool;
