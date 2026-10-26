/**
 * HatchTool.ts — 填充工具
 *
 * 点击工具即打开填充对话框：对当前选择集的边界生成 HATCH 图元。
 * 参数（图案 / 颜色）由对话框收集，实际生成逻辑见 services/hatchService。
 */

import type { CanvasTool } from "./BaseTool";

const HatchTool: CanvasTool = {
    onMouseDown(ctx) {
        if (ctx.onRequestHatch) {
            ctx.onRequestHatch();
            return;
        }
        // 未接线对话框时给出明确提示，不再显示"需要后端实现"的占位文案
        ctx.onNotification("Hatch requires a selection; the hatch dialog is unavailable.");
    },
};

export default HatchTool;
