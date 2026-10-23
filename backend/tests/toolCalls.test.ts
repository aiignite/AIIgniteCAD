import { describe, expect, it } from "vitest";
import {
  CAD_TOOL_DEFINITIONS,
  ToolCallDraftMap,
  applyToolCallDelta,
  finalizeToolCalls,
  parseToolArguments,
  toAnthropicTools,
  toGoogleTools,
  toOllamaTools,
  toOpenAITools,
} from "../src/services/aiEngine/tools";

describe("CAD tool definitions", () => {
  it("定义 31 个唯一工具，覆盖绘制、编辑、阵列、设计操作、视图、只读检查与块库", () => {
    const names = CAD_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toHaveLength(31);
    expect(new Set(names).size).toBe(31);
    expect(names).toEqual([
      "draw_line",
      "draw_polyline",
      "draw_rectangle",
      "draw_circle",
      "draw_text",
      "clear_canvas",
      "delete_last",
      "move_elements",
      "rotate_elements",
      "copy_elements",
      "mirror_elements",
      "draw_arc",
      "draw_dimension",
      "scale_elements",
      "offset_elements",
      "array_elements",
      "align_elements",
      "distribute_elements",
      "dimension_chain",
      "assign_layer",
      "delete_elements",
      "get_canvas_info",
      "zoom_to_selection",
      "query_elements",
      "measure_geometry",
      "check_drawing",
      "list_blocks",
      "insert_block",
      "insert_block_by_name",
      "save_selection_as_block",
      "save_version",
    ]);
  });

  it("每个参数 schema 都是 object 且必填字段存在", () => {
    for (const tool of CAD_TOOL_DEFINITIONS) {
      expect(tool.parameters.type).toBe("object");
      for (const required of tool.parameters.required ?? []) {
        expect(tool.parameters.properties?.[required], `${tool.name}.${required}`).toBeDefined();
      }
    }
  });

  it("生成 OpenAI / Ollama 兼容的 function tools", () => {
    for (const tools of [toOpenAITools(), toOllamaTools()]) {
      expect(tools).toHaveLength(31);
      expect(tools[0]).toMatchObject({
        type: "function",
        function: { name: "draw_line", parameters: { type: "object" } },
      });
    }
  });

  it("生成 Anthropic input_schema 与 Gemini 大写类型 schema", () => {
    const anthropic = toAnthropicTools();
    expect(anthropic[0]).toMatchObject({
      name: "draw_line",
      input_schema: { type: "object" },
    });

    const google = toGoogleTools();
    expect(google).toHaveLength(1);
    expect(google[0].functionDeclarations).toHaveLength(31);
    expect(google[0].functionDeclarations[0].parameters).toMatchObject({
      type: "OBJECT",
      properties: {
        x1: { type: "NUMBER" },
        y1: { type: "NUMBER" },
      },
    });
  });
});

describe("tool argument parsing", () => {
  it("接受对象、JSON 字符串与空参数", () => {
    expect(parseToolArguments({ x: 1 })).toEqual({ x: 1 });
    expect(parseToolArguments('{"x":1}')).toEqual({ x: 1 });
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
  });

  it("拒绝非法 JSON、数组与标量", () => {
    expect(parseToolArguments("{oops")).toBeNull();
    expect(parseToolArguments("[1,2]")).toBeNull();
    expect(parseToolArguments(42)).toBeNull();
  });
});

describe("streaming tool call assembly", () => {
  it("拼接 OpenAI 分片的参数并按 index 排序", () => {
    const drafts: ToolCallDraftMap = new Map();
    applyToolCallDelta(drafts, {
      index: 0,
      id: "call_a",
      name: "draw_line",
      arguments: '{"x1":10,"y1":',
    });
    applyToolCallDelta(drafts, {
      index: 0,
      arguments: '20,"x2":30,"y2":40}',
    });
    applyToolCallDelta(drafts, {
      index: 1,
      id: "call_b",
      name: "draw_circle",
      arguments: '{"cx":1,"cy":2,"radius":3}',
    });

    expect(finalizeToolCalls(drafts)).toEqual([
      {
        id: "call_a",
        name: "draw_line",
        arguments: { x1: 10, y1: 20, x2: 30, y2: 40 },
      },
      {
        id: "call_b",
        name: "draw_circle",
        arguments: { cx: 1, cy: 2, radius: 3 },
      },
    ]);
  });

  it("拼接 Anthropic input_json_delta", () => {
    const drafts: ToolCallDraftMap = new Map();
    applyToolCallDelta(drafts, {
      index: 0,
      id: "toolu_1",
      name: "move_elements",
    });
    applyToolCallDelta(drafts, {
      index: 0,
      arguments: '{"ids":["line-1"],',
    });
    applyToolCallDelta(drafts, {
      index: 0,
      arguments: '"dx":10,"dy":-5}',
    });

    expect(finalizeToolCalls(drafts)).toEqual([
      {
        id: "toolu_1",
        name: "move_elements",
        arguments: { ids: ["line-1"], dx: 10, dy: -5 },
      },
    ]);
  });

  it("丢弃没有名称或参数无法解析的调用", () => {
    const drafts: ToolCallDraftMap = new Map();
    applyToolCallDelta(drafts, { index: 0, id: "missing_name", arguments: "{}" });
    applyToolCallDelta(drafts, {
      index: 1,
      id: "bad_json",
      name: "draw_line",
      arguments: '{"x1":',
    });

    expect(finalizeToolCalls(drafts)).toEqual([]);
  });
});
