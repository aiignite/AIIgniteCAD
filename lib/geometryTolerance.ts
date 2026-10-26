/**
 * geometryTolerance.ts — 统一几何容差与退化判定
 *
 * 偏移、相交、采样、导入导出等几何算法共用同一套阈值，
 * 避免各处的魔法数值不一致导致边界行为差异。
 * 所有阈值以世界单位计（应用内部 canonical 单位为 mm）。
 */

import type { Point } from "../types";

/** 几何容差常量 */
export const GEO_TOL = {
    /** 坐标 / 向量浮点比较 */
    point: 1e-9,
    /** 线段长度下限：低于该值按零长（退化）处理 */
    segmentLength: 1e-9,
    /** 圆 / 弧半径下限 */
    radius: 1e-9,
    /** 偏移距离下限（绝对值） */
    offsetDistance: 1e-9,
    /** 多边形面积下限：低于该值按退化处理 */
    polygonArea: 1e-12,
    /** 角度（度）视为 0 的阈值 */
    angleDeg: 1e-9,
} as const;

/** 是否为有限数值（排除 NaN / Infinity / 非 number） */
export const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

/** 坐标点是否有效（存在且两个分量均为有限数值） */
export const isFinitePoint = (point: Point | undefined | null): point is Point =>
    !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);

/** 零长线段判定：两端点坐标差均在容差内 */
export const isDegenerateSegment = (
    a: Point,
    b: Point,
    tolerance: number = GEO_TOL.segmentLength,
): boolean => Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

/** 半径退化判定：非有限数值或低于下限 */
export const isDegenerateRadius = (radius: unknown): boolean =>
    !isFiniteNumber(radius) || radius <= GEO_TOL.radius;

/** 偏移距离是否可用（有限且绝对值不低于下限） */
export const isValidOffsetDistance = (distance: unknown): distance is number =>
    isFiniteNumber(distance) && Math.abs(distance) >= GEO_TOL.offsetDistance;

/**
 * 两直线段所在直线的交点；平行（含重合）时返回 null。
 * 与 lib/geometry.lineLineIntersection 语义一致，但阈值统一走 GEO_TOL，
 * 且不依赖 EPSILON 默认参数，便于偏移等算法做相邻段求交。
 */
export const lineLineIntersectionPoint = (
    p1: Point,
    p2: Point,
    p3: Point,
    p4: Point,
): Point | null => {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;
    const denominator = d1x * d2y - d1y * d2x;
    if (Math.abs(denominator) <= GEO_TOL.point) return null;
    const dx = p3.x - p1.x;
    const dy = p3.y - p1.y;
    const t = (dx * d2y - dy * d2x) / denominator;
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
};
