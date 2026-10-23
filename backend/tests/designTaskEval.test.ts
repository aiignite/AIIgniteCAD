/**
 * designTaskEval.test.ts — 设计任务级离线评测
 *
 * 每个用例从真实用户指令出发，经技能路由 → 工具白名单 → 草稿执行，
 * 最后检查 Playbook 是否进入系统提示词。全部确定性、无网络与数据库。
 */

import { describe, expect, it } from "vitest";
import type { AIToolCall, CADElement } from "../../types";
import { applyToolCalls, createDraft } from "../../lib/aiAgentLoop";
import { READ_ONLY_TOOL_NAMES } from "../../lib/aiTools";
import { BUILTIN_SKILLS } from "../src/services/aiEngine/skills/builtinSkills";
import {
  activateSkills,
  resolveAllowedTools,
  type ActivatedSkill,
} from "../src/services/aiEngine/skills/skillRouter";
import type { SkillCandidate } from "../src/services/aiEngine/skills/skillService";
import { composeSystemPrompt } from "../src/services/aiEngine/promptComposer";
import { ALL_TOOL_NAMES } from "../src/services/aiEngine/toolValidator";

const ELEMENTS: CADElement[] = [
  {
    id: "l1",
    type: "LINE",
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    layer: "WALLS",
    color: "#fff",
  },
  {
    id: "c1",
    type: "CIRCLE",
    center: { x: 200, y: 0 },
    radius: 20,
    layer: "0",
    color: "#fff",
  },
  {
    id: "r1",
    type: "RECTANGLE",
    start: { x: 0, y: 50 },
    width: 100,
    height: 50,
    layer: "0",
    color: "#fff",
  },
  {
    id: "p1",
    type: "LWPOLYLINE",
    points: [
      { x: 0, y: 100 },
      { x: 50, y: 100 },
      { x: 50, y: 150 },
      { x: 0, y: 102 },
    ],
    layer: "0",
    color: "#fff",
  },
  {
    id: "t1",
    type: "TEXT",
    start: { x: 0, y: 200 },
    text: "A",
    fontSize: 12,
    layer: "0",
    color: "#fff",
  },
];

const SELECTION = ["l1"];
const REVISION = 3;

const seeds: SkillCandidate[] = BUILTIN_SKILLS.map((seed, index) => ({
  id: `builtin-${index}`,
  code: seed.code,
  name: seed.name,
  description: seed.description,
  category: seed.category,
  promptTemplate: seed.promptTemplate,
  toolNames: seed.toolNames,
  keywords: seed.keywords,
  selectionTypes: seed.selectionTypes,
  negativeKeywords: seed.negativeKeywords,
  requiredContext: seed.requiredContext,
  steps: seed.steps,
  checks: seed.checks,
  examples: seed.examples,
  version: 1,
  priority: seed.priority,
  isSystem: true,
}));

interface TaskExpected {
  ok?: boolean[];
  minActions?: number;
  minElements?: number;
  summaryContains?: string;
  /** 只读工具把最后一条 summary 解析成 JSON 后做断言 */
  payload?: (data: any) => void;
}

interface DesignTask {
  id: string;
  instruction: string;
  expectedSkill: string | null;
  requiredTools: string[];
  forbiddenTools?: string[];
  calls: AIToolCall[];
  expected: TaskExpected;
}

const call = (name: string, args: Record<string, unknown>, id = name): AIToolCall => ({
  id,
  name,
  arguments: args,
});

const TASKS: DesignTask[] = [
  {
    id: "draw-rect",
    instruction: "在原点画一个 100×60 的矩形",
    expectedSkill: "cad_drafting_basic",
    requiredTools: ["draw_rectangle", "get_canvas_info"],
    calls: [call("draw_rectangle", { x: 0, y: 0, width: 100, height: 60 })],
    expected: { minActions: 1, minElements: 6 },
  },
  {
    id: "draw-three-circles",
    instruction: "画三个同心圆，半径分别是 30、50、80",
    expectedSkill: "cad_drafting_basic",
    requiredTools: ["draw_circle"],
    calls: [
      call("draw_circle", { cx: 0, cy: 0, radius: 30 }, "c30"),
      call("draw_circle", { cx: 0, cy: 0, radius: 50 }, "c50"),
      call("draw_circle", { cx: 0, cy: 0, radius: 80 }, "c80"),
    ],
    expected: { minActions: 1, minElements: 8 },
  },
  {
    id: "move-selection",
    instruction: "把选中的线向右移动 50",
    expectedSkill: "cad_geometry_edit",
    requiredTools: ["move_elements", "query_elements"],
    calls: [call("move_elements", { dx: 50, dy: 0 })],
    expected: { minActions: 1, summaryContains: "修改 1 个图元" },
  },
  {
    id: "array-circle",
    instruction: "把选中的圆向右阵列 4 个，间距 100",
    expectedSkill: "cad_array_offset",
    requiredTools: ["array_elements", "measure_geometry"],
    calls: [
      call("array_elements", {
        ids: ["c1"],
        rows: 1,
        columns: 4,
        rowSpacing: 100,
        columnSpacing: 100,
      }),
    ],
    expected: { minActions: 1, minElements: 8 },
  },
  {
    id: "offset-line",
    instruction: "把这根线向右偏移 20",
    expectedSkill: "cad_array_offset",
    requiredTools: ["offset_elements"],
    calls: [call("offset_elements", { ids: ["l1"], distance: 20 })],
    expected: { minActions: 1, minElements: 6 },
  },
  {
    id: "scale-selection",
    instruction: "把选中的图元缩放到原来的一半",
    expectedSkill: "cad_array_offset",
    requiredTools: ["scale_elements"],
    calls: [call("scale_elements", { factor: 0.5 })],
    expected: { minActions: 1, minElements: 5 },
  },
  {
    id: "draw-arc",
    instruction: "画一个半径 80、从 0° 到 180° 的圆弧",
    expectedSkill: "cad_curve_arc",
    requiredTools: ["draw_arc"],
    calls: [
      call("draw_arc", { cx: 0, cy: 0, radius: 80, startAngle: 0, endAngle: 180 }),
    ],
    expected: { minActions: 1, minElements: 6 },
  },
  {
    id: "draw-sine",
    instruction: "用多段线画一段正弦曲线，从 0 到 360，振幅 50",
    expectedSkill: "cad_drafting_basic",
    requiredTools: ["draw_polyline"],
    calls: [
      call("draw_polyline", {
        points: [
          { x: 0, y: 0 },
          { x: 90, y: 50 },
          { x: 180, y: 0 },
          { x: 270, y: -50 },
          { x: 360, y: 0 },
        ],
      }),
    ],
    expected: { minActions: 1, minElements: 6 },
  },
  {
    id: "dimension-line",
    instruction: "给这条线加尺寸标注",
    expectedSkill: "cad_dimensioning",
    requiredTools: ["draw_dimension", "measure_geometry"],
    calls: [call("draw_dimension", { x1: 0, y1: 0, x2: 100, y2: 0 })],
    expected: { minActions: 1, minElements: 6 },
  },
  {
    id: "dimension-rect",
    instruction: "标出矩形的宽和高",
    expectedSkill: "cad_dimensioning",
    requiredTools: ["draw_dimension"],
    calls: [
      call("draw_dimension", { x1: 0, y1: 50, x2: 100, y2: 50 }, "width"),
      call("draw_dimension", { x1: 0, y1: 50, x2: 0, y2: 100 }, "height"),
    ],
    expected: { minActions: 1, minElements: 7 },
  },
  {
    id: "layout-room",
    instruction: "规划一个 8×6 米的两室户型并标注",
    expectedSkill: "cad_layout_planning",
    requiredTools: ["draw_rectangle", "draw_dimension", "check_drawing"],
    calls: [call("draw_rectangle", { x: 0, y: 0, width: 8000, height: 6000 })],
    expected: { minActions: 1, minElements: 6 },
  },
  {
    id: "layout-workshop",
    instruction: "把车间分成 4 个工位，留 1.2 米走道",
    expectedSkill: "cad_layout_planning",
    requiredTools: ["array_elements", "copy_elements", "check_drawing"],
    calls: [
      call("draw_rectangle", { x: 0, y: 0, width: 4000, height: 3000 }),
    ],
    expected: { minActions: 1, minElements: 6 },
  },
  {
    id: "review-general",
    instruction: "检查这张图纸有没有问题",
    expectedSkill: "cad_plot_review",
    requiredTools: ["check_drawing", "query_elements", "measure_geometry"],
    forbiddenTools: ["draw_line", "move_elements", "clear_canvas"],
    calls: [call("check_drawing", {})],
    expected: {
      minActions: 0,
      minElements: 5,
      payload: (data) => {
        expect(data.count).toBeGreaterThan(0);
        expect(Array.isArray(data.issues)).toBe(true);
      },
    },
  },
  {
    id: "review-open-contour",
    instruction: "检查有没有未闭合的轮廓",
    expectedSkill: "cad_plot_review",
    requiredTools: ["query_elements"],
    calls: [call("query_elements", { types: ["LWPOLYLINE"] })],
    expected: {
      minActions: 0,
      payload: (data) => {
        expect(data.count).toBe(1);
        expect(data.elements[0].id).toBe("p1");
      },
    },
  },
  {
    id: "review-dimensions",
    instruction: "检查图里缺哪些标注",
    expectedSkill: "cad_plot_review",
    requiredTools: ["check_drawing"],
    calls: [call("check_drawing", {})],
    expected: {
      minActions: 0,
      payload: (data) => {
        expect(data.issues.some((issue: any) => issue.code === "missing-dimension")).toBe(true);
      },
    },
  },
  {
    id: "query-radius",
    instruction: "这个圆的半径是多少？",
    expectedSkill: null,
    requiredTools: ["query_elements", "measure_geometry"],
    calls: [call("query_elements", { types: ["CIRCLE"] })],
    expected: {
      minActions: 0,
      payload: (data) => {
        expect(data.count).toBe(1);
        expect(data.elements[0].description).toContain("r=20");
      },
    },
  },
  {
    id: "measure-length",
    instruction: "这条线有多长？",
    expectedSkill: null,
    requiredTools: ["measure_geometry"],
    calls: [call("measure_geometry", { kind: "length", ids: ["l1"] })],
    expected: {
      minActions: 0,
      payload: (data) => {
        expect(data.kind).toBe("length");
        expect(data.value).toBe(100);
      },
    },
  },
  {
    id: "query-layer",
    instruction: "找出 0 图层上的所有圆",
    expectedSkill: null,
    requiredTools: ["query_elements"],
    calls: [call("query_elements", { types: ["CIRCLE"], layers: ["0"] })],
    expected: {
      minActions: 0,
      payload: (data) => {
        expect(data.count).toBe(1);
      },
    },
  },
  {
    id: "move-line-down",
    instruction: "移动所有线向下 100",
    expectedSkill: "cad_geometry_edit",
    requiredTools: ["move_elements"],
    calls: [call("move_elements", { ids: ["l1"], dx: 0, dy: 100 })],
    expected: { minActions: 1, summaryContains: "修改 1 个图元" },
  },
  {
    id: "rotate-selection",
    instruction: "把选中的矩形旋转 45 度",
    expectedSkill: "cad_geometry_edit",
    requiredTools: ["rotate_elements"],
    calls: [call("rotate_elements", { ids: ["r1"], angle: 45 })],
    expected: { minActions: 1, minElements: 5 },
  },
];

const selectionTypes = ELEMENTS.filter((element) => SELECTION.includes(element.id)).map(
  (element) => element.type,
);

const contextSignals = (() => {
  const signals: Array<"selection" | "layers" | "blocks" | "revision" | "dimensions"> = [];
  if (SELECTION.length > 0) signals.push("selection");
  if (ELEMENTS.some((element) => (element.layer || "0") !== "0")) signals.push("layers");
  if (REVISION > 1) signals.push("revision");
  if (ELEMENTS.some((element) => element.type === "DIMENSION")) signals.push("dimensions");
  return signals;
})();

const route = (instruction: string): ActivatedSkill[] =>
  activateSkills({
    skills: seeds,
    message: instruction,
    selectionTypes,
    contextSignals,
  });

describe("设计任务级评测", () => {
  it("包含 20 条覆盖绘制、编辑、阵列、标注、布局、审查与问答的任务", () => {
    expect(TASKS).toHaveLength(20);
    expect(new Set(TASKS.map((task) => task.id)).size).toBe(20);
  });

  for (const task of TASKS) {
    it(`${task.id} · ${task.instruction}`, () => {
      const activated = route(task.instruction);
      const top = activated[0]?.code ?? null;
      expect(top, `实际激活: ${activated.map((skill) => skill.code).join(", ")}`).toBe(
        task.expectedSkill,
      );

      const allowed = resolveAllowedTools(activated, null, ALL_TOOL_NAMES);
      for (const tool of task.requiredTools) {
        expect(allowed, `${task.id} 缺少 ${tool}`).toContain(tool);
      }
      for (const tool of task.forbiddenTools ?? []) {
        expect(allowed, `${task.id} 不应开放 ${tool}`).not.toContain(tool);
      }
      if (task.expectedSkill === "cad_plot_review") {
        for (const tool of allowed) {
          expect(READ_ONLY_TOOL_NAMES as readonly string[]).toContain(tool);
        }
      }

      if (activated.length > 0) {
        const prompt = composeSystemPrompt({
          activatedSkills: activated,
          allowedTools: allowed,
          canvasContext: {
            elementCount: ELEMENTS.length,
            selectedIds: SELECTION,
            selectionTypes,
            units: "mm",
          },
          toolsEnabled: true,
        });
        expect(prompt).toContain("### 执行步骤");
        expect(prompt).toContain("### 完成检查");
        expect(prompt).toContain("### 示例请求");
      }

      const outcome = applyToolCalls(task.calls, createDraft(ELEMENTS, SELECTION));
      const expectedOk = task.expected.ok ?? task.calls.map(() => true);
      outcome.results.forEach((result, index) => {
        expect(result.ok, `${task.id}/${result.name}: ${result.error ?? ""}`).toBe(
          expectedOk[index],
        );
      });
      if (task.expected.minActions !== undefined) {
        expect(outcome.draft.actions.length).toBeGreaterThanOrEqual(task.expected.minActions);
      }
      if (task.expected.minElements !== undefined) {
        expect(outcome.draft.elements.length).toBeGreaterThanOrEqual(
          task.expected.minElements,
        );
      }
      const last = outcome.results[outcome.results.length - 1];
      if (task.expected.summaryContains) {
        expect(last.summary).toContain(task.expected.summaryContains);
      }
      if (task.expected.payload) {
        expect(last.ok, `${task.id}: ${last.error ?? ""}`).toBe(true);
        task.expected.payload(JSON.parse(last.summary ?? "{}"));
      }
    });
  }
});
