/**
 * shapeRegeneration.test.ts — 参数化图元几何重算与同步回归
 *
 * 覆盖属性面板改参数（重算轮廓）与夹点移中心（平移轮廓）两条路径，
 * 以及非法参数不破坏现有几何的防护。
 */

import { describe, expect, it } from "vitest";
import {
    isParamBasedShape,
    regenerateElement,
    reconcileElement,
} from "../services/advancedShapesService";
import type { CADElement, Point } from "../types";

const ellipse = (over: Partial<CADElement> = {}): CADElement => ({
    id: "ellipse-1",
    type: "ELLIPSE",
    layer: "0",
    color: "#8b949e",
    center: { x: 100, y: 100 },
    radiusX: 20,
    radiusY: 10,
    rotation: 0,
    ...over,
});

const gear = (over: Partial<CADElement> = {}): CADElement => ({
    id: "gear-1",
    type: "GEAR",
    layer: "0",
    color: "#8b949e",
    center: { x: 0, y: 0 },
    numTeeth: 20,
    module: 5,
    pressureAngle: 20,
    ...over,
});

const spiral = (over: Partial<CADElement> = {}): CADElement => ({
    id: "spiral-1",
    type: "SPIRAL",
    layer: "0",
    color: "#8b949e",
    center: { x: 0, y: 0 },
    turns: 3,
    radiusIncrement: 10,
    startRadius: 10,
    ...over,
});

const spring = (over: Partial<CADElement> = {}): CADElement => ({
    id: "spring-1",
    type: "SPRING",
    layer: "0",
    color: "#8b949e",
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    coils: 5,
    springRadius: 10,
    ...over,
});

/** 轮廓相对中心的最大半径，用于验证重算结果 */
const maxRadiusFrom = (points: Point[] | undefined, center: Point): number =>
    (points ?? []).reduce(
        (max, point) => Math.max(max, Math.hypot(point.x - center.x, point.y - center.y)),
        0,
    );

describe("regenerateElement — 椭圆", () => {
    it("半径变化后轮廓按新半径重算", () => {
        const base = regenerateElement(ellipse());
        expect(base.points!.length).toBeGreaterThan(10);

        const grown = regenerateElement(ellipse({ radiusX: 40 }));
        expect(maxRadiusFrom(grown.points, { x: 100, y: 100 })).toBeCloseTo(40, 6);
        expect(maxRadiusFrom(base.points, { x: 100, y: 100 })).toBeCloseTo(20, 6);
    });

    it("旋转变化后轮廓方向随之更新", () => {
        const rotated = regenerateElement(ellipse({ rotation: 90 }));
        // 旋转 90° 后 X 方向半轴应等于原 Y 半轴
        const xs = rotated.points!.map((point) => Math.abs(point.x - 100));
        const ys = rotated.points!.map((point) => Math.abs(point.y - 100));
        expect(Math.max(...xs)).toBeCloseTo(10, 6);
        expect(Math.max(...ys)).toBeCloseTo(20, 6);
    });

    it("半径非法时保持原几何", () => {
        const original = ellipse({ points: [{ x: 120, y: 100 }] });
        expect(regenerateElement(ellipse({ radiusX: 0, points: original.points })).points).toBe(
            original.points,
        );
        expect(regenerateElement(ellipse({ radiusY: -5, points: original.points })).points).toBe(
            original.points,
        );
        expect(
            regenerateElement(ellipse({ radiusX: Number.NaN, points: original.points })).points,
        ).toBe(original.points);
    });
});

describe("regenerateElement — 齿轮", () => {
    it("齿数变化后重新生成轮廓", () => {
        const few = regenerateElement(gear({ numTeeth: 12 }));
        const many = regenerateElement(gear({ numTeeth: 30 }));
        expect(many.points!.length).toBeGreaterThan(few.points!.length);
    });

    it("显式齿顶高 / 齿根高参与重算", () => {
        const tall = regenerateElement(gear({ addendum: 15, dedendum: 6 }));
        // 节圆 50 + 齿顶高 15 = 65
        expect(maxRadiusFrom(tall.points, { x: 0, y: 0 })).toBeCloseTo(65, 6);
        const short = regenerateElement(gear({ addendum: 3, dedendum: 6 }));
        expect(maxRadiusFrom(short.points, { x: 0, y: 0 })).toBeCloseTo(53, 6);
    });

    it("模数变化后节圆半径同步更新", () => {
        const big = regenerateElement(gear({ module: 10 }));
        expect(big.radius).toBeCloseTo((10 * 20) / 2, 6);
    });

    it("参数非法时保持原几何", () => {
        const original = gear({ points: [{ x: 1, y: 1 }] });
        expect(regenerateElement(gear({ numTeeth: 1, points: original.points })).points).toBe(
            original.points,
        );
        expect(regenerateElement(gear({ numTeeth: 7.5, points: original.points })).points).toBe(
            original.points,
        );
        expect(regenerateElement(gear({ module: 0, points: original.points })).points).toBe(
            original.points,
        );
        expect(
            regenerateElement(gear({ pressureAngle: 95, points: original.points })).points,
        ).toBe(original.points);
        // 齿根圆为非正：拒绝重算
        expect(
            regenerateElement(gear({ dedendum: 60, points: original.points })).points,
        ).toBe(original.points);
    });
});

describe("regenerateElement — 螺旋与弹簧", () => {
    it("螺旋线按推导的起始半径重算，首点半径不变", () => {
        const base = regenerateElement(spiral());
        const first = base.points![0];
        const startRadius = Math.hypot(first.x, first.y);
        expect(startRadius).toBeCloseTo(10, 6);

        const more = regenerateElement(spiral({ turns: 6 }));
        expect(more.points!.length).toBeGreaterThan(base.points!.length);
        expect(Math.hypot(more.points![0].x, more.points![0].y)).toBeCloseTo(10, 6);
    });

    it("螺旋线末圈半径为负时拒绝重算", () => {
        const original = spiral({ points: [{ x: 5, y: 0 }] });
        // 起始半径 10，增量 -10，3 圈 → 末圈半径 -20
        expect(
            regenerateElement(spiral({ radiusIncrement: -10, points: original.points })).points,
        ).toBe(original.points);
    });

    it("旧存档无 startRadius 时从轮廓首点推导", () => {
        const legacy = spiral({ startRadius: undefined, points: [{ x: 8, y: 0 }] });
        const regenerated = regenerateElement(legacy);
        expect(Math.hypot(regenerated.points![0].x, regenerated.points![0].y)).toBeCloseTo(8, 6);
    });

    it("弹簧圈数变化后重新生成轮廓", () => {
        const few = regenerateElement(spring({ coils: 3 }));
        const many = regenerateElement(spring({ coils: 8 }));
        expect(many.points!.length).toBeGreaterThan(few.points!.length);
    });

    it("弹簧参数非法时保持原几何", () => {
        const original = spring({ points: [{ x: 0, y: 0 }] });
        expect(regenerateElement(spring({ coils: 0, points: original.points })).points).toBe(
            original.points,
        );
        expect(
            regenerateElement(spring({ springRadius: -1, points: original.points })).points,
        ).toBe(original.points);
    });
});

describe("reconcileElement — 同步策略", () => {
    it("仅移动中心时平移轮廓，顶点数不变", () => {
        const base = regenerateElement(ellipse());
        const moved = reconcileElement(base, { ...base, center: { x: 150, y: 120 } });
        expect(moved.points).toHaveLength(base.points!.length);
        // 每个顶点都平移了 (+50, +20)
        moved.points!.forEach((point, index) => {
            expect(point.x - base.points![index].x).toBeCloseTo(50, 6);
            expect(point.y - base.points![index].y).toBeCloseTo(20, 6);
        });
        expect(maxRadiusFrom(moved.points, { x: 150, y: 120 })).toBeCloseTo(20, 6);
    });

    it("形状参数变化时重算轮廓", () => {
        const base = regenerateElement(ellipse());
        const resized = reconcileElement(base, { ...base, radiusX: 35 });
        expect(maxRadiusFrom(resized.points, { x: 100, y: 100 })).toBeCloseTo(35, 6);
    });

    it("齿轮仅移动中心时平移轮廓", () => {
        const base = regenerateElement(gear());
        const moved = reconcileElement(base, { ...base, center: { x: 30, y: -20 } });
        expect(moved.points).toHaveLength(base.points!.length);
        moved.points!.forEach((point, index) => {
            expect(point.x - base.points![index].x).toBeCloseTo(30, 6);
            expect(point.y - base.points![index].y).toBeCloseTo(-20, 6);
        });
    });

    it("弹簧起终点同向平移时平移轮廓", () => {
        const base = regenerateElement(spring());
        const moved = reconcileElement(base, {
            ...base,
            start: { x: 10, y: 5 },
            end: { x: 110, y: 5 },
        });
        expect(moved.points).toHaveLength(base.points!.length);
        moved.points!.forEach((point, index) => {
            expect(point.x - base.points![index].x).toBeCloseTo(10, 6);
            expect(point.y - base.points![index].y).toBeCloseTo(5, 6);
        });
    });

    it("弹簧只改圈数时重算轮廓", () => {
        const base = regenerateElement(spring());
        const recoiled = reconcileElement(base, { ...base, coils: 9 });
        expect(recoiled.points!.length).toBeGreaterThan(base.points!.length);
    });

    it("非参数化图元原样返回", () => {
        const line: CADElement = {
            id: "l1",
            type: "LINE",
            layer: "0",
            color: "#e6edf3",
            start: { x: 0, y: 0 },
            end: { x: 5, y: 5 },
        };
        expect(reconcileElement(line, { ...line, end: { x: 6, y: 6 } })).toEqual({
            ...line,
            end: { x: 6, y: 6 },
        });
    });

    it("类型变化时原样返回", () => {
        const base = regenerateElement(ellipse());
        const asPolyline: CADElement = { ...base, type: "LWPOLYLINE" };
        expect(reconcileElement(base, asPolyline)).toBe(asPolyline);
    });
});

describe("isParamBasedShape", () => {
    it("识别四类参数化图元", () => {
        expect(isParamBasedShape(ellipse())).toBe(true);
        expect(isParamBasedShape(gear())).toBe(true);
        expect(isParamBasedShape(spiral())).toBe(true);
        expect(isParamBasedShape(spring())).toBe(true);
        expect(
            isParamBasedShape({
                id: "l",
                type: "LINE",
                layer: "0",
                color: "#fff",
                start: { x: 0, y: 0 },
                end: { x: 1, y: 1 },
            }),
        ).toBe(false);
    });
});
