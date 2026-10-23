/**
 * aiContext.test.ts — 画布上下文摘要
 *
 * 验证摘要包含统计/包围盒/选中细节，并对超量选中与空画布做降级。
 */

import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import { chooseContextTier, estimateTokens, summarizeCanvasContext } from "../lib/aiContext";

const line = (
    id: string,
    start = { x: 0, y: 0 },
    end = { x: 10, y: 0 },
    layer = "0",
): CADElement => ({
    id,
    type: "LINE",
    start,
    end,
    layer,
    color: "#fff",
});

const circle = (id: string): CADElement => ({
    id,
    type: "CIRCLE",
    center: { x: 50, y: 50 },
    radius: 10,
    layer: "WALLS",
    color: "#fff",
});

describe("summarizeCanvasContext", () => {
    it("空画布返回最小摘要", () => {
        const summary = summarizeCanvasContext([]);

        expect(summary.text).toBe("Canvas summary: empty.");
        expect(summary.elementCount).toBe(0);
        expect(summary.selectedCount).toBe(0);
        expect(summary.chars).toBe(summary.text.length);
        expect(summary.estimatedTokens).toBe(estimateTokens(summary.text));
    });

    it("汇总类型、图层与整体包围盒", () => {
        const summary = summarizeCanvasContext([line("a"), circle("b")]);

        expect(summary.text).toContain("Canvas summary: 2 elements");
        expect(summary.text).toContain("LINE ×1");
        expect(summary.text).toContain("CIRCLE ×1");
        expect(summary.text).toContain("Layers: 0 ×1, WALLS ×1");
        expect(summary.text).toContain("Bounds: (0,0)→(60,60)");
        expect(summary.text).toContain("Selection: none");
        expect(summary.chars).toBe(summary.text.length);
        expect(summary.estimatedTokens).toBe(Math.ceil(summary.text.length / 4));
    });

    it("选中图元附带 id 与关键几何", () => {
        const summary = summarizeCanvasContext([line("a"), circle("b")], new Set(["a"]));

        expect(summary.selectedCount).toBe(1);
        expect(summary.text).toContain("Selection: 1 — a LINE (0,0)→(10,0)");
    });

    it("选中超过 10 个时截断并标注剩余数量", () => {
        const elements = Array.from({ length: 12 }, (_, index) =>
            line(`line-${index}`, { x: index, y: 0 }, { x: index + 1, y: 0 }),
        );
        const summary = summarizeCanvasContext(
            elements,
            new Set(elements.map((element) => element.id)),
        );

        expect(summary.text).toContain("…+2 more");
        expect(summary.text).not.toContain("line-11");
    });

    it("token 估算按字符数四舍五入向上取整", () => {
        expect(estimateTokens("")).toBe(0);
        expect(estimateTokens("abcd")).toBe(1);
        expect(estimateTokens("abcde")).toBe(2);
    });
});

describe("设计上下文包", () => {
    const meta = {
        projectName: "一层平面",
        units: "mm",
        layers: [
            { name: "0", visible: true, locked: false },
            { name: "WALLS", visible: false, locked: true },
        ],
        blockCount: 2,
        revision: 12,
        hiddenCount: 5,
    };

    it("brief 只给统计与选择 id，不展开几何", () => {
        const summary = summarizeCanvasContext([line("a"), circle("b")], new Set(["a"]), {
            tier: "brief",
            meta,
        });

        expect(summary.tier).toBe("brief");
        expect(summary.text).toContain("Canvas summary: 2 elements");
        expect(summary.text).toContain("Selection: 1 — ids a");
        expect(summary.text).toContain("Project: 一层平面 · units mm");
        expect(summary.text).not.toContain("Dimensions:");
        expect(summary.text).not.toContain("LINE (0,0)");
    });

    it("standard 带图层可见性、块、标注覆盖、隐藏与修订号", () => {
        const summary = summarizeCanvasContext(
            [line("a", { x: 0, y: 0 }, { x: 10, y: 0 }, "WALLS"), circle("b")],
            new Set(["a"]),
            { tier: "standard", meta },
        );

        expect(summary.text).toContain("WALLS ×2 (hidden, locked)");
        expect(summary.text).toContain("Blocks: 2 references");
        expect(summary.text).toContain("Dimensions: none for 2 drawable elements");
        expect(summary.text).toContain("Visibility: 5 elements hidden by isolation");
        expect(summary.text).toContain("Revision: 12");
        expect(summary.text).toContain("Selection: 1 — a LINE");
    });

    it("deep 展开最多 30 个选中图元", () => {
        const elements = Array.from({ length: 35 }, (_, index) =>
            line(`line-${index}`, { x: index, y: 0 }, { x: index + 1, y: 0 }),
        );
        const summary = summarizeCanvasContext(
            elements,
            new Set(elements.map((element) => element.id)),
            { tier: "deep", meta },
        );

        expect(summary.tier).toBe("deep");
        expect(summary.text).toContain("line-29 LINE");
        expect(summary.text).not.toContain("line-34 LINE");
        expect(summary.text).toContain("…+5 more");
        expect(summary.selectedCount).toBe(35);
    });

    it("按问题与图纸规模自动选档", () => {
        expect(chooseContextTier({ message: "画一个圆", elementCount: 3, selectedCount: 0 })).toBe(
            "brief",
        );
        expect(
            chooseContextTier({
                message: "检查一下这张图的标注",
                elementCount: 3,
                selectedCount: 0,
            }),
        ).toBe("deep");
        expect(
            chooseContextTier({
                message: "把选中的矩形移动一下",
                elementCount: 40,
                selectedCount: 2,
            }),
        ).toBe("standard");
        expect(
            chooseContextTier({ message: "画一个圆", elementCount: 500, selectedCount: 0 }),
        ).toBe("deep");
    });
});

describe("上下文事实与明细分离", () => {
    const dimension = (id: string): CADElement => ({
        id,
        type: "DIMENSION",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        offsetPoint: { x: 50, y: 40 },
        layer: "DIM",
        color: "#fff",
    });

    const meta = {
        layers: [
            { name: "0", visible: true, locked: false },
            { name: "HID", visible: false, locked: true },
        ],
        blockCount: 3,
    };

    it("brief 档也给出标注 / 块 / 图层状态一行事实", () => {
        const summary = summarizeCanvasContext([line("a"), dimension("d1")], new Set(["a"]), {
            tier: "brief",
            meta,
        });

        expect(summary.text).toContain("有标注：是");
        expect(summary.text).toContain("块引用：3");
        expect(summary.text).toContain("隐藏图层：1 · 锁定图层：1");
        // 明细仍留在 standard / deep，brief 不展开 Dimensions 行
        expect(summary.text).not.toContain("Dimensions:");
    });

    it("没有标注与块时事实写否与 0", () => {
        const summary = summarizeCanvasContext([line("a")], new Set(), {
            tier: "brief",
            meta: { layers: [{ name: "0", visible: true, locked: false }] },
        });

        expect(summary.text).toContain("有标注：否 · 块引用：0 · 隐藏图层：0 · 锁定图层：0");
    });

    it("standard 档图层截断时补隐藏 / 锁定计数", () => {
        const names = Array.from({ length: 10 }, (_, index) => `L${index}`);
        const elements = names.map((name, index) =>
            line(`line-${index}`, { x: index, y: 0 }, { x: index + 1, y: 0 }, name),
        );
        const summary = summarizeCanvasContext(elements, new Set(), {
            tier: "standard",
            meta: {
                layers: names.map((name, index) => ({
                    name,
                    visible: index !== 8,
                    locked: index === 9,
                })),
            },
        });

        // standard 上限 8 层，剩下的 L8 隐藏、L9 锁定
        expect(summary.text).toContain("…另有 2 个图层（1 个隐藏、1 个锁定）");
        expect(summary.text).not.toContain("…+2 more");
    });

    it("截断的图层都没有状态时不写空括号", () => {
        const names = Array.from({ length: 10 }, (_, index) => `L${index}`);
        const elements = names.map((name, index) =>
            line(`line-${index}`, { x: index, y: 0 }, { x: index + 1, y: 0 }, name),
        );
        const summary = summarizeCanvasContext(elements, new Set(), { tier: "standard" });

        expect(summary.text).toContain("…另有 2 个图层");
        expect(summary.text).not.toContain("（");
    });
});
