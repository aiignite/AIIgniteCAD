import { describe, expect, it } from "vitest";
import { CADElement } from "../types";
import {
    elementCrossesRect,
    elementInsideRect,
    elementsInSelectionRect,
    getSelectionMode,
    rectFromPoints,
} from "../lib/selection";

const line = (id: string, x1: number, y1: number, x2: number, y2: number): CADElement => ({
    id,
    type: "LINE",
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    layer: "0",
    color: "#fff",
});

const circle = (id: string, cx: number, cy: number, radius: number): CADElement => ({
    id,
    type: "CIRCLE",
    center: { x: cx, y: cy },
    radius,
    layer: "0",
    color: "#fff",
});

const inner = rectFromPoints({ x: 0, y: 0 }, { x: 100, y: 100 });

describe("选择方向", () => {
    it("向右为窗口选择，向左为交叉选择", () => {
        expect(getSelectionMode({ x: 0, y: 0 }, { x: 50, y: 20 })).toBe("WINDOW");
        expect(getSelectionMode({ x: 100, y: 0 }, { x: 20, y: 20 })).toBe("CROSSING");
    });

    it("矩形规范化与拖拽方向无关", () => {
        expect(rectFromPoints({ x: 100, y: 100 }, { x: 0, y: 0 })).toEqual(inner);
    });
});

describe("窗口选择", () => {
    it("只选中完全位于矩形内的图元", () => {
        expect(elementInsideRect(line("in", 10, 10, 90, 90), inner)).toBe(true);
        // 一端越界
        expect(elementInsideRect(line("out", 50, 50, 150, 50), inner)).toBe(false);

        const selected = elementsInSelectionRect(
            [line("in", 10, 10, 90, 90), line("out", 50, 50, 150, 50)],
            inner,
            "WINDOW",
        );
        expect(selected.map(el => el.id)).toEqual(["in"]);
    });

    it("圆完全在内时选中，跨越边界时不选中", () => {
        expect(elementInsideRect(circle("in", 50, 50, 20), inner)).toBe(true);
        expect(elementInsideRect(circle("edge", 50, 50, 60), inner)).toBe(false);
    });
});

describe("交叉选择", () => {
    it("与矩形相交即选中", () => {
        expect(elementCrossesRect(line("partial", 50, 50, 150, 50), inner)).toBe(true);
        expect(elementCrossesRect(line("outside", 200, 200, 300, 300), inner)).toBe(false);
    });

    it("线段完全包住矩形时仍视为相交", () => {
        expect(elementCrossesRect(line("through", -50, 50, 150, 50), inner)).toBe(true);
    });

    it("圆弧按实际扫描范围判断", () => {
        const arc: CADElement = {
            id: "arc",
            type: "ARC",
            center: { x: 0, y: 0 },
            radius: 50,
            startAngle: 0,
            endAngle: 90,
            clockwise: true,
            layer: "0",
            color: "#fff",
        };
        // 圆弧位于右下象限，与紧贴右侧的矩形相交
        expect(elementCrossesRect(arc, rectFromPoints({ x: 40, y: -10 }, { x: 60, y: 40 }))).toBe(true);
        // 左上象限与圆弧无关
        expect(elementCrossesRect(arc, rectFromPoints({ x: -60, y: -60 }, { x: -40, y: -40 }))).toBe(false);
    });

    it("包围盒类图元（文字）按矩形范围判断", () => {
        const text: CADElement = {
            id: "text",
            type: "TEXT",
            start: { x: 20, y: 40 },
            text: "HELLO",
            fontSize: 12,
            layer: "0",
            color: "#fff",
        };
        expect(elementCrossesRect(text, inner)).toBe(true);
        expect(elementCrossesRect(text, rectFromPoints({ x: 200, y: 200 }, { x: 300, y: 300 }))).toBe(false);
    });
});
