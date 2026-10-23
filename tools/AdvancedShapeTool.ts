/**
 * AdvancedShapeTool.ts — 齿轮 / 多边形 / 椭圆 / 涡旋 / 弹簧 / 渐开线
 *
 * 画布内点击只负责把位置交给参数弹窗，图形由上层生成。
 */

import type { CanvasTool } from "./BaseTool";

const AdvancedShapeTool: CanvasTool = {
    onMouseDown(ctx) {
        ctx.onRequestAdvancedShape?.(ctx.activeTool, ctx.point);
    },
};

export default AdvancedShapeTool;
