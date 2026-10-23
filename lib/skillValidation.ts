/**
 * skillValidation.ts — 技能字段的唯一校验实现
 *
 * 导入（skillTransfer）与编辑器手写（AISkillsPanel）共用同一套上限与文案：
 * 两端各写一份规则表必然漂移，用户打错一个工具名只会拿到后端整份 400。
 * 后端 express-validator 仍是权威防线，但错误文案与此逐字一致。
 */

import type { SkillContextSignal, SkillInput, SkillStep } from "../types";
import { SUPPORTED_AI_TOOL_NAMES } from "./aiTools";

export const SKILL_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;

export const SKILL_CONTEXT_SIGNALS: readonly SkillContextSignal[] = [
    "selection",
    "layers",
    "blocks",
    "revision",
    "dimensions",
];

export const SKILL_LIMITS = {
    name: 80,
    description: 300,
    category: 40,
    promptTemplate: 4000,
    toolNames: SUPPORTED_AI_TOOL_NAMES.length,
    toolName: 64,
    keywords: 24,
    keywordLength: 32,
    selectionTypes: 16,
    selectionTypeLength: 32,
    steps: 8,
    stepTitle: 80,
    stepDetail: 300,
    stepTool: 64,
    checks: 10,
    checkLength: 200,
    examples: 5,
    exampleLength: 240,
    negativeKeywords: 16,
    negativeKeywordLength: 32,
    priority: 200,
} as const;

/** 校验失败可落在哪些字段上；编辑器和导入用同一组标识 */
export type SkillFieldName =
    | "name"
    | "code"
    | "description"
    | "category"
    | "promptTemplate"
    | "toolNames"
    | "keywords"
    | "selectionTypes"
    | "steps"
    | "checks"
    | "examples"
    | "requiredContext"
    | "negativeKeywords"
    | "priority"
    | "isEnabled";

/** 字段在界面上的中文名，供错误提示定位到输入框 */
export const SKILL_FIELD_LABELS: Record<SkillFieldName, string> = {
    name: "名称",
    code: "代码",
    description: "描述",
    category: "分类",
    promptTemplate: "提示词模板",
    toolNames: "可用工具",
    keywords: "关键词",
    selectionTypes: "选择类型",
    steps: "执行步骤",
    checks: "完成检查",
    examples: "示例请求",
    requiredContext: "设计上下文",
    negativeKeywords: "反关键词",
    priority: "优先级",
    isEnabled: "启用状态",
};

export interface SkillFieldIssue {
    field: SkillFieldName;
    error: string;
}

/** 读取结果：值已归一化（trim、去空），issue 为 null 表示该字段合法 */
export interface SkillFieldRead<T> {
    value: T;
    issue: SkillFieldIssue | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

const trimmed = (value: string): string => value.trim();

const fail = (field: SkillFieldName, error: string): SkillFieldIssue => ({ field, error });

/** 校验字符串数组：数量上限 + 每项长度 + 非空 */
export function readSkillStringList(
    value: unknown,
    field: SkillFieldName,
    label: string,
    maxItems: number,
    maxLength: number,
): SkillFieldRead<string[]> {
    if (value === undefined || value === null) return { value: [], issue: null };
    if (!Array.isArray(value)) return { value: [], issue: fail(field, `${label} 必须是数组`) };
    if (value.length > maxItems) {
        return { value: [], issue: fail(field, `${label} 最多 ${maxItems} 项`) };
    }
    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") {
            return { value: [], issue: fail(field, `${label} 只能包含字符串`) };
        }
        const text = trimmed(item);
        if (!text) return { value: [], issue: fail(field, `${label} 不能包含空项`) };
        if (text.length > maxLength) {
            return { value: [], issue: fail(field, `${label} 每项最多 ${maxLength} 字符`) };
        }
        out.push(text);
    }
    return { value: out, issue: null };
}

export function readSkillSteps(value: unknown): SkillFieldRead<SkillStep[]> {
    const field: SkillFieldName = "steps";
    if (value === undefined || value === null) return { value: [], issue: null };
    if (!Array.isArray(value)) return { value: [], issue: fail(field, "steps 必须是数组") };
    if (value.length > SKILL_LIMITS.steps) {
        return { value: [], issue: fail(field, `steps 最多 ${SKILL_LIMITS.steps} 项`) };
    }
    const out: SkillStep[] = [];
    for (const item of value) {
        if (!isPlainObject(item)) return { value: [], issue: fail(field, "每个步骤必须是对象") };
        const title = typeof item.title === "string" ? trimmed(item.title) : "";
        if (!title) return { value: [], issue: fail(field, "每个步骤都需要标题") };
        if (title.length > SKILL_LIMITS.stepTitle) {
            return { value: [], issue: fail(field, `步骤标题最多 ${SKILL_LIMITS.stepTitle} 字符`) };
        }
        const step: SkillStep = { title };
        if (item.detail !== undefined && item.detail !== null) {
            if (typeof item.detail !== "string") {
                return { value: [], issue: fail(field, "步骤说明必须是字符串") };
            }
            if (item.detail.length > SKILL_LIMITS.stepDetail) {
                return {
                    value: [],
                    issue: fail(field, `步骤说明最多 ${SKILL_LIMITS.stepDetail} 字符`),
                };
            }
            if (item.detail.trim()) step.detail = item.detail.trim();
        }
        if (item.tool !== undefined && item.tool !== null) {
            if (typeof item.tool !== "string") {
                return { value: [], issue: fail(field, "步骤工具必须是字符串") };
            }
            if (item.tool.length > SKILL_LIMITS.stepTool) {
                return { value: [], issue: fail(field, `步骤工具最多 ${SKILL_LIMITS.stepTool} 字符`) };
            }
            const tool = item.tool.trim();
            if (tool && !SUPPORTED_AI_TOOL_NAMES.includes(tool as never)) {
                return { value: [], issue: fail(field, `步骤引用了未知工具：${tool}`) };
            }
            if (tool) step.tool = tool;
        }
        out.push(step);
    }
    return { value: out, issue: null };
}

export function readSkillContextSignals(value: unknown): SkillFieldRead<SkillContextSignal[]> {
    const field: SkillFieldName = "requiredContext";
    if (value === undefined || value === null) return { value: [], issue: null };
    if (!Array.isArray(value)) return { value: [], issue: fail(field, "requiredContext 必须是数组") };
    if (value.length > SKILL_CONTEXT_SIGNALS.length) {
        return {
            value: [],
            issue: fail(field, `requiredContext 最多 ${SKILL_CONTEXT_SIGNALS.length} 项`),
        };
    }
    const out: SkillContextSignal[] = [];
    for (const item of value) {
        if (
            typeof item !== "string" ||
            !SKILL_CONTEXT_SIGNALS.includes(item as SkillContextSignal)
        ) {
            return { value: [], issue: fail(field, `未知的上下文信号：${String(item)}`) };
        }
        if (!out.includes(item as SkillContextSignal)) out.push(item as SkillContextSignal);
    }
    return { value: out, issue: null };
}

export function readSkillToolNames(value: unknown): SkillFieldRead<string[]> {
    const list = readSkillStringList(
        value,
        "toolNames",
        "toolNames",
        SKILL_LIMITS.toolNames,
        SKILL_LIMITS.toolName,
    );
    if (list.issue) return list;
    const unknown = list.value.find((name) => !SUPPORTED_AI_TOOL_NAMES.includes(name as never));
    return unknown
        ? { value: list.value, issue: fail("toolNames", `未知的工具：${unknown}`) }
        : list;
}

export function readSkillName(value: unknown): SkillFieldRead<string> {
    const name = typeof value === "string" ? trimmed(value) : "";
    if (!name) return { value: "", issue: fail("name", "技能名称不能为空") };
    if (name.length > SKILL_LIMITS.name) {
        return { value: name, issue: fail("name", `技能名称最多 ${SKILL_LIMITS.name} 字符`) };
    }
    return { value: name, issue: null };
}

export function readSkillPrompt(value: unknown): SkillFieldRead<string> {
    const text = typeof value === "string" ? trimmed(value) : "";
    if (!text) return { value: "", issue: fail("promptTemplate", "提示词模板不能为空") };
    if (text.length > SKILL_LIMITS.promptTemplate) {
        return {
            value: text,
            issue: fail("promptTemplate", `提示词模板最多 ${SKILL_LIMITS.promptTemplate} 字符`),
        };
    }
    return { value: text, issue: null };
}

export function readSkillCode(value: unknown): SkillFieldRead<string> {
    const code = typeof value === "string" ? trimmed(value) : "";
    if (code && !SKILL_CODE_PATTERN.test(code)) {
        return { value: code, issue: fail("code", "技能代码需匹配 ^[a-z0-9][a-z0-9_-]{2,63}$") };
    }
    return { value: code, issue: null };
}

export function readSkillPriority(value: unknown): SkillFieldRead<number> {
    const priority = value === undefined ? 50 : value;
    if (
        typeof priority !== "number" ||
        !Number.isInteger(priority) ||
        priority < 0 ||
        priority > SKILL_LIMITS.priority
    ) {
        return {
            value: 50,
            issue: fail("priority", `优先级必须是 0 到 ${SKILL_LIMITS.priority} 的整数`),
        };
    }
    return { value: priority, issue: null };
}

export function readSkillDescription(value: unknown): SkillFieldRead<string> {
    const text = typeof value === "string" ? value : "";
    if (text.length > SKILL_LIMITS.description) {
        return {
            value: text,
            issue: fail("description", `技能描述最多 ${SKILL_LIMITS.description} 字符`),
        };
    }
    return { value: text, issue: null };
}

export function readSkillCategory(value: unknown): SkillFieldRead<string> {
    const category = typeof value === "string" ? trimmed(value) : "";
    if (category.length > SKILL_LIMITS.category) {
        return { value: category, issue: fail("category", `技能分类最多 ${SKILL_LIMITS.category} 字符`) };
    }
    return { value: category, issue: null };
}

/** 编辑器保存前的整表校验：一次给出所有问题，按字段顺序排列 */
export function validateSkillDraft(draft: SkillInput): SkillFieldIssue[] {
    const issues: SkillFieldIssue[] = [];
    const push = (read: SkillFieldRead<unknown>) => {
        if (read.issue) issues.push(read.issue);
    };
    push(readSkillName(draft.name));
    push(readSkillCode(draft.code ?? ""));
    push(readSkillDescription(draft.description));
    push(readSkillCategory(draft.category));
    push(readSkillPrompt(draft.promptTemplate));
    push(readSkillToolNames(draft.toolNames));
    push(
        readSkillStringList(
            draft.keywords,
            "keywords",
            "keywords",
            SKILL_LIMITS.keywords,
            SKILL_LIMITS.keywordLength,
        ),
    );
    push(
        readSkillStringList(
            draft.selectionTypes,
            "selectionTypes",
            "selectionTypes",
            SKILL_LIMITS.selectionTypes,
            SKILL_LIMITS.selectionTypeLength,
        ),
    );
    push(readSkillSteps(draft.steps));
    push(
        readSkillStringList(
            draft.checks,
            "checks",
            "checks",
            SKILL_LIMITS.checks,
            SKILL_LIMITS.checkLength,
        ),
    );
    push(
        readSkillStringList(
            draft.examples,
            "examples",
            "examples",
            SKILL_LIMITS.examples,
            SKILL_LIMITS.exampleLength,
        ),
    );
    push(readSkillContextSignals(draft.requiredContext));
    push(
        readSkillStringList(
            draft.negativeKeywords,
            "negativeKeywords",
            "negativeKeywords",
            SKILL_LIMITS.negativeKeywords,
            SKILL_LIMITS.negativeKeywordLength,
        ),
    );
    push(readSkillPriority(draft.priority));
    if (draft.isEnabled !== undefined && typeof draft.isEnabled !== "boolean") {
        issues.push(fail("isEnabled", "isEnabled 必须是布尔值"));
    }
    return issues;
}

/** 字段问题的界面文案：中文名 + 具体原因，便于定位到输入框 */
export function describeSkillIssue(issue: SkillFieldIssue): string {
    return `${SKILL_FIELD_LABELS[issue.field]}：${issue.error}`;
}
