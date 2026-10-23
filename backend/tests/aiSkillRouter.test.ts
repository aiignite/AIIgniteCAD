import { describe, expect, it } from "vitest";
import {
  ACTIVATION_THRESHOLD,
  MAX_ACTIVE_SKILLS,
  MAX_SKILL_PROMPT_CHARS,
  activateSkills,
  resolveAllowedTools,
  scoreSkill,
} from "../src/services/aiEngine/skills/skillRouter";
import { BUILTIN_SKILLS } from "../src/services/aiEngine/skills/builtinSkills";
import type { SkillCandidate } from "../src/services/aiEngine/skills/skillService";
import { ALL_TOOL_NAMES } from "../src/services/aiEngine/toolValidator";

const candidate = (overrides: Partial<SkillCandidate>): SkillCandidate => ({
  id: "skill-1",
  code: "test_skill",
  name: "测试技能",
  description: "",
  category: "General",
  promptTemplate: "提示词",
  toolNames: null,
  keywords: [],
  selectionTypes: [],
  negativeKeywords: [],
  requiredContext: [],
  steps: [],
  checks: [],
  examples: [],
  version: 1,
  priority: 0,
  isSystem: true,
  ...overrides,
});

describe("activateSkills 打分", () => {
  const drafting = candidate({
    id: "s-draft",
    code: "cad_drafting_basic",
    name: "基础绘图",
    keywords: ["画", "圆"],
    toolNames: ["draw_line", "draw_circle", "get_canvas_info"],
  });
  const review = candidate({
    id: "s-review",
    code: "cad_plot_review",
    name: "图纸审查",
    keywords: ["检查"],
    priority: 60,
    toolNames: ["get_canvas_info"],
  });
  const skills = [drafting, review];

  it("关键词命中超过阈值才激活", () => {
    const activated = activateSkills({ skills, message: "画一个圆" });
    expect(activated.map((skill) => skill.code)).toEqual(["cad_drafting_basic"]);
    expect(activated[0].score).toBeGreaterThanOrEqual(ACTIVATION_THRESHOLD);
    expect(activated[0].reasons.join()).toContain("keywords");
  });

  it("无信号时不激活任何技能", () => {
    expect(activateSkills({ skills, message: "今天天气如何" })).toEqual([]);
  });

  it("固定技能优先于打分，且能压过阈值", () => {
    const activated = activateSkills({
      skills,
      message: "随便聊聊",
      pinnedSkillCodes: ["cad_plot_review"],
    });
    expect(activated[0].code).toBe("cad_plot_review");
    expect(activated[0].reasons).toContain("pinned");
  });

  it("助手绑定按权重加分", () => {
    const low = scoreSkill(drafting, { skills, message: "", bindings: [{ skillId: "s-draft", weight: 0 }] });
    const high = scoreSkill(drafting, { skills, message: "", bindings: [{ skillId: "s-draft", weight: 100 }] });
    expect(high.score - low.score).toBeCloseTo(10, 5);
  });

  it("选择集类型与会话连续性各自计分", () => {
    const arc = candidate({ id: "s-arc", code: "cad_curve_arc", keywords: ["弧"], selectionTypes: ["ARC"] });
    const bySelection = scoreSkill(arc, {
      skills: [arc],
      message: "画一段弧",
      selectionTypes: ["ARC"],
    });
    expect(bySelection.score).toBeGreaterThanOrEqual(12);
    expect(bySelection.reasons).toContain("selection_types");

    const byContinuity = scoreSkill(arc, { skills: [arc], message: "", recentSkillCodes: ["cad_curve_arc"] });
    expect(byContinuity.reasons).toContain("continuity");
  });

  it("只有选择类型、没有语言意图时不激活编辑技能", () => {
    const edit = candidate({
      code: "cad_geometry_edit",
      keywords: ["移动"],
      selectionTypes: ["LINE"],
      priority: 20,
    });
    const scored = scoreSkill(edit, {
      skills: [edit],
      message: "这个圆的半径是多少？",
      selectionTypes: ["LINE"],
      contextSignals: ["selection"],
    });
    expect(scored.score).toBeLessThan(ACTIVATION_THRESHOLD);
    expect(scored.reasons).not.toContain("selection_types");
    expect(scored.reasons).not.toContain("context:selection");

    const withIntent = scoreSkill(edit, {
      skills: [edit],
      message: "把选中的线移动 50",
      selectionTypes: ["LINE"],
      contextSignals: ["selection"],
    });
    expect(withIntent.score).toBeGreaterThanOrEqual(ACTIVATION_THRESHOLD);
    expect(withIntent.reasons).toContain("selection_types");
  });

  it("最多激活 3 个技能并按分数排序", () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      candidate({ id: `s${index}`, code: `skill_${index}`, keywords: ["画"] }),
    );
    const activated = activateSkills({ skills: many, message: "画" });
    expect(activated.length).toBeLessThanOrEqual(MAX_ACTIVE_SKILLS);
    const scores = activated.map((skill) => skill.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("负关键词扣分，设计上下文信号加分", () => {
    const review = candidate({
      keywords: ["检查"],
      negativeKeywords: ["直接修复"],
      requiredContext: ["dimensions", "selection"],
      steps: [{ title: "运行检查", tool: "check_drawing" }],
      checks: ["只读"],
      examples: ["检查标注"],
      version: 3,
    });

    const blocked = scoreSkill(review, { skills: [review], message: "检查并直接修复" });
    expect(blocked.reasons).toContain("negative:直接修复");
    expect(blocked.score).toBeLessThan(scoreSkill(review, { skills: [review], message: "检查" }).score);

    const contextual = scoreSkill(review, {
      skills: [review],
      message: "检查这张图",
      contextSignals: ["dimensions", "selection", "layers"],
    });
    expect(contextual.reasons).toContain("context:dimensions/selection");

    const [activated] = activateSkills({
      skills: [review],
      message: "检查这张图",
      contextSignals: ["dimensions", "selection"],
    });
    expect(activated.steps).toEqual([{ title: "运行检查", tool: "check_drawing" }]);
    expect(activated.version).toBe(3);
  });
});

describe("activateSkills 与内置种子", () => {
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

  it("每个内置技能的工具名都存在", () => {
    for (const seed of BUILTIN_SKILLS) {
      for (const name of seed.toolNames) {
        expect(ALL_TOOL_NAMES, `${seed.code}:${name}`).toContain(name);
      }
    }
  });

  it("布局类请求激活布局技能", () => {
    const activated = activateSkills({ skills: seeds, message: "帮我规划一个车间平面布局，工位间距 1500" });
    expect(activated.map((skill) => skill.code)).toContain("cad_layout_planning");
  });

  it("审查类请求只激活只读审查技能", () => {
    const activated = activateSkills({ skills: seeds, message: "检查这张图纸有没有问题" });
    expect(activated[0].code).toBe("cad_plot_review");
    expect(activated[0].toolNames).toEqual([
      "get_canvas_info",
      "query_elements",
      "measure_geometry",
      "check_drawing",
    ]);
  });

  it("审查请求包含编辑动作时保留写工具", () => {
    const activated = activateSkills({
      skills: seeds,
      message: "检查后把这条线移动 50",
      selectionTypes: ["LINE"],
      contextSignals: ["selection", "revision"],
    });
    expect(activated.map((skill) => skill.code)).not.toContain("cad_plot_review");
    expect(activated.map((skill) => skill.code)).toContain("cad_geometry_edit");
    const allowed = resolveAllowedTools(activated, null, ALL_TOOL_NAMES);
    expect(allowed).toContain("move_elements");
  });

  it("技能提示词被裁剪到长度上限", () => {
    const long = candidate({
      code: "long",
      keywords: ["画", "线"],
      promptTemplate: "x".repeat(MAX_SKILL_PROMPT_CHARS + 100),
    });
    const [activated] = activateSkills({ skills: [long], message: "画一条线" });
    expect(activated).toBeDefined();
    expect(activated.promptTemplate.length).toBeLessThanOrEqual(MAX_SKILL_PROMPT_CHARS);
  });
});

describe("resolveAllowedTools", () => {
  const all = ["draw_line", "draw_circle", "move_elements", "get_canvas_info", "clear_canvas"];

  it("技能工具取并集", () => {
    const activated = [
      { code: "a", name: "A", score: 20, reasons: [], promptTemplate: "", toolNames: ["draw_line"], category: "x" },
      { code: "b", name: "B", score: 20, reasons: [], promptTemplate: "", toolNames: ["move_elements"], category: "x" },
    ];
    expect(resolveAllowedTools(activated, null, all)).toEqual(["draw_line", "move_elements"]);
  });

  it("助手白名单收窄技能结果", () => {
    const activated = [
      { code: "a", name: "A", score: 20, reasons: [], promptTemplate: "", toolNames: ["draw_line", "clear_canvas"], category: "x" },
    ];
    expect(resolveAllowedTools(activated, ["draw_line"], all)).toEqual(["draw_line"]);
  });

  it("技能未声明工具时沿用助手白名单", () => {
    const activated = [
      { code: "a", name: "A", score: 20, reasons: [], promptTemplate: "", toolNames: null, category: "x" },
    ];
    expect(resolveAllowedTools(activated, ["get_canvas_info", "draw_line"], all)).toEqual([
      "draw_line",
      "get_canvas_info",
    ]);
  });

  it("交集为空时回退到全量工具而不是下发空列表", () => {
    const activated = [
      { code: "a", name: "A", score: 20, reasons: [], promptTemplate: "", toolNames: ["unknown_tool"], category: "x" },
    ];
    expect(resolveAllowedTools(activated, null, all)).toEqual([...all].sort());
  });

  it("过滤未注册的工具名", () => {
    const activated = [
      { code: "a", name: "A", score: 20, reasons: [], promptTemplate: "", toolNames: ["draw_line", "nope"], category: "x" },
    ];
    expect(resolveAllowedTools(activated, null, all)).toEqual(["draw_line"]);
  });

  it("助手白名单与技能工具无交集时不下发任何工具", () => {
    const activated = [
      { code: "a", name: "A", score: 20, reasons: [], promptTemplate: "", toolNames: ["draw_line"], category: "x" },
    ];
    // 回退到全量工具会把 clear_canvas 之类写工具交给模型，绕过助手限制
    expect(resolveAllowedTools(activated, ["get_canvas_info"], all)).toEqual([]);
  });

  it("审查技能激活时收敛为只读工具，忽略同时命中的编辑技能", () => {
    const review = {
      code: "cad_plot_review",
      name: "图纸审查",
      score: 20,
      reasons: [],
      promptTemplate: "",
      toolNames: ["get_canvas_info", "query_elements", "measure_geometry", "check_drawing"],
      category: "Review",
      steps: [],
      checks: [],
      examples: [],
      version: 1,
    };
    const edit = {
      code: "cad_geometry_edit",
      name: "几何编辑",
      score: 30,
      reasons: [],
      promptTemplate: "",
      toolNames: ["move_elements", "draw_line"],
      category: "Editing",
      steps: [],
      checks: [],
      examples: [],
      version: 1,
    };

    expect(resolveAllowedTools([edit, review], null, ALL_TOOL_NAMES)).toEqual([
      "check_drawing",
      "get_canvas_info",
      "measure_geometry",
      "query_elements",
    ]);
  });
});
