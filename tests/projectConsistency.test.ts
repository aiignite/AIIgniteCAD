import { describe, expect, it } from "vitest";
import {
    checkProjectConsistency,
    summarizeConsistency,
    type DrawingFacts,
} from "../lib/projectConsistency";

const drawing = (overrides: Partial<DrawingFacts> = {}): DrawingFacts => ({
    id: "d1",
    name: "平面图",
    elementCount: 120,
    conventions: {
        units: "mm",
        textHeight: 3.5,
        dimensionPrecision: 2,
        standard: "GB/T 14689",
        layerRules: [
            { name: "OUTLINE", purpose: "轮廓" },
            { name: "DIM", purpose: "标注" },
        ],
    },
    ...overrides,
});

describe("checkProjectConsistency", () => {
    it("单张图纸不做跨图纸检查", () => {
        expect(checkProjectConsistency([drawing()])).toHaveLength(0);
        expect(checkProjectConsistency([])).toHaveLength(0);
    });

    it("约定一致的图纸不报问题", () => {
        const issues = checkProjectConsistency([
            drawing(),
            drawing({ id: "d2", name: "立面图", elementCount: 80 }),
        ]);
        expect(issues).toHaveLength(0);
        expect(summarizeConsistency(issues)).toContain("未发现跨图纸问题");
    });

    it("单位不一致是最严重的一条：跨图复制会缩放错误", () => {
        const issues = checkProjectConsistency([
            drawing(),
            drawing({
                id: "d2",
                name: "立面图",
                conventions: { ...drawing().conventions, units: "m" },
            }),
        ]);
        const units = issues.find((issue) => issue.code === "units-mismatch");
        expect(units?.severity).toBe("warning");
        expect(units?.message).toContain("m / mm");
        expect(units?.drawingIds).toEqual(["d1", "d2"]);
    });

    it("字高、精度、制图标准分别按严重度报告", () => {
        const issues = checkProjectConsistency([
            drawing(),
            drawing({
                id: "d2",
                name: "立面图",
                conventions: {
                    units: "mm",
                    textHeight: 5,
                    dimensionPrecision: 0,
                    standard: "ISO 128",
                    layerRules: [],
                },
            }),
        ]);
        const codes = issues.map((issue) => `${issue.code}:${issue.severity}`);
        expect(codes).toContain("text-height-mismatch:warning");
        expect(codes).toContain("dimension-precision-mismatch:info");
        expect(codes).toContain("standard-mismatch:info");
    });

    it("约定图层只在部分图纸登记时点名缺失图层", () => {
        const issues = checkProjectConsistency([
            drawing(),
            drawing({
                id: "d2",
                name: "立面图",
                conventions: {
                    units: "mm",
                    textHeight: 3.5,
                    dimensionPrecision: 2,
                    standard: "GB/T 14689",
                    layerRules: [{ name: "OUTLINE" }],
                },
            }),
        ]);
        const layers = issues.find((issue) => issue.code === "layer-rules-mismatch");
        expect(layers?.message).toContain("DIM");
        expect(layers?.message).not.toContain("OUTLINE");
    });

    it("重名、空图纸与约定缺失各自成条", () => {
        const issues = checkProjectConsistency([
            drawing(),
            drawing({ id: "d2" }),
            drawing({ id: "d3", name: "详图", elementCount: 0, conventions: null }),
        ]);
        const codes = issues.map((issue) => issue.code);
        expect(codes).toContain("duplicate-name");
        expect(codes).toContain("empty-drawing");
        expect(codes).toContain("conventions-missing");
    });

    it("全部图纸都没有约定时不报「约定缺失」", () => {
        const issues = checkProjectConsistency([
            drawing({ conventions: null }),
            drawing({ id: "d2", conventions: undefined }),
        ]);
        expect(issues.map((issue) => issue.code)).not.toContain("conventions-missing");
    });

    it("未设置的可比字段不参与比较", () => {
        const issues = checkProjectConsistency([
            drawing({ conventions: { units: "mm" } }),
            drawing({ id: "d2", conventions: { units: "mm", textHeight: 5 } }),
        ]);
        expect(issues.map((issue) => issue.code)).not.toContain("text-height-mismatch");
    });

    it("结果按警告 → 提示排序", () => {
        const issues = checkProjectConsistency([
            drawing(),
            drawing({ id: "d2", name: "平面图", elementCount: 0, conventions: { units: "m" } }),
        ]);
        const severities = issues.map((issue) => issue.severity);
        expect(severities.indexOf("warning")).toBeLessThan(severities.indexOf("info"));
    });
});
