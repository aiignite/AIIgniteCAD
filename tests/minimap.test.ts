/**
 * minimap.test.ts — 迷你导航图纯几何测试
 */

import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import {
    miniMapToWorld,
    minimapBounds,
    minimapShapes,
    minimapTransform,
    worldToMiniMap,
} from "../lib/minimap";

const line: CADElement = {
    id: "l1",
    type: "LINE",
    layer: "0",
    color: "#fff",
    start: { x: 0, y: 0 },
    end: { x: 100, y: 50 },
};

const circle: CADElement = {
    id: "c1",
    type: "CIRCLE",
    layer: "0",
    color: "#fff",
    center: { x: 50, y: 25 },
    radius: 10,
};

const text: CADElement = {
    id: "t1",
    type: "TEXT",
    layer: "0",
    color: "#fff",
    start: { x: 10, y: 10 },
    text: "A",
    fontSize: 12,
};

describe("minimapShapes", () => {
    it("直线与圆保留原始几何", () => {
        const shapes = minimapShapes([line, circle]);
        expect(shapes[0].shape).toEqual({ kind: "line", from: { x: 0, y: 0 }, to: { x: 100, y: 50 } });
        expect(shapes[1].shape).toEqual({ kind: "circle", center: { x: 50, y: 25 }, radius: 10 });
    });

    it("无法还原几何时退化为包围盒", () => {
        const shapes = minimapShapes([text]);
        expect(shapes[0].shape.kind).toBe("rect");
    });
});

describe("minimapBounds", () => {
    it("取全部图元的包围盒", () => {
        const bounds = minimapBounds([line, circle]);
        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    });

    it("空集合返回 null", () => {
        expect(minimapBounds([])).toBeNull();
    });
});

describe("minimapTransform", () => {
    const size = { width: 180, height: 120 };
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

    it("等比缩放并居中", () => {
        const transform = minimapTransform(bounds, size);
        const topLeft = worldToMiniMap({ x: 0, y: 0 }, transform);
        const bottomRight = worldToMiniMap({ x: 100, y: 50 }, transform);

        expect(topLeft.x).toBeCloseTo(4);
        expect(bottomRight.x).toBeCloseTo(176);
        // 内容高宽比小于导航图，上下留白更大
        expect(topLeft.y).toBeCloseTo(17);
        expect(bottomRight.y).toBeCloseTo(103);
    });

    it("世界坐标与导航图坐标可逆", () => {
        const transform = minimapTransform(bounds, size);
        const world = { x: 33, y: 21 };
        const back = miniMapToWorld(worldToMiniMap(world, transform), transform);

        expect(back.x).toBeCloseTo(world.x);
        expect(back.y).toBeCloseTo(world.y);
    });
});
