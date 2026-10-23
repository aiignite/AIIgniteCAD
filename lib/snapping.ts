/**
 * snapping.ts — 对象捕捉计算
 *
 * 提供端点 / 中点 / 圆心 / 象限点 / 交点 / 垂足 / 切点 / 最近点八类捕捉。
 * 所有函数均为纯函数：输入图元与光标位置，输出候选捕捉点，由画布交互层挑选最近者。
 */

import { CADElement, Point, SnapType } from "../types";
import { dist } from "./canvasGeometry";

/** 捕捉类型中文名：状态栏与光标旁标签共用 */
export const SNAP_TYPE_LABELS: Record<SnapType, string> = {
    [SnapType.ENDPOINT]: "端点",
    [SnapType.MIDPOINT]: "中点",
    [SnapType.CENTER]: "圆心",
    [SnapType.QUADRANT]: "象限点",
    [SnapType.INTERSECTION]: "交点",
    [SnapType.PERPENDICULAR]: "垂足",
    [SnapType.TANGENT]: "切点",
    [SnapType.NEAREST]: "最近点",
    [SnapType.GRID]: "栅格",
    [SnapType.NONE]: "无",
};

export const snapTypeLabel = (type: SnapType | null): string =>
    type ? SNAP_TYPE_LABELS[type] ?? type : "";


/** 一个捕捉候选：坐标、类型与来源图元 */
export interface SnapCandidate {
    /** 捕捉点坐标 */
    point: Point;
    /** 捕捉类型 */
    type: SnapType;
    /** 来源图元 ID（交点等跨图元结果可缺省） */
    elementId?: string;
}

/** 数值容差，用于去重与角度比较 */
const EPS = 1e-6;

/** 判断两点是否重合（去重用） */
const samePoint = (a: Point, b: Point): boolean =>
    Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;

/**
 * 提取图元的线段集合（用于交点、垂足、最近点计算）。
 * 矩形按 4 条边展开，多段线与参数化曲线按相邻点展开。
 */
const getSegments = (el: CADElement): Array<[Point, Point]> => {
    if (el.type === "LINE" && el.start && el.end) {
        return [[el.start, el.end]];
    }
    if (el.type === "RECTANGLE" && el.start && el.width !== undefined && el.height !== undefined) {
        const { x, y } = el.start;
        const p1 = { x, y };
        const p2 = { x: x + el.width, y };
        const p3 = { x: x + el.width, y: y + el.height };
        const p4 = { x, y: y + el.height };
        return [
            [p1, p2],
            [p2, p3],
            [p3, p4],
            [p4, p1],
        ];
    }
    if (el.points && el.points.length > 1 && el.type !== "DIMENSION") {
        const segments: Array<[Point, Point]> = [];
        for (let i = 0; i < el.points.length - 1; i++) {
            segments.push([el.points[i], el.points[i + 1]]);
        }
        return segments;
    }
    return [];
};

/** 提取图元的圆集合（圆与圆弧统一按整圆近似，圆弧结果会再做角度过滤） */
const getCircles = (el: CADElement): Array<{ center: Point; radius: number }> => {
    if ((el.type === "CIRCLE" || el.type === "ARC") && el.center && el.radius) {
        return [{ center: el.center, radius: el.radius }];
    }
    return [];
};

/** 判断角度是否落在圆弧扫描范围内 */
const isAngleOnArc = (el: CADElement, angleDeg: number): boolean => {
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
};

/** 点投影到线段上的最近点 */
const projectOnSegment = (p: Point, s1: Point, s2: Point): Point => {
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return { ...s1 };
    const t = Math.max(0, Math.min(1, ((p.x - s1.x) * dx + (p.y - s1.y) * dy) / l2));
    return { x: s1.x + t * dx, y: s1.y + t * dy };
};

/** 线段与线段交点（平行或共线时返回空） */
const segmentIntersection = (a1: Point, a2: Point, b1: Point, b2: Point): Point | null => {
    const d1x = a2.x - a1.x;
    const d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x;
    const d2y = b2.y - b1.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < EPS) return null;

    const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
    const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;

    return { x: a1.x + t * d1x, y: a1.y + t * d1y };
};

/** 线段与整圆交点 */
const segmentCircleIntersections = (
    s1: Point,
    s2: Point,
    center: Point,
    radius: number,
): Point[] => {
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const fx = s1.x - center.x;
    const fy = s1.y - center.y;

    const a = dx * dx + dy * dy;
    if (a < EPS) return [];
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];

    const sqrtD = Math.sqrt(discriminant);
    const ts = [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)];
    return ts
        .filter(t => t >= -EPS && t <= 1 + EPS)
        .map(t => ({ x: s1.x + t * dx, y: s1.y + t * dy }));
};

/** 两圆交点 */
const circleCircleIntersections = (
    c1: Point,
    r1: number,
    c2: Point,
    r2: number,
): Point[] => {
    const d = dist(c1, c2);
    if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];

    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h2 = r1 * r1 - a * a;
    if (h2 < 0) return [];
    const h = Math.sqrt(h2);

    const ux = (c2.x - c1.x) / d;
    const uy = (c2.y - c1.y) / d;
    const mid = { x: c1.x + a * ux, y: c1.y + a * uy };

    if (h < EPS) return [mid];
    return [
        { x: mid.x + h * uy, y: mid.y - h * ux },
        { x: mid.x - h * uy, y: mid.y + h * ux },
    ];
};

/** 交点必须同时落在两个图元（若为圆弧）的有效范围内 */
const onArcForBoth = (a: CADElement, b: CADElement, pt: Point): boolean => {
    const check = (el: CADElement): boolean => {
        if (el.type !== "ARC" || !el.center) return true;
        const angle = Math.atan2(pt.y - el.center.y, pt.x - el.center.x) * 180 / Math.PI;
        return isAngleOnArc(el, angle);
    };
    return check(a) && check(b);
};

/** 计算两个图元的全部交点（线段近似处理多段线与参数化曲线，圆弧会过滤扫描范围） */
export const getElementIntersections = (a: CADElement, b: CADElement): Point[] => {
    const raw: Point[] = [];
    const segA = getSegments(a);
    const segB = getSegments(b);
    const circlesA = getCircles(a);
    const circlesB = getCircles(b);

    // 线段 × 线段
    segA.forEach(([a1, a2]) => {
        segB.forEach(([b1, b2]) => {
            const pt = segmentIntersection(a1, a2, b1, b2);
            if (pt) raw.push(pt);
        });
    });

    // 线段 × 圆
    segA.forEach(([s1, s2]) => {
        circlesB.forEach(c => raw.push(...segmentCircleIntersections(s1, s2, c.center, c.radius)));
    });
    segB.forEach(([s1, s2]) => {
        circlesA.forEach(c => raw.push(...segmentCircleIntersections(s1, s2, c.center, c.radius)));
    });

    // 圆 × 圆
    circlesA.forEach(ca => {
        circlesB.forEach(cb => raw.push(...circleCircleIntersections(ca.center, ca.radius, cb.center, cb.radius)));
    });

    // 去重并过滤圆弧范围外的点
    return raw.filter((pt, index) => {
        if (index > 0 && raw.slice(0, index).some(prev => samePoint(prev, pt))) return false;
        return onArcForBoth(a, b, pt);
    });
};

/**
 * 枚举图元上带类型的捕捉点（端点 / 中点 / 圆心 / 象限点）。
 */
export const getTypedSnapPoints = (el: CADElement): SnapCandidate[] => {
    const result: SnapCandidate[] = [];
    const push = (point: Point, type: SnapType) => {
        if (result.some(c => c.point.x === point.x && c.point.y === point.y && c.type === type)) return;
        result.push({ point, type, elementId: el.id });
    };

    if (el.type === "LINE" && el.start && el.end) {
        push(el.start, SnapType.ENDPOINT);
        push(el.end, SnapType.ENDPOINT);
        push(
            { x: (el.start.x + el.end.x) / 2, y: (el.start.y + el.end.y) / 2 },
            SnapType.MIDPOINT,
        );
        return result;
    }

    if (el.type === "RECTANGLE" && el.start && el.width !== undefined && el.height !== undefined) {
        const { x, y } = el.start;
        const corners = [
            { x, y },
            { x: x + el.width, y },
            { x: x + el.width, y: y + el.height },
            { x, y: y + el.height },
        ];
        corners.forEach(p => push(p, SnapType.ENDPOINT));
        for (let i = 0; i < corners.length; i++) {
            const n = corners[(i + 1) % corners.length];
            push({ x: (corners[i].x + n.x) / 2, y: (corners[i].y + n.y) / 2 }, SnapType.MIDPOINT);
        }
        return result;
    }

    if ((el.type === "CIRCLE" || el.type === "ARC") && el.center) {
        push(el.center, SnapType.CENTER);
        if (el.radius) {
            const quadrants = [
                { x: el.center.x + el.radius, y: el.center.y, angle: 0 },
                { x: el.center.x, y: el.center.y + el.radius, angle: 90 },
                { x: el.center.x - el.radius, y: el.center.y, angle: 180 },
                { x: el.center.x, y: el.center.y - el.radius, angle: 270 },
            ];
            quadrants
                .filter(q => isAngleOnArc(el, q.angle))
                .forEach(q => push({ x: q.x, y: q.y }, SnapType.QUADRANT));
        }
        return result;
    }

    if (el.type === "LWPOLYLINE" && el.points) {
        el.points.forEach(p => push(p, SnapType.ENDPOINT));
        for (let i = 0; i < el.points.length - 1; i++) {
            const a = el.points[i];
            const b = el.points[i + 1];
            push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, SnapType.MIDPOINT);
        }
        return result;
    }

    if (el.start) {
        push(el.start, SnapType.ENDPOINT);
    }
    if (el.points && el.points.length > 0) {
        push(el.points[0], SnapType.ENDPOINT);
        push(el.points[el.points.length - 1], SnapType.ENDPOINT);
        if (el.points.length > 2) push(el.points[Math.floor(el.points.length / 2)], SnapType.MIDPOINT);
    }
    return result;
};

/** 计算点到图元的最近点（任意位置） */
export const getNearestPointOnElement = (p: Point, el: CADElement): Point | null => {
    let closest: Point | null = null;
    let best = Infinity;

    const consider = (candidate: Point) => {
        const d = dist(p, candidate);
        if (d < best) {
            best = d;
            closest = candidate;
        }
    };

    getSegments(el).forEach(([s1, s2]) => consider(projectOnSegment(p, s1, s2)));

    getCircles(el).forEach(({ center, radius }) => {
        const d = dist(p, center);
        if (d < EPS) return;
        const angle = Math.atan2(p.y - center.y, p.x - center.x) * 180 / Math.PI;
        if (!isAngleOnArc(el, angle)) return;
        consider({
            x: center.x + (radius * (p.x - center.x)) / d,
            y: center.y + (radius * (p.y - center.y)) / d,
        });
    });

    if (!closest && el.start) consider(el.start);
    return closest;
};

/**
 * 计算垂足：从 anchor 向图元作垂线的落点。
 * 线段取投影点；圆/圆弧取圆心到 anchor 连线与圆周的交点。
 */
export const getPerpendicularPoint = (anchor: Point, el: CADElement): Point | null => {
    let closest: Point | null = null;
    let best = Infinity;

    getSegments(el).forEach(([s1, s2]) => {
        const foot = projectOnSegment(anchor, s1, s2);
        const d = dist(anchor, foot);
        if (d < best) {
            best = d;
            closest = foot;
        }
    });

    getCircles(el).forEach(({ center, radius }) => {
        const d = dist(anchor, center);
        if (d < EPS) return;
        const angle = Math.atan2(anchor.y - center.y, anchor.x - center.x) * 180 / Math.PI;
        if (!isAngleOnArc(el, angle)) return;
        const foot = {
            x: center.x + (radius * (anchor.x - center.x)) / d,
            y: center.y + (radius * (anchor.y - center.y)) / d,
        };
        const fd = dist(anchor, foot);
        if (fd < best) {
            best = fd;
            closest = foot;
        }
    });

    return closest;
};

/**
 * 计算从 anchor 到圆/圆弧的切点。
 * 依据切线长构成直角三角形：切点与圆心连线垂直于切线。
 */
export const getTangentPoints = (anchor: Point, el: CADElement): Point[] => {
    const points: Point[] = [];
    getCircles(el).forEach(({ center, radius }) => {
        const d = dist(anchor, center);
        if (d <= radius + EPS) return; // 点在圆内或圆上，无切点

        const baseAngle = Math.atan2(anchor.y - center.y, anchor.x - center.x);
        const alpha = Math.acos(radius / d);
        [baseAngle + alpha, baseAngle - alpha].forEach(theta => {
            const angleDeg = theta * 180 / Math.PI;
            if (!isAngleOnArc(el, angleDeg)) return;
            points.push({
                x: center.x + radius * Math.cos(theta),
                y: center.y + radius * Math.sin(theta),
            });
        });
    });
    return points;
};

/**
 * 汇总某组图元在光标附近产生的捕捉候选。
 *
 * @param nearby 空间索引筛出的附近图元
 * @param cursor 光标原始坐标
 * @param anchor 当前绘制起点（垂足/切点需要），可缺省
 * @param enabled 已启用的捕捉类型
 */
export const collectSnapCandidates = (
    nearby: CADElement[],
    cursor: Point,
    anchor: Point | undefined,
    enabled: SnapType[],
): SnapCandidate[] => {
    const enabledSet = new Set(enabled);
    const candidates: SnapCandidate[] = [];

    nearby.forEach(el => {
        getTypedSnapPoints(el).forEach(c => {
            if (enabledSet.has(c.type)) candidates.push(c);
        });

        if (anchor && enabledSet.has(SnapType.PERPENDICULAR)) {
            const foot = getPerpendicularPoint(anchor, el);
            if (foot) candidates.push({ point: foot, type: SnapType.PERPENDICULAR, elementId: el.id });
        }

        if (anchor && enabledSet.has(SnapType.TANGENT)) {
            getTangentPoints(anchor, el).forEach(point =>
                candidates.push({ point, type: SnapType.TANGENT, elementId: el.id }),
            );
        }

        if (enabledSet.has(SnapType.NEAREST)) {
            const nearest = getNearestPointOnElement(cursor, el);
            if (nearest) candidates.push({ point: nearest, type: SnapType.NEAREST, elementId: el.id });
        }
    });

    if (enabledSet.has(SnapType.INTERSECTION)) {
        for (let i = 0; i < nearby.length; i++) {
            for (let j = i + 1; j < nearby.length; j++) {
                getElementIntersections(nearby[i], nearby[j]).forEach(point =>
                    candidates.push({ point, type: SnapType.INTERSECTION }),
                );
            }
        }
    }

    return candidates;
};
