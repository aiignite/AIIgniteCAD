import { describe, expect, it } from "vitest";
import { AI_GHOST_COLORS, planAIGhostPreview } from "../lib/aiGhost";
import type { CADElement } from "../types";

const line = (id: string, x2 = 100): CADElement => ({
    id,
    type: "LINE",
    start: { x: 0, y: 0 },
    end: { x: x2, y: 0 },
    layer: "0",
    color: "#fff",
});

const circle = (id: string, radius = 5): CADElement => ({
    id,
    type: "CIRCLE",
    center: { x: 10, y: 10 },
    radius,
    layer: "0",
    color: "#fff",
});

describe("AI 幽灵预览计划", () => {
    it("新增与修改后的结果进入 incoming", () => {
        const before = [line("a"), line("b", 50)];
        const after = [line("a"), line("b", 80), circle("c")];

        const plan = planAIGhostPreview(before, after);

        expect(plan.incoming.map((element) => element.id).sort()).toEqual(["b", "c"]);
        expect(plan.incoming.find((element) => element.id === "b")?.end?.x).toBe(80);
    });

    it("删除与修改前的现状进入 outgoing，并登记需摘除的真实图元", () => {
        const before = [line("a"), line("b", 50), circle("c")];
        const after = [line("a"), line("b", 80)];

        const plan = planAIGhostPreview(before, after);

        expect(plan.outgoing.map((element) => element.id).sort()).toEqual(["b", "c"]);
        expect([...plan.outgoingIds].sort()).toEqual(["b", "c"]);
        expect(plan.outgoing.find((element) => element.id === "b")?.end?.x).toBe(50);
    });

    it("未变化图元两侧都不出现", () => {
        const before = [line("a"), circle("b")];
        const after = [line("a"), circle("b")];

        const plan = planAIGhostPreview(before, after);

        expect(plan.incoming).toHaveLength(0);
        expect(plan.outgoing).toHaveLength(0);
        expect(plan.outgoingIds.size).toBe(0);
    });

    it("清空画布时全部现状图元被判为将被移除", () => {
        const before = [line("a"), circle("b")];

        const plan = planAIGhostPreview(before, []);

        expect([...plan.outgoingIds].sort()).toEqual(["a", "b"]);
        expect(plan.incoming).toHaveLength(0);
    });

    it("幽灵配色与选中黄、预选浅蓝互不冲突", () => {
        expect(AI_GHOST_COLORS).toEqual({ incoming: "#a78bfa", outgoing: "#f87171" });
    });
});
