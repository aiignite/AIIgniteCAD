/**
 * TrimTool.ts — 点击删除命中图元（修剪占位实现）
 */

import type { CanvasTool } from "./BaseTool";

const TrimTool: CanvasTool = {
    onMouseDown(ctx) {
        const hit = ctx.findHitElement(ctx.rawPoint);
        if (!hit) return;
        ctx.commitAction(ctx.elements.filter(element => element.id !== hit.id));
    },
};

export default TrimTool;
