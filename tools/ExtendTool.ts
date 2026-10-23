/**
 * ExtendTool.ts — 延伸
 *
 * 点击目标的一端，沿该端向外延伸到最近的边界交点；
 * 几何求交在 lib/trimExtend.ts，可单测。
 */

import { extendElementAt } from "../lib/trimExtend";
import type { CanvasTool } from "./BaseTool";

const ExtendTool: CanvasTool = {
    onMouseDown(ctx) {
        const hit = ctx.findHitElement(ctx.rawPoint);
        if (!hit) return;

        const others = ctx.elements.filter((element) => element.id !== hit.id);
        const extended = extendElementAt(hit, ctx.point, others);
        if (!extended) {
            ctx.onNotification("No boundary in the extend direction.");
            return;
        }

        ctx.commitAction(ctx.elements.map((element) => (element.id === hit.id ? extended : element)));
        ctx.onNotification("Extended to boundary.");
    },
};

export default ExtendTool;
