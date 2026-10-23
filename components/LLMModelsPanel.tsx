import React, { useEffect, useState } from "react";
import type { AIUsageSummary, LLMModel, LLMModelInput } from "../types";
import { apiService } from "../services/apiService";
import type { UseAIRegistryResult, ModelTestResult } from "../hooks/useAIRegistry";
import { formatCostUsd, formatLatency, formatPercent, formatTokens } from "../lib/aiUi";

const PROVIDERS: LLMModel["provider"][] = ["Google", "Anthropic", "OpenAI", "Ollama"];

interface ModelForm {
    name: string;
    provider: LLMModel["provider"];
    modelId: string;
    apiKey: string;
    apiUrl: string;
    isActive: boolean;
    supportsTools: boolean;
    contextWindow: string;
    maxOutputTokens: string;
    temperature: string;
    topP: string;
    timeoutSeconds: string;
    promptPricePer1k: string;
    completionPricePer1k: string;
}

const emptyForm: ModelForm = {
    name: "",
    provider: "Google",
    modelId: "",
    apiKey: "",
    apiUrl: "",
    isActive: true,
    supportsTools: true,
    contextWindow: "",
    maxOutputTokens: "",
    temperature: "",
    topP: "",
    timeoutSeconds: "",
    promptPricePer1k: "",
    completionPricePer1k: "",
};

/** 空串表示"未设置"，服务端按 nullable 字段沿用默认值 */
const numOr = (value: string): number | null => {
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
};

const text = (value: number | null | undefined): string =>
    value === null || value === undefined ? "" : String(value);

const toForm = (model: LLMModel): ModelForm => ({
    ...emptyForm,
    name: model.name,
    provider: model.provider,
    modelId: model.modelId || "",
    apiUrl: model.configuration?.apiUrl || "",
    isActive: model.isActive,
    supportsTools: model.supportsTools ?? true,
    contextWindow: text(model.contextWindow),
    maxOutputTokens: text(model.maxOutputTokens),
    temperature: text(model.temperature),
    topP: text(model.topP),
    timeoutSeconds: text(model.timeoutSeconds),
    promptPricePer1k: text(model.promptPricePer1k),
    completionPricePer1k: text(model.completionPricePer1k),
});

const toInput = (form: ModelForm): LLMModelInput => ({
    name: form.name.trim(),
    provider: form.provider,
    modelId: form.modelId.trim(),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    isActive: form.isActive,
    supportsTools: form.supportsTools,
    contextWindow: numOr(form.contextWindow) ?? 32000,
    maxOutputTokens: numOr(form.maxOutputTokens),
    temperature: numOr(form.temperature),
    topP: numOr(form.topP),
    timeoutSeconds: numOr(form.timeoutSeconds) ?? 60,
    promptPricePer1k: numOr(form.promptPricePer1k),
    completionPricePer1k: numOr(form.completionPricePer1k),
    configuration: { apiUrl: form.apiUrl.trim() || null },
});

const fieldClass =
    "w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text";
const labelClass = "text-[10px] text-cad-muted font-medium";

interface LLMModelsPanelProps {
    registry: UseAIRegistryResult;
}

export const LLMModelsPanel: React.FC<LLMModelsPanelProps> = ({ registry }) => {
    const { models, error, dismissError } = registry;
    const [form, setForm] = useState<ModelForm | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [hint, setHint] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, ModelTestResult>>({});
    const [usage, setUsage] = useState<AIUsageSummary | null>(null);
    const [usageNonce, setUsageNonce] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const summary = await apiService.getAIUsage(30);
                if (!cancelled) setUsage(summary);
            } catch {
                if (!cancelled) setUsage(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [usageNonce]);

    const save = async () => {
        if (!form) return;
        if (!form.name.trim() || !form.modelId.trim()) {
            setHint("名称与 Model ID 必填");
            return;
        }
        const ok = await registry.saveModel(editingId, toInput(form));
        if (ok) {
            setForm(null);
            setEditingId(null);
            setHint(null);
            setUsageNonce((prev) => prev + 1);
        }
    };

    const runTest = async (id: string) => {
        setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: "测试中…" } }));
        const result = await registry.testModel(id);
        setTestResults((prev) => ({
            ...prev,
            [id]: result ?? { ok: false, message: "测试失败" },
        }));
    };

    return (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="flex items-center justify-between p-3 border-b border-cad-border bg-cad-panel">
                <h3 className="text-sm font-bold text-cad-text">模型注册表</h3>
                <button
                    onClick={() => {
                        setEditingId(null);
                        setHint(null);
                        setForm({ ...emptyForm });
                    }}
                    className="flex items-center justify-center size-7 rounded hover:bg-cad-text/10 text-cad-muted hover:text-cad-text transition-colors"
                    title="添加模型"
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

            {usage && (
                <div className="px-3 py-2 border-b border-cad-border bg-cad-panel/60 space-y-1">
                    <p className="text-[10px] text-cad-muted font-bold uppercase tracking-wide">
                        近 {usage.days} 天用量
                    </p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-cad-text font-mono">
                        <span>调用 {usage.calls}</span>
                        <span>
                            失败 {usage.failures}（{formatPercent(usage.failureRate)}）
                        </span>
                        <span>输入 {formatTokens(usage.promptTokens)}</span>
                        <span>输出 {formatTokens(usage.completionTokens)}</span>
                        <span>成本 {formatCostUsd(usage.costUsd)}</span>
                        <span>均延 {formatLatency(usage.avgLatencyMs)}</span>
                    </div>
                    {usage.byProvider.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                            {usage.byProvider.map((item) => (
                                <span
                                    key={item.provider}
                                    className="px-1.5 py-0.5 rounded bg-cad-text/10 text-[10px] text-cad-muted"
                                    title={`${item.calls} 次调用 · ${item.failures} 次失败`}
                                >
                                    {item.provider} · {item.calls}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {form ? (
                <div className="flex-1 p-3 space-y-2 bg-cad-panel overflow-y-auto">
                    <h4 className="text-xs font-bold text-cad-text">
                        {editingId ? "编辑模型" : "添加模型"}
                    </h4>
                    <label className="block">
                        <span className={labelClass}>名称</span>
                        <input
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className={fieldClass}
                            placeholder="GLM-4.7"
                        />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className={labelClass}>Provider</span>
                            <select
                                value={form.provider}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        provider: e.target.value as LLMModel["provider"],
                                    })
                                }
                                className={fieldClass}
                            >
                                {PROVIDERS.map((provider) => (
                                    <option key={provider} value={provider}>
                                        {provider}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className={labelClass}>Model ID</span>
                            <input
                                value={form.modelId}
                                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                                className={fieldClass}
                                placeholder="glm-4.7"
                            />
                        </label>
                    </div>
                    <label className="block">
                        <span className={labelClass}>
                            API Key{editingId ? "（留空保持不变）" : ""}
                        </span>
                        <input
                            type="password"
                            value={form.apiKey}
                            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                            className={fieldClass}
                            placeholder="••••••••••••"
                            autoComplete="off"
                        />
                    </label>
                    <label className="block">
                        <span className={labelClass}>API URL（自建网关 / 内网服务 / Ollama）</span>
                        <input
                            value={form.apiUrl}
                            onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
                            className={fieldClass}
                            placeholder="https://…/v1 或 http://192.168.1.20:3000/v1"
                        />
                        <span className="mt-1 block text-[10px] leading-snug text-cad-muted">
                            内网 HTTP 端点需服务端开启 AI_ALLOW_PRIVATE_ENDPOINTS；使用内网域名时还需加入
                            AI_ALLOWED_ENDPOINTS。
                        </span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className={labelClass}>上下文窗口</span>
                            <input
                                type="number"
                                min={512}
                                value={form.contextWindow}
                                onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
                                className={fieldClass}
                                placeholder="32000"
                            />
                        </label>
                        <label className="block">
                            <span className={labelClass}>最大输出 token</span>
                            <input
                                type="number"
                                min={1}
                                value={form.maxOutputTokens}
                                onChange={(e) =>
                                    setForm({ ...form, maxOutputTokens: e.target.value })
                                }
                                className={fieldClass}
                                placeholder="8192"
                            />
                        </label>
                        <label className="block">
                            <span className={labelClass}>温度 0–2</span>
                            <input
                                type="number"
                                step="0.1"
                                min={0}
                                max={2}
                                value={form.temperature}
                                onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                                className={fieldClass}
                            />
                        </label>
                        <label className="block">
                            <span className={labelClass}>Top P 0–1</span>
                            <input
                                type="number"
                                step="0.05"
                                min={0}
                                max={1}
                                value={form.topP}
                                onChange={(e) => setForm({ ...form, topP: e.target.value })}
                                className={fieldClass}
                            />
                        </label>
                        <label className="block">
                            <span className={labelClass}>超时（秒）5–600</span>
                            <input
                                type="number"
                                min={5}
                                max={600}
                                value={form.timeoutSeconds}
                                onChange={(e) =>
                                    setForm({ ...form, timeoutSeconds: e.target.value })
                                }
                                className={fieldClass}
                                placeholder="60"
                            />
                        </label>
                        <label className="block">
                            <span className={labelClass}>输入 $/1k</span>
                            <input
                                type="number"
                                step="0.0001"
                                min={0}
                                value={form.promptPricePer1k}
                                onChange={(e) =>
                                    setForm({ ...form, promptPricePer1k: e.target.value })
                                }
                                className={fieldClass}
                            />
                        </label>
                        <label className="block">
                            <span className={labelClass}>输出 $/1k</span>
                            <input
                                type="number"
                                step="0.0001"
                                min={0}
                                value={form.completionPricePer1k}
                                onChange={(e) =>
                                    setForm({ ...form, completionPricePer1k: e.target.value })
                                }
                                className={fieldClass}
                            />
                        </label>
                    </div>
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
                                checked={form.supportsTools}
                                onChange={(e) =>
                                    setForm({ ...form, supportsTools: e.target.checked })
                                }
                                className="accent-[#137fec]"
                            />
                            支持 Function Calling
                        </label>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={() => void save()}
                            className="flex-1 py-2 px-4 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors"
                        >
                            {editingId ? "保存模型" : "添加模型"}
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
                    {models.length === 0 && (
                        <p className="p-3 text-[11px] text-cad-muted">
                            还没有模型。添加后 AI 助手才能工作；未设默认时按"助手绑定 → 默认 →
                            最早启用"的顺序解析。
                        </p>
                    )}
                    {models.map((model) => {
                        const test = testResults[model.id];
                        return (
                            <div
                                key={model.id}
                                className="p-3 rounded-lg border border-cad-border bg-cad-panel"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-2 min-w-0">
                                        <span
                                            className={`mt-1 size-2 rounded-full shrink-0 ${
                                                model.isActive
                                                    ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                                                    : "bg-gray-600"
                                            }`}
                                        />
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-cad-text truncate">
                                                {model.name}
                                                {model.isDefault && (
                                                    <span className="ml-1 text-[10px] px-1 rounded bg-cad-primary/20 text-cad-primary align-middle">
                                                        默认
                                                    </span>
                                                )}
                                                {!model.supportsTools && (
                                                    <span
                                                        className="ml-1 text-[10px] px-1 rounded bg-cad-text/10 text-cad-muted align-middle"
                                                        title="该模型不会收到工具定义，AI 只能文本回复"
                                                    >
                                                        无工具
                                                    </span>
                                                )}
                                            </p>
                                            <p className="text-[10px] text-cad-muted truncate">
                                                {model.provider} · {model.modelId}
                                            </p>
                                            <p className="text-[10px] text-cad-muted font-mono truncate">
                                                ctx {formatTokens(model.contextWindow)} ·{" "}
                                                {model.hasApiKey
                                                    ? `key ${model.apiKeyPreview || "已配置"}`
                                                    : "未配置 Key"}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setEditingId(model.id);
                                            setHint(null);
                                            setForm(toForm(model));
                                        }}
                                        className="p-1 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                                        title="编辑"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            edit
                                        </span>
                                    </button>
                                </div>

                                {test && (
                                    <p
                                        className={`mt-1.5 text-[10px] ${
                                            test.ok ? "text-emerald-500" : "text-red-500"
                                        }`}
                                    >
                                        {test.ok
                                            ? `连通正常 · ${formatLatency(test.latencyMs)}`
                                            : `失败：${test.message ?? "未知错误"}`}
                                    </p>
                                )}

                                <div className="mt-2 flex flex-wrap items-center gap-1">
                                    <button
                                        onClick={() => void runTest(model.id)}
                                        disabled={!model.isActive}
                                        className="px-1.5 py-0.5 rounded text-[10px] border border-cad-border text-cad-muted hover:text-cad-text disabled:opacity-40"
                                    >
                                        测试连接
                                    </button>
                                    {!model.isDefault && (
                                        <button
                                            onClick={() => void registry.markDefaultModel(model.id)}
                                            className="px-1.5 py-0.5 rounded text-[10px] border border-cad-border text-cad-muted hover:text-cad-text"
                                            title="故障转移链的起点"
                                        >
                                            设为默认
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (confirm(`删除模型 ${model.name}？`))
                                                void registry.removeModel(model.id);
                                        }}
                                        className="px-1.5 py-0.5 rounded text-[10px] border border-red-500/40 text-red-500 hover:bg-red-500/10"
                                    >
                                        删除
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default LLMModelsPanel;
