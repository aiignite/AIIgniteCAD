/**
 * HatchTool.ts — 填充占位工具
 */

import type { CanvasTool } from "./BaseTool";

const HatchTool: CanvasTool = {
    onMouseDown(ctx) {
        ctx.onNotification(`Tool '${ctx.activeTool}' is complex and requires backend implementation.`);
    },
};

export default HatchTool;
