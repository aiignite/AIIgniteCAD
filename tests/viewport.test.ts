import { describe, expect, it } from "vitest";
import {
    DEFAULT_VIEWBOX,
    fitViewBox,
    MAX_VIEW_WIDTH,
    MIN_VIEW_WIDTH,
    unionBounds,
    zoomPercent,
    zoomViewBoxAt,
} from "../lib/viewport";

describe("zoomViewBoxAt", () => {
    it("保持锚点在视口中的相对位置不变", () => {
        const anchor = { x: 200, y: 150 };
        const before = {
            rx: (anchor.x - DEFAULT_VIEWBOX.x) / DEFAULT_VIEWBOX.w,
            ry: (anchor.y - DEFAULT_VIEWBOX.y) / DEFAULT_VIEWBOX.h,
        };

        const zoomed = zoomViewBoxAt(DEFAULT_VIEWBOX, anchor, 0.5);

        expect((anchor.x - zoomed.x) / zoomed.w).toBeCloseTo(before.rx, 10);
        expect((anchor.y - zoomed.y) / zoomed.h).toBeCloseTo(before.ry, 10);
        expect(zoomed.w).toBeCloseTo(400);
        expect(zoomed.h).toBeCloseTo(300);
    });

    it("限制最大与最小视口宽度", () => {
        const huge = zoomViewBoxAt(DEFAULT_VIEWBOX, { x: 0, y: 0 }, 1e9);
        expect(huge.w).toBe(MAX_VIEW_WIDTH);

        const tiny = zoomViewBoxAt(DEFAULT_VIEWBOX, { x: 0, y: 0 }, 1e-9);
        expect(tiny.w).toBe(MIN_VIEW_WIDTH);
    });

    it("非法倍率不改变视口", () => {
        expect(zoomViewBoxAt(DEFAULT_VIEWBOX, { x: 0, y: 0 }, 0)).toBe(DEFAULT_VIEWBOX);
        expect(zoomViewBoxAt(DEFAULT_VIEWBOX, { x: 0, y: 0 }, Number.NaN)).toBe(DEFAULT_VIEWBOX);
    });
});

describe("fitViewBox", () => {
    it("包含内容并匹配视口宽高比", () => {
        const view = fitViewBox({ minX: 100, minY: 100, maxX: 500, maxY: 300 }, 16 / 9);

        expect(view.x).toBeLessThanOrEqual(100);
        expect(view.y).toBeLessThanOrEqual(100);
        expect(view.x + view.w).toBeGreaterThanOrEqual(500);
        expect(view.y + view.h).toBeGreaterThanOrEqual(300);
        expect(view.w / view.h).toBeCloseTo(16 / 9, 6);
    });

    it("空图纸回到默认视口", () => {
        expect(fitViewBox(null, 4 / 3)).toEqual(DEFAULT_VIEWBOX);
    });
});

describe("unionBounds", () => {
    it("合并多个包围盒", () => {
        expect(unionBounds([
            { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            { minX: -5, minY: 2, maxX: 3, maxY: 20 },
        ])).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 20 });
        expect(unionBounds([])).toBeNull();
    });
});

describe("zoomPercent", () => {
    it("按初始宽度换算百分比", () => {
        expect(zoomPercent(DEFAULT_VIEWBOX)).toBe(100);
        expect(zoomPercent({ ...DEFAULT_VIEWBOX, w: 400 })).toBe(200);
        expect(zoomPercent({ ...DEFAULT_VIEWBOX, w: 1600 })).toBe(50);
    });
});
