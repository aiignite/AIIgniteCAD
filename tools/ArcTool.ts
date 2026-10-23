/**
 * ArcTool.ts — 三点圆弧工具
 *
 * 依次拾取起点、圆弧上一点、终点，由三点外接圆求解圆心与方向。
 */

import { dist } from "../lib/canvasGeometry";
import type { CanvasTool } from "./BaseTool";
import { createElementId } from "./BaseTool";

const ArcTool: CanvasTool = {
    onMouseDown(ctx) {
        const points = [...ctx.arcPoints, ctx.point];

        if (points.length < 3) {
            ctx.setArcPoints(points);
            ctx.setDragMode("ARC_POINT");
            return;
        }

        const [p1, p2, p3] = points;
        const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));

        if (Math.abs(D) < 0.01) {
            ctx.onNotification("Points are collinear, cannot draw arc.");
        } else {
            const Ux = ((p1.x ** 2 + p1.y ** 2) * (p2.y - p3.y) + (p2.x ** 2 + p2.y ** 2) * (p3.y - p1.y) + (p3.x ** 2 + p3.y ** 2) * (p1.y - p2.y)) / D;
            const Uy = ((p1.x ** 2 + p1.y ** 2) * (p3.x - p2.x) + (p2.x ** 2 + p2.y ** 2) * (p1.x - p3.x) + (p3.x ** 2 + p3.y ** 2) * (p2.x - p1.x)) / D;
            const center = { x: Ux, y: Uy };
            const radius = dist(center, p1);

            const startAngle = (Math.atan2(p1.y - center.y, p1.x - center.x) * 180) / Math.PI;
            const midAngle = (Math.atan2(p2.y - center.y, p2.x - center.x) * 180) / Math.PI;
            const endAngle = (Math.atan2(p3.y - center.y, p3.x - center.x) * 180) / Math.PI;

            // 通过中间点判断顺/逆时针
            const norm = (angle: number) => (angle + 360) % 360;
            const a1 = norm(startAngle);
            const a2 = norm(midAngle);
            const a3 = norm(endAngle);
            const cwDist12 = (a2 - a1 + 360) % 360;
            const cwDist13 = (a3 - a1 + 360) % 360;

            ctx.addElement({
                id: createElementId(),
                type: "ARC",
                layer: ctx.currentLayer,
                color: ctx.currentLayerColor,
                center,
                radius,
                startAngle,
                endAngle,
                clockwise: cwDist12 < cwDist13,
            });
        }

        ctx.setArcPoints([]);
        ctx.setDragMode(null);
    },

    onMouseUp() {
        return { keepDragState: true };
    },
};

export default ArcTool;
