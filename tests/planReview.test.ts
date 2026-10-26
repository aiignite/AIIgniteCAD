import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import type { PlanProposal } from "../lib/aiPlan";
import { planStepKind, preflightPlan, summarizePreflight } from "../lib/planReview";

const line = (id: string, x1: number, y1: number, x2: number, y2: number): CADElement => ({
    id,
    type: "LINE",
    layer: "0",
    color: "#fff",
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
});

const plan = (steps: PlanProposal["steps"]): PlanProposal => ({
    goal: "测试计划",
    assumptions: [],
    steps,
    checks: [],
    risks: [],
});

describe("planStepKind", () => {
    it("区分写、只读、视图、无工具与未知工具", () => {
        expect(planStepKind("draw_rectangle")).toBe("write");
        expect(planStepKind("check_drawing")).toBe("readonly");
        expect(planStepKind("zoom_to_selection")).toBe("view");
        expect(planStepKind(undefined)).toBe("no-tool");
        expect(planStepKind("nonexistent_tool")).toBe("unknown-tool");
    });
});

describe("preflightPlan", () => {
    it("只读与说明步骤不计为失败", () => {
        const result = preflightPlan({
            elements: [],
            proposal: plan([
                { title: "读取现状", tool: "get_canvas_info", arguments: {} },
                { title: "说明结果" },
                { title: "画一条线", tool: "draw_line", arguments: { x1: 0, y1: 0, x2: 100, y2: 0 } },
            ]),
        });

        expect(result.steps.map((step) => step.kind)).toEqual(["readonly", "no-tool", "write"]);
        expect(result.writtenSteps).toBe(1);
        expect(result.failedSteps).toBe(0);
        expect(result.changedCount).toBe(1);
        expect(result.introduced).toHaveLength(0);
        expect(summarizePreflight(result)).toContain("预检通过");
    });

    it("未知工具记为失败步骤而不是抛错", () => {
        const result = preflightPlan({
            elements: [],
            proposal: plan([{ title: "未知操作", tool: "not_a_tool", arguments: {} }]),
        });

        expect(result.steps[0].kind).toBe("unknown-tool");
        expect(result.failedSteps).toBe(1);
        expect(result.steps[0].error).toContain("未知工具");
    });

    it("目标不存在时记录失败原因，不产生画布改动", () => {
        const result = preflightPlan({
            elements: [line("a", 0, 0, 10, 0)],
            proposal: plan([
                {
                    title: "移动不存在的图元",
                    tool: "move_elements",
                    arguments: { ids: ["ghost"], dx: 10, dy: 0 },
                },
            ]),
        });

        expect(result.writtenSteps).toBe(0);
        expect(result.failedSteps).toBe(1);
        expect(result.changedCount).toBe(0);
        expect(result.steps[0].error).toBeTruthy();
        expect(result.introduced).toHaveLength(0);
    });

    it("计划引入的确定性检查问题会归因到具体步骤", () => {
        const result = preflightPlan({
            elements: [],
            proposal: plan([
                {
                    title: "画一条零长度线",
                    tool: "draw_line",
                    arguments: { x1: 10, y1: 10, x2: 10, y2: 10 },
                },
            ]),
        });

        expect(result.hasErrors).toBe(true);
        expect(result.counts.error).toBe(1);
        expect(result.introduced.map((issue) => issue.code)).toContain("zero-length");
        expect(result.steps[0].introduced.map((issue) => issue.code)).toContain("zero-length");
        expect(summarizePreflight(result)).toContain("错误 1");
    });

    it("约定驱动的图层问题同样进入预检并归因", () => {
        const result = preflightPlan({
            elements: [line("a", 0, 0, 100, 0)],
            conventions: { layerRules: [{ name: "OUTLINE", purpose: "轮廓" }] },
            proposal: plan([
                {
                    title: "把线移到未登记图层",
                    tool: "assign_layer",
                    arguments: { ids: ["a"], layer: "SCRATCH" },
                },
            ]),
        });

        expect(result.introduced.map((issue) => issue.code)).toContain("layer-rule-violation");
        expect(result.steps[0].introduced.map((issue) => issue.code)).toContain(
            "layer-rule-violation",
        );
    });

    it("同一问题只算在最先引入它的步骤上", () => {
        const result = preflightPlan({
            elements: [],
            proposal: plan([
                {
                    title: "画零长度线",
                    tool: "draw_line",
                    arguments: { x1: 0, y1: 0, x2: 0, y2: 0 },
                },
                {
                    title: "把同一条线右移",
                    tool: "move_elements",
                    arguments: { dx: 10, dy: 0 },
                },
            ]),
        });

        // 第二步没有显式 ids，落在空选择集上会直接失败，问题仍只归第一步
        expect(result.steps[0].introduced.length).toBeGreaterThan(0);
        expect(result.introduced.filter((issue) => issue.code === "zero-length")).toHaveLength(1);
    });

    it("空步骤计划不产生问题与改动", () => {
        const result = preflightPlan({ elements: [line("a", 0, 0, 10, 0)], proposal: plan([]) });
        expect(result.steps).toHaveLength(0);
        expect(result.introduced).toHaveLength(0);
        expect(result.changedCount).toBe(0);
    });
});
