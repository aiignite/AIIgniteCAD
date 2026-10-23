/**
 * settingsRegistry.ts — 设置页 AI 注册表的视图模型
 *
 * 模型 / 助手 / 技能三个面板自身不带过滤能力（技能面板只有内部搜索），
 * 设置页把搜索词与统计放在这里算好，再以 registry props 的形式传给面板，
 * 这样匹配规则既不用改面板，也能脱离 DOM 单测。
 */

import type { AiSkill, Assistant, LLMModel } from "../types";

/** 三张注册表的原始行，与 useAIRegistry 返回的字段同名，可直接覆盖后透传给面板 */
export interface RegistryRows {
    models: LLMModel[];
    assistants: Assistant[];
    skills: AiSkill[];
}

/** 可搜索、可切换分组的注册表分区 */
export type RegistrySection = "models" | "assistants" | "skills";

/** 服务端返回缺字段时按空表处理，避免渲染期再判 undefined */
export function toRegistryRows(partial?: Partial<RegistryRows> | null): RegistryRows {
    return {
        models: partial?.models ?? [],
        assistants: partial?.assistants ?? [],
        skills: partial?.skills ?? [],
    };
}

/** 空查询代表不过滤；大小写与连续空格不应该影响命中 */
export function normalizeSearchQuery(query: string): string {
    if (typeof query !== "string") return "";
    return query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function fieldMatches(value: unknown, needle: string): boolean {
    if (typeof value !== "string" || value.length === 0) return false;
    return value.toLocaleLowerCase().includes(needle);
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function anyFieldMatches(fields: unknown[], needle: string): boolean {
    if (needle.length === 0) return true;
    return fields.some((field) => fieldMatches(field, needle));
}

/** 模型卡片上展示的字段都可搜索 */
export function modelSearchFields(model: LLMModel): unknown[] {
    return [model.id, model.name, model.modelId, model.provider, model.configuration?.apiUrl];
}

/** 助手除自身文案外还要能按绑定的模型搜到 */
export function assistantSearchFields(assistant: Assistant): unknown[] {
    const bound = assistant.llmModel;
    return [
        assistant.id,
        assistant.name,
        assistant.description,
        assistant.category,
        bound?.name,
        bound?.modelId,
        bound?.provider,
    ];
}

/** 技能编码（code）与关键词是路由用的主键，必须能搜到 */
export function skillSearchFields(skill: AiSkill): unknown[] {
    return [
        skill.id,
        skill.code,
        skill.name,
        skill.description,
        skill.category,
        ...stringList(skill.keywords),
        ...stringList(skill.toolNames),
    ];
}

export function matchesModel(model: LLMModel, query: string): boolean {
    return anyFieldMatches(modelSearchFields(model), normalizeSearchQuery(query));
}

export function matchesAssistant(assistant: Assistant, query: string): boolean {
    return anyFieldMatches(assistantSearchFields(assistant), normalizeSearchQuery(query));
}

export function matchesSkill(skill: AiSkill, query: string): boolean {
    return anyFieldMatches(skillSearchFields(skill), normalizeSearchQuery(query));
}

/** 分区对应的行 */
export function registryRowsForSection(rows: RegistryRows, section: RegistrySection): unknown[] {
    if (section === "models") return rows.models;
    if (section === "assistants") return rows.assistants;
    return rows.skills;
}

/**
 * 只过滤当前分区：助手面板的下拉需要完整的模型与技能列表，
 * 搜索「图纸」时不应该把可选项也一起筛掉。
 */
export function filterRegistryRows(
    rows: RegistryRows,
    section: RegistrySection,
    query: string,
): RegistryRows {
    const base = toRegistryRows(rows);
    const needle = normalizeSearchQuery(query);
    if (needle.length === 0) return base;
    if (section === "models") {
        return { ...base, models: base.models.filter((model) => matchesModel(model, needle)) };
    }
    if (section === "assistants") {
        return {
            ...base,
            assistants: base.assistants.filter((assistant) => matchesAssistant(assistant, needle)),
        };
    }
    return { ...base, skills: base.skills.filter((skill) => matchesSkill(skill, needle)) };
}

function byText(a: string | undefined, b: string | undefined): number {
    return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

/** 默认项置顶、其余按名称；技能按优先级倒序，让高频技能第一眼可见 */
export function sortRegistryRows(rows: RegistryRows, section: RegistrySection): RegistryRows {
    const base = toRegistryRows(rows);
    if (section === "models") {
        const models = [...base.models].sort((a, b) => {
            if (Boolean(a.isDefault) !== Boolean(b.isDefault)) return a.isDefault ? -1 : 1;
            return byText(a.name, b.name);
        });
        return { ...base, models };
    }
    if (section === "assistants") {
        const assistants = [...base.assistants].sort((a, b) => byText(a.name, b.name));
        return { ...base, assistants };
    }
    const skills = [...base.skills].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return byText(a.name, b.name);
    });
    return { ...base, skills };
}

/** 设置页正文用的视图模型：搜索 + 排序一次算完 */
export function buildRegistryView(
    rows: RegistryRows,
    section: RegistrySection,
    query: string,
): RegistryRows {
    return sortRegistryRows(filterRegistryRows(rows, section, query), section);
}

export interface RegistrySummary {
    modelCount: number;
    assistantCount: number;
    skillCount: number;
    activeModelCount: number;
    enabledSkillCount: number;
    toolCapableModelCount: number;
    /** 已绑定模型的助手数量，用于提示「有多少助手能真正跑起来」 */
    modelBoundAssistantCount: number;
    defaultModelName: string | null;
    /** 服务端默认模型 id，偏好块据此判断是否需要重新标记默认 */
    defaultModelId: string | null;
    /** 去重后的提供商，顺序稳定便于快照断言 */
    providers: string[];
}

export function summarizeRegistryRows(rows: RegistryRows): RegistrySummary {
    const base = toRegistryRows(rows);
    const defaultModel = base.models.find((model) => model.isDefault) ?? null;
    const providers: string[] = [];
    for (const model of base.models) {
        if (typeof model.provider === "string" && !providers.includes(model.provider)) {
            providers.push(model.provider);
        }
    }
    return {
        modelCount: base.models.length,
        assistantCount: base.assistants.length,
        skillCount: base.skills.length,
        activeModelCount: base.models.filter((model) => model.isActive !== false).length,
        enabledSkillCount: base.skills.filter((skill) => skill.isEnabled !== false).length,
        toolCapableModelCount: base.models.filter((model) => model.supportsTools === true).length,
        modelBoundAssistantCount: base.assistants.filter(
            (assistant) => Boolean(assistant.llmModelId) || Boolean(assistant.llmModel),
        ).length,
        defaultModelName: defaultModel ? defaultModel.name : null,
        defaultModelId: defaultModel ? defaultModel.id : null,
        providers,
    };
}

/** 偏好区块「默认模型」下拉的选项 */
export interface DefaultModelOption {
    value: string;
    label: string;
    isDefault: boolean;
}

export function buildDefaultModelOptions(models: LLMModel[]): DefaultModelOption[] {
    return [...toRegistryRows({ models }).models]
        .sort((a, b) => {
            if (Boolean(a.isDefault) !== Boolean(b.isDefault)) return a.isDefault ? -1 : 1;
            return byText(a.name, b.name);
        })
        .map((model) => {
            const detail = [model.provider, model.modelId].filter(
                (part): part is string => typeof part === "string" && part.length > 0,
            );
            return {
                value: model.id,
                label: detail.length > 0 ? `${model.name} · ${detail.join(" / ")}` : model.name,
                isDefault: model.isDefault === true,
            };
        });
}
