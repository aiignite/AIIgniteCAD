/**
 * skillCandidates.ts — 候选技能的前端筛选与文案
 *
 * 打分由后端完成，这里只负责：
 * - 把固定技能并入候选并置顶；
 * - 过滤低于激活线的噪声；
 * - 把路由原因翻译成用户能看懂的提示。
 */

import type { AiSkillCandidate, AiSkill } from "../types";

/** 与服务端 ACTIVATION_THRESHOLD 一致；低于此分数的候选项不展示 */
export const MIN_CANDIDATE_SCORE = 12;
export const MAX_VISIBLE_CANDIDATES = 3;

export interface CandidateView extends AiSkillCandidate {
    pinned?: boolean;
}

const byScore = (a: CandidateView, b: CandidateView): number =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.score - a.score || a.name.localeCompare(b.name);

/** 固定技能即使不在本轮匹配结果里也要可见，用户才知道它仍会生效 */
export function mergeVisibleCandidates(
    matched: readonly AiSkillCandidate[],
    pinnedSkillCodes: readonly string[],
    allSkills: readonly AiSkill[],
    options: { max?: number; minScore?: number } = {},
): CandidateView[] {
    const max = options.max ?? MAX_VISIBLE_CANDIDATES;
    const minScore = options.minScore ?? MIN_CANDIDATE_SCORE;
    const pinned = new Set(pinnedSkillCodes);
    const byCode = new Map<string, CandidateView>();

    for (const item of matched) {
        if (item.score < minScore && !pinned.has(item.code)) continue;
        byCode.set(item.code, { ...item, pinned: pinned.has(item.code) });
    }

    for (const skill of allSkills) {
        if (!pinned.has(skill.code) || byCode.has(skill.code)) continue;
        byCode.set(skill.code, {
            code: skill.code,
            name: skill.name,
            description: skill.description,
            category: skill.category,
            score: 100,
            reasons: ["pinned"],
            tools: skill.toolNames,
            version: skill.version,
            pinned: true,
        });
    }

    return [...byCode.values()].sort(byScore).slice(0, Math.max(max, pinned.size));
}

const REASON_LABELS: Array<[string, string]> = [
    ["pinned:", "手动固定"],
    ["pinned", "手动固定"],
    ["recommended", "保留候选"],
    ["assistant_binding:", "助手绑定"],
    ["keywords_history:", "历史话题"],
    ["keywords:", "关键词"],
    ["continuity_carryover", "沿用上轮"],
    ["continuity", "会话延续"],
    ["selection_types", "选择集匹配"],
    ["context:", "图纸上下文"],
    ["negative:", "排除词命中"],
];

/** 把后端 reason 串翻译成一行可读说明，未知原因保持原样 */
export function describeSkillReasons(reasons: readonly string[]): string {
    const labels = reasons.map((reason) => {
        const hit = REASON_LABELS.find(([prefix]) => reason.startsWith(prefix));
        if (!hit) return reason;
        const detail = hit[0].endsWith(":") ? reason.slice(hit[0].length) : "";
        const label = hit[1];
        return detail ? `${label}（${detail}）` : label;
    });
    return [...new Set(labels)].join(" · ");
}

/** 候选条的稳定签名：只比较话题前后缀，避免每次按键都重新请求 */
export function candidateSignature(input: {
    message: string;
    assistantId?: string | null;
    pinnedSkillCodes: readonly string[];
    recentSkillCodes: readonly string[];
    historyTexts: readonly string[];
}): string {
    const normalized = input.message.toLowerCase().replace(/\s+/g, " ").trim();
    const topic =
        normalized.length <= 40
            ? normalized
            : `${normalized.slice(0, 40)}|${normalized.slice(-20)}`;
    return [
        topic,
        input.assistantId ?? "",
        input.pinnedSkillCodes.join(","),
        input.recentSkillCodes.join(","),
        input.historyTexts.join("|"),
    ].join("§");
}
