import React, { useMemo, useState } from "react";
import type { Assistant, AssistantInput } from "../types";
import type { UseAIRegistryResult } from "../hooks/useAIRegistry";
import { SUPPORTED_AI_TOOL_NAMES } from "../lib/aiTools";
import { toolLabel } from "../lib/aiUi";

const ICONS = [
    "psychology",
    "architecture",
    "design_services",
    "precision_manufacturing",
    "engineering",
    "calculate",
];

const COLORS = [
    "text-cad-primary",
    "text-emerald-500",
    "text-amber-500",
    "text-rose-500",
    "text-violet-500",
];

interface AssistantForm {
    name: string;
    icon: string;
    description: string;
    color: string;
    category: string;
    prompt: string;
    isActive: boolean;
    isPublic: boolean;
    llmModelId: string;
    temperature: string;
    maxTokens: string;
    maxToolRounds: string;
    toolNames: string[];
    skillIds: string[];
}

const emptyForm: AssistantForm = {
    name: "",
    icon: "psychology",
    description: "",
    color: "text-cad-primary",
    category: "General",
    prompt: "",
    isActive: true,
    isPublic: false,
    llmModelId: "",
    temperature: "",
    maxTokens: "",
    maxToolRounds: "4",
    toolNames: [],
    skillIds: [],
};

const numOr = (value: string): number | null => {
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
};

const toForm = (assistant: Assistant): AssistantForm => ({
    name: assistant.name,
    icon: assistant.icon,
    description: assistant.description ?? "",
    color: assistant.color,
    category: assistant.category ?? "General",
    prompt: assistant.prompt ?? "",
    isActive: assistant.isActive ?? true,
    isPublic: assistant.isPublic ?? false,
    llmModelId: assistant.llmModelId ?? assistant.llmModel?.id ?? "",
    temperature: assistant.temperature === null || assistant.temperature === undefined
        ? ""
        : String(assistant.temperature),
    maxTokens: assistant.maxTokens === null || assistant.maxTokens === undefined
        ? ""
        : String(assistant.maxTokens),
    maxToolRounds: String(assistant.maxToolRounds ?? 4),
    toolNames: assistant.toolNames ?? [],
    skillIds: assistant.skillIds ?? (assistant.skills ?? []).map((item) => item.skillId),
});

const toInput = (form: AssistantForm): AssistantInput => ({
    name: form.name.trim(),
    icon: form.icon,
    description: form.description.trim(),
    color: form.color,
    category: form.category.trim() || "General",
    prompt: form.prompt.trim() || null,
    isActive: form.isActive,
    isPublic: form.isPublic,
    llmModelId: form.llmModelId || null,
    temperature: numOr(form.temperature),
    maxTokens: numOr(form.maxTokens),
    maxToolRounds: Math.min(12, Math.max(0, numOr(form.maxToolRounds) ?? 4)),
    toolNames: form.toolNames.length > 0 ? form.toolNames : null,
    skills: form.skillIds.map((skillId) => ({ skillId })),
});

const fieldClass =
    "w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text";
const labelClass = "text-[10px] text-cad-muted font-medium";

interface AssistantsPanelProps {
    registry: UseAIRegistryResult;
}

export const AssistantsPanel: React.FC<AssistantsPanelProps> = ({ registry }) => {
    const { assistants, models, skills, error, dismissError } = registry;
    const [form, setForm] = useState<AssistantForm | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [hint, setHint] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const enabledSkills = useMemo(() => skills.filter((skill) => skill.isEnabled), [skills]);

    const save = async () => {
        if (!form) return;
        if (!form.name.trim()) {
            setHint("名称必填");
            return;
        }
        const ok = await registry.saveAssistant(editingId, toInput(form));
        if (ok) {
            setForm(null);
            setEditingId(null);
            setHint(null);
        }
    };

    const toggle = (key: "toolNames" | "skillIds", value: string) => {
        if (!form) return;
        const list = form[key];
        setForm({
            ...form,
            [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
        } as AssistantForm);
    };

    return (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="flex items-center justify-between p-3 border-b border-cad-border bg-cad-panel">
                <h3 className="text-sm font-bold text-cad-text">助手</h3>
                <button
                    onClick={() => {
                        setEditingId(null);
                        setHint(null);
                        setShowAdvanced(false);
                        setForm({ ...emptyForm });
                    }}
                    className="flex items-center justify-center size-7 rounded hover:bg-cad-text/10 text-cad-muted hover:text-cad-text transition-colors"
                    title="新建助手"
                >
                    <span className="material-symbols-outlined text-[20px]">add</span>
                </button>
            </div>

            {(error || hint) && (
                <div
                    className={`flex items-start gap-2 px-3 py-1.5 text-[11px] border-b ${
                        error
                            ? "border-red-500/40 bg-red-500/10 text-red-500"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-500"
                    }`}
                >
                    <span className="flex-1 min-w-0 break-words">
                        {error ? `${error.message}${error.hint ? ` · ${error.hint}` : ""}` : hint}
                    </span>
                    <button
                        onClick={() => {
                            if (error) dismissError();
                            else setHint(null);
                        }}
                        className="shrink-0 text-cad-muted hover:text-cad-text"
                        title="关闭"
                    >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                </div>
            )}

            {form ? (
                <div className="flex-1 p-3 space-y-2 bg-cad-panel overflow-y-auto">
                    <h4 className="text-xs font-bold text-cad-text">
                        {editingId ? "编辑助手" : "新建助手"}
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className={labelClass}>名称</span>
                            <input
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className={fieldClass}
                            />
                        </label>
                        <label className="block">
                            <span className={labelClass}>分类</span>
                            <input
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                                className={fieldClass}
                            />
                        </label>
                    </div>
                    <label className="block">
                        <span className={labelClass}>描述</span>
                        <input
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className={fieldClass}
                        />
                    </label>
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                            {ICONS.map((icon) => (
                                <button
                                    key={icon}
                                    onClick={() => setForm({ ...form, icon })}
                                    className={`p-1 rounded border ${
                                        form.icon === icon
                                            ? "border-cad-primary bg-cad-primary/10"
                                            : "border-cad-border"
                                    }`}
                                    title={icon}
                                >
                                    <span
                                        className={`material-symbols-outlined text-[16px] ${form.color}`}
                                    >
                                        {icon}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1 ml-auto">
                            {COLORS.map((color) => (
                                <button
                                    key={color}
                                    onClick={() => setForm({ ...form, color })}
                                    className={`size-4 rounded-full border ${
                                        form.color === color ? "border-cad-text" : "border-transparent"
                                    }`}
                                    title={color}
                                >
                                    <span className={`material-symbols-outlined text-[12px] ${color}`}>
                                        circle
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <label className="block">
                        <span className={labelClass}>
                            系统提示词（会真正注入本轮 prompt，替换默认角色说明）
                        </span>
                        <textarea
                            value={form.prompt}
                            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                            rows={5}
                            className="mt-1 w-full px-2 py-1.5 rounded border border-cad-border bg-transparent text-xs text-cad-text font-mono resize-y"
                            placeholder="你是负责机械制图的 CAD 助手，优先使用阵列与镜像…"
                        />
                    </label>
                    <label className="block">
                        <span className={labelClass}>绑定模型（留空 = 用默认模型）</span>
                        <select
                            value={form.llmModelId}
                            onChange={(e) => setForm({ ...form, llmModelId: e.target.value })}
                            className={fieldClass}
                        >
                            <option value="">跟随默认模型</option>
                            {models
                                .filter((model) => model.isActive)
                                .map((model) => (
                                    <option key={model.id} value={model.id}>
                                        {model.name} · {model.provider}
                                        {model.supportsTools ? "" : "（无工具）"}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <button
                        onClick={() => setShowAdvanced((prev) => !prev)}
                        className="flex items-center gap-1 text-[10px] text-cad-muted hover:text-cad-text"
                    >
                        <span className="material-symbols-outlined text-[14px]">
                            {showAdvanced ? "expand_less" : "expand_more"}
                        </span>
                        高级：采样参数、工具白名单、技能
                    </button>

                    {showAdvanced && (
                        <div className="space-y-2 pl-2 border-l border-cad-border">
                            <div className="grid grid-cols-3 gap-2">
                                <label className="block">
                                    <span className={labelClass}>温度 0–2</span>
                                    <input
                                        type="number"
                                        step="0.1"
                                        min={0}
                                        max={2}
                                        value={form.temperature}
                                        onChange={(e) =>
                                            setForm({ ...form, temperature: e.target.value })
                                        }
                                        className={fieldClass}
                                        placeholder="模型默认"
                                    />
                                </label>
                                <label className="block">
                                    <span className={labelClass}>最大输出</span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={form.maxTokens}
                                        onChange={(e) =>
                                            setForm({ ...form, maxTokens: e.target.value })
                                        }
                                        className={fieldClass}
                                        placeholder="模型默认"
                                    />
                                </label>
                                <label className="block">
                                    <span className={labelClass}>工具轮次 0–12</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={12}
                                        value={form.maxToolRounds}
                                        onChange={(e) =>
                                            setForm({ ...form, maxToolRounds: e.target.value })
                                        }
                                        className={fieldClass}
                                    />
                                </label>
                            </div>
                            <div>
                                <span className={labelClass}>
                                    工具白名单（不选 = 全部可用）
                                </span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {SUPPORTED_AI_TOOL_NAMES.map((tool) => (
                                        <button
                                            key={tool}
                                            onClick={() => toggle("toolNames", tool)}
                                            className={`px-1.5 py-0.5 rounded border text-[10px] ${
                                                form.toolNames.includes(tool)
                                                    ? "border-cad-primary bg-cad-primary/15 text-cad-primary"
                                                    : "border-cad-border text-cad-muted hover:text-cad-text"
                                            }`}
                                        >
                                            {toolLabel(tool)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <span className={labelClass}>
                                    绑定技能（这些技能参与评分，其余仍可被规则命中）
                                </span>
                                <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                                    {enabledSkills.length === 0 && (
                                        <p className="text-[10px] text-cad-muted">
                                            没有启用的技能
                                        </p>
                                    )}
                                    {enabledSkills.map((skill) => (
                                        <label
                                            key={skill.id}
                                            className="flex items-center gap-2 text-[10px] text-cad-text"
                                            title={skill.description}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={form.skillIds.includes(skill.id)}
                                                onChange={() => toggle("skillIds", skill.id)}
                                                className="accent-[#137fec]"
                                            />
                                            <span className="truncate flex-1">{skill.name}</span>
                                            <span className="font-mono text-cad-muted">
                                                {skill.code}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 text-[11px] text-cad-text">
                            <input
                                type="checkbox"
                                checked={form.isActive}
                                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                                className="accent-[#137fec]"
                            />
                            启用
                        </label>
                        <label className="flex items-center gap-1.5 text-[11px] text-cad-text">
                            <input
                                type="checkbox"
                                checked={form.isPublic}
                                onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
                                className="accent-[#137fec]"
                            />
                            公开
                        </label>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={() => void save()}
                            className="flex-1 py-2 px-4 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors"
                        >
                            {editingId ? "保存助手" : "创建助手"}
                        </button>
                        <button
                            onClick={() => {
                                setForm(null);
                                setEditingId(null);
                            }}
                            className="flex-1 py-2 px-4 bg-cad-border/50 text-cad-text text-xs font-bold rounded hover:bg-cad-border/70 transition-colors"
                        >
                            取消
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {assistants.length === 0 && (
                        <p className="p-3 text-[11px] text-cad-muted">
                            还没有助手。助手决定系统提示词、模型、工具白名单与技能绑定。
                        </p>
                    )}
                    {assistants.map((assistant) => (
                        <div
                            key={assistant.id}
                            className={`p-3 rounded-lg border bg-cad-panel ${
                                assistant.isActive ? "border-cad-border" : "border-cad-border/50 opacity-60"
                            }`}
                        >
                            <div className="flex items-start gap-2">
                                <span
                                    className={`material-symbols-outlined text-[20px] ${assistant.color}`}
                                >
                                    {assistant.icon}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-bold text-cad-text truncate">
                                        {assistant.name}
                                    </p>
                                    <p className="text-[10px] text-cad-muted truncate">
                                        {assistant.description}
                                    </p>
                                    <p className="text-[10px] text-cad-muted font-mono truncate">
                                        {assistant.llmModel?.name ?? assistant.llmModelId ?? "默认模型"}
                                        {typeof assistant.maxToolRounds === "number"
                                            ? ` · ${assistant.maxToolRounds} 轮`
                                            : ""}
                                        {assistant.toolNames
                                            ? ` · ${assistant.toolNames.length} 个工具`
                                            : ""}
                                        {(assistant.skillIds?.length ?? 0) > 0
                                            ? ` · ${assistant.skillIds?.length} 个技能`
                                            : ""}
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        setEditingId(assistant.id);
                                        setHint(null);
                                        setForm(toForm(assistant));
                                    }}
                                    className="p-1 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                                    title="编辑"
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        edit
                                    </span>
                                </button>
                                <button
                                    onClick={() => {
                                        if (confirm(`删除助手 ${assistant.name}？`))
                                            void registry.removeAssistant(assistant.id);
                                    }}
                                    className="p-1 rounded text-cad-muted hover:text-red-500 hover:bg-red-500/10"
                                    title="删除"
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        delete
                                    </span>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AssistantsPanel;
