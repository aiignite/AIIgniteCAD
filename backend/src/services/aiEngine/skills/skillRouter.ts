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
  recommended: 25,
  bindingBase: 25,
  keywordUnit: 8,
  keywordCap: 24,
  historyKeywordUnit: 5,
  historyKeywordCap: 20,
  selectionType: 12,
  continuity: 8,
  contextSignal: 4,
  contextCap: 8,
  negativeKeyword: -16,
} as const;

export const ACTIVATION_THRESHOLD = 12;
export const MAX_ACTIVE_SKILLS = 3;
export const MAX_SKILL_PROMPT_CHARS = 3500;
/** 短消息（如“继续/好的”）没有新话题时沿用上一轮技能，阈值与 PLM 对齐 */
export const CONTINUITY_MESSAGE_MAX_CHARS = 8;

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
  /** 前端候选条中用户保留的技能：加分但不像固定那样绕过阈值 */
  recommendedSkillCodes?: readonly string[];
  /** 助手绑定的技能与权重 */
  bindings?: readonly SkillBinding[];
  /** 同一会话上一轮激活过的技能 code */
  recentSkillCodes?: readonly string[];
  /** 最近几条用户历史消息（旧→新，不含当前消息），关键词按轮次衰减计分 */
  historyTexts?: readonly string[];
  /** 当前图纸具备的设计信号，用于匹配技能的 requiredContext */
  contextSignals?: readonly SkillContextSignal[];
  threshold?: number;
  maxSkills?: number;
}

export interface ActivatedSkill {
  code: string;
  name: string;
  description: string;
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

const keywordHits = (skill: SkillCandidate, text: string): string[] => {
  const haystack = normalize(text);
  if (!haystack) return [];
  const hits: string[] = [];
  for (const keyword of skill.keywords) {
    const needle = normalize(keyword);
    if (!needle) continue;
    if (haystack.includes(needle)) hits.push(keyword);
  }
  return hits;
};

const keywordScore = (skill: SkillCandidate, message: string): { score: number; hits: string[] } => {
  const hits = keywordHits(skill, message);
  const raw = Math.min(hits.length * SCORE_THRESHOLDS.keywordUnit, SCORE_THRESHOLDS.keywordCap);
  return { score: raw, hits: hits.slice(0, 4) };
};

/** 最近一条命中历史消息按深度 0.5^depth 衰减；越靠近当前轮权重越高 */
const historyKeywordScore = (
  skill: SkillCandidate,
  historyTexts: readonly string[],
): { score: number; depth: number; hits: string[] } | null => {
  for (let index = historyTexts.length - 1; index >= 0; index -= 1) {
    const hits = keywordHits(skill, historyTexts[index]);
    if (hits.length === 0) continue;
    const depth = historyTexts.length - index;
    const raw = Math.min(
      hits.length * SCORE_THRESHOLDS.historyKeywordUnit,
      SCORE_THRESHOLDS.historyKeywordCap,
    );
    const score = Math.round(raw * 0.5 ** depth * 10) / 10;
    return score > 0 ? { score, depth, hits: hits.slice(0, 4) } : null;
  }
  return null;
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

  // 候选条来自同一套打分，用户保留即表示认可；仍然要过阈值，
  // 避免把候选里明显不相关的技能硬塞进 prompt。
  const recommended = input.recommendedSkillCodes?.map(normalize) ?? [];
  const isRecommended =
    recommended.includes(normalize(skill.code)) || recommended.includes(normalize(skill.name));
  if (isRecommended) {
    score += SCORE_THRESHOLDS.recommended;
    reasons.push("recommended");
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
  } else {
    // 当前消息没有命中时，回看最近几轮用户消息；0.5^depth 衰减，
    // 让跨轮话题保留弱信号，又不至于把旧话题重新顶成主技能。
    const history = historyKeywordScore(skill, input.historyTexts ?? []);
    if (history) {
      score += history.score;
      reasons.push(`keywords_history:${history.depth}:${history.hits.join("/")}`);
    }
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
  const hasIntent =
    isPinned ||
    isRecommended ||
    Boolean(binding) ||
    keywords.score > 0 ||
    reasons.some((reason) => reason.startsWith("keywords_history:")) ||
    isContinuous;

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

  // priority 只作为同分时的微调；零信号技能不能靠它变成正分候选
  return { score: score > 0 ? score + skill.priority / 1000 : score, reasons };
}

export function truncateSkillPrompt(prompt: string): string {
  if (prompt.length <= MAX_SKILL_PROMPT_CHARS) return prompt;
  return `${prompt.slice(0, MAX_SKILL_PROMPT_CHARS - 1)}…`;
}

interface RankedSkill {
  skill: SkillCandidate;
  score: number;
  reasons: string[];
}

const rankSkills = (input: SkillRouteInput): RankedSkill[] =>
  input.skills
    .map((skill) => {
      const { score, reasons } = scoreSkill(skill, input);
      return { skill, score, reasons };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.skill.priority - a.skill.priority);

const toActivated = (skill: SkillCandidate, score: number, reasons: string[]): ActivatedSkill => ({
  code: skill.code,
  name: skill.name,
  description: skill.description,
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
});

/**
 * 技能候选项：保留正分但尚未过激活线的技能，供前端候选条展示。
 * 与 activateSkills 共用打分，避免界面推荐和实际注入两套规则。
 */
export function resolveCandidates(input: SkillRouteInput, limit = 8): ActivatedSkill[] {
  return rankSkills(input)
    .slice(0, Math.max(1, limit))
    .map(({ skill, score, reasons }) => toActivated(skill, score, reasons));
}

export function activateSkills(input: SkillRouteInput): ActivatedSkill[] {
  const threshold = input.threshold ?? ACTIVATION_THRESHOLD;
  const maxSkills = input.maxSkills ?? MAX_ACTIVE_SKILLS;
  const message = input.message.trim();
  const ranked = rankSkills(input);
  const hasCurrentKeyword = ranked.some((entry) =>
    entry.reasons.some((reason) => reason.startsWith("keywords:")),
  );
  const recent = [...new Set(input.recentSkillCodes ?? [])];

  // 「继续/好的/谢谢」这类短消息没有新话题：沿用上一轮技能，
  // 否则关键词驱动路由会让智能体的技能集整体掉线。
  if (
    message.length > 0 &&
    message.length < CONTINUITY_MESSAGE_MAX_CHARS &&
    !hasCurrentKeyword &&
    (input.pinnedSkillCodes?.length ?? 0) === 0 &&
    recent.length > 0
  ) {
    const byCode = new Map(input.skills.map((skill) => [skill.code, skill]));
    const carry = recent
      .map((code) => byCode.get(code))
      .filter((skill): skill is SkillCandidate => Boolean(skill))
      .slice(0, maxSkills);
    if (carry.length > 0) {
      return carry.map((skill) =>
        toActivated(skill, threshold + 8, ["continuity_carryover"]),
      );
    }
  }

  return ranked
    .filter((entry) => entry.score >= threshold)
    .slice(0, maxSkills)
    .map(({ skill, score, reasons }) => toActivated(skill, score, reasons));
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
