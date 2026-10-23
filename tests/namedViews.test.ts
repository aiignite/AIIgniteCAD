/**
 * namedViews.test.ts — 命名视图纯逻辑测试
 */

import { describe, expect, it } from "vitest";
import {
    isNamedView,
    normalizeViewName,
    removeNamedView,
    upsertNamedView,
    type NamedView,
} from "../lib/namedViews";

const view = (name: string): NamedView => ({
    name,
    viewBox: { x: 10, y: 20, w: 800, h: 600 },
});

describe("isNamedView", () => {
    it("接受结构完整的命名视图", () => {
        expect(isNamedView(view("A"))).toBe(true);
    });

    it("拒绝缺字段或尺寸非法的数据", () => {
        expect(isNamedView(null)).toBe(false);
        expect(isNamedView({ name: "A" })).toBe(false);
        expect(isNamedView({ name: "", viewBox: { x: 0, y: 0, w: 10, h: 10 } })).toBe(false);
        expect(isNamedView({ name: "A", viewBox: { x: 0, y: 0, w: 0, h: 10 } })).toBe(false);
        expect(isNamedView({ name: "A", viewBox: { x: 0, y: 0, w: 10, h: NaN } })).toBe(false);
    });
});

describe("upsertNamedView", () => {
    it("同名视图被覆盖并排在末尾", () => {
        const views = upsertNamedView([view("A"), view("B")], view("A"));
        expect(views.map((item) => item.name)).toEqual(["B", "A"]);
        expect(views[1].viewBox).toEqual({ x: 10, y: 20, w: 800, h: 600 });
    });

    it("复制视口副本，避免外部改写", () => {
        const source = view("A");
        const views = upsertNamedView([], source);
        source.viewBox.w = 1;
        expect(views[0].viewBox.w).toBe(800);
    });
});

describe("removeNamedView", () => {
    it("删除指定名称，其余保持不变", () => {
        expect(removeNamedView([view("A"), view("B")], "A").map((item) => item.name)).toEqual(["B"]);
        expect(removeNamedView([view("A")], "Z")).toHaveLength(1);
    });
});

describe("normalizeViewName", () => {
    it("去空白并限制长度", () => {
        expect(normalizeViewName("  俯视图  ")).toBe("俯视图");
        expect(normalizeViewName("x".repeat(80))).toHaveLength(64);
        expect(normalizeViewName("   ")).toBe("");
    });
});
