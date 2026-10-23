/**
 * skillTransfer.ts — 技能导入导出的纯逻辑
 *
 * 导出格式固定为带版本号的 JSON，便于跨环境传递技能；
 * 导入在写入服务端前先做一次完整校验，任何越界或非法字段都直接拒绝，
 * 不让脏数据进入提示词预算与工具白名单。字段规则本身在 skillValidation 里，
 * 与编辑器手写路径共用。
 */

import type { AiSkill, SkillContextSignal, SkillInput, SkillStep } from "../types";
import {
    SKILL_CODE_PATTERN,
    SKILL_LIMITS,
    readSkillCategory,
    readSkillCode,
    readSkillContextSignals,
    readSkillDescription,
    readSkillName,
    readSkillPriority,
    readSkillPrompt,
    readSkillSteps,
    readSkillStringList,
    readSkillToolNames,
    type SkillFieldIssue,
    type SkillFieldRead,
} from "./skillValidation";

export const SKILL_EXPORT_KIND = "aiignite-skill";
export const SKILL_EXPORT_VERSION = 1;

export interface SkillExportSkill {
    code: string;
    name: string;
    description: string;
    category: string;
    promptTemplate: string;
    toolNames: string[];
    selectionTypes: string[];
    keywords: string[];
    steps: SkillStep[];
    checks: string[];
    examples: string[];
    requiredContext: SkillContextSignal[];
    negativeKeywords: string[];
    priority: number;
    isEnabled: boolean;
}

export interface SkillExportPayload {
    kind: typeof SKILL_EXPORT_KIND;
    version: number;
    exportedAt: string;
    skill: SkillExportSkill;
}

export type SkillImportResult =
    | { ok: boolean; value: SkillExportSkill; error?: undefined }
    | { ok: boolean; value?: undefined; error: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function buildSkillExport(
    skill: AiSkill,
    exportedAt: string = new Date().toISOString(),
): SkillExportPayload {
    return {
        kind: SKILL_EXPORT_KIND,
        version: SKILL_EXPORT_VERSION,
        exportedAt,
        skill: {
            code: skill.code,
            name: skill.name,
            description: skill.description ?? "",
            category: skill.category ?? "",
            promptTemplate: skill.promptTemplate,
            toolNames: [...(skill.toolNames ?? [])],
            selectionTypes: [...(skill.selectionTypes ?? [])],
            keywords: [...(skill.keywords ?? [])],
            steps: (skill.steps ?? []).map((step) => ({ ...step })),
            checks: [...(skill.checks ?? [])],
            examples: [...(skill.examples ?? [])],
            requiredContext: [...(skill.requiredContext ?? [])],
            negativeKeywords: [...(skill.negativeKeywords ?? [])],
            priority: skill.priority ?? 50,
            isEnabled: skill.isEnabled !== false,
        },
    };
}

export function skillExportFileName(skill: AiSkill): string {
    const safe = skill.code.replace(/[^a-zA-Z0-9_-]/g, "-");
    return `${safe || "skill"}.aiignite-skill.json`;
}

/** 导入路径按字段顺序校验，第一个问题即返回，并把它定位到字段 */
const firstIssue = (
    ...reads: Array<SkillFieldRead<unknown>>
): SkillFieldIssue | null => {
    for (const read of reads) {
        if (read.issue) return read.issue;
    }
    return null;
};

export function parseSkillImport(raw: unknown): SkillImportResult {
    if (!isPlainObject(raw)) return { ok: false, error: "技能文件必须是 JSON 对象" };
    if (raw.kind !== SKILL_EXPORT_KIND) {
        return { ok: false, error: `不是 ${SKILL_EXPORT_KIND} 技能文件` };
    }
    if (raw.version !== SKILL_EXPORT_VERSION) {
        return { ok: false, error: `不支持的技能文件版本：${String(raw.version)}` };
    }
    const skill = raw.skill;
    if (!isPlainObject(skill)) return { ok: false, error: "技能文件缺少 skill 字段" };

    const name = readSkillName(skill.name);
    const description = readSkillDescription(skill.description);
    const category = readSkillCategory(skill.category);
    const promptTemplate = readSkillPrompt(skill.promptTemplate);
    const code = readSkillCode(skill.code);
    const toolNames = readSkillToolNames(skill.toolNames);
    const keywords = readSkillStringList(
        skill.keywords,
        "keywords",
        "keywords",
        SKILL_LIMITS.keywords,
        SKILL_LIMITS.keywordLength,
    );
    const selectionTypes = readSkillStringList(
        skill.selectionTypes,
        "selectionTypes",
        "selectionTypes",
        SKILL_LIMITS.selectionTypes,
        SKILL_LIMITS.selectionTypeLength,
    );
    const steps = readSkillSteps(skill.steps);
    const checks = readSkillStringList(
        skill.checks,
        "checks",
        "checks",
        SKILL_LIMITS.checks,
        SKILL_LIMITS.checkLength,
    );
    const examples = readSkillStringList(
        skill.examples,
        "examples",
        "examples",
        SKILL_LIMITS.examples,
        SKILL_LIMITS.exampleLength,
    );
    const requiredContext = readSkillContextSignals(skill.requiredContext);
    const negativeKeywords = readSkillStringList(
        skill.negativeKeywords,
        "negativeKeywords",
        "negativeKeywords",
        SKILL_LIMITS.negativeKeywords,
        SKILL_LIMITS.negativeKeywordLength,
    );
    const priority = readSkillPriority(skill.priority);

    const issue = firstIssue(
        name,
        description,
        category,
        promptTemplate,
        code,
        toolNames,
        keywords,
        selectionTypes,
        steps,
        checks,
        examples,
        requiredContext,
        negativeKeywords,
        priority,
    );
    if (issue) return { ok: false, error: issue.error };
    if (skill.isEnabled !== undefined && typeof skill.isEnabled !== "boolean") {
        return { ok: false, error: "isEnabled 必须是布尔值" };
    }

    return {
        ok: true,
        value: {
            code: code.value,
            name: name.value,
            description: description.value.trim(),
            category: category.value || "custom",
            promptTemplate: promptTemplate.value,
            toolNames: toolNames.value,
            selectionTypes: selectionTypes.value,
            keywords: keywords.value,
            steps: steps.value,
            checks: checks.value,
            examples: examples.value,
            requiredContext: requiredContext.value,
            negativeKeywords: negativeKeywords.value,
            priority: priority.value,
            isEnabled: skill.isEnabled !== false,
        },
    };
}

/** 导入时若目标代码已被占用，追加副本后缀，保证仍满足代码格式 */
export function resolveImportCode(preferred: string, takenCodes: readonly string[]): string {
    const taken = new Set(takenCodes);
    const base = preferred.replace(/[^a-z0-9_-]/g, "").replace(/^[^a-z0-9]+/, "") || "imported-skill";
    if (!taken.has(base) && SKILL_CODE_PATTERN.test(base)) return base;
    for (let index = 1; index <= 50; index += 1) {
        const suffix = index === 1 ? "-copy" : `-copy${index}`;
        const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
        if (SKILL_CODE_PATTERN.test(candidate) && !taken.has(candidate)) return candidate;
    }
    return `imported-${Date.now().toString(36)}`;
}

/** 导入文件 → 创建技能请求体 */
export function skillImportToInput(skill: SkillExportSkill, code: string): SkillInput {
    return {
        name: skill.name,
        code,
        description: skill.description,
        category: skill.category,
        promptTemplate: skill.promptTemplate,
        toolNames: skill.toolNames,
        selectionTypes: skill.selectionTypes,
        keywords: skill.keywords,
        steps: skill.steps,
        checks: skill.checks,
        examples: skill.examples,
        requiredContext: skill.requiredContext,
        negativeKeywords: skill.negativeKeywords,
        priority: skill.priority,
        isEnabled: skill.isEnabled,
    };
}
