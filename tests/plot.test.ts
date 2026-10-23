/**
 * plot.test.ts — 图框 / 打印布局纯函数测试
 */

import { describe, expect, it } from "vitest";
import { CADElement } from "../types";
import {
    computePlotLayout,
    createDefaultPlotSettings,
    formatPlotScale,
    getPaperDimensionsMm,
    getPlotContentBounds,
    PLOT_LINE_WEIGHT_MM,
} from "../lib/plot";

const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
): CADElement => ({
    id: "rect-1",
    type: "RECTANGLE",
    layer: "0",
    color: "#e6edf3",
    start: { x, y },
    width,
    height,
});

describe("plot layout", () => {
    it("按纸张方向返回实际尺寸", () => {
        expect(getPaperDimensionsMm("A4", "portrait")).toEqual({
            widthMm: 210,
            heightMm: 297,
        });
        expect(getPaperDimensionsMm("A4", "landscape")).toEqual({
            widthMm: 297,
            heightMm: 210,
        });
        expect(getPaperDimensionsMm("A0", "landscape").widthMm).toBe(1189);
    });

    it("适配模式把内容完整放入绘图区并保持宽高比", () => {
        const settings = createDefaultPlotSettings({
            paper: "A3",
            orientation: "landscape",
            scaleMode: "fit",
        });
        const layout = computePlotLayout([rect(0, 0, 800, 600)], settings);

        expect(layout.overflow).toBe(false);
        expect(layout.titleBlockArea).not.toBeNull();

        const content = layout.contentBounds;
        expect(layout.viewBox.x).toBeLessThanOrEqual(content.minX);
        expect(layout.viewBox.y).toBeLessThanOrEqual(content.minY);
        expect(layout.viewBox.x + layout.viewBox.w).toBeGreaterThanOrEqual(
            content.maxX,
        );
        expect(layout.viewBox.y + layout.viewBox.h).toBeGreaterThanOrEqual(
            content.maxY,
        );

        const drawingAspect =
            layout.drawingArea.width / layout.drawingArea.height;
        expect(layout.viewBox.w / layout.viewBox.h).toBeCloseTo(
            drawingAspect,
            9,
        );
    });

    it("固定比例按 1:N 计算世界视口", () => {
        const settings = createDefaultPlotSettings({
            scaleMode: "fixed",
            scaleDenominator: 100,
            paper: "A3",
            orientation: "landscape",
        });
        const layout = computePlotLayout([rect(0, 0, 800, 600)], settings);

        expect(layout.scale).toBeCloseTo(0.01, 9);
        expect(layout.viewBox.w).toBeCloseTo(layout.drawingArea.width * 100, 6);
        expect(layout.viewBox.h).toBeCloseTo(
            layout.drawingArea.height * 100,
            6,
        );
        expect(layout.overflow).toBe(false);
    });

    it("固定比例下内容超出绘图区时标记 overflow", () => {
        const settings = createDefaultPlotSettings({
            scaleMode: "fixed",
            scaleDenominator: 1,
            paper: "A4",
            orientation: "portrait",
        });
        const layout = computePlotLayout([rect(0, 0, 800, 600)], settings);

        expect(layout.overflow).toBe(true);
    });

    it("关闭标题栏后绘图区扩展到下方边距", () => {
        const margin = 10;
        const settings = createDefaultPlotSettings({
            titleBlock: false,
            marginMm: margin,
            paper: "A4",
            orientation: "portrait",
        });
        const layout = computePlotLayout([rect(0, 0, 100, 100)], settings);

        expect(layout.titleBlockArea).toBeNull();
        expect(layout.drawingArea.height).toBeCloseTo(
            layout.paper.heightMm - margin * 2,
            6,
        );
    });

    it("空图纸回退到 800×600 视口且不产生非法数值", () => {
        const settings = createDefaultPlotSettings();
        const layout = computePlotLayout([], settings);

        expect(getPlotContentBounds([])).toEqual({
            minX: 0,
            minY: 0,
            maxX: 800,
            maxY: 600,
        });
        expect(Number.isFinite(layout.scale)).toBe(true);
        expect(layout.scale).toBeGreaterThan(0);
        expect(layout.viewBox.w).toBeGreaterThan(0);
        expect(layout.viewBox.h).toBeGreaterThan(0);
        expect(layout.overflow).toBe(false);
    });

    it("比例尺格式化为 CAD 习惯写法", () => {
        expect(formatPlotScale(0.01)).toBe("1:100");
        expect(formatPlotScale(0.5)).toBe("1:2");
        expect(formatPlotScale(2)).toBe("2:1");
        expect(formatPlotScale(0)).toBe("—");
    });

    it("打印线宽换算依赖比例：1:N 时世界线宽为 N × 0.25", () => {
        const settings = createDefaultPlotSettings({
            scaleMode: "fixed",
            scaleDenominator: 100,
        });
        const layout = computePlotLayout([rect(0, 0, 100, 100)], settings);
        expect(PLOT_LINE_WEIGHT_MM / layout.scale).toBeCloseTo(25, 9);
    });
});
