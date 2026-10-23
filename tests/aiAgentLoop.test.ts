import { describe, expect, it } from "vitest";
import type { AIToolCall, CADElement } from "../types";
import {
    MAX_TOOL_CALLS_PER_ROUND,
    applyToolCalls,
    createDraft,
    diffElementCounts,
    fallbackActionsFromText,
    summarizeCanvas,
} from "../lib/aiAgentLoop";
import { FIXTURE_BLOCK_CATALOG, FIXTURE_ELEMENTS, FIXTURE_SELECTION } from "./aiToolFixtures";

const call = (name: string, args: Record<string, unknown>, id = name): AIToolCall => ({
    id,
    name,
    arguments: args,
});

const emptyCanvas: CADElement[] = [];

describe("createDraft / summarizeCanvas", () => {
    it("丢弃画布上不存在的选择 id", () => {
        const draft = createDraft(FIXTURE_ELEMENTS, [...FIXTURE_SELECTION, "ghost"]);
        expect(draft.selection).toEqual(FIXTURE_SELECTION);
        expect(draft.actions).toEqual([]);
    });

    it("统计类型分布与包围盒", () => {
        const stats = summarizeCanvas(createDraft(FIXTURE_ELEMENTS, FIXTURE_SELECTION));
        expect(stats.elementCount).toBe(3);
        expect(stats.byType).toEqual({ LINE: 1, CIRCLE: 1, TEXT: 1 });
        expect(stats.selectedCount).toBe(2);
        expect(stats.bounds).toEqual({ minX: 50, minY: 50, maxX: 450, maxY: 350 });
    });

    it("空画布没有包围盒", () => {
        const stats = summarizeCanvas(createDraft(emptyCanvas));
        expect(stats.elementCount).toBe(0);
        expect(stats.bounds).toBeNull();
    });

    it("块库目录读取失败时草稿标记为不可用", () => {
        expect(createDraft(emptyCanvas, [], { entries: [], ok: false }).blocksUnavailable).toBe(
            true,
        );
        expect(createDraft(emptyCanvas, [], FIXTURE_BLOCK_CATALOG).blocksUnavailable).toBe(false);
        expect(createDraft(emptyCanvas).blocksUnavailable).toBe(false);
    });
});

describe("applyToolCalls 在草稿上求值", () => {
    it("绘制工具累加图元并记录变更 id", () => {
        const start = createDraft(emptyCanvas);
        const { draft, results } = applyToolCalls(
            [
                call("draw_line", { x1: 0, y1: 0, x2: 100, y2: 0 }, "a"),
                call("draw_circle", { cx: 50, cy: 50, radius: 10 }, "b"),
            ],
            start,
        );

        expect(results.map((result) => result.ok)).toEqual([true, true]);
        expect(draft.elements).toHaveLength(2);
        expect(results[1].changedIds).toHaveLength(1);
        expect(draft.actions.map((action) => action.operation)).toEqual(["ADD", "ADD"]);
    });

    it("只读工具回报画布状态且不产生动作", () => {
        const { draft, results } = applyToolCalls(
            [call("get_canvas_info", {}, "info")],
            createDraft(FIXTURE_ELEMENTS, ["line-1"]),
        );

        expect(results[0].ok).toBe(true);
        expect(results[0].summary).toContain("图元 3 个");
        expect(results[0].summary).toContain("LINE×1");
        expect(results[0].changedIds).toBeUndefined();
        expect(draft.actions).toHaveLength(0);
        expect(draft.elements).toBe(FIXTURE_ELEMENTS);
    });

    it("省略 ids 且无选择集时拒绝，并把原因回传给模型", () => {
        const { results } = applyToolCalls(
            [call("move_elements", { dx: 10, dy: 0 }, "move")],
            createDraft(FIXTURE_ELEMENTS, []),
        );

        expect(results[0].ok).toBe(false);
        expect(results[0].error).toContain("ids");
    });

    it("变换作用于草稿选择集", () => {
        const { draft, results } = applyToolCalls(
            [call("move_elements", { dx: 10, dy: 5 }, "move")],
            createDraft(FIXTURE_ELEMENTS, ["line-1"]),
        );

        expect(results[0].ok).toBe(true);
        expect(results[0].summary).toContain("修改 1 个图元");
        const moved = draft.elements.find((element) => element.id === "line-1");
        expect(moved?.start).toEqual({ x: 110, y: 105 });
    });

    it("复制产生的新图元进入草稿并可被下一轮引用", () => {
        const first = applyToolCalls(
            [call("copy_elements", { ids: ["line-1"], dx: 200, dy: 0 }, "copy")],
            createDraft(FIXTURE_ELEMENTS, []),
        );
        expect(first.draft.elements).toHaveLength(4);
        const copyId = first.draft.selection;
        expect(copyId).toHaveLength(1);

        const second = applyToolCalls(
            [call("move_elements", { ids: copyId, dx: 0, dy: 50 }, "move2")],
            first.draft,
            1,
        );
        expect(second.results[0].ok).toBe(true);
        expect(second.draft.elements.find((element) => element.id === copyId[0])?.start).toEqual({
            x: 300,
            y: 150,
        });
    });

    it("新建图元可在后续轮次按 id 精修", () => {
        const drawn = applyToolCalls(
            [call("draw_rectangle", { x: 0, y: 0, width: 5000, height: 4000 }, "rect")],
            createDraft(emptyCanvas),
        );
        const newIds = drawn.results[0].changedIds ?? [];
        expect(newIds).toHaveLength(1);

        const scaled = applyToolCalls(
            [call("scale_elements", { ids: newIds, factor: 0.5 }, "scale")],
            drawn.draft,
            1,
        );
        expect(scaled.results[0].ok).toBe(true);
        expect(scaled.draft.elements[0]).toMatchObject({ width: 2500, height: 2000 });
    });

    it("清空画布回报删除数量", () => {
        const { draft, results } = applyToolCalls(
            [call("clear_canvas", {}, "clear")],
            createDraft(FIXTURE_ELEMENTS, FIXTURE_SELECTION),
        );
        expect(draft.elements).toEqual([]);
        expect(results[0].summary).toContain("删除 3 个图元");
        expect(results[0].changedIds).toHaveLength(3);
    });

    it("未知工具与不存在的 id 单条拒绝，不影响同轮其它调用", () => {
        const { draft, results } = applyToolCalls(
            [
                call("unknown_tool", {}, "u"),
                call("move_elements", { ids: ["ghost"], dx: 1, dy: 1 }, "m"),
                call("draw_text", { x: 1, y: 1, text: "OK" }, "t"),
            ],
            createDraft(FIXTURE_ELEMENTS, []),
        );

        expect(results.map((result) => result.ok)).toEqual([false, false, true]);
        expect(draft.elements).toHaveLength(4);
        expect(results[0].error).toContain("unknown_tool");
        expect(results[1].error).toContain("move_elements.ids");
    });

    it("失败调用同样占单轮额度，不能靠重试占满一轮", () => {
        const calls = Array.from({ length: MAX_TOOL_CALLS_PER_ROUND + 1 }, (_, index) =>
            call("move_elements", { ids: [`ghost-${index}`], dx: 1, dy: 1 }, `move-${index}`),
        );
        const { draft, results, skipped } = applyToolCalls(calls, createDraft(FIXTURE_ELEMENTS));

        expect(results).toHaveLength(calls.length);
        expect(skipped).toBe(1);
        expect(results[MAX_TOOL_CALLS_PER_ROUND].ok).toBe(false);
        expect(results[MAX_TOOL_CALLS_PER_ROUND].error).toContain("上限");
        expect(draft.elements).toHaveLength(3);
    });

    it("超出单轮上限的调用被跳过并提示下一轮继续", () => {
        const calls = Array.from({ length: MAX_TOOL_CALLS_PER_ROUND + 1 }, (_, index) =>
            call("draw_line", { x1: index, y1: 0, x2: index, y2: 10 }, `line-${index}`),
        );
        const { draft, results, skipped } = applyToolCalls(calls, createDraft(emptyCanvas));

        expect(results).toHaveLength(calls.length);
        expect(skipped).toBe(1);
        expect(results[MAX_TOOL_CALLS_PER_ROUND].ok).toBe(false);
        expect(results[MAX_TOOL_CALLS_PER_ROUND].error).toContain("上限");
        expect(draft.elements).toHaveLength(MAX_TOOL_CALLS_PER_ROUND);
    });

    it("视图类工具只产出视口请求，不写画布也不进动作", () => {
        const { draft, results, viewRequests } = applyToolCalls(
            [call("zoom_to_selection", { ids: ["circle-1"] }, "zoom")],
            createDraft(FIXTURE_ELEMENTS, []),
        );

        expect(results[0].ok).toBe(true);
        expect(viewRequests).toHaveLength(1);
        expect(viewRequests[0].bounds).toEqual({
            minX: 350,
            minY: 250,
            maxX: 450,
            maxY: 350,
        });
        expect(draft.actions).toHaveLength(0);
        expect(draft.elements).toBe(FIXTURE_ELEMENTS);
    });

    it("省略 ids 时缩放到草稿选择集", () => {
        const { viewRequests } = applyToolCalls(
            [call("zoom_to_selection", {}, "zoom")],
            createDraft(FIXTURE_ELEMENTS, ["line-1"]),
        );

        expect(viewRequests).toHaveLength(1);
        expect(viewRequests[0].bounds).toEqual({
            minX: 100,
            minY: 100,
            maxX: 300,
            maxY: 100,
        });
    });

    it("没有可缩放目标时拒绝并把原因回传给模型", () => {
        const { results, viewRequests } = applyToolCalls(
            [call("zoom_to_selection", {}, "zoom")],
            createDraft(FIXTURE_ELEMENTS, []),
        );

        expect(results[0].ok).toBe(false);
        expect(results[0].error).toContain("没有可缩放");
        expect(viewRequests).toHaveLength(0);
    });

    it("未知 ids 的缩放调用点名 ids 字段", () => {
        const { results } = applyToolCalls(
            [call("zoom_to_selection", { ids: ["ghost"] }, "zoom")],
            createDraft(FIXTURE_ELEMENTS, []),
        );

        expect(results[0].error).toContain("zoom_to_selection.ids");
    });

    it("连续重复的同工具同参数调用提示模型换做法，但不拒绝", () => {
        const { results } = applyToolCalls(
            [
                call("draw_circle", { cx: 0, cy: 0, radius: 5 }, "a"),
                call("draw_circle", { cx: 0, cy: 0, radius: 5 }, "b"),
                call("draw_circle", { cx: 20, cy: 0, radius: 5 }, "c"),
            ],
            createDraft(emptyCanvas),
        );

        expect(results.map((result) => result.ok)).toEqual([true, true, true]);
        expect(results[0].summary).not.toContain("完全相同");
        expect(results[1].summary).toContain("完全相同");
        expect(results[2].summary).not.toContain("完全相同");
    });

    it("重复的失败调用同样带提示", () => {
        const { results } = applyToolCalls(
            [
                call("move_elements", { dx: 1, dy: 1 }, "a"),
                call("move_elements", { dx: 1, dy: 1 }, "b"),
            ],
            createDraft(FIXTURE_ELEMENTS, []),
        );

        expect(results[1].error).toContain("完全相同");
    });
});

describe("applyToolCalls 计划模式", () => {
    const planArgs = {
        goal: "整理工位",
        steps: [
            { title: "对齐", tool: "align_elements", arguments: { mode: "left", ids: ["line-1"] } },
            { title: "查询", tool: "get_canvas_info" },
        ],
        checks: ["包围盒不变"],
    };

    it("propose_plan 返回计划但不写草稿、不产生动作", () => {
        const { draft, results, plan } = applyToolCalls(
            [call("propose_plan", planArgs, "plan")],
            createDraft(FIXTURE_ELEMENTS, FIXTURE_SELECTION),
        );

        expect(results[0].ok).toBe(true);
        expect(results[0].summary).toContain("整理工位");
        expect(plan?.steps).toHaveLength(2);
        expect(draft.elements).toBe(FIXTURE_ELEMENTS);
        expect(draft.actions).toHaveLength(0);
    });

    it("计划与只读工具同轮时继续返回只读结果", () => {
        const { results, plan } = applyToolCalls(
            [call("get_canvas_info", {}, "info"), call("propose_plan", planArgs, "plan")],
            createDraft(FIXTURE_ELEMENTS),
        );

        expect(results.map((result) => result.ok)).toEqual([true, true]);
        expect(results[0].summary).toContain("图元 3 个");
        expect(plan?.goal).toBe("整理工位");
    });

    it("缺少步骤的计划回传错误且不影响后续调用", () => {
        const { results, plan, draft } = applyToolCalls(
            [
                call("propose_plan", { goal: "空计划", steps: [] }, "bad"),
                call("draw_line", { x1: 0, y1: 0, x2: 1, y2: 1 }, "line"),
            ],
            createDraft(emptyCanvas),
        );

        expect(results[0].ok).toBe(false);
        expect(results[0].error).toContain("goal");
        expect(plan).toBeUndefined();
        expect(results[1].ok).toBe(true);
        expect(draft.elements).toHaveLength(1);
    });
});

describe("块插入计入草稿事实", () => {
    it("insert_block 成功后记录块身份，失败时不记录", () => {
        const start = createDraft(emptyCanvas, [], FIXTURE_BLOCK_CATALOG);
        const { draft, results } = applyToolCalls(
            [
                call("insert_block", { blockId: "block-door", x: 500, y: 400 }, "ok"),
                call("insert_block", { blockId: "block-missing", x: 10, y: 10 }, "missing"),
            ],
            start,
        );

        expect(results.map((result) => result.ok)).toEqual([true, false]);
        expect(draft.blockInsertions).toEqual([{ blockId: "block-door", name: "标准门洞" }]);
    });

    it("新草稿不带上一轮的块插入", () => {
        expect(createDraft(emptyCanvas).blockInsertions).toEqual([]);
    });

    it("块库不可用时查询与插入都说「不可用」", () => {
        const start = createDraft(emptyCanvas, [], { entries: [], ok: false });
        const { results } = applyToolCalls(
            [
                call("list_blocks", {}, "list"),
                call("insert_block", { blockId: "block-door", x: 0, y: 0 }, "insert"),
            ],
            start,
        );

        expect(results.map((result) => result.ok)).toEqual([false, false]);
        expect(results[0].error).toContain("块库当前不可用");
        expect(results[1].error).toContain("块库当前不可用");
    });
});

describe("diffElementCounts 几何差分", () => {
    it("新增、修改、移除分开计数", () => {
        const { draft } = applyToolCalls(
            [
                call("move_elements", { ids: ["line-1"], dx: 10, dy: 0 }, "move"),
                call("draw_line", { x1: 0, y1: 0, x2: 5, y2: 5 }, "draw"),
                call("delete_elements", { ids: ["circle-1"] }, "delete"),
            ],
            createDraft(FIXTURE_ELEMENTS),
        );

        expect(diffElementCounts(FIXTURE_ELEMENTS, draft.elements)).toEqual({
            added: 1,
            modified: 1,
            removed: 1,
        });
    });

    it("只改动图元时摘要写修改而不是新增", () => {
        const { results } = applyToolCalls(
            [call("rotate_elements", { ids: ["line-1"], angle: 90, cx: 100, cy: 100 }, "rotate")],
            createDraft(FIXTURE_ELEMENTS, ["line-1"]),
        );

        expect(results[0].summary).toBe("修改 1 个图元，画布共 3 个");
    });

    it("没有变化时三项都是 0", () => {
        expect(diffElementCounts(FIXTURE_ELEMENTS, FIXTURE_ELEMENTS)).toEqual({
            added: 0,
            modified: 0,
            removed: 0,
        });
    });
});

describe("fallbackActionsFromText 文本 JSON 降级", () => {
    it("模型未走 toolCall 时从正文还原动作", () => {
        const actions = fallbackActionsFromText(
            '已为你画好。\n```json\n{"operation":"ADD","message":"画一个圆","elements":[{"type":"CIRCLE","cx":50,"cy":50,"radius":10}]}\n```',
        );
        expect(actions).toHaveLength(1);
        expect(actions[0].operation).toBe("ADD");
        expect(actions[0].elements).toHaveLength(1);
    });

    it("纯文本与非法 operation 不产生动作", () => {
        expect(fallbackActionsFromText("我先读一下画布状态")).toEqual([]);
        expect(fallbackActionsFromText('{"operation":"NONE"}')).toEqual([]);
        expect(fallbackActionsFromText('{"operation":"WORLD_DOMINATION"}')).toEqual([]);
        expect(fallbackActionsFromText("{not json")).toEqual([]);
    });
});
