/**
 * snapping.test.ts — lib/snapping.ts 单元测试
 * 覆盖交点、垂足、切点、最近点与带类型捕捉点的计算，并验证类型开关过滤。
 */

import { describe, it, expect } from "vitest";
import { CADElement, Point, SnapType } from "../types";
import {
    collectSnapCandidates,
    getElementIntersections,
    getNearestPointOnElement,
    getPerpendicularPoint,
    getTangentPoints,
    getTypedSnapPoints,
    snapTypeLabel,
} from "../lib/snapping";

/** 构造一条直线图元 */
const line = (id: string, start: Point, end: Point): CADElement => ({
    id,
    type: "LINE",
    layer: "0",
    color: "#fff",
    start,
    end,
});

/** 构造一个圆图元 */
const circle = (id: string, center: Point, radius: number): CADElement => ({
    id,
    type: "CIRCLE",
    layer: "0",
    color: "#fff",
    center,
    radius,
});

describe("getElementIntersections", () => {
    it("计算两条直线的交点", () => {
        const a = line("a", { x: 0, y: 0 }, { x: 100, y: 100 });
        const b = line("b", { x: 0, y: 100 }, { x: 100, y: 0 });
        const pts = getElementIntersections(a, b);
        expect(pts).toHaveLength(1);
        expect(pts[0].x).toBeCloseTo(50, 6);
        expect(pts[0].y).toBeCloseTo(50, 6);
    });

    it("线段与圆相交返回两个点", () => {
        const l = line("l", { x: -100, y: 0 }, { x: 100, y: 0 });
        const c = circle("c", { x: 0, y: 0 }, 50);
        const pts = getElementIntersections(l, c);
        expect(pts).toHaveLength(2);
        expect(pts.map(p => p.x).sort((x, y) => x - y)).toEqual([-50, 50]);
    });

    it("相离的圆没有交点", () => {
        const a = circle("a", { x: 0, y: 0 }, 10);
        const b = circle("b", { x: 100, y: 0 }, 10);
        expect(getElementIntersections(a, b)).toHaveLength(0);
    });

    it("两圆相交返回两个对称点", () => {
        const a = circle("a", { x: 0, y: 0 }, 50);
        const b = circle("b", { x: 60, y: 0 }, 50);
        const pts = getElementIntersections(a, b);
        expect(pts).toHaveLength(2);
        expect(pts[0].x).toBeCloseTo(30, 6);
        expect(pts[1].x).toBeCloseTo(30, 6);
    });
});

describe("getTypedSnapPoints", () => {
    it("直线产生两个端点与一个中点", () => {
        const el = line("l", { x: 0, y: 0 }, { x: 100, y: 0 });
        const candidates = getTypedSnapPoints(el);
        expect(candidates.filter(c => c.type === SnapType.ENDPOINT)).toHaveLength(2);
        const mid = candidates.find(c => c.type === SnapType.MIDPOINT);
        expect(mid?.point).toEqual({ x: 50, y: 0 });
    });

    it("圆产生圆心与四个象限点", () => {
        const el = circle("c", { x: 10, y: 20 }, 5);
        const candidates = getTypedSnapPoints(el);
        expect(candidates.filter(c => c.type === SnapType.CENTER)).toHaveLength(1);
        expect(candidates.filter(c => c.type === SnapType.QUADRANT)).toHaveLength(4);
    });

    it("圆弧只保留扫描范围内的象限点", () => {
        const arc: CADElement = {
            id: "arc",
            type: "ARC",
            layer: "0",
            color: "#fff",
            center: { x: 0, y: 0 },
            radius: 10,
            startAngle: 0,
            endAngle: 90,
            clockwise: true,
        };
        const quadrants = getTypedSnapPoints(arc).filter(c => c.type === SnapType.QUADRANT);
        expect(quadrants).toHaveLength(2); // 0° 与 90°
    });
});

describe("getPerpendicularPoint", () => {
    it("线段垂足为投影点", () => {
        const el = line("l", { x: 0, y: 0 }, { x: 100, y: 0 });
        expect(getPerpendicularPoint({ x: 30, y: 40 }, el)).toEqual({ x: 30, y: 0 });
    });

    it("圆的垂足落在圆周上", () => {
        const el = circle("c", { x: 0, y: 0 }, 10);
        const foot = getPerpendicularPoint({ x: 100, y: 0 }, el);
        expect(foot).toEqual({ x: 10, y: 0 });
    });
});

describe("getTangentPoints", () => {
    it("圆外一点产生两个切点，且切点半径与切线垂直", () => {
        const el = circle("c", { x: 0, y: 0 }, 10);
        const anchor = { x: 20, y: 0 };
        const pts = getTangentPoints(anchor, el);
        expect(pts).toHaveLength(2);

        // 切点满足：切点到圆心向量与切点到 anchor 向量点积为 0
        pts.forEach(p => {
            const radial = { x: p.x - 0, y: p.y - 0 };
            const tangent = { x: anchor.x - p.x, y: anchor.y - p.y };
            expect(radial.x * tangent.x + radial.y * tangent.y).toBeCloseTo(0, 6);
        });
    });

    it("圆内点没有切点", () => {
        const el = circle("c", { x: 0, y: 0 }, 10);
        expect(getTangentPoints({ x: 1, y: 0 }, el)).toHaveLength(0);
    });
});

describe("getNearestPointOnElement", () => {
    it("返回线段上的最近点", () => {
        const el = line("l", { x: 0, y: 0 }, { x: 100, y: 0 });
        expect(getNearestPointOnElement({ x: 120, y: 30 }, el)).toEqual({ x: 100, y: 0 });
    });
});

describe("collectSnapCandidates", () => {
    it("只返回已启用类型对应的候选点", () => {
        const el = line("l", { x: 0, y: 0 }, { x: 100, y: 0 });
        const candidates = collectSnapCandidates(
            [el],
            { x: 0, y: 5 },
            undefined,
            [SnapType.ENDPOINT],
        );
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates.every(c => c.type === SnapType.ENDPOINT)).toBe(true);
    });

    it("启用交点时返回两直线的交点", () => {
        const a = line("a", { x: 0, y: 0 }, { x: 100, y: 100 });
        const b = line("b", { x: 0, y: 100 }, { x: 100, y: 0 });
        const candidates = collectSnapCandidates(
            [a, b],
            { x: 50, y: 50 },
            undefined,
            [SnapType.INTERSECTION],
        );
        expect(candidates.some(c => c.type === SnapType.INTERSECTION && c.point.x === 50 && c.point.y === 50)).toBe(true);
    });
});

describe("snapTypeLabel", () => {
    it("返回捕捉类型的中文名", () => {
        expect(snapTypeLabel(SnapType.ENDPOINT)).toBe("端点");
        expect(snapTypeLabel(SnapType.INTERSECTION)).toBe("交点");
    });

    it("无捕捉点时返回空串，避免状态栏出现 NONE", () => {
        expect(snapTypeLabel(null)).toBe("");
        expect(snapTypeLabel(SnapType.NONE)).toBe("无");
    });
});
