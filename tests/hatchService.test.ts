import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import {
    DEFAULT_HATCH_SPACING,
    createHatch,
    generateHatchPattern,
    hatchSpacingOf,
    normalizeHatchSpacing,
} from "../services/hatchService";

const rectangle = (): CADElement => ({
    id: "rect",
    type: "RECTANGLE",
    layer: "0",
    color: "#000000",
    start: { x: 0, y: 0 },
    width: 200,
    height: 100,
});

const countLines = (path: string): number => (path.match(/M /g) ?? []).length;

describe("填充间距解析", () => {
    it("创建时保留用户输入的间距", () => {
        const hatch = createHatch(
            [rectangle()],
            { type: "HORIZONTAL", spacing: 80, angle: 0 },
            "#4a5568",
            "0",
        );

        expect(hatch.hatchPattern?.spacing).toBe(80);
        expect(hatchSpacingOf(hatch)).toBe(80);
    });

    it("非法间距回落到默认间距", () => {
        expect(normalizeHatchSpacing(0)).toBe(DEFAULT_HATCH_SPACING);
        expect(normalizeHatchSpacing(-5)).toBe(DEFAULT_HATCH_SPACING);
        expect(normalizeHatchSpacing("abc")).toBe(DEFAULT_HATCH_SPACING);
        expect(normalizeHatchSpacing(undefined)).toBe(DEFAULT_HATCH_SPACING);

        const hatch = createHatch([rectangle()], { type: "HORIZONTAL", spacing: 0 }, "#4a5568", "0");
        expect(hatchSpacingOf(hatch)).toBe(DEFAULT_HATCH_SPACING);
    });

    it("旧存档按 hatchScale 兼容，缺失时用默认间距", () => {
        const legacy: CADElement = {
            id: "legacy",
            type: "HATCH",
            layer: "0",
            color: "#000000",
            points: [],
            hatchScale: 3,
        };
        expect(hatchSpacingOf(legacy)).toBe(30);

        const bare: CADElement = {
            id: "bare",
            type: "HATCH",
            layer: "0",
            color: "#000000",
            points: [],
        };
        expect(hatchSpacingOf(bare)).toBe(DEFAULT_HATCH_SPACING);
    });
});

describe("填充图案按间距生成", () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

    it("间距越大线条越少", () => {
        const dense = countLines(generateHatchPattern("HORIZONTAL", bounds, 10, 0));
        const sparse = countLines(generateHatchPattern("HORIZONTAL", bounds, 100, 0));

        expect(dense).toBe(11);
        expect(sparse).toBe(2);
    });

    it("斜线填充是平行线，且端点都落在包围盒内", () => {
        const path = generateHatchPattern("DIAGONAL_RIGHT", bounds, 25, 0);
        const segments = [...path.matchAll(/M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)/g)].map(
            (match) => match.slice(1).map(Number) as [number, number, number, number],
        );

        expect(segments.length).toBeGreaterThan(2);
        for (const [x1, y1, x2, y2] of segments) {
            // 45° 斜线：x、y 方向的变化量相等，不会收敛到同一个角点
            expect(Math.abs(x2 - x1 - (y2 - y1))).toBeLessThan(1e-6);
            for (const [x, y] of [
                [x1, y1],
                [x2, y2],
            ]) {
                expect(x).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
                expect(x).toBeLessThanOrEqual(bounds.maxX + 1e-6);
                expect(y).toBeGreaterThanOrEqual(bounds.minY - 1e-6);
                expect(y).toBeLessThanOrEqual(bounds.maxY + 1e-6);
            }
        }
    });

    it("非法或过小的间距不会无限循环", () => {
        // 0 视为非法，回落到默认间距（200×100 区域共 11 条线），而不是死循环
        expect(countLines(generateHatchPattern("HORIZONTAL", bounds, 0, 0))).toBe(11);
        // 点阵是二维密度，兜底后仍要保证有上限
        expect(countLines(generateHatchPattern("DOT", bounds, 0.0001, 0))).toBeLessThan(6000);
    });
});
