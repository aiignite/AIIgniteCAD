import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  describeToolResult,
} from "../src/services/aiEngine/promptComposer";
import {
  CAD_TOOL_DEFINITIONS,
  READ_ONLY_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  formatToolReference,
} from "../src/services/aiEngine/tools";
import type { ActivatedSkill } from "../src/services/aiEngine/skills/skillRouter";

const skill = (overrides: Partial<ActivatedSkill>): ActivatedSkill => ({
  code: "skill_a",
  name: "技能A",
  score: 30,
  reasons: ["keywords"],
  promptTemplate: "技能A的规则",
  toolNames: ["draw_line"],
  category: "Drafting",
  ...overrides,
});

describe("composeSystemPrompt", () => {
  it("基础规则使用世界坐标而不是屏幕像素", () => {
    const prompt = composeSystemPrompt({ activatedSkills: [], allowedTools: [] });
    expect(prompt).toContain("画布世界坐标");
    expect(prompt).toContain("不是屏幕像素");
    expect(prompt).not.toContain("800x600");
  });

  it("助手 prompt 被真正注入", () => {
    const prompt = composeSystemPrompt({
      assistantPrompt: "你是产线布局专家",
      assistantName: "布局助手",
      activatedSkills: [],
      allowedTools: ["draw_line"],
    });
    expect(prompt).toContain("你是产线布局专家");
    expect(prompt).toContain("布局助手");
  });

  it("已激活技能按名称成块输出", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [skill({ code: "cad_layout_planning", name: "布局规划" })],
      allowedTools: ["draw_line"],
    });
    expect(prompt).toContain("# 已激活技能");
    expect(prompt).toContain("## 技能：布局规划");
    expect(prompt).toContain("技能A的规则");
  });

  it("技能的所需上下文、不适用场景与版本号都进入提示词", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [
        skill({
          code: "cad_layout_planning",
          name: "布局规划",
          version: 3,
          requiredContext: ["selection", "layers"],
          negativeKeywords: ["三维"],
        }),
      ],
      allowedTools: ["draw_line"],
    });
    expect(prompt).toContain("（v3）");
    expect(prompt).toContain("### 所需上下文");
    expect(prompt).toContain("- selection");
    expect(prompt).toContain("### 不适用场景");
    expect(prompt).toContain("三维");
  });

  it("工具清单与草稿语义一同出现", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: ["draw_line", "get_canvas_info"],
    });
    expect(prompt).toContain("# 本轮可用工具");
    expect(prompt).toContain("- draw_line");
    expect(prompt).toContain("预览对话框确认");
  });

  it("关闭工具时不再声明可用工具", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: ["draw_line"],
      toolsEnabled: false,
    });
    expect(prompt).not.toContain("# 本轮可用工具");
  });

  it("计划模式列出可引用的写工具，规则指向该清单", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: ["get_canvas_info", "propose_plan"],
      planMode: true,
      referenceableTools: WRITE_TOOL_NAMES,
    });
    expect(prompt).toContain("# 计划步骤可引用的写工具");
    expect(prompt).toContain("- draw_line(x1, y1, x2, y2)");
    expect(prompt).toContain("move_elements(dx, dy, [ids])");
    expect(prompt).toContain("省略 ids 表示作用于用户确认时的当前选择集");
    expect(prompt).toContain("tool 取自下文「计划步骤可引用的写工具」");
    expect(prompt).not.toContain("tool 只能使用本轮可用工具中的 CAD 工具");
  });

  it("计划模式下可引用清单只包含写工具，不含只读与视图工具", () => {
    const excluded = new Set<string>([...READ_ONLY_TOOL_NAMES, "zoom_to_selection"]);
    expect(WRITE_TOOL_NAMES).toHaveLength(CAD_TOOL_DEFINITIONS.length - excluded.size);
    expect(WRITE_TOOL_NAMES.some((name) => excluded.has(name))).toBe(false);

    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: [],
      planMode: true,
      referenceableTools: WRITE_TOOL_NAMES,
    });
    for (const name of READ_ONLY_TOOL_NAMES) {
      expect(prompt).not.toContain(`- ${name}(`);
    }
    expect(prompt).not.toContain("- zoom_to_selection(");
  });

  it("多方案模式同样下发可引用写工具清单", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: ["list_blocks", "propose_variants"],
      variantMode: true,
      referenceableTools: WRITE_TOOL_NAMES,
    });
    expect(prompt).toContain("# 计划步骤可引用的写工具");
    expect(prompt).toContain("- insert_block(blockId, x, y, [scale], [rotation])");
    expect(prompt).toContain("tool 取自下文「计划步骤可引用的写工具」");
  });

  it("助手白名单排除了全部写工具时，不再指向不存在的清单", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: ["get_canvas_info", "propose_plan"],
      planMode: true,
      referenceableTools: [],
    });
    expect(prompt).not.toContain("# 计划步骤可引用的写工具");
    expect(prompt).toContain("本轮没有可引用的写工具");
    expect(prompt).not.toContain("tool 取自下文「计划步骤可引用的写工具」");
  });

  it("速查表与工具定义同源，不会手写第二份清单", () => {
    const reference = formatToolReference(WRITE_TOOL_NAMES);
    for (const tool of CAD_TOOL_DEFINITIONS) {
      if (!WRITE_TOOL_NAMES.includes(tool.name)) continue;
      expect(reference).toContain(tool.description);
    }
    expect(reference.split("\n")).toHaveLength(WRITE_TOOL_NAMES.length);
  });

  it("项目设计约定与版本记忆作为独立段落注入", () => {
    const conventions =
      "# 项目设计约定\n本轮设计必须遵守以下项目约定。\n- 单位：mm；建议字高：3.5；尺寸精度：2 位";
    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: [],
      designConventions: conventions,
      versionMemory: "# 版本记忆\n- v3（2026-10-22）：+2 / -1；新增 DIMENSION×2",
    });
    expect(prompt).toContain("项目设计约定");
    expect(prompt).toContain("建议字高：3.5");
    expect(prompt).toContain("# 版本记忆");
    expect(prompt).toContain("+2 / -1");

    const empty = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: [],
      designConventions: "  ",
      versionMemory: "",
    });
    expect(empty).not.toContain("本轮设计必须遵守");
    expect(empty).not.toContain("# 版本记忆");
  });

  it("画布快照报告选择集与包围盒", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: [],
      canvasContext: {
        elementCount: 12,
        units: "mm",
        bounds: { minX: 0, minY: 0, maxX: 5000.1234, maxY: 4000 },
        selectedIds: ["line-1", "line-2"],
        selectionTypes: ["LINE", "LINE"],
      },
    });
    expect(prompt).toContain("图元总数：12");
    expect(prompt).toContain("单位：mm");
    expect(prompt).toContain("5000.12");
    expect(prompt).toContain("line-1, line-2");
    expect(prompt).toContain("选择类型：LINE");
  });

  it("无选择集时明确告知模型，避免其假设已选中", () => {
    const prompt = composeSystemPrompt({
      activatedSkills: [],
      allowedTools: [],
      canvasContext: { elementCount: 3 },
    });
    expect(prompt).toContain("当前没有选中图元");
  });

  it("续轮时提示循环轮次", () => {
    const prompt = composeSystemPrompt({ activatedSkills: [], allowedTools: [], round: 2 });
    expect(prompt).toContain("当前是第 3 轮");
  });

  it("超出预算时优先丢弃低权重段落而保留规则与工具说明", () => {
    const prompt = composeSystemPrompt({
      assistantPrompt: "助手设定".repeat(600),
      activatedSkills: [skill({ promptTemplate: "技能长文".repeat(600) })],
      allowedTools: ["draw_line"],
      historySummary: "历史摘要".repeat(600),
      canvasContext: { text: "画布上下文".repeat(600), elementCount: 5 },
      maxChars: 4000,
    });
    expect(prompt.length).toBeLessThanOrEqual(4000);
    expect(prompt).toContain("# 角色");
    expect(prompt).toContain("# 本轮可用工具");
    expect(prompt).not.toContain("历史摘要");
  });

  it("预算内的短 prompt 全部保留", () => {
    const prompt = composeSystemPrompt({
      assistantPrompt: "简洁人格",
      activatedSkills: [skill({})],
      allowedTools: ["draw_line"],
      historySummary: "此前绘制了房间轮廓",
      canvasContext: { elementCount: 2 },
    });
    expect(prompt).toContain("简洁人格");
    expect(prompt).toContain("此前绘制了房间轮廓");
    expect(prompt).toContain("图元总数：2");
  });
});

describe("describeToolResult", () => {
  it("成功结果包含摘要与变更 id，且 id 数量受限", () => {
    const text = describeToolResult({
      toolName: "array_elements",
      ok: true,
      summary: "生成 12 个副本",
      changedIds: Array.from({ length: 80 }, (_, index) => `id-${index}`),
    });
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ ok: true, tool: "array_elements", changedCount: 80 });
    expect(parsed.changedIds).toHaveLength(50);
  });

  it("失败结果只回传错误原因", () => {
    const parsed = JSON.parse(
      describeToolResult({ toolName: "move_elements", ok: false, error: "未选择图元" }),
    );
    expect(parsed).toEqual({ ok: false, tool: "move_elements", error: "未选择图元" });
  });
});
