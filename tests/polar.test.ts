/**
 * polar.test.ts — lib/polar.ts 单元测试
 *
 * 极轴吸附只在"接近增量方向"时生效，因此重点验证容差边界与距离守恒。
 */

import { describe, expect, it } from "vitest";
import type { Point } from "../types";
import {
    DEFAULT_POLAR_STEP_DEG,
    POLAR_SNAP_TOLERANCE_DEG,
    constrainToPolar,
    normalizeAngle,
    pointFromPolar,
} from "../lib/polar";

const ORIGIN: Point = { x: 0, y: 0 };

describe("constrainToPolar", () => {
    it("接近 0° 时将点吸附到水平射线并保持距离", () => {
        const result = constrainToPolar(ORIGIN, { x: 100, y: -6 });
        const distance = Math.hypot(100, 6);

        expect(result.snapped).toBe(true);
        expect(result.angle).toBe(0);
        expect(result.distance).toBeCloseTo(distance, 6);
        expect(result.point.x).toBeCloseTo(distance, 6);
        expect(result.point.y).toBeCloseTo(0, 6);
    });

    it("接近 45° 时吸附到该增量方向", () => {
        const result = constrainToPolar(ORIGIN, { x: 70, y: 69 });

        expect(result.snapped).toBe(true);
        expect(result.angle).toBe(45);
        expect(result.point.x).toBeCloseTo(result.point.y, 6);
    });

    it("偏离增量超出容差时原样返回", () => {
        const free = { x: 46.985, y: 17.101 }; // 约 20°，距 0° 与 45° 都超过容差
        const result = constrainToPolar(ORIGIN, free);

        expect(result.snapped).toBe(false);
        expect(result.angle).toBeNull();
        expect(result.point).toEqual(free);
    });

    it("容差边界内的角度可以命中", () => {
        const inside = pointFromPolar(
            ORIGIN,
            100,
            DEFAULT_POLAR_STEP_DEG - POLAR_SNAP_TOLERANCE_DEG,
        );
        const outside = pointFromPolar(
            ORIGIN,
            100,
            DEFAULT_POLAR_STEP_DEG - POLAR_SNAP_TOLERANCE_DEG - 1,
        );

        expect(constrainToPolar(ORIGIN, inside).snapped).toBe(true);
        expect(constrainToPolar(ORIGIN, outside).snapped).toBe(false);
    });

    it("锚点与光标重合时不做吸附", () => {
        const result = constrainToPolar(ORIGIN, { x: 0, y: 0 });

        expect(result.snapped).toBe(false);
        expect(result.angle).toBeNull();
    });

    it("增量非正时视为关闭极轴", () => {
        const result = constrainToPolar(ORIGIN, { x: 100, y: -6 }, 0);

        expect(result.snapped).toBe(false);
        expect(result.point).toEqual({ x: 100, y: -6 });
    });

    it("以 anchor 为原点计算，而不是世界原点", () => {
        const result = constrainToPolar({ x: 10, y: 20 }, { x: 110, y: 14 });

        expect(result.angle).toBe(0);
        expect(result.point.x).toBeCloseTo(110.18, 2);
        expect(result.point.y).toBeCloseTo(20, 6);
    });
});

describe("pointFromPolar / normalizeAngle", () => {
    it("按角度展开终点（Y 轴向下，90° 指向屏幕下方）", () => {
        const below = pointFromPolar({ x: 10, y: 10 }, 100, 90);
        expect(below.x).toBeCloseTo(10, 6);
        expect(below.y).toBeCloseTo(110, 6);
        expect(pointFromPolar({ x: 0, y: 0 }, 50, 0).x).toBeCloseTo(50, 6);
    });

    it("把任意角度归一化到 [0, 360)", () => {
        expect(normalizeAngle(-90)).toBe(270);
        expect(normalizeAngle(450)).toBe(90);
        expect(normalizeAngle(360)).toBe(0);
        expect(normalizeAngle(0)).toBe(0);
    });
});
