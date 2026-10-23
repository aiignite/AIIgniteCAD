import { describe, expect, it } from "vitest";
import { AIActionResponse, AIToolCall } from "../types";
import {
    SUPPORTED_AI_TOOL_NAMES,
    extractJsonObject,
    normalizeAIElement,
    parseTextAIAction,
    toolCallToAction,
    toolCallToViewRequest,
    type ToolCallConversionOptions,
} from "../lib/aiTools";
import {
    FIXTURE_BLOCK_CATALOG,
    FIXTURE_ELEMENTS,
    FIXTURE_SELECTION,
    TOOL_FIXTURES,
    ToolFixture,
    ToolFixtureExpectation,
} from "./aiToolFixtures";

/** fixture 统一在固定画布 + 固定选择集上求值 */
const convert = (fixture: ToolFixture): AIActionResponse | null => {
    const result = toolCallToAction(fixture.call, {
        elements: FIXTURE_ELEMENTS,
        selectedIds: FIXTURE_SELECTION,
        blockCatalog: fixture.blockCatalog,
    });
    return result.error ? null : (result.action ?? null);
};

/** 只取动作：失败按 null 处理，沿用原有断言风格 */
const actionOf = (
    call: AIToolCall,
    options?: ToolCallConversionOptions,
): AIActionResponse | null => {
    const result = toolCallToAction(call, options);
    return result.error ? null : (result.action ?? null);
};

/** 只取失败原因：成功时为 null */
const errorOf = (call: AIToolCall, options?: ToolCallConversionOptions): string | null =>
    toolCallToAction(call, options).error ?? null;

const matchesExpectation = (
    action: AIActionResponse | null,
    expectation: ToolFixtureExpectation,
): boolean => {
    if (expectation.nullAction) return action === null;
    if (!action || action.operation !== expectation.operation) return false;

    if (expectation.elementTypes) {
        const types = action.elements?.map((element) => element.type) ?? [];
        if (JSON.stringify(types) !== JSON.stringify(expectation.elementTypes)) return false;
    }

    if (expectation.targetIds) {
        const ids = action.elements?.map((element) => element.id) ?? [];
        if (JSON.stringify(ids) !== JSON.stringify(expectation.targetIds)) return false;
    }

    if (expectation.params) {
        for (const [key, value] of Object.entries(expectation.params)) {
            if (JSON.stringify(action.params?.[key]) !== JSON.stringify(value)) return false;
        }
    }

    return true;
};

describe("AI tool call fixtures", () => {
    it("评测集包含 56 条确定性指令，覆盖全部 31 个工具", () => {
        expect(TOOL_FIXTURES).toHaveLength(56);
        expect(SUPPORTED_AI_TOOL_NAMES).toHaveLength(31);
        const covered = new Set(TOOL_FIXTURES.map((fixture) => fixture.call.name));
        expect(covered).toEqual(new Set(SUPPORTED_AI_TOOL_NAMES));
    });

    it("fixture 指令成功率 >= 90%", () => {
        const failures: string[] = [];

        for (const fixture of TOOL_FIXTURES) {
            const action = convert(fixture);
            if (!matchesExpectation(action, fixture.expectation)) {
                failures.push(fixture.id);
            }
        }

        const passed = TOOL_FIXTURES.length - failures.length;
        const successRate = passed / TOOL_FIXTURES.length;
        expect(successRate, `失败用例: ${failures.join(", ") || "none"}`).toBeGreaterThanOrEqual(
            0.9,
        );
    });

    it("逐条 fixture 均产生预期动作", () => {
        for (const fixture of TOOL_FIXTURES) {
            const action = convert(fixture);
            if (!fixture.expectation.nullAction) {
                expect(action, fixture.id).not.toBeNull();
            }
            expect(
                matchesExpectation(action, fixture.expectation),
                `${fixture.id}: ${JSON.stringify(action)}`,
            ).toBe(true);
        }
    });
});

describe("tool call conversion", () => {
    it("保留几何参数并应用默认图层与颜色", () => {
        const line = actionOf({
            id: "1",
            name: "draw_line",
            arguments: { x1: -50, y1: -20, x2: 40, y2: 10 },
        });
        expect(line?.elements?.[0]).toMatchObject({
            type: "LINE",
            start: { x: -50, y: -20 },
            end: { x: 40, y: 10 },
            layer: "AI_GENERATED",
            color: "#137fec",
        });

        const rect = actionOf({
            id: "2",
            name: "draw_rectangle",
            arguments: { x: 10, y: 20, width: 200, height: 120 },
        });
        expect(rect?.elements?.[0]).toMatchObject({ type: "RECTANGLE", width: 200, height: 120 });

        const circle = actionOf({
            id: "3",
            name: "draw_circle",
            arguments: { cx: 400, cy: 300, radius: 50 },
        });
        expect(circle?.elements?.[0]).toMatchObject({
            type: "CIRCLE",
            center: { x: 400, y: 300 },
            radius: 50,
        });

        const text = actionOf({
            id: "4",
            name: "draw_text",
            arguments: { x: 10, y: 20, text: "客厅" },
        });
        expect(text?.elements?.[0]).toMatchObject({ type: "TEXT", text: "客厅", fontSize: 12 });

        const polyline = actionOf({
            id: "5",
            name: "draw_polyline",
            arguments: {
                points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 10 },
                ],
                closed: true,
            },
        });
        expect(polyline?.elements?.[0]).toMatchObject({ type: "LWPOLYLINE", closed: true });
    });

    it("按 id 解析真实图元，未知 id 时拒绝调用", () => {
        const action = actionOf(
            { id: "1", name: "move_elements", arguments: { ids: ["circle-1"], dx: 10, dy: 5 } },
            { elements: FIXTURE_ELEMENTS },
        );
        expect(action?.elements).toEqual([FIXTURE_ELEMENTS[1]]);

        const missing = errorOf(
            { id: "2", name: "move_elements", arguments: { ids: ["missing"], dx: 10, dy: 5 } },
            { elements: FIXTURE_ELEMENTS },
        );
        expect(missing).toContain("move_elements.ids");
    });

    it("拒绝非法参数", () => {
        const invalidCalls: AIToolCall[] = [
            { id: "1", name: "draw_circle", arguments: { cx: 0, cy: 0, radius: 0 } },
            { id: "2", name: "draw_rectangle", arguments: { x: 0, y: 0, width: 0, height: 10 } },
            { id: "3", name: "draw_text", arguments: { x: 0, y: 0, text: "   " } },
            { id: "4", name: "move_elements", arguments: { dx: 0, dy: 0 } },
            { id: "5", name: "rotate_elements", arguments: { angle: Number.NaN } },
            {
                id: "6",
                name: "mirror_elements",
                arguments: { p1: { x: 1, y: 1 }, p2: { x: 1, y: 1 } },
            },
            { id: "7", name: "unknown_tool", arguments: {} },
            {
                id: "8",
                name: "draw_arc",
                arguments: { cx: 0, cy: 0, radius: 10, startAngle: 45, endAngle: 45 },
            },
            { id: "9", name: "draw_dimension", arguments: { x1: 5, y1: 5, x2: 5, y2: 5 } },
            { id: "10", name: "scale_elements", arguments: { ids: ["line-1"], factor: 0 } },
            { id: "11", name: "offset_elements", arguments: { ids: ["line-1"], distance: 0 } },
            {
                id: "12",
                name: "array_elements",
                arguments: {
                    ids: ["line-1"],
                    rows: 0,
                    columns: 3,
                    rowSpacing: 10,
                    columnSpacing: 10,
                },
            },
            {
                id: "13",
                name: "array_elements",
                arguments: {
                    ids: ["line-1"],
                    rows: 5,
                    columns: 60,
                    rowSpacing: 10,
                    columnSpacing: 10,
                },
            },
        ];

        for (const call of invalidCalls) {
            const error = errorOf(call, {
                elements: FIXTURE_ELEMENTS,
                selectedIds: FIXTURE_SELECTION,
            });
            // 每条失败原因都必须指向具体输入（工具名或 tool.字段），模型才能改
            expect(error, call.name).toContain(call.name);
        }
    });

    it("非法参数错误定位到具体字段", () => {
        const fieldErrors: Array<[AIToolCall, string]> = [
            [
                { id: "1", name: "draw_circle", arguments: { cx: 0, cy: 0, radius: 0 } },
                "draw_circle.radius",
            ],
            [
                {
                    id: "2",
                    name: "draw_rectangle",
                    arguments: { x: 0, y: 0, width: 0, height: 10 },
                },
                "draw_rectangle.width",
            ],
            [
                { id: "3", name: "draw_text", arguments: { x: 0, y: 0, text: "   " } },
                "draw_text.text",
            ],
            [{ id: "4", name: "move_elements", arguments: { dx: 0, dy: 0 } }, "move_elements.dx"],
            [
                {
                    id: "10",
                    name: "scale_elements",
                    arguments: { ids: ["line-1"], factor: 0 },
                },
                "scale_elements.factor",
            ],
            [
                { id: "11", name: "offset_elements", arguments: { ids: ["line-1"], distance: 0 } },
                "offset_elements.distance",
            ],
        ];

        for (const [call, field] of fieldErrors) {
            const error = errorOf(call, {
                elements: FIXTURE_ELEMENTS,
                selectedIds: FIXTURE_SELECTION,
            });
            expect(error, call.name).toContain(field);
        }
    });

    it("省略 ids 时只作用于选择集，空选择则拒绝而不是改全部图元", () => {
        const targets = actionOf(
            { id: "1", name: "move_elements", arguments: { dx: 30, dy: 0 } },
            { elements: FIXTURE_ELEMENTS, selectedIds: ["circle-1"] },
        );
        expect(targets?.elements?.map((element) => element.id)).toEqual(["circle-1"]);

        const noneSelected = errorOf(
            { id: "2", name: "move_elements", arguments: { dx: 30, dy: 0 } },
            { elements: FIXTURE_ELEMENTS, selectedIds: [] },
        );
        expect(noneSelected).toContain("move_elements");
        expect(noneSelected).toContain("ids");

        const legacyCall = actionOf(
            { id: "3", name: "rotate_elements", arguments: { angle: 90 } },
            { elements: FIXTURE_ELEMENTS },
        );
        expect(legacyCall).toBeNull();
    });

    it("显式 ids 优先于选择集，未知 id 整条拒绝", () => {
        const action = actionOf(
            { id: "1", name: "copy_elements", arguments: { ids: ["circle-1"], dx: 10, dy: 0 } },
            { elements: FIXTURE_ELEMENTS, selectedIds: FIXTURE_SELECTION },
        );
        expect(action?.elements?.map((element) => element.id)).toEqual(["circle-1"]);

        const partial = errorOf(
            {
                id: "2",
                name: "copy_elements",
                arguments: { ids: ["line-1", "ghost"], dx: 10, dy: 0 },
            },
            { elements: FIXTURE_ELEMENTS, selectedIds: FIXTURE_SELECTION },
        );
        expect(partial).toContain("copy_elements.ids");
    });

    it("标注沿测量线法向偏移，默认偏移生成 DIM 图层图元", () => {
        const action = actionOf({
            id: "1",
            name: "draw_dimension",
            arguments: { x1: 100, y1: 100, x2: 500, y2: 100 },
        });
        const dimension = action?.elements?.[0];
        expect(dimension).toMatchObject({ type: "DIMENSION", layer: "DIM" });
        expect(dimension?.offsetPoint).toEqual({ x: 300, y: 140 });

        const vertical = actionOf({
            id: "2",
            name: "draw_dimension",
            arguments: { x1: 0, y1: 0, x2: 0, y2: 240, textOffset: 60 },
        });
        expect(vertical?.elements?.[0].offsetPoint).toEqual({ x: -60, y: 120 });
    });
});

describe("工具失败原因定位到字段", () => {
    it("draw_line 缺 x1 时错误信息含 x1", () => {
        const error = errorOf({
            id: "1",
            name: "draw_line",
            arguments: { y1: 0, x2: 10, y2: 10 },
        });
        expect(error).toContain("draw_line.x1");
    });

    it("array_elements.rows 为 0 时错误信息含 rows", () => {
        const error = errorOf(
            {
                id: "1",
                name: "array_elements",
                arguments: {
                    ids: ["line-1"],
                    rows: 0,
                    columns: 3,
                    rowSpacing: 10,
                    columnSpacing: 10,
                },
            },
            { elements: FIXTURE_ELEMENTS },
        );
        expect(error).toContain("array_elements.rows");
    });

    it("行列数取整后仍超范围时指向对应字段", () => {
        const error = errorOf(
            {
                id: "1",
                name: "array_elements",
                arguments: {
                    ids: ["line-1"],
                    rows: 3.5,
                    columns: 60,
                    rowSpacing: 10,
                    columnSpacing: 10,
                },
            },
            { elements: FIXTURE_ELEMENTS },
        );
        expect(error).toContain("array_elements.columns");
    });

    it("半径类参数报告字段名而不是笼统的「参数不合法」", () => {
        const error = errorOf({
            id: "1",
            name: "draw_circle",
            arguments: { cx: 0, cy: 0, radius: -5 },
        });
        expect(error).toContain("draw_circle.radius");
    });

    it("块不存在时给出 blockId 与下一步动作", () => {
        const error = errorOf(
            { id: "1", name: "insert_block", arguments: { blockId: "nope", x: 0, y: 0 } },
            { blockCatalog: [] },
        );
        expect(error).toContain("insert_block.blockId");
        expect(error).toContain("list_blocks");
    });

    it("块库读取失败时说「不可用」，不能谎报空库", () => {
        const error = errorOf(
            { id: "1", name: "insert_block", arguments: { blockId: "door-1", x: 0, y: 0 } },
            { blockCatalog: [], blocksUnavailable: true },
        );
        expect(error).toContain("块库当前不可用");
        expect(error).toContain("不是空库");
        expect(error).not.toContain("不在块库中");
    });

    it("枚举参数把允许值回写给模型", () => {
        const error = errorOf(
            {
                id: "1",
                name: "align_elements",
                arguments: { ids: ["line-1", "circle-1"], mode: "middle" },
            },
            { elements: FIXTURE_ELEMENTS },
        );
        expect(error).toContain("align_elements.mode");
        expect(error).toContain("left");
    });

    it("合法参数不会带错误", () => {
        expect(
            errorOf(
                { id: "1", name: "move_elements", arguments: { ids: ["line-1"], dx: 5, dy: 0 } },
                { elements: FIXTURE_ELEMENTS },
            ),
        ).toBeNull();
    });
});

describe("text JSON fallback", () => {
    it("从 Markdown 代码块中提取并规范化图元", () => {
        const content = `Sure, here is the line.

\`\`\`json
{
  "message": "Line added",
  "operation": "add",
  "elements": [
    { "type": "line", "x1": 1, "y1": 2, "x2": 3, "y2": 4 }
  ]
}
\`\`\``;

        const action = parseTextAIAction(content);
        expect(action?.operation).toBe("ADD");
        expect(action?.elements?.[0]).toMatchObject({
            type: "LINE",
            start: { x: 1, y: 2 },
            end: { x: 3, y: 4 },
            layer: "AI_GENERATED",
            color: "#137fec",
        });
    });

    it("兼容嵌套 properties 与圆心半径", () => {
        const element = normalizeAIElement({
            type: "circle",
            properties: { cx: 10, cy: 20, radius: 5, color: "#ffffff" },
        });
        expect(element).toMatchObject({
            type: "CIRCLE",
            center: { x: 10, y: 20 },
            radius: 5,
            color: "#ffffff",
        });
    });

    it("忽略 NONE 与无效 JSON", () => {
        expect(parseTextAIAction('{"operation":"NONE"}')).toBeNull();
        expect(parseTextAIAction("no json here")).toBeNull();
        expect(parseTextAIAction('{"operation":"ADD","elements":')).toBeNull();
    });

    it("提取 JSON 时忽略字符串中的花括号与后续说明", () => {
        const text = 'Result: {"operation":"ADD","message":"use {curly} braces"} thanks';
        expect(extractJsonObject(text)).toBe('{"operation":"ADD","message":"use {curly} braces"}');
    });
});

describe("块与版本工具转换", () => {
    it("按名称插入块：支持精确名称与唯一子串", () => {
        const exact = actionOf(
            { id: "1", name: "insert_block_by_name", arguments: { name: "标准门洞", x: 0, y: 0 } },
            { elements: FIXTURE_ELEMENTS, selectedIds: [], blockCatalog: FIXTURE_BLOCK_CATALOG },
        );
        expect(exact?.operation).toBe("ADD");
        expect(exact?.elements?.map((el) => el.type)).toEqual(["RECTANGLE", "LINE"]);

        const partial = actionOf(
            { id: "2", name: "insert_block_by_name", arguments: { name: "门洞", x: 0, y: 0 } },
            { elements: FIXTURE_ELEMENTS, selectedIds: [], blockCatalog: FIXTURE_BLOCK_CATALOG },
        );
        expect(partial?.operation).toBe("ADD");
    });

    it("名称匹配到多个块时拒绝并列出候选", () => {
        const catalog = [
            ...FIXTURE_BLOCK_CATALOG,
            { ...FIXTURE_BLOCK_CATALOG[0], id: "block-double", name: "双开门" },
        ];
        const error = errorOf(
            { id: "1", name: "insert_block_by_name", arguments: { name: "门", x: 0, y: 0 } },
            { elements: FIXTURE_ELEMENTS, selectedIds: [], blockCatalog: catalog },
        );
        expect(error).toContain("匹配到多个块");
        expect(error).toContain("标准门洞");
        expect(error).toContain("双开门");
    });

    it("名称不存在时回传可用块名称", () => {
        const error = errorOf(
            { id: "1", name: "insert_block_by_name", arguments: { name: "法兰", x: 0, y: 0 } },
            { elements: FIXTURE_ELEMENTS, selectedIds: [], blockCatalog: FIXTURE_BLOCK_CATALOG },
        );
        expect(error).toContain("不在块库中");
        expect(error).toContain("标准门洞");
    });

    it("把选中图形保存为块，默认基点取选择集左下角", () => {
        const action = actionOf(
            { id: "1", name: "save_selection_as_block", arguments: { name: "样品" } },
            {
                elements: FIXTURE_ELEMENTS,
                selectedIds: FIXTURE_SELECTION,
                blockCatalog: FIXTURE_BLOCK_CATALOG,
            },
        );
        expect(action?.operation).toBe("SAVE_BLOCK");
        expect(action?.elements?.map((el) => el.id)).toEqual(FIXTURE_SELECTION);
        expect(action?.params).toMatchObject({
            blockName: "样品",
            basePoint: { x: 50, y: 38 },
        });
    });

    it("保存版本只产出附加操作，不改画布", () => {
        const action = actionOf(
            { id: "1", name: "save_version", arguments: { message: "增加标注" } },
            { elements: FIXTURE_ELEMENTS, selectedIds: FIXTURE_SELECTION },
        );
        expect(action?.operation).toBe("SAVE_VERSION");
        expect(action?.elements).toBeUndefined();
        expect(action?.params?.versionMessage).toBe("增加标注");
    });
});

describe("视图类工具转换", () => {
    it("按 ids 求出目标包围盒", () => {
        const request = toolCallToViewRequest(
            { id: "1", name: "zoom_to_selection", arguments: { ids: ["circle-1"] } },
            { elements: FIXTURE_ELEMENTS, selectedIds: [] },
        );

        expect(request?.bounds).toEqual({ minX: 350, minY: 250, maxX: 450, maxY: 350 });
        expect(request?.summary).toContain("1 个图元");
    });

    it("省略 ids 时回落到选择集", () => {
        const request = toolCallToViewRequest(
            { id: "2", name: "zoom_to_selection", arguments: {} },
            { elements: FIXTURE_ELEMENTS, selectedIds: FIXTURE_SELECTION },
        );

        expect(request?.bounds).toEqual({ minX: 50, minY: 38, maxX: 300, maxY: 100 });
    });

    it("没有目标或非视图工具时返回 null", () => {
        expect(
            toolCallToViewRequest(
                { id: "3", name: "zoom_to_selection", arguments: {} },
                { elements: FIXTURE_ELEMENTS, selectedIds: [] },
            ),
        ).toBeNull();
        expect(
            toolCallToViewRequest(
                { id: "4", name: "draw_line", arguments: { x1: 0, y1: 0, x2: 1, y2: 1 } },
                { elements: FIXTURE_ELEMENTS, selectedIds: FIXTURE_SELECTION },
            ),
        ).toBeNull();
    });
});
