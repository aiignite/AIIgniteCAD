/**
 * selection.ts — 窗口选择 / 交叉选择
 *
 * 遵循 CAD 惯例：
 * - 从左向右拖拽 = 窗口选择（Window），仅选中完全位于矩形内的对象；
 * - 从右向左拖拽 = 交叉选择（Crossing），选中与矩形相交或位于其内的对象。
 */

import { CADElement, Point } from "../types";
import { BoundingBox, getElementBoundingBox } from "./geometry";

export interface SelectionRect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export type SelectionMode = "WINDOW" | "CROSSING";

const EPS = 1e-9;

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

export function rectFromPoints(a: Point, b: Point): SelectionRect {
    return {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
    };
}

/** 拖拽方向决定选择语义：向右为窗口选择，向左为交叉选择 */
export function getSelectionMode(start: Point, end: Point): SelectionMode {
    return end.x >= start.x ? "WINDOW" : "CROSSING";
}

const pointInRect = (p: Point, rect: SelectionRect): boolean =>
    p.x >= rect.minX - EPS && p.x <= rect.maxX + EPS &&
    p.y >= rect.minY - EPS && p.y <= rect.maxY + EPS;

const normalizeBounds = (box: BoundingBox): BoundingBox => ({
    minX: Math.min(box.minX, box.maxX),
    minY: Math.min(box.minY, box.maxY),
    maxX: Math.max(box.minX, box.maxX),
    maxY: Math.max(box.minY, box.maxY),
});

const boundsIntersectRect = (box: BoundingBox, rect: SelectionRect): boolean => {
    const b = normalizeBounds(box);
    return !(b.maxX < rect.minX || b.minX > rect.maxX ||
        b.maxY < rect.minY || b.minY > rect.maxY);
};

/** 圆弧按扫描范围计算更精确的包围盒，避免整圆包围盒导致窗口选择误判 */
function getPreciseBounds(el: CADElement): BoundingBox {
    if (el.type === "ARC" && el.center && el.radius && el.startAngle !== undefined && el.endAngle !== undefined) {
        const span = el.clockwise
            ? (el.endAngle - el.startAngle + 360) % 360
            : (el.startAngle - el.endAngle + 360) % 360;
        const angles = [el.startAngle, el.endAngle];
        for (const cardinal of [0, 90, 180, 270]) {
            const offset = el.clockwise
                ? (cardinal - el.startAngle + 360) % 360
                : (el.startAngle - cardinal + 360) % 360;
            if (offset <= span + EPS) angles.push(cardinal);
        }
        const points = angles.map(angle => {
            const rad = angle * Math.PI / 180;
            return {
                x: el.center!.x + el.radius! * Math.cos(rad),
                y: el.center!.y + el.radius! * Math.sin(rad),
            };
        });
        return getElementBoundingBox({ ...el, type: "LWPOLYLINE", points } as CADElement);
    }
    return normalizeBounds(getElementBoundingBox(el));
}

/** 元素是否完全位于选择矩形内 */
export function elementInsideRect(el: CADElement, rect: SelectionRect): boolean {
    const b = getPreciseBounds(el);
    return b.minX >= rect.minX - EPS && b.maxX <= rect.maxX + EPS &&
        b.minY >= rect.minY - EPS && b.maxY <= rect.maxY + EPS;
}

/** 提取可用于矩形求交的折线线段 */
function getSegments(el: CADElement): Array<[Point, Point]> {
    if (el.type === "LINE" && el.start && el.end) {
        return [[el.start, el.end]];
    }

    if (el.type === "RECTANGLE" && el.start && el.width !== undefined && el.height !== undefined) {
        const x1 = Math.min(el.start.x, el.start.x + el.width);
        const x2 = Math.max(el.start.x, el.start.x + el.width);
        const y1 = Math.min(el.start.y, el.start.y + el.height);
        const y2 = Math.max(el.start.y, el.start.y + el.height);
        const p1 = { x: x1, y: y1 };
        const p2 = { x: x2, y: y1 };
        const p3 = { x: x2, y: y2 };
        const p4 = { x: x1, y: y2 };
        return [[p1, p2], [p2, p3], [p3, p4], [p4, p1]];
    }

    if (el.points && el.points.length > 1) {
        const segments: Array<[Point, Point]> = [];
        for (let i = 0; i < el.points.length - 1; i++) {
            segments.push([el.points[i], el.points[i + 1]]);
        }
        return segments;
    }

    return [];
}

const orientation = (a: Point, b: Point, c: Point): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);

    if (((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) &&
        ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) {
        return true;
    }

    // 共线且落在端点上
    const onSegment = (p: Point, q: Point, r: Point): boolean =>
        Math.min(p.x, r.x) - EPS <= q.x && q.x <= Math.max(p.x, r.x) + EPS &&
        Math.min(p.y, r.y) - EPS <= q.y && q.y <= Math.max(p.y, r.y) + EPS;

    if (Math.abs(o1) <= EPS && onSegment(a, c, b)) return true;
    if (Math.abs(o2) <= EPS && onSegment(a, d, b)) return true;
    if (Math.abs(o3) <= EPS && onSegment(c, a, d)) return true;
    if (Math.abs(o4) <= EPS && onSegment(c, b, d)) return true;
    return false;
}

function segmentIntersectsRect(a: Point, b: Point, rect: SelectionRect): boolean {
    if (pointInRect(a, rect) || pointInRect(b, rect)) return true;

    const corners = [
        { x: rect.minX, y: rect.minY },
        { x: rect.maxX, y: rect.minY },
        { x: rect.maxX, y: rect.maxY },
        { x: rect.minX, y: rect.maxY },
    ];
    for (let i = 0; i < 4; i++) {
        if (segmentsIntersect(a, b, corners[i], corners[(i + 1) % 4])) return true;
    }
    return false;
}

/** 判断圆（周长）是否与矩形相交；圆完全在矩形内或完全在外时返回 false */
function circlePerimeterIntersectsRect(center: Point, radius: number, rect: SelectionRect): boolean {
    if (radius <= EPS) return pointInRect(center, rect);

    const nearestX = clamp(center.x, rect.minX, rect.maxX);
    const nearestY = clamp(center.y, rect.minY, rect.maxY);
    const nearest = Math.hypot(center.x - nearestX, center.y - nearestY);
    if (nearest > radius + EPS) return false;

    const corners = [
        { x: rect.minX, y: rect.minY },
        { x: rect.maxX, y: rect.minY },
        { x: rect.maxX, y: rect.maxY },
        { x: rect.minX, y: rect.maxY },
    ];
    const farthest = Math.max(...corners.map(c => Math.hypot(center.x - c.x, center.y - c.y)));
    return farthest >= radius - EPS;
}

function angleOnArc(el: CADElement, angleDeg: number): boolean {
    if (el.type !== "ARC") return true;
    const start = el.startAngle ?? 0;
    const end = el.endAngle ?? 360;
    const span = el.clockwise
        ? (end - start + 360) % 360
        : (start - end + 360) % 360;
    const offset = el.clockwise
        ? (angleDeg - start + 360) % 360
        : (start - angleDeg + 360) % 360;
    return offset <= span + EPS;
}

/** 圆弧端点，用于圆弧与矩形求交 */
function arcEndpoints(el: CADElement): Point[] {
    if (el.type !== "ARC" || !el.center || !el.radius) return [];
    return [el.startAngle ?? 0, el.endAngle ?? 360].map(angle => {
        const rad = angle * Math.PI / 180;
        return {
            x: el.center!.x + el.radius! * Math.cos(rad),
            y: el.center!.y + el.radius! * Math.sin(rad),
        };
    });
}

/** 圆/圆弧周长与矩形边的交点（仅保留位于圆弧扫描范围内的点） */
function circleRectIntersections(el: CADElement, rect: SelectionRect): boolean {
    if (!el.center || !el.radius) return false;

    const edges: Array<[Point, Point]> = [
        [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }],
        [{ x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }],
        [{ x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }],
        [{ x: rect.minX, y: rect.maxY }, { x: rect.minX, y: rect.minY }],
    ];

    for (const [s1, s2] of edges) {
        const dx = s2.x - s1.x;
        const dy = s2.y - s1.y;
        const fx = s1.x - el.center.x;
        const fy = s1.y - el.center.y;
        const a = dx * dx + dy * dy;
        if (a < EPS) continue;
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - el.radius * el.radius;
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) continue;
        const sqrtD = Math.sqrt(discriminant);
        for (const t of [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)]) {
            if (t < -EPS || t > 1 + EPS) continue;
            const point = { x: s1.x + t * dx, y: s1.y + t * dy };
            const angle = Math.atan2(point.y - el.center.y, point.x - el.center.x) * 180 / Math.PI;
            if (angleOnArc(el, angle)) return true;
        }
    }
    return false;
}

/** 元素是否与选择矩形相交（交叉选择语义） */
export function elementCrossesRect(el: CADElement, rect: SelectionRect): boolean {
    const b = getPreciseBounds(el);
    if (!boundsIntersectRect(b, rect)) return false;
    if (elementInsideRect(el, rect)) return true;

    for (const [a, c] of getSegments(el)) {
        if (segmentIntersectsRect(a, c, rect)) return true;
    }

    if ((el.type === "CIRCLE" || el.type === "ARC") && el.center && el.radius) {
        if (circlePerimeterIntersectsRect(el.center, el.radius, rect) &&
            circleRectIntersections(el, rect)) {
            return true;
        }
        if (el.type === "ARC" && arcEndpoints(el).some(p => pointInRect(p, rect))) {
            return true;
        }
    }

    // 文本、标注、填充等以包围盒作为拾取范围
    if (el.type === "TEXT" || el.type === "DIMENSION" || el.type === "HATCH" ||
        el.type === "BLOCK_REFERENCE") {
        return true;
    }

    return false;
}

/** 按选择模式筛选矩形内的元素 */
export function elementsInSelectionRect(
    elements: CADElement[],
    rect: SelectionRect,
    mode: SelectionMode,
): CADElement[] {
    return elements.filter(el =>
        mode === "WINDOW" ? elementInsideRect(el, rect) : elementCrossesRect(el, rect),
    );
}
