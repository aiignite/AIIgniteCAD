/**
 * grip.ts — 夹点（Grip）计算与拖拽应用
 *
 * 为选中图元生成可拖拽控制点，并定义拖拽后如何改写图元属性。
 * 纯函数实现，便于单测；画布交互层只负责命中与提交历史。
 */

import { CADElement, Point } from "../types";
import { dist } from "./canvasGeometry";

/** 夹点句柄：指明所属图元与被修改的属性 */
export interface GripPoint {
    /** 所属图元 ID */
    elementId: string;
    /** 控制点语义，决定拖拽时改写哪个属性 */
    key:
        | "start"
        | "end"
        | "center"
        | "offsetPoint"
        | "radius"
        | "arcStart"
        | "arcEnd"
        | `point:${number}`
        | "corner:0"
        | "corner:1"
        | "corner:2"
        | "corner:3";
    /** 夹点当前坐标 */
    point: Point;
}

/** 圆的四个象限角度，用于半径夹点 */
const QUADRANT_ANGLES = [0, 90, 180, 270];

/**
 * 计算圆/圆弧上某个角度对应的坐标。
 */
const pointOnCircle = (center: Point, radius: number, angleDeg: number): Point => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
        x: center.x + radius * Math.cos(rad),
        y: center.y + radius * Math.sin(rad),
    };
};

/**
 * 生成图元的夹点列表。
 * 类型不同，控制点也不同：线取两端，矩形取四角，圆取圆心+象限点，多段线取各顶点。
 */
export const getGripPoints = (el: CADElement): GripPoint[] => {
    const grips: GripPoint[] = [];

    if (el.type === "LINE" && el.start && el.end) {
        grips.push({ elementId: el.id, key: "start", point: el.start });
        grips.push({ elementId: el.id, key: "end", point: el.end });
        return grips;
    }

    if (el.type === "RECTANGLE" && el.start && el.width !== undefined && el.height !== undefined) {
        const { x, y } = el.start;
        const corners: Point[] = [
            { x, y },
            { x: x + el.width, y },
            { x: x + el.width, y: y + el.height },
            { x, y: y + el.height },
        ];
        corners.forEach((point, index) => {
            grips.push({ elementId: el.id, key: `corner:${index}` as GripPoint["key"], point });
        });
        return grips;
    }

    if (el.type === "CIRCLE" && el.center && el.radius) {
        grips.push({ elementId: el.id, key: "center", point: el.center });
        QUADRANT_ANGLES.forEach(angle => {
            grips.push({ elementId: el.id, key: "radius", point: pointOnCircle(el.center!, el.radius!, angle) });
        });
        return grips;
    }

    if (el.type === "ARC" && el.center && el.radius && el.startAngle !== undefined && el.endAngle !== undefined) {
        grips.push({ elementId: el.id, key: "center", point: el.center });
        grips.push({ elementId: el.id, key: "arcStart", point: pointOnCircle(el.center, el.radius, el.startAngle) });
        grips.push({ elementId: el.id, key: "arcEnd", point: pointOnCircle(el.center, el.radius, el.endAngle) });
        return grips;
    }

    if (el.type === "LWPOLYLINE" && el.points) {
        el.points.forEach((point, index) => {
            grips.push({ elementId: el.id, key: `point:${index}`, point });
        });
        return grips;
    }

    if (el.type === "TEXT" && el.start) {
        grips.push({ elementId: el.id, key: "start", point: el.start });
        return grips;
    }

    if (el.type === "DIMENSION") {
        if (el.start) grips.push({ elementId: el.id, key: "start", point: el.start });
        if (el.end) grips.push({ elementId: el.id, key: "end", point: el.end });
        if (el.offsetPoint) grips.push({ elementId: el.id, key: "offsetPoint", point: el.offsetPoint });
        return grips;
    }

    if (el.center) {
        grips.push({ elementId: el.id, key: "center", point: el.center });
    }
    return grips;
};

/**
 * 按夹点拖拽结果返回更新后的图元。
 * 保持图元类型不变（矩形只改变位置/尺寸，不转为多段线）。
 */
export const applyGripDrag = (el: CADElement, grip: GripPoint, target: Point): CADElement => {
    const updated: CADElement = { ...el };

    switch (grip.key) {
        case "start":
            updated.start = target;
            return updated;
        case "end":
            updated.end = target;
            return updated;
        case "center":
            updated.center = target;
            return updated;
        case "offsetPoint":
            updated.offsetPoint = target;
            return updated;

        case "radius":
            if (updated.center) {
                updated.radius = Math.max(dist(updated.center, target), 0.01);
            }
            return updated;

        case "arcStart":
            if (updated.center) {
                updated.startAngle = Math.atan2(target.y - updated.center.y, target.x - updated.center.x) * 180 / Math.PI;
            }
            return updated;

        case "arcEnd":
            if (updated.center) {
                updated.endAngle = Math.atan2(target.y - updated.center.y, target.x - updated.center.x) * 180 / Math.PI;
            }
            return updated;

        default:
            break;
    }

    // 多段线顶点
    if (grip.key.startsWith("point:")) {
        const index = Number(grip.key.slice("point:".length));
        if (updated.points && index >= 0 && index < updated.points.length) {
            updated.points = updated.points.map((p, i) => (i === index ? target : p));
        }
        return updated;
    }

    // 矩形四角：保持对角固定，重算起点与宽高
    if (grip.key.startsWith("corner:") && el.start && el.width !== undefined && el.height !== undefined) {
        const index = Number(grip.key.slice("corner:".length));
        const opposite = [
            { x: el.start.x + el.width, y: el.start.y + el.height },
            { x: el.start.x, y: el.start.y + el.height },
            { x: el.start.x, y: el.start.y },
            { x: el.start.x + el.width, y: el.start.y },
        ][index];

        updated.start = { x: Math.min(opposite.x, target.x), y: Math.min(opposite.y, target.y) };
        updated.width = Math.abs(target.x - opposite.x);
        updated.height = Math.abs(target.y - opposite.y);
        return updated;
    }

    return updated;
};
