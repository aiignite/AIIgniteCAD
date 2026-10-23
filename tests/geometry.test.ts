/**
 * geometry.test.ts — lib/geometry.ts 单元测试
 * 覆盖向量运算、线段/圆求交、包围盒、矩阵变换与多边形计算等核心几何能力。
 */

import { describe, it, expect } from "vitest";
import {
    distance,
    distanceSquared,
    midpoint,
    pointsEqual,
    lerp,
    add,
    subtract,
    scale,
    dot,
    cross,
    length,
    lengthSquared,
    normalize,
    rotate,
    perpendicular,
    angleBetween,
    angle,
    signedAngle,
    degToRad,
    radToDeg,
    normalizeAngle,
    normalizeAngleSigned,
    lineLength,
    pointOnLine,
    closestPointOnLineSegment,
    distanceToLineSegment,
    isPointOnLineSegment,
    lineLineIntersection,
    lineSegmentIntersection,
    isPointInCircle,
    pointOnCircle,
    closestPointOnCircle,
    distanceToCircle,
    lineCircleIntersection,
    circleCircleIntersection,
    boundingBoxFromPoints,
    getElementBoundingBox,
    isPointInBoundingBox,
    boundingBoxesIntersect,
    expandBoundingBox,
    identityMatrix,
    translationMatrix,
    rotationMatrix,
    scaleMatrix,
    multiplyMatrix,
    transformPoint,
    createTransform,
    polygonArea,
    polygonCentroid,
    isPointInPolygon,
    clamp,
    isZero,
    roundTo,
    snapToGrid,
    snapPointToGrid,
    type Line,
    type Circle,
} from "../lib/geometry";
import { CADElement, Point } from "../types";

/** 构造线段，减少测试中的重复字面量 */
const line = (sx: number, sy: number, ex: number, ey: number): Line => ({
    start: { x: sx, y: sy },
    end: { x: ex, y: ey },
});

/** 构造圆 */
const circle = (cx: number, cy: number, radius: number): Circle => ({
    center: { x: cx, y: cy },
    radius,
});

/** 断言点坐标（浮点容差 1e-6） */
const expectPoint = (actual: Point, x: number, y: number) => {
    expect(actual.x).toBeCloseTo(x, 6);
    expect(actual.y).toBeCloseTo(y, 6);
};

/** 构造 CAD 元素的最小合法对象 */
const element = (partial: Partial<CADElement> & Pick<CADElement, "type">): CADElement => ({
    id: "el-1",
    layer: "0",
    color: "#ffffff",
    ...partial,
});

describe("基础度量与向量运算", () => {
    it("计算距离与中点", () => {
        expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
        expect(distanceSquared({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
        expectPoint(midpoint({ x: 0, y: 0 }, { x: 4, y: 6 }), 2, 3);
    });

    it("按容差比较点并支持线性插值", () => {
        expect(pointsEqual({ x: 0, y: 0 }, { x: 1e-12, y: 0 })).toBe(true);
        expect(pointsEqual({ x: 0, y: 0 }, { x: 0.01, y: 0 }, 1e-3)).toBe(false);
        expectPoint(lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.25), 2.5, 5);
    });

    it("执行向量加减、缩放、点积与叉积", () => {
        expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
        expect(subtract({ x: 3, y: 4 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 2 });
        expect(scale({ x: 1, y: -2 }, 3)).toEqual({ x: 3, y: -6 });
        expect(dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
        expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
        expect(length({ x: 3, y: 4 })).toBe(5);
        expect(lengthSquared({ x: 3, y: 4 })).toBe(25);
    });

    it("归一化、旋转与垂直向量", () => {
        expectPoint(normalize({ x: 3, y: 4 }), 0.6, 0.8);
        // 零向量归一化返回零向量，避免除零
        expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
        expectPoint(rotate({ x: 1, y: 0 }, Math.PI / 2), 0, 1);
        expectPoint(perpendicular({ x: 1, y: 0 }), 0, 1);
    });

    it("计算夹角与有符号夹角", () => {
        expect(angleBetween({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2, 6);
        expect(angle({ x: 0, y: -1 })).toBeCloseTo(-Math.PI / 2, 6);
        expect(signedAngle({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2, 6);
        // 零长度向量夹角返回 0
        expect(angleBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    });
});

describe("角度工具", () => {
    it("完成角度与弧度互转", () => {
        expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
        expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 10);
    });

    it("把角度规范化到指定区间", () => {
        expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 10);
        expect(normalizeAngleSigned((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 10);
        expect(normalizeAngleSigned(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
    });
});

describe("线段运算", () => {
    it("计算线段长度与参数点", () => {
        expect(lineLength(line(0, 0, 10, 0))).toBe(10);
        expectPoint(pointOnLine(line(0, 0, 10, 10), 0.5), 5, 5);
    });

    it("求线段上最近点与距离", () => {
        expectPoint(closestPointOnLineSegment({ x: 5, y: 5 }, line(0, 0, 10, 0)), 5, 0);
        // 超出线段范围时钳制到端点
        expectPoint(closestPointOnLineSegment({ x: 20, y: 0 }, line(0, 0, 10, 0)), 10, 0);
        expect(distanceToLineSegment({ x: 5, y: 5 }, line(0, 0, 10, 0))).toBe(5);
        expect(isPointOnLineSegment({ x: 5, y: 0 }, line(0, 0, 10, 0))).toBe(true);
        expect(isPointOnLineSegment({ x: 15, y: 0 }, line(0, 0, 10, 0))).toBe(false);
    });

    it("求直线与线段交点", () => {
        const horizontal = line(0, 0, 10, 0);
        const vertical = line(5, -5, 5, 5);

        const result = lineLineIntersection(horizontal, vertical);
        expect(result).not.toBeNull();
        expectPoint(result!.point, 5, 0);
        expect(result!.t1).toBeCloseTo(0.5, 10);
        expect(result!.t2).toBeCloseTo(0.5, 10);

        expect(lineLineIntersection(horizontal, line(0, 1, 10, 1))).toBeNull();
        expectPoint(lineSegmentIntersection(horizontal, vertical)!, 5, 0);
        // 无限直线相交但线段不相交
        expect(lineSegmentIntersection(line(0, 0, 1, 0), line(5, -1, 5, 1))).toBeNull();
    });
});

describe("圆运算", () => {
    it("判断点与圆的位置关系", () => {
        const c = circle(0, 0, 5);
        expect(isPointInCircle({ x: 1, y: 1 }, c)).toBe(true);
        expect(isPointInCircle({ x: 5, y: 0 }, c)).toBe(false);
        expect(distanceToCircle({ x: 0, y: 8 }, c)).toBe(3);
        expectPoint(pointOnCircle(c, 0), 5, 0);
        expectPoint(closestPointOnCircle({ x: 10, y: 0 }, c), 5, 0);
    });

    it("求直线与圆的交点", () => {
        const points = lineCircleIntersection(line(-10, 0, 10, 0), circle(0, 0, 5));
        expect(points).toHaveLength(2);
        expectPoint(points[0], -5, 0);
        expectPoint(points[1], 5, 0);

        expect(lineCircleIntersection(line(-10, 10, 10, 10), circle(0, 0, 5))).toHaveLength(0);
    });

    it("求两圆交点：两点、相切与相离", () => {
        const two = circleCircleIntersection(circle(0, 0, 5), circle(8, 0, 5));
        expect(two).toHaveLength(2);
        expectPoint(two[0], 4, 3);
        expectPoint(two[1], 4, -3);

        expect(circleCircleIntersection(circle(0, 0, 5), circle(10, 0, 5))).toHaveLength(1);
        expect(circleCircleIntersection(circle(0, 0, 5), circle(20, 0, 5))).toHaveLength(0);
    });
});

describe("包围盒", () => {
    it("由点集生成包围盒", () => {
        expect(boundingBoxFromPoints([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
        expect(
            boundingBoxFromPoints([
                { x: -2, y: 3 },
                { x: 4, y: -1 },
            ])
        ).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 3 });
    });

    it("按元素类型计算包围盒", () => {
        expect(
            getElementBoundingBox(element({ type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 5 } }))
        ).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });

        expect(
            getElementBoundingBox(element({ type: "CIRCLE", center: { x: 10, y: 10 }, radius: 2 }))
        ).toEqual({ minX: 8, minY: 8, maxX: 12, maxY: 12 });

        expect(
            getElementBoundingBox(
                element({ type: "RECTANGLE", start: { x: 0, y: 0 }, width: 10, height: 5 })
            )
        ).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });

        expect(
            getElementBoundingBox(
                element({
                    type: "LWPOLYLINE",
                    points: [
                        { x: 0, y: 0 },
                        { x: 5, y: 8 },
                    ],
                })
            )
        ).toEqual({ minX: 0, minY: 0, maxX: 5, maxY: 8 });

        // TEXT 的包围盒自基线向上延伸，宽度按字符数估算
        expect(
            getElementBoundingBox(
                element({ type: "TEXT", start: { x: 10, y: 20 }, text: "AB", fontSize: 10 })
            )
        ).toEqual({ minX: 10, minY: 10, maxX: 22, maxY: 20 });

        expect(
            getElementBoundingBox(element({ type: "ARC", center: { x: 0, y: 0 }, radius: 3 }))
        ).toEqual({ minX: -3, minY: -3, maxX: 3, maxY: 3 });
    });

    it("判断点、相交与扩展", () => {
        const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
        expect(isPointInBoundingBox({ x: 5, y: 5 }, box)).toBe(true);
        expect(isPointInBoundingBox({ x: 11, y: 5 }, box)).toBe(false);
        expect(boundingBoxesIntersect(box, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
        expect(boundingBoxesIntersect(box, { minX: 20, minY: 20, maxX: 30, maxY: 30 })).toBe(false);
        expect(expandBoundingBox(box, 2)).toEqual({ minX: -2, minY: -2, maxX: 12, maxY: 12 });
    });
});

describe("矩阵变换", () => {
    it("平移、旋转、缩放矩阵作用于点", () => {
        expectPoint(transformPoint({ x: 1, y: 2 }, translationMatrix(10, 20)), 11, 22);
        expectPoint(transformPoint({ x: 1, y: 0 }, rotationMatrix(Math.PI / 2)), 0, 1);
        expectPoint(transformPoint({ x: 2, y: 3 }, scaleMatrix(2, 3)), 4, 9);
        expectPoint(transformPoint({ x: 7, y: 8 }, identityMatrix()), 7, 8);
    });

    it("组合矩阵与复合变换", () => {
        const combined = multiplyMatrix(translationMatrix(10, 0), scaleMatrix(2, 2));
        expectPoint(transformPoint({ x: 1, y: 1 }, combined), 12, 2);

        // createTransform：先平移 (10,0)，再旋转 90°，最后缩放 2 倍
        const matrix = createTransform({ x: 10, y: 0 }, Math.PI / 2, { x: 2, y: 2 });
        expectPoint(transformPoint({ x: 1, y: 0 }, matrix), 10, 2);
    });
});

describe("多边形与数值工具", () => {
    const square: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ];

    it("计算面积（带符号）与形心", () => {
        expect(polygonArea(square)).toBe(100);
        expect(polygonArea([...square].reverse())).toBe(-100);
        expect(polygonArea(square.slice(0, 2))).toBe(0);
        expectPoint(polygonCentroid(square), 5, 5);
        expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
        expect(polygonCentroid([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
    });

    it("判断点是否在多边形内部", () => {
        expect(isPointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
        expect(isPointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    });

    it("常用数值处理", () => {
        expect(clamp(15, 0, 10)).toBe(10);
        expect(clamp(-5, 0, 10)).toBe(0);
        expect(isZero(1e-12)).toBe(true);
        expect(isZero(0.1)).toBe(false);
        expect(roundTo(1.23456, 2)).toBe(1.23);
        expect(snapToGrid(23, 10)).toBe(20);
        expect(snapToGrid(26, 10)).toBe(30);
        expect(snapPointToGrid({ x: 23, y: 26 }, 10)).toEqual({ x: 20, y: 30 });
    });
});
