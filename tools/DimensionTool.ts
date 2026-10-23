/**
 * DimensionTool.ts — 三点线性标注工具
 *
 * 第一次点击标注起点，第二次点击终点，第三次点击确定标注高度。
 */

import type { CanvasTool } from "./BaseTool";
import { createElementId } from "./BaseTool";

const DimensionTool: CanvasTool = {
    onMouseDown(ctx) {
        if (ctx.dimPoints.length === 0) {
            ctx.setDimPoints([ctx.point]);
            ctx.setDrawStart(ctx.point);
            return;
        }

        if (ctx.dimPoints.length === 1) {
            ctx.setDimPoints(prev => [...prev, ctx.point]);
            ctx.setDragMode("DIMENSION_HEIGHT");
            return;
        }

        ctx.addElement({
            id: createElementId(),
            type: "DIMENSION",
            layer: "DIM",
            color: "#4ade80",
            start: ctx.dimPoints[0],
            end: ctx.dimPoints[1],
            offsetPoint: ctx.point,
        });
        ctx.setDimPoints([]);
        ctx.setDragMode(null);
    },

    onMouseUp() {
        return { keepDragState: true };
    },
};

export default DimensionTool;
