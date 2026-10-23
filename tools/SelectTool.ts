/**
 * SelectTool.ts — 选择 / 移动 / 框选 / 夹点编辑
 */

import { dist } from "../lib/canvasGeometry";
import { applyGripDrag } from "../lib/grip";
import type { CanvasTool } from "./BaseTool";
import { finishMove, finishSelectionBox, handleSelectionPress } from "./BaseTool";

const SelectTool: CanvasTool = {
    onMouseDown(ctx) {
        if (ctx.button !== 0) return;
        handleSelectionPress(ctx, "MOVE_ITEMS");
    },

    onMouseUp(ctx) {
        if (ctx.dragMode === "GRIP_EDIT" && ctx.activeGrip) {
            const grip = ctx.activeGrip;
            const moved = dist(grip.point, ctx.point) > 0.01;
            if (moved && ctx.elements.some(element => element.id === grip.elementId)) {
                ctx.commitAction(
                    ctx.elements.map(element =>
                        element.id === grip.elementId ? applyGripDrag(element, grip, ctx.point) : element,
                    ),
                );
            }
            ctx.setActiveGrip(null);
            return;
        }

        if (ctx.dragMode === "SELECT_BOX") finishSelectionBox(ctx);
        if (ctx.dragMode === "MOVE_ITEMS") finishMove(ctx);
    },
};

export default SelectTool;
