import { describe, expect, it } from "vitest";
import type { AiSkill, AiSkillCandidate } from "../types";
import {
    MIN_CANDIDATE_SCORE,
    candidateSignature,
    describeSkillReasons,
    mergeVisibleCandidates,
} from "../lib/skillCandidates";

const skill = (overrides: Partial<AiSkill>): AiSkill => ({
    id: "skill-1",
    code: "array_skill",
    name: "阵列技能",
    description: "",
    category: "Editing",
    promptTemplate: "",
    toolNames: [],
    selectionTypes: [],
    keywords: [],
    steps: [],
    checks: [],
    examples: [],
    requiredContext: [],
    negativeKeywords: [],
    version: 1,
    priority: 50,
    isEnabled: true,
    isSystem: true,
    userId: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
});

const candidate = (overrides: Partial<AiSkillCandidate>): AiSkillCandidate => ({
    code: "array_skill",
    name: "阵列技能",
    description: "",
    category: "Editing",
    score: 20,
    reasons: ["keywords:阵列"],
    tools: [],
    version: 1,
    ...overrides,
});

describe("技能候选前端筛选", () => {
    it("低于激活线的候选不展示，固定技能始终可见并置顶", () => {
        const visible = mergeVisibleCandidates(
            [
                candidate({ code: "a", name: "低分", score: MIN_CANDIDATE_SCORE - 1 }),
                candidate({ code: "b", name: "高分", score: 30 }),
            ],
            ["pinned"],
            [skill({ code: "pinned", name: "固定技能" })],
        );
        expect(visible.map((item) => item.code)).toEqual(["pinned", "b"]);
        expect(visible[0].pinned).toBe(true);
    });

    it("最多展示三个候选，固定技能占位但不会被裁掉", () => {
        const matched = Array.from({ length: 5 }, (_, index) =>
            candidate({ code: `s${index}`, name: `技能${index}`, score: 40 - index }),
        );
        const visible = mergeVisibleCandidates(
            matched,
            ["fixed"],
            [skill({ code: "fixed", name: "固定技能" })],
        );
        expect(visible).toHaveLength(3);
        expect(visible[0].code).toBe("fixed");
    });

    it("路由原因翻译成可读文案并去重", () => {
        expect(
            describeSkillReasons([
                "pinned",
                "keywords:阵列/复制",
                "keywords_history:1:阵列",
                "assistant_binding:30",
            ]),
        ).toBe("手动固定 · 关键词（阵列/复制） · 历史话题（1:阵列） · 助手绑定（30）");
    });

    it("输入签名只保留话题前后缀，避免中间小改动触发重算", () => {
        const long = `${"开头".repeat(30)}中间内容${"结尾".repeat(10)}`;
        const signature = candidateSignature({
            message: long,
            pinnedSkillCodes: [],
            recentSkillCodes: [],
            historyTexts: [],
        });
        expect(signature.includes("中间内容")).toBe(false);
        expect(
            candidateSignature({
                message: "画 一个圆",
                pinnedSkillCodes: [],
                recentSkillCodes: [],
                historyTexts: [],
            }),
        ).toBe(
            candidateSignature({
                message: "画 一个圆",
                pinnedSkillCodes: [],
                recentSkillCodes: [],
                historyTexts: [],
            }),
        );
    });
});
