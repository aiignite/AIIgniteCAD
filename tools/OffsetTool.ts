/**
 * OffsetTool.ts — 按点击距离偏移选中对象
 *
 * 以点击位置到选中对象形心的距离作为偏移量。
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

        const centroid = Transform.getElementsCentroid(targets);
        const distance = dist(centroid, ctx.point);
        if (distance < 1) {
            ctx.onNotification("Move farther from the selection to set the offset distance.");
            return;
        }

        const copies = offsetElements(targets, distance);
        ctx.commitAction([...ctx.elements, ...copies]);
        ctx.setSelection(copies.map(element => element.id));
        ctx.onNotification(`Offset by ${distance.toFixed(2)}`);
    },
};

export default OffsetTool;
