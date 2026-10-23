/**
 * RotateTool.ts — 围绕基点拖拽旋转选中对象
 */

import * as Transform from "../lib/transform";
import type { CanvasTool } from "./BaseTool";
import { getSelectedElements } from "./BaseTool";

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

        const targets = getSelectedElements(ctx);
        if (targets.length === 0) return;

        const angle = (Math.atan2(ctx.point.y - ctx.drawStart.y, ctx.point.x - ctx.drawStart.x) * 180) / Math.PI;
        const rotated = Transform.rotateElements(targets, ctx.drawStart, angle);
        const rotatedById = new Map(rotated.map(element => [element.id, element]));

        ctx.commitAction(ctx.elements.map(element => rotatedById.get(element.id) ?? element));
        ctx.onNotification(`Rotated ${targets.length} objects.`);
    },
};

export default RotateTool;
