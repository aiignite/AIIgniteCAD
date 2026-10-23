import { describe, expect, it } from "vitest";
import {
  MAX_POINTS,
  MAX_TEXT_CHARS,
  MAX_TOOL_CALLS_PER_TURN,
  validateToolCall,
  validateToolCalls,
} from "../src/services/aiEngine/toolValidator";

const ok = (raw: Record<string, unknown>, options?: Parameters<typeof validateToolCall>[1]) => {
  const result = validateToolCall(raw, options);
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  return result.call;
};

describe("validateToolCall 基本校验", () => {
  it("接受合法 draw_line 并保留声明字段", () => {
    expect(
      ok({ id: "c1", name: "draw_line", arguments: { x1: 0, y1: 0, x2: 100, y2: 50 } }),
    ).toEqual({ id: "c1", name: "draw_line", arguments: { x1: 0, y1: 0, x2: 100, y2: 50 } });
  });

  it("未知工具与未授权工具分别拒绝", () => {
    const unknown = validateToolCall({ name: "draw_spiral", arguments: {} });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("UNKNOWN_TOOL");

    const notAllowed = validateToolCall(
      { name: "clear_canvas", arguments: {} },
      { allowedNames: ["draw_line"] },
    );
    expect(notAllowed.ok).toBe(false);
    if (!notAllowed.ok) expect(notAllowed.reason).toBe("TOOL_NOT_ALLOWED");
  });

  it("缺少必填参数拒绝", () => {
    const result = validateToolCall({ name: "draw_circle", arguments: { cx: 1, cy: 2 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MISSING_ARGUMENT");
  });

  it("结构非法（arguments 非对象）拒绝", () => {
    expect(validateToolCall({ name: "draw_line", arguments: "[1,2]" }).ok).toBe(false);
    expect(validateToolCall("draw_line").ok).toBe(false);
  });

  it("剥离 schema 之外的字段", () => {
    const call = ok({
      name: "draw_rectangle",
      arguments: { x: 0, y: 0, width: 10, height: 20, color: "#fff", layer: "X" },
    });
    expect(call.arguments).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });
});

describe("validateToolCall 数值边界", () => {
  it("拒绝 NaN / Infinity / 超范围坐标", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1e8, -1e8]) {
      const result = validateToolCall({
        name: "draw_line",
        arguments: { x1: bad, y1: 0, x2: 1, y2: 1 },
      });
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok) expect(result.reason).toBe("BAD_NUMBER");
    }
  });

  it("半径必须为正、宽高不可为 0", () => {
    expect(
      validateToolCall({ name: "draw_circle", arguments: { cx: 0, cy: 0, radius: 0 } }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "draw_rectangle",
        arguments: { x: 0, y: 0, width: 0, height: 10 },
      }).ok,
    ).toBe(false);
  });

  it("缩放因子限制在 0.01–100", () => {
    const base = { ids: ["a"], center: undefined };
    expect(validateToolCall({ name: "scale_elements", arguments: { ...base, factor: 0 } }).ok).toBe(
      false,
    );
    expect(
      validateToolCall({ name: "scale_elements", arguments: { ...base, factor: 1000 } }).ok,
    ).toBe(false);
    expect(
      ok({ name: "scale_elements", arguments: { ids: ["a"], factor: 2 } }).arguments,
    ).toEqual({ ids: ["a"], factor: 2 });
  });

  it("阵列行列取整且限制 1–50", () => {
    expect(
      ok({
        name: "array_elements",
        arguments: { ids: ["a"], rows: 3.7, columns: 2, rowSpacing: 10, columnSpacing: 20 },
      }).arguments.rows,
    ).toBe(3);
    expect(
      validateToolCall({
        name: "array_elements",
        arguments: { ids: ["a"], rows: 999, columns: 2, rowSpacing: 10, columnSpacing: 20 },
      }).ok,
    ).toBe(false);
  });

  it("角度允许超过 360 但拒绝极端值", () => {
    expect(
      ok({ name: "draw_arc", arguments: { cx: 0, cy: 0, radius: 5, startAngle: 720, endAngle: 0 } })
        .arguments.startAngle,
    ).toBe(720);
    expect(
      validateToolCall({
        name: "draw_arc",
        arguments: { cx: 0, cy: 0, radius: 5, startAngle: 1e6, endAngle: 0 },
      }).ok,
    ).toBe(false);
  });
});

describe("validateToolCall 集合类参数", () => {
  it(`polyline 点数限制在 2–${MAX_POINTS}`, () => {
    expect(
      validateToolCall({ name: "draw_polyline", arguments: { points: [{ x: 1, y: 1 }] } }).ok,
    ).toBe(false);

    const many = Array.from({ length: MAX_POINTS + 1 }, (_, index) => ({ x: index, y: index }));
    expect(validateToolCall({ name: "draw_polyline", arguments: { points: many } }).ok).toBe(false);

    const call = ok({
      name: "draw_polyline",
      arguments: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: "true" },
    });
    expect(call.arguments.closed).toBe(true);
    expect(call.arguments.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it("接受数组形式的点并规范化为对象", () => {
    const call = ok(
      { name: "rotate_elements", arguments: { angle: 90, center: [10, 20] } },
      { selectedIds: ["arc-1"] },
    );
    expect(call.arguments.center).toEqual({ x: 10, y: 20 });
    expect(call.arguments.ids).toEqual(["arc-1"]);
  });

  it("文本长度受限且被 trim", () => {
    const call = ok({
      name: "draw_text",
      arguments: { x: 0, y: 0, text: "  标注  " },
    });
    expect(call.arguments.text).toBe("标注");

    expect(
      validateToolCall({
        name: "draw_text",
        arguments: { x: 0, y: 0, text: "a".repeat(MAX_TEXT_CHARS + 1) },
      }).ok,
    ).toBe(false);
    expect(
      validateToolCall({ name: "draw_text", arguments: { x: 0, y: 0, text: "   " } }).ok,
    ).toBe(false);
  });

  it("字号限制 1–200", () => {
    expect(
      validateToolCall({ name: "draw_text", arguments: { x: 0, y: 0, text: "a", fontSize: 0 } }).ok,
    ).toBe(false);
    expect(
      validateToolCall({ name: "draw_text", arguments: { x: 0, y: 0, text: "a", fontSize: 500 } })
        .ok,
    ).toBe(false);
  });
});

describe("validateToolCall 作用域", () => {
  it("省略 ids 时使用传入的选择集", () => {
    const call = ok(
      { name: "move_elements", arguments: { dx: 10, dy: 0 } },
      { selectedIds: ["line-1", "line-2"] },
    );
    expect(call.arguments.ids).toEqual(["line-1", "line-2"]);
  });

  it("省略 ids 且无选择集时拒绝，不再隐式作用于全部图元", () => {
    const result = validateToolCall(
      { name: "move_elements", arguments: { dx: 10, dy: 0 } },
      { selectedIds: [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_TARGET");
  });

  it("get_canvas_info 与 clear_canvas 不需要作用对象", () => {
    expect(ok({ name: "get_canvas_info", arguments: {} }).name).toBe("get_canvas_info");
    expect(ok({ name: "clear_canvas", arguments: {} }).name).toBe("clear_canvas");
  });

  it("zoom_to_selection 需要作用对象，省略时用选择集补齐", () => {
    const withSelection = ok(
      { name: "zoom_to_selection", arguments: {} },
      { selectedIds: ["line-1"] },
    );
    expect(withSelection.arguments.ids).toEqual(["line-1"]);

    const result = validateToolCall(
      { name: "zoom_to_selection", arguments: {} },
      { selectedIds: [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_TARGET");
  });

  it("ids 去空白并拒绝非字符串项", () => {
    expect(ok({ name: "copy_elements", arguments: { dx: 1, dy: 1, ids: [" a "] } }).arguments.ids).toEqual(
      ["a"],
    );
    expect(
      validateToolCall({ name: "copy_elements", arguments: { dx: 1, dy: 1, ids: [1, 2] } }).ok,
    ).toBe(false);
  });
});

describe("validateToolCall 只读设计工具", () => {
  it("query_elements 规范化过滤条件与数量上限", () => {
    const call = ok({
      name: "query_elements",
      arguments: {
        types: [" line ", "CIRCLE"],
        layers: ["0"],
        bounds: { minX: 200, minY: 100, maxX: 0, maxY: 0 },
        text: "",
        limit: 8.9,
        color: "#fff",
      },
    });
    expect(call.arguments).toEqual({
      types: ["line", "CIRCLE"],
      layers: ["0"],
      bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      limit: 8,
    });

    expect(validateToolCall({ name: "query_elements", arguments: { limit: 100 } }).ok).toBe(false);
    expect(
      validateToolCall({ name: "query_elements", arguments: { types: ["LINE", 3] } }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "query_elements",
        arguments: { bounds: { minX: 0, minY: 0, maxX: 10 } },
      }).ok,
    ).toBe(false);
  });

  it("measure_geometry 仅接受四种测量类型", () => {
    expect(ok({ name: "measure_geometry", arguments: { kind: "length" } }).arguments).toEqual({
      kind: "length",
    });
    expect(
      validateToolCall({ name: "measure_geometry", arguments: { kind: "volume" } }).ok,
    ).toBe(false);
    expect(validateToolCall({ name: "measure_geometry", arguments: {} }).ok).toBe(false);

    const distance = ok({
      name: "measure_geometry",
      arguments: { kind: "distance", p1: [0, 0], p2: { x: 3, y: 4 } },
    });
    expect(distance.arguments).toEqual({
      kind: "distance",
      p1: { x: 0, y: 0 },
      p2: { x: 3, y: 4 },
    });
  });

  it("check_drawing 无参数且不需要选择集", () => {
    expect(ok({ name: "check_drawing", arguments: {} })).toEqual({
      id: "call_check_drawing",
      name: "check_drawing",
      arguments: {},
    });
    expect(ok({ name: "check_drawing", arguments: {} }, { selectedIds: [] }).name).toBe(
      "check_drawing",
    );
  });

  it("insert_block 校验 blockId、坐标与缩放旋转", () => {
    const call = ok({
      name: "insert_block",
      arguments: {
        blockId: " block-door ",
        x: 500,
        y: 400,
        scale: 2,
        rotation: 90,
        extra: "strip-me",
      },
    });
    expect(call.arguments).toEqual({
      blockId: "block-door",
      x: 500,
      y: 400,
      scale: 2,
      rotation: 90,
    });

    expect(validateToolCall({ name: "insert_block", arguments: { x: 1, y: 2 } }).ok).toBe(false);
    expect(
      validateToolCall({ name: "insert_block", arguments: { blockId: "  ", x: 1, y: 2 } }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "insert_block",
        arguments: { blockId: "block", x: 1, y: 2, scale: 0 },
      }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "insert_block",
        arguments: { blockId: "block", x: 1e9, y: 2 },
      }).ok,
    ).toBe(false);
  });

  it("list_blocks 只读且限制返回数量", () => {
    expect(ok({ name: "list_blocks", arguments: {} }, { selectedIds: [] })).toEqual({
      id: "call_list_blocks",
      name: "list_blocks",
      arguments: {},
    });
    expect(
      ok({ name: "list_blocks", arguments: { keyword: " 门 ", limit: 5.9 } }).arguments,
    ).toEqual({ keyword: "门", limit: 5 });
    expect(validateToolCall({ name: "list_blocks", arguments: { limit: 100 } }).ok).toBe(false);
    expect(validateToolCall({ name: "list_blocks", arguments: { keyword: 3 } }).ok).toBe(false);
  });

  it("insert_block_by_name 校验名称、坐标与缩放旋转", () => {
    const call = ok({
      name: "insert_block_by_name",
      arguments: { name: " 标准门洞 ", x: 500, y: 400, scale: 2, rotation: 90 },
    });
    expect(call.arguments).toEqual({
      name: "标准门洞",
      x: 500,
      y: 400,
      scale: 2,
      rotation: 90,
    });

    expect(
      validateToolCall({ name: "insert_block_by_name", arguments: { x: 1, y: 2 } }).ok,
    ).toBe(false);
    expect(
      validateToolCall({ name: "insert_block_by_name", arguments: { name: "  ", x: 1, y: 2 } })
        .ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "insert_block_by_name",
        arguments: { name: "门", x: 1, y: 2, scale: 0 },
      }).ok,
    ).toBe(false);
  });

  it("save_selection_as_block 需要选择集并校验名称与基点", () => {
    const call = ok(
      {
        name: "save_selection_as_block",
        arguments: { name: " 样品块 ", description: " 常用件 ", basePoint: { x: 1, y: 2 } },
      },
      { selectedIds: ["line-1"] },
    );
    expect(call.arguments).toEqual({
      name: "样品块",
      description: "常用件",
      basePoint: { x: 1, y: 2 },
      ids: ["line-1"],
    });

    expect(
      validateToolCall({ name: "save_selection_as_block", arguments: { name: "样品" } }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "save_selection_as_block",
        arguments: { name: "样品", basePoint: { x: "a", y: 2 } },
      }, { selectedIds: ["line-1"] }).ok,
    ).toBe(false);
    expect(
      validateToolCall({ name: "save_selection_as_block", arguments: { name: "x".repeat(81) } }, {
        selectedIds: ["line-1"],
      }).ok,
    ).toBe(false);
  });

  it("save_version 只接受长度受限的版本说明", () => {
    expect(ok({ name: "save_version", arguments: { message: " 增加标注 " } })).toEqual({
      id: "call_save_version",
      name: "save_version",
      arguments: { message: "增加标注" },
    });
    expect(ok({ name: "save_version", arguments: {} }).arguments).toEqual({});
    expect(
      validateToolCall({ name: "save_version", arguments: { message: "x".repeat(201) } }).ok,
    ).toBe(false);
  });
});

describe("validateToolCall 设计操作工具", () => {
  it("对齐模式与分布轴只接受白名单值，并补齐选择集", () => {
    const aligned = ok(
      { name: "align_elements", arguments: { mode: "left" } },
      { selectedIds: ["a", "b"] },
    );
    expect(aligned.arguments).toEqual({ mode: "left", ids: ["a", "b"] });
    expect(
      validateToolCall({ name: "align_elements", arguments: { mode: "diagonal" } }).ok,
    ).toBe(false);

    const distributed = ok(
      { name: "distribute_elements", arguments: { ids: ["a", "b", "c"], axis: "horizontal" } },
    );
    expect(distributed.arguments.axis).toBe("horizontal");
    expect(
      validateToolCall({ name: "distribute_elements", arguments: { axis: "depth" } }).ok,
    ).toBe(false);
  });

  it("assign_layer 图层名 trim 且限制长度", () => {
    const call = ok(
      { name: "assign_layer", arguments: { layer: "  WALLS  " } },
      { selectedIds: ["a"] },
    );
    expect(call.arguments).toEqual({ layer: "WALLS", ids: ["a"] });
    expect(validateToolCall({ name: "assign_layer", arguments: { layer: "   " } }).ok).toBe(false);
    expect(
      validateToolCall({ name: "assign_layer", arguments: { layer: "x".repeat(65) } }).ok,
    ).toBe(false);
  });

  it("dimension_chain 接受有序点列与偏移", () => {
    const call = ok({
      name: "dimension_chain",
      arguments: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 250, y: 0 }],
        textOffset: 30,
      },
    });
    expect(call.arguments.points).toHaveLength(3);
    expect(call.arguments.textOffset).toBe(30);
    expect(
      validateToolCall({
        name: "dimension_chain",
        arguments: { points: [{ x: 0, y: 0 }] },
      }).ok,
    ).toBe(false);
  });

  it("delete_elements 作用于选择集，没有目标时拒绝", () => {
    const call = ok(
      { name: "delete_elements", arguments: {} },
      { selectedIds: ["a", "b"] },
    );
    expect(call.arguments.ids).toEqual(["a", "b"]);

    const none = validateToolCall({ name: "delete_elements", arguments: {} }, { selectedIds: [] });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe("NO_TARGET");
  });
});

describe("validateToolCall 计划工具", () => {
  it("接受带写工具步骤的计划并保留参数", () => {
    const call = ok({
      name: "propose_plan",
      arguments: {
        goal: "规划工位布局",
        assumptions: ["单位为毫米"],
        steps: [
          {
            title: "绘制外框",
            tool: "draw_rectangle",
            arguments: { x: 0, y: 0, width: 100, height: 50 },
          },
          {
            title: "插入门洞",
            tool: "insert_block",
            arguments: { blockId: "block-door", x: 20, y: 20 },
          },
          { title: "检查结果", tool: "check_drawing" },
        ],
        checks: ["外框闭合"],
        risks: [],
      },
    });

    expect(call.name).toBe("propose_plan");
    const steps = call.arguments.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(3);
    expect(steps[1]).toMatchObject({ title: "插入门洞", tool: "insert_block" });
    expect(steps[0]).toMatchObject({ title: "绘制外框", tool: "draw_rectangle" });
    expect(steps[2].arguments).toBeUndefined();
    expect(call.arguments.risks).toBeUndefined();
  });

  it("拒绝缺少 goal、空步骤与未知步骤工具", () => {
    const base = { goal: "目标", steps: [{ title: "一步" }] };
    expect(validateToolCall({ name: "propose_plan", arguments: { ...base, goal: " " } }).ok).toBe(
      false,
    );
    expect(validateToolCall({ name: "propose_plan", arguments: { goal: "目标" } }).ok).toBe(false);
    expect(
      validateToolCall({
        name: "propose_plan",
        arguments: { goal: "目标", steps: [{ title: "绘制", tool: "propose_plan" }] },
      }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "propose_plan",
        arguments: { goal: "目标", steps: [{ title: "绘制", tool: "draw_spiral" }] },
      }).ok,
    ).toBe(false);
  });

  it("计划里的编辑步骤不要求 ids，作用对象在确认时按选择集解析", () => {
    const call = ok({
      name: "propose_plan",
      arguments: {
        goal: "调整布局",
        steps: [
          { title: "绘制外框", tool: "draw_rectangle", arguments: { x: 0, y: 0, width: 100, height: 50 } },
          { title: "移动选中图元", tool: "move_elements", arguments: { dx: 100, dy: 0 } },
        ],
      },
    });
    const steps = call.arguments.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ tool: "move_elements", arguments: { dx: 100, dy: 0 } });
    expect((steps[1].arguments as Record<string, unknown>).ids).toBeUndefined();
  });

  it("直接调用编辑工具仍然必须给出作用对象", () => {
    const result = validateToolCall({ name: "move_elements", arguments: { dx: 10, dy: 0 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_TARGET");
  });

  it("步骤数量与参数体积受限，白名单外拒绝调用", () => {
    const steps = Array.from({ length: 13 }, (_, index) => ({ title: `步骤 ${index}` }));
    expect(
      validateToolCall({ name: "propose_plan", arguments: { goal: "目标", steps } }).ok,
    ).toBe(false);

    expect(
      validateToolCall({
        name: "propose_plan",
        arguments: {
          goal: "目标",
          steps: [
            {
              title: "超长参数",
              tool: "draw_polyline",
              arguments: { points: "x".repeat(6000) },
            },
          ],
        },
      }).ok,
    ).toBe(false);

    expect(
      validateToolCall(
        { name: "propose_plan", arguments: { goal: "目标", steps: [{ title: "一步" }] } },
        { allowedNames: ["get_canvas_info"] },
      ).ok,
    ).toBe(false);
  });
});

describe("validateToolCall 多方案工具", () => {
  const variant = (name: string, overrides: Record<string, unknown> = {}) => ({
    name,
    summary: `${name} 的取舍`,
    steps: [
      {
        title: "绘制轮廓",
        tool: "draw_rectangle",
        arguments: { x: 0, y: 0, width: 100, height: 60 },
      },
    ],
    ...overrides,
  });

  it("接受 2–3 个名称唯一的方案并保留步骤参数", () => {
    const call = ok({
      name: "propose_variants",
      arguments: {
        goal: "两种布局",
        variants: [variant("紧凑"), variant("宽松")],
      },
    });
    const variants = call.arguments.variants as Array<Record<string, unknown>>;
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ name: "紧凑", summary: "紧凑 的取舍" });
    expect((variants[0].steps as Array<Record<string, unknown>>)[0]).toMatchObject({
      tool: "draw_rectangle",
    });
  });

  it("方案里的编辑步骤同样不要求 ids", () => {
    const call = ok({
      name: "propose_variants",
      arguments: {
        goal: "两种布局",
        variants: [
          variant("紧凑", {
            steps: [{ title: "移动选中图元", tool: "move_elements", arguments: { dx: 20, dy: 0 } }],
          }),
          variant("宽松"),
        ],
      },
    });
    const variants = call.arguments.variants as Array<Record<string, unknown>>;
    const steps = variants[0].steps as Array<Record<string, unknown>>;
    expect(steps[0]).toMatchObject({ tool: "move_elements" });
  });

  it("拒绝数量越界、重名与非法步骤工具", () => {
    expect(
      validateToolCall({
        name: "propose_variants",
        arguments: { goal: "目标", variants: [variant("唯一")] },
      }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "propose_variants",
        arguments: {
          goal: "目标",
          variants: [variant("A"), variant("A")],
        },
      }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "propose_variants",
        arguments: {
          goal: "目标",
          variants: [variant("A"), variant("B", { steps: [{ title: "x", tool: "draw_spiral" }] })],
        },
      }).ok,
    ).toBe(false);
    expect(
      validateToolCall({
        name: "propose_variants",
        arguments: {
          goal: "目标",
          variants: [variant("A"), variant("B"), variant("C"), variant("D")],
        },
      }).ok,
    ).toBe(false);
  });
});

describe("validateToolCalls 批量", () => {
  it(`单轮最多 ${MAX_TOOL_CALLS_PER_TURN} 次，超出部分记为 rejected`, () => {
    const calls = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 2 }, (_, index) => ({
      id: `c${index}`,
      name: "draw_line",
      arguments: { x1: 0, y1: 0, x2: 1, y2: 1 },
    }));
    const result = validateToolCalls(calls);
    expect(result.accepted).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0].reason).toBe("TOO_MANY_CALLS");
  });

  it("混合接受与拒绝，rejected 保留 id 供回传模型", () => {
    const result = validateToolCalls([
      { id: "good", name: "draw_line", arguments: { x1: 0, y1: 0, x2: 1, y2: 1 } },
      { id: "bad", name: "draw_line", arguments: { x1: 0 } },
      { id: "unknown", name: "nope", arguments: {} },
    ]);
    expect(result.accepted.map((call) => call.id)).toEqual(["good"]);
    expect(result.rejected.map((item) => [item.id, item.reason])).toEqual([
      ["bad", "MISSING_ARGUMENT"],
      ["unknown", "UNKNOWN_TOOL"],
    ]);
  });
});
