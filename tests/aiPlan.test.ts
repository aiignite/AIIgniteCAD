import { describe, expect, it } from "vitest";
import {
    MAX_PLAN_STEPS,
    PLAN_TOOL_NAME,
    parsePlanProposal,
    planToToolCalls,
    shouldProposePlan,
} from "../lib/aiPlan";
import { SUPPORTED_AI_TOOL_NAMES, isReadOnlyTool, isViewTool } from "../lib/aiTools";

const validPlan = {
    goal: "规划一个两室户型",
    assumptions: ["单位为毫米", "墙厚 200"],
    steps: [
        {
            title: "绘制外轮廓",
            detail: "8000×6000",
            tool: "draw_rectangle",
            arguments: { x: 0, y: 0, width: 8000, height: 6000 },
        },
        { title: "读取现状", tool: "get_canvas_info", arguments: {} },
        { title: "说明结果" },
    ],
    checks: ["外轮廓闭合", "主要尺寸已标注"],
    risks: ["门窗位置为假设值"],
};

describe("shouldProposePlan", () => {
    const stats = { elementCount: 10, selectedCount: 0 };

    it("显式规划与跨多类操作进入计划模式", () => {
        expect(shouldProposePlan("帮我规划一个车间布局", stats)).toBe(true);
        expect(shouldProposePlan("画三根线，然后标注并移动它们", stats)).toBe(true);
        expect(
            shouldProposePlan("整理选中的工位并优化间距", { elementCount: 100, selectedCount: 5 }),
        ).toBe(true);
    });

    it("单步请求不走计划模式", () => {
        expect(shouldProposePlan("画一个半径 50 的圆", stats)).toBe(false);
        expect(shouldProposePlan("把选中的矩形向右移动 50", stats)).toBe(false);
        expect(shouldProposePlan("检查这张图纸", stats)).toBe(false);
        expect(shouldProposePlan("", stats)).toBe(false);
    });
});

describe("parsePlanProposal", () => {
    it("解析完整计划并裁剪超长内容", () => {
        const plan = parsePlanProposal(validPlan);
        expect(plan).not.toBeNull();
        expect(plan).toMatchObject({
            goal: "规划一个两室户型",
            assumptions: ["单位为毫米", "墙厚 200"],
            checks: ["外轮廓闭合", "主要尺寸已标注"],
            risks: ["门窗位置为假设值"],
        });
        expect(plan?.steps).toHaveLength(3);
        expect(plan?.steps[0].arguments).toEqual({ x: 0, y: 0, width: 8000, height: 6000 });
    });

    it("缺少 goal 或步骤时拒绝", () => {
        expect(parsePlanProposal({ ...validPlan, goal: " " })).toBeNull();
        expect(parsePlanProposal({ ...validPlan, steps: [] })).toBeNull();
        expect(parsePlanProposal(null)).toBeNull();
    });

    it(`步骤最多 ${MAX_PLAN_STEPS} 条，空标题被忽略`, () => {
        const steps = Array.from({ length: MAX_PLAN_STEPS + 5 }, (_, index) => ({
            title: index === 0 ? " " : `步骤 ${index}`,
            tool: "draw_line",
            arguments: { x1: 0, y1: 0, x2: 1, y2: 1 },
        }));
        const plan = parsePlanProposal({ goal: "测试", steps });
        expect(plan?.steps).toHaveLength(MAX_PLAN_STEPS - 1);
    });

    it("超长工具参数被丢弃但步骤保留", () => {
        const plan = parsePlanProposal({
            goal: "测试",
            steps: [
                {
                    title: "超长参数",
                    tool: "draw_polyline",
                    arguments: { points: "x".repeat(6000) },
                },
            ],
        });
        expect(plan?.steps[0].arguments).toBeUndefined();
    });
});

describe("planToToolCalls", () => {
    it("只保留可落图的写工具", () => {
        const plan = parsePlanProposal(validPlan)!;
        const calls = planToToolCalls(plan);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            name: "draw_rectangle",
            arguments: { x: 0, y: 0, width: 8000, height: 6000 },
        });
    });

    it("过滤只读、视图与未知工具", () => {
        const calls = planToToolCalls({
            goal: "测试",
            assumptions: [],
            checks: [],
            risks: [],
            steps: [
                { title: "查询", tool: "query_elements", arguments: {} },
                { title: "缩放", tool: "zoom_to_selection", arguments: {} },
                { title: "未知", tool: "draw_everything", arguments: {} },
                { title: "删除", tool: "delete_last" },
            ],
        });
        expect(calls.map((call) => call.name)).toEqual(["delete_last"]);
        expect(calls[0].arguments).toEqual({});
    });

    it("计划工具常量与后端保持一致", () => {
        expect(PLAN_TOOL_NAME).toBe("propose_plan");
    });

    it("服务端可引用的写工具在前端全部可执行", () => {
        const writeTools = SUPPORTED_AI_TOOL_NAMES.filter(
            (name) => !isReadOnlyTool(name) && !isViewTool(name),
        );
        expect(writeTools).toHaveLength(25);
        const calls = planToToolCalls({
            goal: "逐个执行写工具",
            assumptions: [],
            checks: [],
            risks: [],
            steps: writeTools.map((tool) => ({ title: tool, tool })),
        });
        expect(calls.map((call) => call.name)).toEqual(writeTools);
    });
});
