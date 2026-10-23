/**
 * TrimTool.ts — 快速修剪
 *
 * 对齐 AutoCAD 2020+ 的免选边界模式：其余图元互为剪切边界，
 * 点击目标上要剪掉的段落即可；几何拆分在 lib/trimExtend.ts，可单测。
 */

import { trimElementAt } from "../lib/trimExtend";
import type { CanvasTool } from "./BaseTool";
import { createElementId } from "./BaseTool";

const TrimTool: CanvasTool = {
    onMouseDown(ctx) {
        const hit = ctx.findHitElement(ctx.rawPoint);
        if (!hit) return;

        const others = ctx.elements.filter((element) => element.id !== hit.id);
        const outcome = trimElementAt(hit, ctx.point, others, createElementId);
        if (!outcome) {
            ctx.onNotification("No cutting edges cross this object; nothing to trim.");
            return;
        }

        if (outcome.replacements.length === 0) {
            ctx.commitAction(ctx.elements.filter((element) => element.id !== hit.id));
            ctx.onNotification("Trimmed.");
            return;
        }

        ctx.commitAction(
            ctx.elements.flatMap((element) =>
                element.id === hit.id ? outcome.replacements : [element],
            ),
        );
        ctx.onNotification("Trimmed.");
    },
};

export default TrimTool;
