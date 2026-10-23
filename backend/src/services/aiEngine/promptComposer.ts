/**
 * promptComposer.ts — 系统提示词装配
 *
 * 顺序固定：基础 CAD 规则 → 助手人格 → 已激活技能块 → 本轮可用工具与语义说明 →
 * 画布快照与会话摘要。技能与助手 prompt 都可能有超长文本，因此对总量做预算裁剪，
 * 优先保留基础规则与工具说明（缺失会让模型产出无法执行的调用）。
 */

import type { ActivatedSkill } from "./skills/skillRouter";
import { formatToolReference } from "./tools";

export interface CanvasContextSnapshot {
  text?: string;
  elementCount?: number;
  selectedIds?: string[];
  selectionTypes?: string[];
  units?: string;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  /** 设计上下文信号：项目、图层、块、提交数、隐藏图元与标注覆盖 */
  projectName?: string;
  layerNames?: string[];
  blockCount?: number;
  revision?: number;
  hiddenCount?: number;
  hasDimensions?: boolean;
}

export interface ComposePromptInput {
  /** 助手表单里配置的 system prompt */
  assistantPrompt?: string | null;
  assistantName?: string | null;
  activatedSkills: readonly ActivatedSkill[];
  allowedTools: readonly string[];
  canvasContext?: CanvasContextSnapshot | null;
  /** 会话历史摘要（确定性 digest） */
  historySummary?: string | null;
  /** 当前工具循环轮次，0 为首轮 */
  round?: number;
  toolsEnabled?: boolean;
  /** 计划模式：只读工具 + propose_plan，禁止直接写画布 */
  planMode?: boolean;
  /** 多方案模式：只读工具 + propose_variants，禁止直接写画布 */
  variantMode?: boolean;
  /**
   * 计划 / 多方案步骤可以引用的写工具名。
   * 与 allowedTools 语义不同：这里列出的工具本轮不可调用，确认计划后才会执行。
   */
  referenceableTools?: readonly string[];
  /** 项目设计约定摘要（由设计约定面板维护） */
  designConventions?: string | null;
  /** 最近版本的变更记忆 */
  versionMemory?: string | null;
  maxChars?: number;
}

const BASE_RULES = `# 角色

你是 2D CAD 绘图助手，通过工具调用操作浏览器中的图纸。

# 坐标系

- 使用画布世界坐标：X 向右增大，Y 向下增大，单位与当前图纸单位一致。
- 坐标不是屏幕像素，也不受缩放平移影响。
- 角度以度为单位，从 +X 轴起算；由于 Y 向下，正角在屏幕上表现为顺时针。

# 规则

1. 需要创建或修改图形时调用工具，不要在文本里输出 JSON 指令。
2. 一轮可以连续调用多个工具；彼此独立的图元尽量一次给全。
3. 编辑类工具（move/rotate/copy/mirror/scale/offset/array）必须明确对象：
   使用上下文里的 selectedIds 或 get_canvas_info 返回的 id。没有可用对象时，
   先用 get_canvas_info 查看，不要猜测 id，也不要对全图操作。
4. 只有用户明确要求清空图纸时才使用 clear_canvas。
5. 数值不明确时选择合理默认并在回复中说明假设，不要反问。
6. 尺寸、半径、角度等参数必须是有限数值，坐标绝对值不超过 1e7。
7. 回复正文用一句话说明你做了什么，避免冗长解释。`;

const DRAFT_SEMANTICS = `# 执行语义

- 工具不会立即改图纸：调用结果先落到草稿，用户在预览对话框确认后才会写入。
- 因此工具返回的 ok 表示"已在草稿上生效"，changedIds 是草稿中新增或修改的图元 id。
- 收到 tool 角色的结果后，先判断是否达成用户目标；不足则继续调用工具修正。
- 若某工具被拒绝（tool_rejected），根据原因修正参数后重试，或改用其他方式；
  不要重复提交同样的失败调用。
- 视图类工具（zoom_to_selection）只改变视口，不改图纸，因此不需要预览确认，直接调用即可。`;

/** 步骤里引用工具时的措辞必须指向提示词里真实存在的清单 */
const stepToolSource = (hasReferenceList: boolean): string =>
  hasReferenceList
    ? "tool 取自下文「计划步骤可引用的写工具」"
    : "本轮没有可引用的写工具，只给出说明性步骤";

const planModeRules = (hasReferenceList: boolean) => `# 计划模式（本轮）

本轮不要直接修改图形，也不要调用任何写工具。先用只读工具确认现状，然后调用一次
propose_plan 提交计划，等待用户确认。

- goal：一句话说明目标。
- steps：按执行顺序给出 1–12 步；需要落图的步骤必须填写 tool 与 arguments，
  ${stepToolSource(hasReferenceList)}，参数使用真实坐标与 id。
- assumptions：请求中缺失但必须假设的尺寸、单位或约束。
- checks：执行后如何验证（数量、包围盒、闭合、标注等）。
- risks：可能影响现有图纸的风险。
- 不要编造图元 id；不确定时先 query_elements / measure_geometry / check_drawing。`;

const variantModeRules = (hasReferenceList: boolean) => `# 多方案模式（本轮）

本轮不要直接修改图形，也不要调用任何写工具。先用只读工具确认现状，然后调用一次
propose_variants 提交 2–3 个互不相同的设计方案，等待用户选择。

- goal：一句话说明设计目标。
- variants：每个方案包含 name、summary 与 steps；summary 说明与其它方案的取舍差异。
- steps 与计划模式一致：需要落图的步骤必须填写 tool 与 arguments，${stepToolSource(
    hasReferenceList,
  )}，参数使用真实坐标与 id。
- 方案之间必须有实质差异（布局、间距、图层组织或标注策略），不要只改文字描述。
- 不要编造图元 id；不确定时先 query_elements / measure_geometry / check_drawing。`;

const jsonish = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

function describeCanvas(context: CanvasContextSnapshot | null | undefined): string | null {
  if (!context) return null;
  const lines: string[] = ["# 画布快照"];
  if (context.projectName) lines.push(`- 图纸：${context.projectName}`);
  if (typeof context.elementCount === "number") lines.push(`- 图元总数：${context.elementCount}`);
  if (context.units) lines.push(`- 单位：${context.units}`);
  if (context.bounds) {
    lines.push(
      `- 包围盒：x ${round(context.bounds.minX)}–${round(context.bounds.maxX)}，` +
        `y ${round(context.bounds.minY)}–${round(context.bounds.maxY)}`,
    );
  }
  if (context.selectedIds && context.selectedIds.length > 0) {
    lines.push(`- 当前选择（${context.selectedIds.length} 个）：${context.selectedIds.join(", ")}`);
    if (context.selectionTypes?.length) {
      lines.push(`- 选择类型：${[...new Set(context.selectionTypes)].join(", ")}`);
    }
  } else {
    lines.push("- 当前没有选中图元。");
  }
  if (context.layerNames?.length) {
    lines.push(`- 图层（${context.layerNames.length}）：${context.layerNames.slice(0, 16).join(", ")}`);
  }
  if (typeof context.blockCount === "number" && context.blockCount > 0) {
    lines.push(`- 块引用：${context.blockCount} 个`);
  }
  if (typeof context.hiddenCount === "number" && context.hiddenCount > 0) {
    lines.push(`- 临时隐藏图元：${context.hiddenCount} 个（不参与显示与捕捉）`);
  }
  if (typeof context.revision === "number" && context.revision > 0) {
    lines.push(`- 本次编辑提交次数：${context.revision}`);
  }
  if (context.hasDimensions) lines.push("- 图中已有尺寸标注。");
  if (context.text) lines.push("", context.text);
  return lines.join("\n");
}

const round = (value: number): number => Math.round(value * 100) / 100;

const MAX_SKILL_BLOCK_CHARS = 1400;

/**
 * 计划 / 多方案步骤可引用的写工具速查表。
 * 「可调用」与「可引用」是两个集合：写工具在本轮不可调用，但必须让模型知道步骤能引用哪些，
 * 否则守规则的模型只会写出只读步骤，计划卡片就没有可执行的动作。
 */
function describeReferenceableTools(names: readonly string[] | undefined): string | null {
  if (!names || names.length === 0) return null;
  const list = formatToolReference(names);
  if (!list) return null;
  return [
    "# 计划步骤可引用的写工具",
    "",
    "下列工具本轮不要调用，只作为 steps 的 tool 取值；用户在预览里确认后才会执行。",
    "省略 ids 表示作用于用户确认时的当前选择集。只读工具用于确认现状，不要写进步骤。",
    "格式为 tool(必填参数, [可选参数])。",
    "",
    list,
  ].join("\n");
}

function describeSkills(skills: readonly ActivatedSkill[]): string | null {
  if (skills.length === 0) return null;
  const blocks = skills.map((skill) => {
    const parts = [`## 技能：${skill.name}（v${skill.version}）`, skill.promptTemplate.trim()];
    const steps = skill.steps ?? [];
    const checks = skill.checks ?? [];
    const examples = skill.examples ?? [];
    const requiredContext = skill.requiredContext ?? [];
    const negativeKeywords = skill.negativeKeywords ?? [];
    if (steps.length > 0) {
      parts.push(
        "### 执行步骤",
        steps
          .map(
            (step, index) =>
              `${index + 1}. ${step.title}${step.detail ? `：${step.detail}` : ""}${
                step.tool ? `（${step.tool}）` : ""
              }`,
          )
          .join("\n"),
      );
    }
    if (checks.length > 0) {
      parts.push("### 完成检查", checks.map((check) => `- ${check}`).join("\n"));
    }
    if (examples.length > 0) {
      parts.push("### 示例请求", examples.map((example) => `- ${example}`).join("\n"));
    }
    // 声明路由时依赖的设计信号：提示模型先确认这些上下文，缺失就先读取再动手
    if (requiredContext.length > 0) {
      parts.push(
        "### 所需上下文",
        requiredContext.map((signal) => `- ${signal}`).join("\n"),
      );
    }
    // 负关键词用于排除场景：命中时该技能不适用，模型应换用其它技能
    if (negativeKeywords.length > 0) {
      parts.push(
        "### 不适用场景",
        negativeKeywords.map((keyword) => `- 需求包含「${keyword}」时不要使用本技能`).join("\n"),
      );
    }
    const block = parts.join("\n");
    return block.length > MAX_SKILL_BLOCK_CHARS
      ? `${block.slice(0, MAX_SKILL_BLOCK_CHARS - 1)}…`
      : block;
  });
  return ["# 已激活技能", "", ...blocks].join("\n");
}

export function composeSystemPrompt(input: ComposePromptInput): string {
  const toolsEnabled = input.toolsEnabled !== false;
  const round = input.round ?? 0;
  const budget = input.maxChars ?? 12_000;

  const sections: Array<{ text: string; weight: number }> = [
    { text: BASE_RULES, weight: 100 },
  ];

  if (input.assistantPrompt && input.assistantPrompt.trim()) {
    sections.push({
      text: ["# 助手设定", input.assistantName ? `（${input.assistantName}）` : "", input.assistantPrompt.trim()]
        .filter(Boolean)
        .join("\n"),
      weight: 80,
    });
  }

  const skills = describeSkills(input.activatedSkills);
  if (skills) sections.push({ text: skills, weight: 70 });

  if (toolsEnabled) {
    const toolSection = [
      "# 本轮可用工具",
      input.allowedTools.length > 0 ? input.allowedTools.map((name) => `- ${name}`).join("\n") : "- （无）",
      "",
      DRAFT_SEMANTICS,
    ].join("\n");
    sections.push({ text: toolSection, weight: 95 });
  }

  const referenceable = describeReferenceableTools(input.referenceableTools);
  if (input.planMode) sections.push({ text: planModeRules(Boolean(referenceable)), weight: 96 });
  if (input.variantMode) {
    sections.push({ text: variantModeRules(Boolean(referenceable)), weight: 96 });
  }
  if (referenceable) sections.push({ text: referenceable, weight: 93 });
  if (input.designConventions && input.designConventions.trim()) {
    sections.push({ text: input.designConventions.trim(), weight: 85 });
  }
  if (input.versionMemory && input.versionMemory.trim()) {
    sections.push({ text: input.versionMemory.trim(), weight: 55 });
  }

  const canvas = describeCanvas(input.canvasContext);
  if (canvas) sections.push({ text: canvas, weight: 60 });

  if (input.historySummary && input.historySummary.trim()) {
    sections.push({
      text: `# 会话摘要（更早的历史已折叠）\n${input.historySummary.trim()}`,
      weight: 40,
    });
  }

  if (round > 0) {
    sections.push({
      text: `# 循环状态\n当前是第 ${round + 1} 轮，草稿中已累积前几轮的工具结果。`,
      weight: 50,
    });
  }

  // 从低权重开始丢弃段落以满足预算；基础规则与工具说明始终保留
  let joined = sections.map((section) => section.text).join("\n\n");
  let total = joined.length;
  if (total > budget) {
    const droppable = sections
      .filter((section) => section.weight < 90)
      .sort((a, b) => a.weight - b.weight);
    for (const section of droppable) {
      if (total <= budget) break;
      const index = sections.indexOf(section);
      if (index < 0) continue;
      total -= section.text.length + 2;
      sections.splice(index, 1);
    }
    joined = sections.map((section) => section.text).join("\n\n");
  }

  return joined;
}

/** 把工具结果摘要为回传给模型的 tool 角色文本 */
export function describeToolResult(result: {
  toolName: string;
  ok: boolean;
  summary?: string;
  error?: string;
  changedIds?: string[];
}): string {
  if (!result.ok) {
    return jsonish({ ok: false, tool: result.toolName, error: result.error ?? "执行失败" });
  }
  return jsonish({
    ok: true,
    tool: result.toolName,
    summary: result.summary ?? "",
    changedIds: (result.changedIds ?? []).slice(0, 50),
    changedCount: (result.changedIds ?? []).length,
  });
}
