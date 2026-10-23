/**
 * skillRouter.ts — 技能规则路由
 *
 * 多信号打分而不是 embedding：显式固定 > 助手绑定 > 关键词 > 选择集类型 >
 * 会话连续性。分数低于阈值不激活，避免把无关提示词与工具塞进 prompt 里
 * 抬高成本、干扰模型。纯函数，输入输出都可单测。
 */

import type { SkillCandidate } from "./skillService";
import type { SkillContextSignal, SkillStep } from "./skillPlaybook";
import { READ_ONLY_TOOL_NAMES } from "../tools";

export const SCORE_THRESHOLDS = {
  pinned: 100,
  bindingBase: 25,
  keywordUnit: 8,
  keywordCap: 24,
  selectionType: 12,
  continuity: 8,
  contextSignal: 4,
  contextCap: 8,
  negativeKeyword: -16,
} as const;

export const ACTIVATION_THRESHOLD = 12;
export const MAX_ACTIVE_SKILLS = 3;
export const MAX_SKILL_PROMPT_CHARS = 3500;

export interface SkillBinding {
  skillId: string;
  weight: number;
}

export interface SkillRouteInput {
  skills: readonly SkillCandidate[];
  /** 本轮用户消息 */
  message: string;
  /** 当前选择集涉及的图元类型 */
  selectionTypes?: readonly string[];
  /** 前端显式固定的技能 code */
  pinnedSkillCodes?: readonly string[];
  /** 助手绑定的技能与权重 */
  bindings?: readonly SkillBinding[];
  /** 同一会话上一轮激活过的技能 code */
  recentSkillCodes?: readonly string[];
  /** 当前图纸具备的设计信号，用于匹配技能的 requiredContext */
  contextSignals?: readonly SkillContextSignal[];
  threshold?: number;
  maxSkills?: number;
}

export interface ActivatedSkill {
  code: string;
  name: string;
  score: number;
  reasons: string[];
  promptTemplate: string;
  toolNames: string[] | null;
  category: string;
  steps: SkillStep[];
  checks: string[];
  examples: string[];
  requiredContext: SkillContextSignal[];
  negativeKeywords: string[];
  version: number;
}

const normalize = (value: string): string => value.toLowerCase().trim();

const keywordScore = (skill: SkillCandidate, message: string): { score: number; hits: string[] } => {
  const haystack = normalize(message);
  const hits: string[] = [];
  for (const keyword of skill.keywords) {
    const needle = normalize(keyword);
    if (!needle) continue;
    if (haystack.includes(needle)) hits.push(keyword);
  }
  const raw = Math.min(hits.length * SCORE_THRESHOLDS.keywordUnit, SCORE_THRESHOLDS.keywordCap);
  return { score: raw, hits: hits.slice(0, 4) };
};

export function scoreSkill(
  skill: SkillCandidate,
  input: SkillRouteInput,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const pinned = input.pinnedSkillCodes?.map(normalize) ?? [];
  const isPinned = pinned.includes(normalize(skill.code)) || pinned.includes(normalize(skill.name));
  if (isPinned) {
    score += SCORE_THRESHOLDS.pinned;
    reasons.push("pinned");
  }

  const binding = input.bindings?.find((item) => item.skillId === skill.id);
  if (binding) {
    const value = SCORE_THRESHOLDS.bindingBase + Math.max(0, binding.weight) / 10;
    score += value;
    reasons.push(`assistant_binding:${Math.round(value)}`);
  }

  const keywords = keywordScore(skill, input.message);
  if (keywords.score > 0) {
    score += keywords.score;
    reasons.push(`keywords:${keywords.hits.join("/")}`);
  }

  const recent = input.recentSkillCodes?.map(normalize) ?? [];
  const isContinuous = recent.includes(normalize(skill.code));
  if (isContinuous) {
    score += SCORE_THRESHOLDS.continuity;
    reasons.push("continuity");
  }

  // 负关键词用于排除明显不适用的场景，例如"检查"技能遇到"直接修复"
  const haystack = normalize(input.message);
  const negativeHits = (skill.negativeKeywords ?? []).filter(
    (keyword) => keyword.trim() && haystack.includes(normalize(keyword)),
  );
  if (negativeHits.length > 0) {
    score += SCORE_THRESHOLDS.negativeKeyword * negativeHits.length;
    reasons.push(`negative:${negativeHits.slice(0, 3).join("/")}`);
  }

  // 选择类型与设计上下文只放大已有意图，不能单独让技能越过阈值：
  // 否则"选中任何线"都会同时激活编辑与阵列技能。
  const hasIntent = isPinned || Boolean(binding) || keywords.score > 0 || isContinuous;

  if (hasIntent) {
    const signals = new Set(input.contextSignals ?? []);
    const matchedSignals = (skill.requiredContext ?? []).filter((signal) => signals.has(signal));
    if (matchedSignals.length > 0) {
      const bonus = Math.min(
        matchedSignals.length * SCORE_THRESHOLDS.contextSignal,
        SCORE_THRESHOLDS.contextCap,
      );
      score += bonus;
      reasons.push(`context:${matchedSignals.join("/")}`);
    }

    const selectionTypes = input.selectionTypes ?? [];
    if (
      skill.selectionTypes.length > 0 &&
      selectionTypes.some((type) =>
        skill.selectionTypes.some((own) => normalize(own) === normalize(type)),
      )
    ) {
      score += SCORE_THRESHOLDS.selectionType;
      reasons.push("selection_types");
    }
  }

  // priority 只作为同分时的微调，避免内置技能的编号顺序主导路由
  return { score: score + skill.priority / 1000, reasons };
}

export function truncateSkillPrompt(prompt: string): string {
  if (prompt.length <= MAX_SKILL_PROMPT_CHARS) return prompt;
  return `${prompt.slice(0, MAX_SKILL_PROMPT_CHARS - 1)}…`;
}

export function activateSkills(input: SkillRouteInput): ActivatedSkill[] {
  const threshold = input.threshold ?? ACTIVATION_THRESHOLD;
  const maxSkills = input.maxSkills ?? MAX_ACTIVE_SKILLS;

  return input.skills
    .map((skill) => {
      const { score, reasons } = scoreSkill(skill, input);
      return { skill, score, reasons };
    })
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score || b.skill.priority - a.skill.priority)
    .slice(0, maxSkills)
    .map(({ skill, score, reasons }) => ({
      code: skill.code,
      name: skill.name,
      score: Math.round(score * 10) / 10,
      reasons,
      promptTemplate: truncateSkillPrompt(skill.promptTemplate),
      toolNames: skill.toolNames,
      category: skill.category,
      steps: skill.steps ?? [],
      checks: skill.checks ?? [],
      examples: skill.examples ?? [],
      requiredContext: skill.requiredContext ?? [],
      negativeKeywords: skill.negativeKeywords ?? [],
      version: skill.version ?? 1,
    }));
}

/**
 * 本轮可用工具 = 助手白名单 ∩ (技能工具子集的并集)；
 * 技能未声明工具子集时不额外收窄，只受助手白名单限制。
 */
export function resolveAllowedTools(
  activated: readonly ActivatedSkill[],
  assistantWhitelist: readonly string[] | null,
  allToolNames: readonly string[],
): string[] {
  const readOnly = new Set<string>(READ_ONLY_TOOL_NAMES);
  const toolsOf = (skill: ActivatedSkill): string[] | null =>
    skill.toolNames && skill.toolNames.length > 0 ? skill.toolNames : null;

  // 审查技能激活时收敛为只读工具：即使编辑/阵列技能同时被路由命中，
  // 也不应把写工具下发给模型。
  const readOnlySets = activated
    .filter((skill) => {
      const tools = toolsOf(skill);
      return tools !== null && tools.every((name) => readOnly.has(name));
    })
    .map((skill) => toolsOf(skill) as string[]);

  const skillToolSets = (readOnlySets.length > 0
    ? readOnlySets
    : activated.map(toolsOf).filter((tools): tools is string[] => tools !== null)
  );

  let allowed: string[];
  if (skillToolSets.length > 0) {
    allowed = [...new Set(skillToolSets.flat())];
  } else if (assistantWhitelist && assistantWhitelist.length > 0) {
    allowed = [...assistantWhitelist];
  } else {
    allowed = [...allToolNames];
  }

  if (assistantWhitelist && assistantWhitelist.length > 0) {
    const whitelist = new Set(assistantWhitelist);
    allowed = allowed.filter((name) => whitelist.has(name));
  }

  const known = new Set(allToolNames);
  const filtered = allowed.filter((name) => known.has(name));
  if (filtered.length > 0) return filtered.sort();
  // 助手白名单与技能工具没有交集时不下发任何工具；
  // 退回全量工具会绕过助手限制，把 clear_canvas 之类的写工具交给模型
  if (assistantWhitelist && assistantWhitelist.length > 0) return [];
  return [...allToolNames].sort();
}
