/**
 * MirrorTool.ts — 沿拖拽直线镜像选中对象
 */

import type { CADElement, Point } from "../types";
import { dist } from "../lib/canvasGeometry";
import type { CanvasTool } from "./BaseTool";
import { createElementId, getSelectedElements } from "./BaseTool";

/** 将点沿经过 a、b 的直线反射 */
function reflectAcrossLine(point: Point, a: Point, b: Point): Point {
    const A = b.y - a.y;
    const B = a.x - b.x;
    const C = -A * a.x - B * a.y;
    const div = A * A + B * B;
    const d = (A * point.x + B * point.y + C) / div;
    return { x: point.x - 2 * A * d, y: point.y - 2 * B * d };
}

const MirrorTool: CanvasTool = {
    onMouseDown(ctx) {
        ctx.setDragMode("MIRROR_LINE");
        ctx.setDrawStart(ctx.point);
        ctx.setCurrentPoint(ctx.point);
    },

    onMouseUp(ctx) {
        if (ctx.dragMode !== "MIRROR_LINE" || !ctx.drawStart) return;
        if (dist(ctx.drawStart, ctx.point) <= 5) return;

        const targets = getSelectedElements(ctx);
        if (targets.length === 0) {
            ctx.onNotification("No objects selected to mirror.");
            return;
        }

        const start = ctx.drawStart;
        const end = ctx.point;
        const newItems = targets.map(element => {
            const copy: CADElement = { ...element, id: createElementId() };
            const reflect = (point: Point) => reflectAcrossLine(point, start, end);

            if (copy.start) copy.start = reflect(copy.start);
            if (copy.end) copy.end = reflect(copy.end);
            if (copy.center) copy.center = reflect(copy.center);
            if (copy.points) copy.points = copy.points.map(reflect);
            if (copy.offsetPoint) copy.offsetPoint = reflect(copy.offsetPoint);

            // 矩形镜像后无法保持轴对齐，转为多段线
            if (copy.type === "RECTANGLE" && element.start && element.width && element.height) {
                const corners = [
                    element.start,
                    { x: element.start.x + element.width, y: element.start.y },
                    { x: element.start.x + element.width, y: element.start.y + element.height },
                    { x: element.start.x, y: element.start.y + element.height },
                ].map(reflect);

                copy.type = "LWPOLYLINE";
                copy.points = [...corners, corners[0]];
                delete copy.width;
                delete copy.height;
                copy.start = undefined;
            }

            return copy;
        });

        if (newItems.length === 0) return;
        ctx.commitAction([...ctx.elements, ...newItems]);
        ctx.setSelection(newItems.map(element => element.id));
        ctx.onNotification(`Mirrored ${newItems.length} objects.`);
    },
};

export default MirrorTool;
