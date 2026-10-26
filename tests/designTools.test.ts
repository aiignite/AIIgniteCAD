import { describe, expect, it } from "vitest";
import type { AIToolCall, CADElement } from "../types";
import { applyToolCalls, createDraft } from "../lib/aiAgentLoop";
import {
    buildReviewFixPrompt,
    reviewDrawing,
    reviewIssueKey,
    summarizeReview,
} from "../lib/designReview";
import { queryElements } from "../lib/elementQuery";
import { measureGeometry } from "../lib/measurement";
import { executeReadOnlyTool } from "../lib/readOnlyTools";

const element = (overrides: Partial<CADElement> & Pick<CADElement, "id" | "type">): CADElement => ({
    layer: "0",
    color: "#fff",
    ...overrides,
});

const line = (id: string, x1: number, y1: number, x2: number, y2: number, layer = "0") =>
    element({ id, type: "LINE", start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, layer });

const rect = (id: string, x: number, y: number, width: number, height: number, layer = "0") =>
    element({ id, type: "RECTANGLE", start: { x, y }, width, height, layer });

const circle = (id: string, cx: number, cy: number, radius: number, layer = "0") =>
    element({ id, type: "CIRCLE", center: { x: cx, y: cy }, radius, layer });

const polyline = (id: string, points: { x: number; y: number }[], closed = false) =>
    element({ id, type: "LWPOLYLINE", points, closed });

const text = (id: string, x: number, y: number, content: string, fontSize = 12) =>
    element({ id, type: "TEXT", start: { x, y }, text: content, fontSize });

describe("queryElements", () => {
    const elements = [
        line("l1", 0, 0, 10, 0, "walls"),
        line("l2", 100, 100, 140, 100, "0"),
        circle("c1", 20, 20, 5, "walls"),
        element({ id: "t1", type: "TEXT", start: { x: 0, y: 0 }, text: "客厅", fontSize: 12 }),
    ];

    it("按类型与图层过滤，忽略大小写", () => {
        const result = queryElements(elements, { types: ["line"], layers: ["WALLS"] });
        expect(result.count).toBe(1);
        expect(result.elements[0].id).toBe("l1");
    });

    it("按文本与包围盒过滤", () => {
        expect(queryElements(elements, { text: "客" }).elements[0].id).toBe("t1");
        const inBox = queryElements(elements, {
            bounds: { minX: 90, minY: 90, maxX: 200, maxY: 200 },
        });
        expect(inBox.elements.map((item) => item.id)).toEqual(["l2"]);
    });

    it("限制返回数量但保留命中总数", () => {
        const result = queryElements(elements, { limit: 1 });
        expect(result.count).toBe(4);
        expect(result.returned).toBe(1);
        expect(result.elements).toHaveLength(1);
    });
});

describe("measureGeometry", () => {
    it("按两点与两个图元测量距离", () => {
        const byPoints = measureGeometry([], [], {
            kind: "distance",
            p1: { x: 0, y: 0 },
            p2: { x: 3, y: 4 },
        });
        expect(byPoints).toMatchObject({ ok: true, value: 5 });

        const byIds = measureGeometry([line("l1", 0, 0, 10, 0), line("l2", 20, 0, 30, 0)], [], {
            kind: "distance",
            ids: ["l1", "l2"],
        });
        expect(byIds).toMatchObject({ ok: true, value: 20 });
    });

    it("测量总长度、精确面积与包围盒", () => {
        const elements = [
            line("l1", 0, 0, 100, 0),
            circle("c1", 0, 0, 10),
            rect("r1", 0, 0, 20, 10),
        ];
        expect(measureGeometry(elements, ["l1"], { kind: "length" })).toMatchObject({
            ok: true,
            value: 100,
        });
        expect(measureGeometry(elements, ["r1"], { kind: "area" })).toMatchObject({
            ok: true,
            area: 200,
        });
        expect(measureGeometry([], [], { kind: "bbox", ids: ["r1"] }).ok).toBe(false);
        const bounds = measureGeometry(elements, [], { kind: "bbox" });
        expect(bounds).toMatchObject({
            ok: true,
            bounds: { minX: -10, minY: -10, maxX: 100, maxY: 10 },
        });
    });

    it("闭合多段线用鞋带公式算面积，未闭合时按包围盒估算并标注", () => {
        const closed = measureGeometry(
            [
                polyline(
                    "p1",
                    [
                        { x: 0, y: 0 },
                        { x: 10, y: 0 },
                        { x: 0, y: 10 },
                    ],
                    true,
                ),
            ],
            ["p1"],
            { kind: "area" },
        );
        expect(closed).toMatchObject({ ok: true, area: 50 });

        const open = measureGeometry(
            [
                polyline("p2", [
                    { x: 0, y: 0 },
                    { x: 10, y: 10 },
                ]),
            ],
            ["p2"],
            { kind: "area" },
        );
        expect(open.detail).toContain("估算");
    });

    it("非法类型或目标数量返回错误", () => {
        const badKind = measureGeometry([], [], { kind: "volume" as never });
        expect(badKind.ok).toBe(false);
        expect(badKind.error).toContain("不支持");

        const badDistance = measureGeometry([line("l1", 0, 0, 1, 1)], [], {
            kind: "distance",
            ids: ["l1"],
        });
        expect(badDistance.ok).toBe(false);

        const missing = measureGeometry([line("l1", 0, 0, 1, 1)], [], {
            kind: "length",
            ids: ["ghost"],
        });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("ghost");
    });
});

describe("reviewDrawing", () => {
    it("发现零长度、退化矩形、重复与近似闭合问题", () => {
        const issues = reviewDrawing([
            line("zero", 5, 5, 5, 5),
            circle("bad-circle", 0, 0, 0),
            rect("bad-rect", 0, 0, 0, 10),
            line("dup-a", 0, 0, 10, 10),
            line("dup-b", 10, 10, 0, 0),
            polyline("almost", [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 2 },
            ]),
        ]);
        const codes = issues.map((issue) => issue.code);
        expect(codes).toContain("zero-length");
        expect(codes).toContain("invalid-circle");
        expect(codes).toContain("degenerate-rectangle");
        expect(codes).toContain("duplicate");
        expect(codes).toContain("near-closed-contour");
        expect(issues[0].severity).toBe("error");
    });

    it("无标注的成图给出提示，摘要包含严重级别计数", () => {
        const issues = reviewDrawing([
            line("l1", 0, 0, 10, 0),
            line("l2", 0, 10, 10, 10),
            line("l3", 0, 20, 10, 20),
        ]);
        const missing = issues.find((issue) => issue.code === "missing-dimension");
        expect(missing?.severity).toBe("info");
        expect(summarizeReview(issues)).toContain("error 0");
    });

    it("干净图纸没有问题", () => {
        expect(reviewDrawing([circle("c1", 0, 0, 10)])).toEqual([]);
        expect(summarizeReview([])).toContain("未发现");
    });

    it("文字重叠按交叠比例报告，完全重合交给重复规则", () => {
        const overlap = reviewDrawing([text("t1", 0, 0, "WIDE"), text("t2", 5, 0, "WIDE")]);
        expect(overlap.map((issue) => issue.code)).toContain("text-overlap");

        const apart = reviewDrawing([text("t1", 0, 0, "WIDE"), text("t2", 200, 0, "WIDE")]);
        expect(apart.map((issue) => issue.code)).not.toContain("text-overlap");

        const same = reviewDrawing([text("t1", 0, 0, "重复文字"), text("t2", 0, 0, "重复文字")]);
        expect(same.map((issue) => issue.code)).toContain("duplicate");
        expect(same.map((issue) => issue.code)).not.toContain("text-overlap");
    });

    it("成图全部留在图层 0 时提示整理图层", () => {
        const flat = Array.from({ length: 8 }, (_, index) =>
            line(`l${index}`, 0, index * 10, 100, index * 10),
        );
        const hint = reviewDrawing(flat).find((issue) => issue.code === "unorganized-layers");
        expect(hint?.severity).toBe("info");

        const organized = flat.map((item, index) =>
            index === 0 ? { ...item, layer: "WALLS" } : item,
        );
        expect(reviewDrawing(organized).map((issue) => issue.code)).not.toContain(
            "unorganized-layers",
        );
    });

    it("约定图层之外的图元给出图层未登记警告", () => {
        const issues = reviewDrawing(
            [line("l1", 0, 0, 10, 0, "WALLS"), line("l2", 0, 10, 10, 10, "随便放的")],
            { conventions: { layerRules: [{ name: "WALLS", purpose: "墙体" }] } },
        );
        const violation = issues.find((issue) => issue.code === "layer-rule-violation");
        expect(violation?.severity).toBe("warning");
        expect(violation?.elementIds).toEqual(["l2"]);
        expect(violation?.message).toContain("WALLS（墙体）");
    });

    it("AI 图层不参与图层约定检查", () => {
        const issues = reviewDrawing([line("l1", 0, 0, 10, 0, "AI_GENERATED")], {
            conventions: { layerRules: [{ name: "WALLS" }] },
        });
        expect(issues.map((issue) => issue.code)).not.toContain("layer-rule-violation");
    });

    it("约定图层在图中没有图元时提示遗漏", () => {
        const issues = reviewDrawing([line("l1", 0, 0, 10, 0, "WALLS")], {
            conventions: { layerRules: [{ name: "WALLS" }, { name: "DIM", purpose: "标注" }] },
        });
        const empty = issues.find((issue) => issue.code === "empty-convention-layer");
        expect(empty?.severity).toBe("info");
        expect(empty?.message).toContain("「DIM」（标注）");
    });

    it("文字字高不一致时提示统一", () => {
        const issues = reviewDrawing([text("t1", 0, 0, "A", 12), text("t2", 100, 0, "B", 3.5)], {
            conventions: { textHeight: 3.5 },
        });
        const inconsistent = issues.find((issue) => issue.code === "text-height-inconsistent");
        expect(inconsistent?.severity).toBe("info");
        expect(inconsistent?.message).toContain("3.5");
        expect(inconsistent?.elementIds).toEqual(["t2"]);
    });

    it("没有约定时不产生任何约定类问题", () => {
        const issues = reviewDrawing([line("l1", 0, 0, 10, 0, "别的图层")]);
        const codes = issues.map((issue) => issue.code);
        expect(codes).not.toContain("layer-rule-violation");
        expect(codes).not.toContain("empty-convention-layer");
    });

    it("修复请求只携带问题摘要与图元 id", () => {
        const prompt = buildReviewFixPrompt([
            {
                code: "zero-length",
                severity: "error",
                message: "直线 l1 长度为 0。",
                elementIds: ["l1"],
            },
            {
                code: "missing-dimension",
                severity: "info",
                message: "图中没有尺寸标注。",
                elementIds: [],
            },
        ]);
        expect(prompt).toContain("[错误] 直线 l1 长度为 0");
        expect(prompt).toContain("图元：l1");
        expect(prompt).toContain("[提示]");
        expect(prompt).not.toContain('"type"');
        expect(buildReviewFixPrompt([])).toBe("");
    });

    it("问题键对图元顺序不敏感", () => {
        const issue = {
            code: "duplicate" as const,
            severity: "warning" as const,
            message: "重复",
            elementIds: ["b", "a"],
        };
        expect(reviewIssueKey(issue)).toBe(reviewIssueKey({ ...issue, elementIds: ["a", "b"] }));
    });
});

describe("executeReadOnlyTool", () => {
    const draft = createDraft(
        [line("l1", 0, 0, 100, 0), circle("c1", 200, 0, 20), rect("r1", 0, 50, 100, 50)],
        ["l1"],
    );

    const call = (name: string, args: Record<string, unknown> = {}): AIToolCall => ({
        id: `call-${name}`,
        name,
        arguments: args,
    });

    it("get_canvas_info 直接回传画布摘要", () => {
        const outcome = executeReadOnlyTool(call("get_canvas_info"), draft, "摘要");
        expect(outcome).toEqual({ ok: true, summary: "摘要" });
    });

    it("query_elements 返回合法 JSON 且不改动草稿", () => {
        const outcome = executeReadOnlyTool(
            call("query_elements", { types: ["LINE"], limit: 5 }),
            draft,
            "",
        );
        expect(outcome.ok).toBe(true);
        const payload = JSON.parse(outcome.summary ?? "");
        expect(payload.count).toBe(1);
        expect(payload.elements[0].id).toBe("l1");
        expect(draft.elements).toHaveLength(3);
    });

    it("measure_geometry 默认使用草稿选择集", () => {
        const outcome = executeReadOnlyTool(
            call("measure_geometry", { kind: "length" }),
            draft,
            "",
        );
        expect(outcome.ok).toBe(true);
        expect(JSON.parse(outcome.summary ?? "")).toMatchObject({ kind: "length", value: 100 });
    });

    it("check_drawing 输出摘要与问题清单", () => {
        const broken = createDraft([line("zero", 1, 1, 1, 1)]);
        const outcome = executeReadOnlyTool(call("check_drawing"), broken, "");
        const payload = JSON.parse(outcome.summary ?? "");
        expect(payload.count).toBeGreaterThan(0);
        expect(payload.issues[0].code).toBe("zero-length");
    });

    it("check_drawing 的 project 范围做跨图纸一致性检查", () => {
        const draft = createDraft([line("a", 0, 0, 10, 0)], [], [], undefined, [
            { id: "p1", name: "平面图", elementCount: 10, conventions: { units: "mm" } },
            { id: "p2", name: "立面图", elementCount: 8, conventions: { units: "m" } },
        ]);
        const outcome = executeReadOnlyTool(call("check_drawing", { scope: "project" }), draft, "");
        expect(outcome.ok).toBe(true);
        const payload = JSON.parse(outcome.summary ?? "");
        expect(payload.scope).toBe("project");
        expect(payload.drawings).toBe(2);
        expect(payload.issues.map((issue: { code: string }) => issue.code)).toContain(
            "units-mismatch",
        );
    });

    it("没有项目清单时 project 范围明确报不可用", () => {
        const outcome = executeReadOnlyTool(
            call("check_drawing", { scope: "project" }),
            createDraft([]),
            "",
        );
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toContain("不可用");
    });

    it("结果超出字符预算时裁剪数组且仍是合法 JSON", () => {
        const many = Array.from({ length: 20 }, (_, index) =>
            line(`very-long-element-id-${index}-${"x".repeat(40)}`, index, 0, index, 100),
        );
        const outcome = executeReadOnlyTool(
            call("query_elements", { limit: 20 }),
            createDraft(many),
            "",
        );
        const payload = JSON.parse(outcome.summary ?? "");
        expect(payload.truncated).toBe(true);
        expect(payload.returned).toBe(payload.elements.length);
    });

    it("块库不可用时 list_blocks 回报失败而不是 0 个块", () => {
        const outcome = executeReadOnlyTool(
            call("list_blocks"),
            createDraft([], [], { entries: [], ok: false }),
            "",
        );
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toContain("块库当前不可用");
        expect(outcome.error).toContain("不是空库");
    });

    it("块库可用但为空时仍返回 total 0", () => {
        const outcome = executeReadOnlyTool(call("list_blocks"), createDraft([], []), "");
        expect(outcome.ok).toBe(true);
        expect(JSON.parse(outcome.summary ?? "").total).toBe(0);
    });

    it("未知只读工具返回错误", () => {
        expect(executeReadOnlyTool(call("mystery"), draft, "").ok).toBe(false);
    });
});

describe("Agent 循环中的只读工具", () => {
    const call = (name: string, args: Record<string, unknown> = {}): AIToolCall => ({
        id: `call-${name}`,
        name,
        arguments: args,
    });

    it("查询结果回传模型且不产生动作或撤销步骤", () => {
        const { draft, results } = applyToolCalls(
            [call("query_elements", { types: ["LINE"] })],
            createDraft([line("l1", 0, 0, 10, 0)]),
        );
        expect(results[0].ok).toBe(true);
        expect(results[0].summary).toContain("l1");
        expect(draft.actions).toHaveLength(0);
        expect(draft.elements).toHaveLength(1);
    });

    it("测量失败作为 toolResult 回传，允许模型自纠错", () => {
        const { results } = applyToolCalls(
            [call("measure_geometry", { kind: "distance" })],
            createDraft([line("l1", 0, 0, 10, 0)]),
        );
        expect(results[0].ok).toBe(false);
        expect(results[0].error).toContain("恰好两个图元");
    });
});
