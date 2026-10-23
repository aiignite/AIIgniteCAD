import { describe, expect, it } from "vitest";
import { applyToolCalls, createDraft } from "../lib/aiAgentLoop";
import { parseVariantProposal, shouldProposeVariants, variantToToolCalls } from "../lib/aiVariants";

const rectangleStep = (x: number) => ({
    title: `画矩形 ${x}`,
    tool: "draw_rectangle",
    arguments: { x, y: 0, width: 100, height: 60 },
});

const proposal = {
    goal: "两种工位布局",
    variants: [
        { name: "紧凑", summary: "间距 400", steps: [rectangleStep(0)] },
        {
            name: "宽松",
            summary: "间距 800",
            steps: [rectangleStep(0), { title: "检查", tool: "check_drawing" }],
        },
    ],
};

describe("shouldProposeVariants", () => {
    it("只有明确的方案对比请求才进入多方案模式", () => {
        expect(shouldProposeVariants("给我两个布局方案对比")).toBe(true);
        expect(shouldProposeVariants("做几个备选方案")).toBe(true);
        expect(shouldProposeVariants("show alternative layouts")).toBe(true);
        expect(shouldProposeVariants("规划一个车间布局")).toBe(false);
        expect(shouldProposeVariants("画一个圆")).toBe(false);
    });
});

describe("parseVariantProposal", () => {
    it("解析 2–3 个方案并保留步骤工具", () => {
        const parsed = parseVariantProposal(proposal);
        expect(parsed?.goal).toBe("两种工位布局");
        expect(parsed?.variants).toHaveLength(2);
        expect(parsed?.variants[0].summary).toBe("间距 400");
        expect(parsed?.variants[1].steps).toHaveLength(2);
        expect(parsed?.variants[0].steps[0].arguments).toEqual({
            x: 0,
            y: 0,
            width: 100,
            height: 60,
        });
    });

    it("拒绝数量、重名与空步骤", () => {
        expect(parseVariantProposal({ ...proposal, variants: [proposal.variants[0]] })).toBeNull();
        expect(
            parseVariantProposal({
                ...proposal,
                variants: [proposal.variants[0], { ...proposal.variants[1], name: "紧凑" }],
            }),
        ).toBeNull();
        expect(
            parseVariantProposal({
                goal: "目标",
                variants: [
                    { name: "A", steps: [] },
                    { name: "B", steps: [rectangleStep(0)] },
                ],
            }),
        ).toBeNull();
    });

    it("超过 3 个方案被拒绝", () => {
        const variants = ["A", "B", "C", "D"].map((name) => ({
            name,
            steps: [rectangleStep(0)],
        }));
        expect(parseVariantProposal({ goal: "目标", variants })).toBeNull();
    });
});

describe("variantToToolCalls / 草稿执行", () => {
    it("过滤只读步骤，写步骤转为工具调用", () => {
        const parsed = parseVariantProposal(proposal)!;
        const calls = variantToToolCalls(parsed.variants[1]);
        expect(calls.map((call) => call.name)).toEqual(["draw_rectangle"]);
    });

    it("propose_variants 不产生画布动作，只返回方案", () => {
        const { draft, results, variants } = applyToolCalls(
            [{ id: "v1", name: "propose_variants", arguments: proposal }],
            createDraft([], []),
        );
        expect(results[0].ok).toBe(true);
        expect(variants?.variants).toHaveLength(2);
        expect(draft.actions).toEqual([]);
        expect(draft.elements).toEqual([]);
    });

    it("非法方案回传错误且不影响后续调用", () => {
        const { results, variants, draft } = applyToolCalls(
            [
                { id: "bad", name: "propose_variants", arguments: { goal: "缺方案" } },
                {
                    id: "draw",
                    name: "draw_line",
                    arguments: { x1: 0, y1: 0, x2: 10, y2: 0 },
                },
            ],
            createDraft([], []),
        );
        expect(results[0].ok).toBe(false);
        expect(results[1].ok).toBe(true);
        expect(variants).toBeUndefined();
        expect(draft.elements).toHaveLength(1);
    });
});
