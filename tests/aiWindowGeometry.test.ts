import { describe, expect, it } from "vitest";
import {
    MIN_H,
    MIN_W,
    TOP_INSET,
    clampDrawerWidth,
    clampRect,
    defaultRect,
    drawerRect,
    moveRect,
    resizeRect,
} from "../lib/aiWindowGeometry";

const viewport = { w: 1440, h: 900 };

describe("AI 浮窗几何", () => {
    it("默认位置在 Header 下方右侧，且完整落在视口内", () => {
        const rect = defaultRect(viewport);
        expect(rect.y).toBeGreaterThanOrEqual(TOP_INSET);
        expect(rect.x + rect.w).toBeLessThanOrEqual(viewport.w);
        expect(rect.y + rect.h).toBeLessThanOrEqual(viewport.h);
    });

    it("拖动与缩放不会越过 Header 或视口边界", () => {
        const rect = defaultRect(viewport);
        const moved = moveRect(rect, -5000, -5000, viewport);
        expect(moved.x).toBe(8);
        expect(moved.y).toBe(TOP_INSET);

        const resized = resizeRect(rect, "nw", -5000, -5000, viewport);
        expect(resized.w).toBeGreaterThanOrEqual(MIN_W);
        expect(resized.h).toBeGreaterThanOrEqual(MIN_H);
        expect(resized.y).toBeGreaterThanOrEqual(TOP_INSET);
    });

    it("抽屉贴右且宽度受视口比例约束", () => {
        const rect = drawerRect(viewport, 9999);
        expect(rect.x + rect.w).toBe(viewport.w);
        expect(rect.y).toBe(TOP_INSET);
        expect(rect.w).toBeLessThanOrEqual(Math.round(viewport.w * 0.55));
        expect(clampDrawerWidth(100, viewport)).toBeGreaterThanOrEqual(MIN_W);
    });

    it("小视口下矩形尺寸不会被压成负数", () => {
        const rect = clampRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 500, h: 600 });
        expect(rect.w).toBeGreaterThan(0);
        expect(rect.h).toBeGreaterThan(0);
    });
});
