/**
 * offset.test.ts — 偏移几何正确性回归
 */

import { describe, expect, it } from "vitest";
import {
    offsetArc,
    offsetCircle,
    offsetElement,
    offsetElements,
    offsetLine,
    offsetPolyline,
} from "../services/offsetService";
import type { CADElement } from "../types";

const base = (over: Partial<CADElement>): CADElement => ({
    id: "e1",
    type: "LINE",
    layer: "0",
    color: "#e6edf3",
    ...over,
});

describe("offsetLine", () => {
    it("沿行进方向左侧平移，保持长度与方向", () => {
        const line = offsetLine({ x: 0, y: 0 }, { x: 10, y: 0 }, 5)!;
        expect(line.type).toBe("LINE");
        expect(line.start).toEqual({ x: 0, y: 5 });
        expect(line.end).toEqual({ x: 10, y: 5 });
    });

    it("负距离向右侧平移", () => {
        const line = offsetLine({ x: 0, y: 0 }, { x: 10, y: 0 }, -3)!;
        expect(line.start).toEqual({ x: 0, y: -3 });
    });

    it("零长线段返回 null", () => {
        expect(offsetLine({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toBeNull();
    });

    it("距离为 0 返回 null", () => {
        expect(offsetLine({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull();
    });
});

describe("offsetPolyline", () => {
    it("开放多段线按 N-1 段处理，不绕回起点", () => {
        const poly = offsetPolyline(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
            ],
            5,
            false,
        )!;
        expect(poly.points).toHaveLength(3);
        // 顶点取相邻偏移段的交点：底边 y=5 与右边 x=5 的交点
        expect(poly.points).toEqual([
            { x: 0, y: 5 },
            { x: 5, y: 5 },
            { x: 5, y: 10 },
        ]);
        expect(poly.closed).toBeUndefined();
    });

    it("闭合多段线首尾顶点同样求交，不产生尖刺", () => {
        const poly = offsetPolyline(
            [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
            ],
            5,
            true,
        )!;
        expect(poly.closed).toBe(true);
        expect(poly.points).toEqual([
            { x: 5, y: 5 },
            { x: 15, y: 5 },
            { x: 15, y: 15 },
            { x: 5, y: 15 },
        ]);
    });

    it("连续重复点先去除，再计算法向", () => {
        const poly = offsetPolyline(
            [
                { x: 0, y: 0 },
                { x: 0, y: 0 },
                { x: 10, y: 0 },
            ],
            5,
            false,
        )!;
        expect(poly.points).toEqual([
            { x: 0, y: 5 },
            { x: 10, y: 5 },
        ]);
    });

    it("平行共线延续时退化为平移（不丢点）", () => {
        const poly = offsetPolyline(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 20, y: 0 },
            ],
            5,
            false,
        )!;
        expect(poly.points).toEqual([
            { x: 0, y: 5 },
            { x: 10, y: 5 },
            { x: 20, y: 5 },
        ]);
    });

    it("点数不足或距离无效时返回 null", () => {
        expect(offsetPolyline([{ x: 0, y: 0 }], 5, false)).toBeNull();
        expect(
            offsetPolyline(
                [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                ],
                0,
                false,
            ),
        ).toBeNull();
    });
});

describe("offsetCircle / offsetArc", () => {
    it("圆按半径增减偏移，圆心不变", () => {
        const circle = offsetCircle({ x: 5, y: 5 }, 10, 3)!;
        expect(circle.type).toBe("CIRCLE");
        expect(circle.radius).toBe(13);
        expect(circle.center).toEqual({ x: 5, y: 5 });
    });

    it("偏移后半径非正时返回 null（不允许圆翻面）", () => {
        expect(offsetCircle({ x: 0, y: 0 }, 5, -5)).toBeNull();
        expect(offsetCircle({ x: 0, y: 0 }, 5, -6)).toBeNull();
        expect(offsetCircle({ x: 0, y: 0 }, 0, 3)).toBeNull();
    });

    it("弧保持起止角与方向", () => {
        const arc = offsetArc({ x: 0, y: 0 }, 10, 30, 120, true, -2)!;
        expect(arc.type).toBe("ARC");
        expect(arc.radius).toBe(8);
        expect(arc.startAngle).toBe(30);
        expect(arc.endAngle).toBe(120);
        expect(arc.clockwise).toBe(true);
    });

    it("弧偏移后半径非正时返回 null", () => {
        expect(offsetArc({ x: 0, y: 0 }, 4, 0, 90, false, -5)).toBeNull();
    });
});

describe("offsetElement", () => {
    it("RECTANGLE 偏移后边长为 0 或负时返回 null", () => {
        const rect = base({ id: "r1", type: "RECTANGLE", start: { x: 0, y: 0 }, width: 20, height: 10 });
        // 10 - 2*5 = 0 → 退化
        expect(offsetElement(rect, 5)).toBeNull();
        // 10 - 2*6 < 0 → 退化
        expect(offsetElement(rect, 6)).toBeNull();
    });

    it("RECTANGLE 小距离偏移得到更小的矩形", () => {
        const rect = offsetElement(
            base({ id: "r2", type: "RECTANGLE", start: { x: 0, y: 0 }, width: 20, height: 10 }),
            2,
        )!;
        expect(rect.type).toBe("RECTANGLE");
        expect(rect.start).toEqual({ x: 2, y: 2 });
        expect(rect.width).toBe(16);
        expect(rect.height).toBe(6);
    });

    it("负宽高矩形按规范角点处理", () => {
        const rect = offsetElement(
            base({ id: "r3", type: "RECTANGLE", start: { x: 20, y: 10 }, width: -20, height: -10 }),
            -2,
        )!;
        // 负距离向外扩张：规范矩形 (0,0,20,10) 外扩 2
        expect(rect.type).toBe("RECTANGLE");
        expect(rect.start).toEqual({ x: -2, y: -2 });
        expect(rect.width).toBe(24);
        expect(rect.height).toBe(14);
    });

    it("RECTANGLE 保留原图层与颜色", () => {
        const rect = offsetElement(
            base({
                id: "r4",
                type: "RECTANGLE",
                layer: "WALLS",
                color: "#ff0000",
                start: { x: 0, y: 0 },
                width: 20,
                height: 10,
            }),
            2,
        )!;
        expect(rect.layer).toBe("WALLS");
        expect(rect.color).toBe("#ff0000");
    });

    it("不支持的类型返回 null（不再静默复制原对象）", () => {
        expect(offsetElement(base({ id: "t1", type: "TEXT", start: { x: 0, y: 0 }, text: "A" }), 5)).toBeNull();
        expect(
            offsetElement(base({ id: "t2", type: "DIMENSION", start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }), 5),
        ).toBeNull();
    });

    it("LWPOLYLINE 偏移保留闭合标志", () => {
        const poly = offsetElement(
            base({
                id: "p1",
                type: "LWPOLYLINE",
                closed: true,
                points: [
                    { x: 0, y: 0 },
                    { x: 20, y: 0 },
                    { x: 20, y: 20 },
                ],
            }),
            5,
        )!;
        expect(poly.type).toBe("LWPOLYLINE");
        expect(poly.closed).toBe(true);
        expect(poly.points).toHaveLength(3);
    });
});

describe("offsetElements", () => {
    it("汇总成功副本与失败清单", () => {
        const outcome = offsetElements(
            [
                base({ id: "ok-line", type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }),
                base({ id: "bad-text", type: "TEXT", start: { x: 0, y: 0 }, text: "A" }),
                base({ id: "bad-zero", type: "LINE", start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }),
            ],
            5,
        );

        expect(outcome.elements).toHaveLength(1);
        expect(outcome.elements[0].id).not.toBe("ok-line");
        expect(outcome.failures).toEqual([
            { id: "bad-text", type: "TEXT", reason: "unsupported-type" },
            { id: "bad-zero", type: "LINE", reason: "degenerate-geometry" },
        ]);
    });

    it("距离无效时全部记为失败，不产生副本", () => {
        const outcome = offsetElements(
            [base({ id: "l1", type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } })],
            0,
        );
        expect(outcome.elements).toHaveLength(0);
        expect(outcome.failures).toHaveLength(1);
    });

    it("零长线段记为退化失败", () => {
        const outcome = offsetElements(
            [base({ id: "z1", type: "LINE", start: { x: 1, y: 1 }, end: { x: 1, y: 1 } })],
            5,
        );
        expect(outcome.elements).toHaveLength(0);
        expect(outcome.failures[0].reason).toBe("degenerate-geometry");
    });
});
