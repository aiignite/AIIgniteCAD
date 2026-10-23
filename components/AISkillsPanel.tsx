import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import type { AiSkill, SkillContextSignal, SkillInput, SkillStep } from "../types";
import type { UseAIRegistryResult } from "../hooks/useAIRegistry";
import { SUPPORTED_AI_TOOL_NAMES, type AIToolName } from "../lib/aiTools";
import { toolLabel } from "../lib/aiUi";
import {
    buildSkillExport,
    parseSkillImport,
    resolveImportCode,
    skillExportFileName,
    skillImportToInput,
    type SkillExportSkill,
} from "../lib/skillTransfer";
import {
    SKILL_CONTEXT_SIGNALS,
    SKILL_LIMITS,
    describeSkillIssue,
    validateSkillDraft,
    type SkillFieldIssue,
    type SkillFieldName,
} from "../lib/skillValidation";
import { apiService } from "../services/apiService";
import { getSkillStatsRevision, subscribeSkillStats } from "../store/skillStats";

const CONTEXT_SIGNAL_META: Record<SkillContextSignal, { label: string; hint: string }> = {
    selection: { label: "选择集", hint: "有选中图元时加分" },
    layers: { label: "多图层", hint: "存在非 0 图层时加分" },
    blocks: { label: "块引用", hint: "图中有块时加分" },
    revision: { label: "多次编辑", hint: "图纸已有提交历史时加分" },
    dimensions: { label: "尺寸标注", hint: "图中已有标注时加分" },
};

const CONTEXT_SIGNALS: Array<{ value: SkillContextSignal; label: string; hint: string }> =
    SKILL_CONTEXT_SIGNALS.map((value) => ({ value, ...CONTEXT_SIGNAL_META[value] }));

const emptyForm = {
    name: "",
    code: "",
    description: "",
    category: "custom",
    promptTemplate: "",
    keywords: "",
    negativeKeywords: "",
    requiredContext: [] as SkillContextSignal[],
    steps: "",
    checks: "",
    examples: "",
    toolNames: [] as string[],
    selectionTypes: "",
    priority: 50,
    isEnabled: true,
};

type SkillForm = typeof emptyForm;

const csv = (value: string): string[] =>
    value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

const lines = (value: string): string[] =>
    value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);

const stepLine = (step: SkillStep): string => {
    const parts = [step.title, step.detail ?? "", step.tool ?? ""];
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    return parts.join(" | ");
};

/** 步骤编辑格式：标题 | 说明 | 工具，后两段可省略 */
const parseStepLines = (value: string): SkillStep[] =>
    lines(value)
        .map((line) => {
            const [title, detail, tool] = line.split("|").map((part) => part.trim());
            return {
                title,
                ...(detail ? { detail } : {}),
                ...(tool ? { tool } : {}),
            };
        })
        .filter((step) => step.title.length > 0);

const toForm = (skill: AiSkill): SkillForm => ({
    name: skill.name,
    code: skill.code,
    description: skill.description,
    category: skill.category,
    promptTemplate: skill.promptTemplate,
    keywords: skill.keywords.join(", "),
    negativeKeywords: (skill.negativeKeywords ?? []).join(", "),
    requiredContext: skill.requiredContext ?? [],
    steps: (skill.steps ?? []).map(stepLine).join("\n"),
    checks: (skill.checks ?? []).join("\n"),
    examples: (skill.examples ?? []).join("\n"),
    toolNames: skill.toolNames,
    selectionTypes: skill.selectionTypes.join(", "),
    priority: skill.priority,
    isEnabled: skill.isEnabled,
});

const toInput = (form: SkillForm): SkillInput => ({
    name: form.name.trim(),
    description: form.description.trim(),
    category: form.category.trim() || "custom",
    promptTemplate: form.promptTemplate,
    keywords: csv(form.keywords),
    negativeKeywords: csv(form.negativeKeywords),
    requiredContext: form.requiredContext,
    steps: parseStepLines(form.steps),
    checks: lines(form.checks),
    examples: lines(form.examples),
    toolNames: form.toolNames,
    selectionTypes: csv(form.selectionTypes),
    priority: form.priority,
    isEnabled: form.isEnabled,
});

interface AISkillsPanelProps {
    registry: UseAIRegistryResult;
}

/** 每个技能的反馈与采纳统计 */
interface SkillStatRow {
    up: number;
    down: number;
    total: number;
    helpfulRate: number;
    applied: number;
    discarded: number;
    adoptionRate: number;
}

export const AISkillsPanel: React.FC<AISkillsPanelProps> = ({ registry }) => {
    const { skills, error, dismissError } = registry;
    const [query, setQuery] = useState("");
    const [form, setForm] = useState<SkillForm | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [hint, setHint] = useState<string | null>(null);
    const [issues, setIssues] = useState<SkillFieldIssue[]>([]);
    const [stats, setStats] = useState<Record<string, SkillStatRow>>({});
    const [pendingImport, setPendingImport] = useState<SkillExportSkill | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const loadStats = useCallback(() => {
        apiService
            .getSkillStats()
            .then(({ skills: rows }) => {
                setStats(
                    Object.fromEntries(
                        rows.map((row) => [
                            row.code,
                            {
                                up: row.up,
                                down: row.down,
                                total: row.total,
                                helpfulRate: row.helpfulRate,
                                applied: row.applied,
                                discarded: row.discarded,
                                adoptionRate: row.adoptionRate,
                            },
                        ]),
                    ),
                );
            })
            .catch(() => setStats({}));
    }, []);

    const statsRevision = useSyncExternalStore(subscribeSkillStats, getSkillStatsRevision);

    useEffect(() => {
        loadStats();
    }, [loadStats, skills.length, statsRevision]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return skills;
        return skills.filter(
            (skill) =>
                skill.name.toLowerCase().includes(needle) ||
                skill.code.toLowerCase().includes(needle) ||
                skill.category.toLowerCase().includes(needle) ||
                skill.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
        );
    }, [skills, query]);

    const save = async () => {
        if (!form) return;
        const payload =
            !editingId && form.code ? { ...toInput(form), code: form.code } : toInput(form);
        // 与导入路径同一套规则：先把问题定位到字段，而不是让后端整份 400
        const found = validateSkillDraft(payload);
        setIssues(found);
        if (found.length > 0) {
            setHint(`还有 ${found.length} 处问题：${describeSkillIssue(found[0])}`);
            return;
        }
        setHint(null);
        const ok = await registry.saveSkill(editingId, payload);
        if (ok) {
            openForm(null);
            setEditingId(null);
            setHint(`技能已${editingId ? "更新" : "创建"}`);
        }
    };

    /** 打开或关闭表单都要丢弃上一份草稿的字段问题，否则错误会挂在另一个技能上 */
    const openForm = (next: SkillForm | null) => {
        setIssues([]);
        setForm(next);
    };

    const fieldNote = (name: SkillFieldName) => {
        const message = issues.find((item) => item.field === name)?.error;
        return message ? (
            <span className="mt-0.5 block text-[10px] text-red-500">{message}</span>
        ) : null;
    };

    const toggleTool = (tool: AIToolName) => {
        if (!form) return;
        setForm({
            ...form,
            toolNames: form.toolNames.includes(tool)
                ? form.toolNames.filter((item) => item !== tool)
                : [...form.toolNames, tool],
        });
    };

    const toggleContext = (signal: SkillContextSignal) => {
        if (!form) return;
        setForm({
            ...form,
            requiredContext: form.requiredContext.includes(signal)
                ? form.requiredContext.filter((item) => item !== signal)
                : [...form.requiredContext, signal],
        });
    };

    const importCode = useMemo(
        () =>
            pendingImport
                ? resolveImportCode(
                      pendingImport.code || "imported-skill",
                      skills.map((skill) => skill.code),
                  )
                : "",
        [pendingImport, skills],
    );

    const onPickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (file.size > 256 * 1024) {
            setHint("技能文件过大，上限 256 KB");
            return;
        }
        let raw: unknown;
        try {
            raw = JSON.parse(await file.text());
        } catch {
            setHint("技能文件不是合法 JSON");
            return;
        }
        const parsed = parseSkillImport(raw);
        if (!parsed.ok) {
            setHint(`技能文件校验失败：${parsed.error}`);
            return;
        }
        setHint(null);
        setPendingImport(parsed.value);
    };

    const confirmImport = async () => {
        if (!pendingImport) return;
        const ok = await registry.saveSkill(null, skillImportToInput(pendingImport, importCode));
        if (ok) {
            setHint(`已导入技能 ${pendingImport.name}`);
            setPendingImport(null);
        }
    };

    const exportSkill = (skill: AiSkill) => {
        const blob = new Blob([JSON.stringify(buildSkillExport(skill), null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = skillExportFileName(skill);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setHint(`已导出技能 ${skill.name}`);
    };

    return (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="px-3 py-2 border-b border-cad-border bg-cad-panel space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-cad-text">技能</h3>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-2 py-1 rounded text-[11px] text-cad-primary hover:bg-cad-primary/10 border border-cad-primary/30"
                        >
                            导入
                        </button>
                        <button
                            onClick={() => {
                                setEditingId(null);
                                setHint(null);
                                openForm({ ...emptyForm });
                            }}
                            className="px-2 py-1 rounded text-[11px] text-cad-primary hover:bg-cad-primary/10 border border-cad-primary/30"
                        >
                            新建技能
                        </button>
                    </div>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => void onPickFile(e)}
                    className="hidden"
                    aria-label="导入技能文件"
                />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索名称 / 代码 / 关键词"
                    className="w-full px-2 py-1.5 rounded border border-cad-border bg-transparent text-xs text-cad-text focus:ring-1 focus:ring-cad-primary"
                />
                <p className="text-[10px] text-cad-muted">
                    规则路由按关键词、选择类型与优先级评分，命中后把提示词模板注入本轮 prompt。
                </p>
            </div>

            {(error || hint) && (
                <div
                    className={`flex items-start gap-2 px-3 py-1.5 text-[11px] border-b ${
                        error
                            ? "border-red-500/40 bg-red-500/10 text-red-500"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                    }`}
                >
                    <span className="min-w-0 break-words flex-1">
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

            {pendingImport && (
                <div className="p-3 space-y-2 border-b border-cad-border bg-cad-panel">
                    <p className="text-[11px] font-bold text-cad-text">导入预览</p>
                    <p className="text-[10px] text-cad-muted font-mono truncate">
                        {pendingImport.name} · {importCode} · {pendingImport.category} · P
                        {pendingImport.priority}
                    </p>
                    <p className="text-[10px] text-cad-muted line-clamp-3">
                        {pendingImport.promptTemplate}
                    </p>
                    <p className="text-[10px] text-cad-muted">
                        {pendingImport.toolNames.length} 个工具 · {pendingImport.steps.length} 步 ·{" "}
                        {pendingImport.keywords.length} 个关键词
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => void confirmImport()}
                            className="px-3 py-1.5 rounded text-[11px] bg-cad-primary text-white"
                        >
                            确认导入
                        </button>
                        <button
                            onClick={() => setPendingImport(null)}
                            className="px-3 py-1.5 rounded text-[11px] border border-cad-border text-cad-muted hover:text-cad-text"
                        >
                            取消
                        </button>
                    </div>
                </div>
            )}

            {form && (
                <div className="p-3 space-y-2 border-b border-cad-border bg-cad-panel overflow-y-auto max-h-[55%]">
                    <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] text-cad-muted">
                            名称
                            <input
                                aria-label="技能名称"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                            />
                            {fieldNote("name")}
                        </label>
                        <label className="text-[10px] text-cad-muted">
                            代码（留空自动生成）
                            <input
                                aria-label="技能代码"
                                value={form.code}
                                disabled={Boolean(editingId)}
                                onChange={(e) => setForm({ ...form, code: e.target.value })}
                                placeholder="gear-hobbing"
                                className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text disabled:opacity-50"
                            />
                            {fieldNote("code")}
                        </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] text-cad-muted">
                            分类
                            <input
                                aria-label="技能分类"
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                                className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                            />
                            {fieldNote("category")}
                        </label>
                        <label className="text-[10px] text-cad-muted">
                            优先级 0–{SKILL_LIMITS.priority}（越小越优先）
                            <input
                                aria-label="优先级"
                                type="number"
                                min={0}
                                max={SKILL_LIMITS.priority}
                                value={form.priority}
                                onChange={(e) =>
                                    setForm({ ...form, priority: Number(e.target.value) || 0 })
                                }
                                className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                            />
                            {fieldNote("priority")}
                        </label>
                    </div>
                    <label className="block text-[10px] text-cad-muted">
                        描述
                        <input
                            aria-label="技能描述"
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                        />
                        {fieldNote("description")}
                    </label>
                    <label className="block text-[10px] text-cad-muted">
                        提示词模板
                        <textarea
                            aria-label="提示词模板"
                            value={form.promptTemplate}
                            onChange={(e) => setForm({ ...form, promptTemplate: e.target.value })}
                            rows={5}
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text font-mono resize-y"
                        />
                        {fieldNote("promptTemplate")}
                    </label>
                    <label className="block text-[10px] text-cad-muted">
                        关键词（逗号分隔，命中即加分，最多 {SKILL_LIMITS.keywords} 个）
                        <input
                            aria-label="关键词"
                            value={form.keywords}
                            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                        />
                        {fieldNote("keywords")}
                    </label>
                    <label className="block text-[10px] text-cad-muted">
                        反关键词（逗号分隔，命中时降低评分，最多 {SKILL_LIMITS.negativeKeywords}{" "}
                        个）
                        <input
                            aria-label="反关键词"
                            value={form.negativeKeywords}
                            onChange={(e) => setForm({ ...form, negativeKeywords: e.target.value })}
                            placeholder="三维, 渲染"
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                        />
                        {fieldNote("negativeKeywords")}
                    </label>
                    <div className="text-[10px] text-cad-muted">
                        需要的设计上下文（命中时额外加分）
                        <div className="mt-1 flex flex-wrap gap-1">
                            {CONTEXT_SIGNALS.map((signal) => (
                                <button
                                    key={signal.value}
                                    onClick={() => toggleContext(signal.value)}
                                    title={signal.hint}
                                    className={`px-1.5 py-0.5 rounded border text-[10px] ${
                                        form.requiredContext.includes(signal.value)
                                            ? "border-cad-primary bg-cad-primary/15 text-cad-primary"
                                            : "border-cad-border text-cad-muted hover:text-cad-text"
                                    }`}
                                >
                                    {signal.label}
                                </button>
                            ))}
                        </div>
                        {fieldNote("requiredContext")}
                    </div>
                    <label className="block text-[10px] text-cad-muted">
                        执行步骤（每行一条，最多 {SKILL_LIMITS.steps} 条；格式：标题 | 说明 | 工具）
                        <textarea
                            aria-label="执行步骤"
                            value={form.steps}
                            onChange={(e) => setForm({ ...form, steps: e.target.value })}
                            rows={4}
                            placeholder={
                                "确定作用对象 | 优先使用 selectedIds，否则先查询 | query_elements\n执行变换 | 一次完成同类操作\n复核结果 | 用测量确认尺寸 | measure_geometry"
                            }
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text font-mono resize-y"
                        />
                        {fieldNote("steps")}
                    </label>
                    <label className="block text-[10px] text-cad-muted">
                        完成检查（每行一条，最多 {SKILL_LIMITS.checks} 条）
                        <textarea
                            aria-label="完成检查"
                            value={form.checks}
                            onChange={(e) => setForm({ ...form, checks: e.target.value })}
                            rows={3}
                            placeholder={"只修改了目标图元\n尺寸与用户要求一致"}
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text resize-y"
                        />
                        {fieldNote("checks")}
                    </label>
                    <label className="block text-[10px] text-cad-muted">
                        示例请求（每行一条，最多 {SKILL_LIMITS.examples} 条）
                        <textarea
                            aria-label="示例请求"
                            value={form.examples}
                            onChange={(e) => setForm({ ...form, examples: e.target.value })}
                            rows={2}
                            placeholder={"把选中的矩形向右移动 50\n按 3 行 4 列阵列这个圆"}
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text resize-y"
                        />
                        {fieldNote("examples")}
                    </label>
                    <label className="block text-[10px] text-cad-muted">
                        选择类型（逗号分隔，有对应选中图元时加分）
                        <input
                            aria-label="选择类型"
                            value={form.selectionTypes}
                            onChange={(e) => setForm({ ...form, selectionTypes: e.target.value })}
                            placeholder="CIRCLE, ARC"
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                        />
                        {fieldNote("selectionTypes")}
                    </label>
                    <div className="text-[10px] text-cad-muted">
                        技能工具白名单（留空表示不限制）
                        <div className="mt-1 flex flex-wrap gap-1">
                            {SUPPORTED_AI_TOOL_NAMES.map((tool) => (
                                <button
                                    key={tool}
                                    onClick={() => toggleTool(tool)}
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
                        {fieldNote("toolNames")}
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-cad-text">
                        <input
                            type="checkbox"
                            checked={form.isEnabled}
                            onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                            className="accent-[#137fec]"
                        />
                        启用
                    </label>
                    <div className="flex gap-2">
                        <button
                            onClick={() => void save()}
                            className="px-3 py-1.5 rounded text-[11px] bg-cad-primary text-white"
                        >
                            {editingId ? "保存" : "创建"}
                        </button>
                        <button
                            onClick={() => {
                                openForm(null);
                                setEditingId(null);
                            }}
                            className="px-3 py-1.5 rounded text-[11px] border border-cad-border text-cad-muted hover:text-cad-text"
                        >
                            取消
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {visible.length === 0 && (
                    <p className="text-[11px] text-cad-muted">
                        没有匹配的技能。系统技能在首次访问时自动播种。
                    </p>
                )}
                {visible.map((skill) => (
                    <div
                        key={skill.id}
                        className={`p-2 rounded-lg border bg-white dark:bg-[#1e293b] ${
                            skill.isEnabled
                                ? "border-cad-border"
                                : "border-cad-border/50 opacity-60"
                        }`}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-xs font-bold text-cad-text truncate">
                                    {skill.name}
                                    {skill.isSystem && (
                                        <span className="ml-1 text-[10px] px-1 rounded bg-cad-primary/20 text-cad-primary align-middle">
                                            系统
                                        </span>
                                    )}
                                </p>
                                <p className="text-[10px] text-cad-muted font-mono truncate">
                                    {skill.code} · {skill.category} · P{skill.priority} · v
                                    {skill.version ?? 1}
                                    {stats[skill.code]?.total
                                        ? ` · 有用 ${Math.round(
                                              stats[skill.code].helpfulRate * 100,
                                          )}%（${stats[skill.code].total}）`
                                        : ""}
                                    {stats[skill.code]?.applied || stats[skill.code]?.discarded
                                        ? ` · 采纳 ${Math.round(
                                              stats[skill.code].adoptionRate * 100,
                                          )}%（${stats[skill.code].applied}/${
                                              stats[skill.code].applied +
                                              stats[skill.code].discarded
                                          }）`
                                        : ""}
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                checked={skill.isEnabled}
                                disabled={skill.isSystem}
                                onChange={(e) =>
                                    void registry.toggleSkill(skill.id, e.target.checked)
                                }
                                title={skill.isSystem ? "系统技能只读，克隆后可修改" : "启用/停用"}
                                className="mt-0.5 accent-[#137fec] disabled:opacity-40"
                            />
                        </div>
                        {skill.description && (
                            <p className="mt-1 text-[10px] text-cad-muted line-clamp-2">
                                {skill.description}
                            </p>
                        )}
                        {skill.keywords.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                                {skill.keywords.slice(0, 8).map((keyword) => (
                                    <span
                                        key={keyword}
                                        className="px-1 rounded bg-cad-text/10 text-[10px] text-cad-muted"
                                    >
                                        {keyword}
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-1">
                            <button
                                onClick={() => {
                                    setEditingId(skill.id);
                                    setHint(null);
                                    openForm(toForm(skill));
                                }}
                                disabled={skill.isSystem}
                                className="px-1.5 py-0.5 rounded text-[10px] border border-cad-border text-cad-muted hover:text-cad-text disabled:opacity-40"
                                title={skill.isSystem ? "系统技能只读" : undefined}
                            >
                                编辑
                            </button>
                            <button
                                onClick={() => void registry.cloneSkill(skill.id)}
                                className="px-1.5 py-0.5 rounded text-[10px] border border-cad-border text-cad-muted hover:text-cad-text"
                            >
                                克隆
                            </button>
                            <button
                                onClick={() => exportSkill(skill)}
                                className="px-1.5 py-0.5 rounded text-[10px] border border-cad-border text-cad-muted hover:text-cad-text"
                                title="导出为 JSON 文件"
                            >
                                导出
                            </button>
                            {!skill.isSystem && (
                                <button
                                    onClick={() => {
                                        if (confirm(`删除技能 ${skill.name}？`))
                                            void registry.removeSkill(skill.id);
                                    }}
                                    className="px-1.5 py-0.5 rounded text-[10px] border border-red-500/40 text-red-500 hover:bg-red-500/10"
                                >
                                    删除
                                </button>
                            )}
                            {(skill.steps?.length ?? 0) > 0 && (
                                <span className="text-[10px] text-cad-muted">
                                    {skill.steps.length} 步
                                </span>
                            )}
                            {skill.toolNames.length > 0 && (
                                <span className="ml-auto text-[10px] text-cad-muted truncate">
                                    {skill.toolNames.length} 个工具
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AISkillsPanel;
