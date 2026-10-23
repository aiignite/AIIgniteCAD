/**
 * CopyTool.ts — 拖拽复制工具
 */

import type { CanvasTool } from "./BaseTool";
import { finishCopy, finishSelectionBox, handleSelectionPress } from "./BaseTool";

const CopyTool: CanvasTool = {
    onMouseDown(ctx) {
        if (ctx.button !== 0) return;
        handleSelectionPress(ctx, "COPY_ITEMS");
    },

    onMouseUp(ctx) {
        if (ctx.dragMode === "SELECT_BOX") finishSelectionBox(ctx);
        if (ctx.dragMode === "COPY_ITEMS") finishCopy(ctx);
    },
};

export default CopyTool;
