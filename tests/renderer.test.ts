/**
 * renderer.test.ts — 渲染器坐标换算与命中顺序
 */

import { describe, expect, it } from "vitest";
import { bufferedViewportBounds, computePixelsPerUnit, svgRenderer } from "../renderer/svgRenderer";
import type { RenderViewport } from "../renderer/types";
import type { CADElement } from "../types";

const viewport: RenderViewport = {
    viewBox: { x: 100, y: 50, w: 1200, h: 800 },
    width: 800,
    height: 600,
};

const line = (id: string, y: number): CADElement => ({
    id,
    type: "LINE",
    start: { x: 0, y },
    end: { x: 100, y },
    layer: "0",
    color: "#e6edf3",
});

describe("SvgRenderer 坐标换算", () => {
    it("按短边适配并居中", () => {
        const scale = computePixelsPerUnit(viewport);
        expect(scale).toBeCloseTo(2 / 3);
        // 水平方向居中：视口左右各留 0，顶部留出 letterbox
        expect(svgRenderer.toScreen({ x: 100, y: 50 }, viewport)).toEqual({
            x: 0,
            y: (600 - 800 * (2 / 3)) / 2,
        });
    });

    it("屏幕坐标可逆变换回世界坐标", () => {
        const screen = svgRenderer.toScreen({ x: 640, y: 410 }, viewport);
        const world = svgRenderer.toWorld(screen, viewport);
        expect(world.x).toBeCloseTo(640);
        expect(world.y).toBeCloseTo(410);
    });
});

describe("SvgRenderer 命中测试", () => {
    it("重叠时返回后绘制（数组末尾）的图元", () => {
        const bottom = line("bottom", 0);
        const top = line("top", 0);
        expect(svgRenderer.hitTest({ x: 50, y: 0 }, [bottom, top], 1)?.id).toBe("top");
    });

    it("hitTestAll 按从上到下排序", () => {
        const hits = svgRenderer.hitTestAll(
            { x: 50, y: 0 },
            [line("a", 0), line("b", 0), line("c", 5)],
            1,
        );
        expect(hits.map((el) => el.id)).toEqual(["b", "a"]);
    });

    it("容差外不命中", () => {
        expect(svgRenderer.hitTest({ x: 50, y: 3 }, [line("a", 0)], 1)).toBeNull();
    });
});

describe("bufferedViewportBounds", () => {
    it("按 10% 外扩视口", () => {
        expect(bufferedViewportBounds(viewport)).toEqual({
            minX: 100 - 120,
            minY: 50 - 80,
            maxX: 100 + 1200 + 120,
            maxY: 50 + 800 + 80,
        });
    });
});
