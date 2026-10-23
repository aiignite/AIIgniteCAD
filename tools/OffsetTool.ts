/**
 * OffsetTool.ts — 偏移选中对象
 *
 * 优先使用动态输入键入的距离；未键入时以点击位置到选中对象形心的距离作为偏移量。
 */

import { dist } from "../lib/canvasGeometry";
import * as Transform from "../lib/transform";
import { offsetElements } from "../services/offsetService";
import type { CanvasTool } from "./BaseTool";
import { getSelectedElements } from "./BaseTool";

const OffsetTool: CanvasTool = {
    onMouseDown(ctx) {
        const targets = getSelectedElements(ctx);
        if (targets.length === 0) {
            ctx.onNotification("Select objects first to offset.");
            return;
        }

        // 键入的距离优先，可连续点击按同一距离多次偏移
        const distance =
            ctx.dynamicDistance !== null && ctx.dynamicDistance > 0
                ? ctx.dynamicDistance
                : dist(Transform.getElementsCentroid(targets), ctx.point);
        if (!Number.isFinite(distance) || distance < 1) {
            ctx.onNotification("Type a distance or click farther from the selection.");
            return;
        }

        const copies = offsetElements(targets, distance);
        ctx.commitAction([...ctx.elements, ...copies]);
        ctx.setSelection(copies.map(element => element.id));
        ctx.onNotification(`Offset by ${distance.toFixed(2)}`);
    },
};

export default OffsetTool;
