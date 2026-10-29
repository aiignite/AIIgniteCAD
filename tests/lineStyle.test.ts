import { describe, expect, it } from "vitest";
import {
    dashArrayForLineType,
    dxfHundredthsToLineWeight,
    lineWeightToDxfHundredths,
    lineWeightToScreenPx,
    normalizeLineType,
    normalizeLineWeight,
} from "../lib/lineStyle";

describe("线型映射", () => {
    it("非法或缺失的线型回落实线", () => {
        expect(normalizeLineType(undefined)).toBe("CONTINUOUS");
        expect(normalizeLineType("WAVE")).toBe("CONTINUOUS");
        expect(normalizeLineType("DASHED")).toBe("DASHED");
    });

    it("每种线型对应固定虚线图案", () => {
        expect(dashArrayForLineType("CONTINUOUS")).toBeUndefined();
        expect(dashArrayForLineType("DASHED")).toBe("8 4");
        expect(dashArrayForLineType("DOTTED")).toBe("1 3");
        expect(dashArrayForLineType("DASHDOT")).toBe("10 3 1 3");
        expect(dashArrayForLineType(undefined)).toBeUndefined();
    });

    it("打印时虚线图案按出图比例放大", () => {
        expect(dashArrayForLineType("DASHED", 100)).toBe("800 400");
        expect(dashArrayForLineType("DOTTED", 0.5)).toBe("0.5 1.5");
        expect(dashArrayForLineType("CONTINUOUS", 100)).toBeUndefined();
    });
});

describe("线宽换算", () => {
    it("归一化：非法或非正值视为未设置", () => {
        expect(normalizeLineWeight(0.355)).toBe(0.36);
        expect(normalizeLineWeight("0.35")).toBe(0.35);
        expect(normalizeLineWeight(0)).toBeUndefined();
        expect(normalizeLineWeight(-1)).toBeUndefined();
        expect(normalizeLineWeight("abc")).toBeUndefined();
        expect(normalizeLineWeight(undefined)).toBeUndefined();
    });

    it("毫米换算为屏幕像素并夹在可读范围内", () => {
        expect(lineWeightToScreenPx(0.5)).toBeCloseTo(1.89, 2);
        expect(lineWeightToScreenPx(0.13)).toBe(0.5);
        expect(lineWeightToScreenPx(undefined)).toBeUndefined();
    });

    it("DXF 370 以 1/100 mm 往返", () => {
        expect(lineWeightToDxfHundredths(0.35)).toBe(35);
        expect(lineWeightToDxfHundredths(undefined)).toBeUndefined();
        expect(dxfHundredthsToLineWeight(35)).toBe(0.35);
        expect(dxfHundredthsToLineWeight(0)).toBeUndefined();
        expect(dxfHundredthsToLineWeight(-1)).toBeUndefined();
    });
});
