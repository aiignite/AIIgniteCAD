/**
 * TextTool.ts — 单行文字工具
 *
 * 点击位置后请求上层弹出文字输入框。
 */

import type { CanvasTool } from "./BaseTool";

const TextTool: CanvasTool = {
    onMouseDown(ctx) {
        ctx.onRequestTextEntry(ctx.point);
    },
};

export default TextTool;
