import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import { reviewPreview } from "../lib/previewReview";

const line = (overrides: Partial<CADElement> = {}): CADElement => ({
    id: "line-1",
    type: "LINE",
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    layer: "0",
    color: "#fff",
    ...overrides,
});

const circle = (overrides: Partial<CADElement> = {}): CADElement => ({
    id: "circle-1",
    type: "CIRCLE",
    center: { x: 50, y: 50 },
    radius: 20,
    layer: "0",
    color: "#fff",
    ...overrides,
});

describe("reviewPreview", () => {
    it("识别本次新引入的错误并阻断应用", () => {
        const review = reviewPreview([], [line({ end: { x: 0, y: 0 } })]);
        expect(review.hasErrors).toBe(true);
        expect(review.counts).toMatchObject({ error: 1, warning: 0, info: 0 });
        expect(review.introduced[0]).toMatchObject({ code: "zero-length", severity: "error" });
    });

    it("图纸原有问题不算在本次变更头上", () => {
        const broken = line({ end: { x: 0, y: 0 } });
        const review = reviewPreview([broken], [broken, circle()]);
        expect(review.hasErrors).toBe(false);
        expect(review.introduced).toHaveLength(0);
    });

    it("本次变更修复的问题计入 resolved", () => {
        const broken = line({ end: { x: 0, y: 0 } });
        const review = reviewPreview([broken], [line()]);
        expect(review.resolved).toBe(1);
        expect(review.introduced).toHaveLength(0);
    });

    it("新增重复图元给出警告但不阻断", () => {
        const review = reviewPreview([circle()], [circle(), circle({ id: "circle-2" })]);
        expect(review.hasErrors).toBe(false);
        expect(review.counts.warning).toBe(1);
        expect(review.introduced[0].code).toBe("duplicate");
    });

    it("按 错误 → 警告 → 提示 排序", () => {
        const review = reviewPreview(
            [],
            [
                line({ id: "zero", end: { x: 0, y: 0 } }),
                circle({ id: "c1" }),
                circle({ id: "c2" }),
                line({ id: "l2", start: { x: 300, y: 0 }, end: { x: 400, y: 0 } }),
                line({ id: "l3", start: { x: 300, y: 50 }, end: { x: 400, y: 50 } }),
            ],
        );
        expect(review.introduced[0].severity).toBe("error");
        expect(review.counts.error).toBe(1);
        expect(review.counts.warning).toBeGreaterThanOrEqual(1);
    });

    it("按项目设计约定检查图层归属", () => {
        const review = reviewPreview([], [line({ id: "l1", layer: "随便放的" })], {
            layerRules: [{ name: "WALLS", purpose: "墙体" }],
        });
        expect(review.hasErrors).toBe(false);
        expect(review.counts.warning).toBe(1);
        expect(review.introduced[0].code).toBe("layer-rule-violation");
    });

    it("没有约定时图层归属不参与检查", () => {
        const review = reviewPreview([], [line({ id: "l1", layer: "随便放的" })]);
        expect(review.introduced.map((issue) => issue.code)).not.toContain("layer-rule-violation");
    });
});
