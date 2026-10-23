import React, { useMemo, useState } from "react";
import type { DesignConventions, DesignLayerRule, UnitType } from "../types";

interface DesignConventionsPanelProps {
    fileName?: string;
    conventions?: DesignConventions | null;
    onSave: (conventions: DesignConventions | null) => Promise<void> | void;
}

interface ConventionForm {
    standard: string;
    units: UnitType;
    textHeight: string;
    dimensionPrecision: string;
    layerRules: DesignLayerRule[];
    notes: string;
}

interface PanelStatus {
    kind: "error" | "hint";
    text: string;
}

const UNITS: UnitType[] = ["mm", "cm", "m", "in", "ft"];
const MAX_NOTES = 16;
const EMPTY_FORM: ConventionForm = {
    standard: "",
    units: "mm",
    textHeight: "3.5",
    dimensionPrecision: "2",
    layerRules: [],
    notes: "",
};

const toForm = (conventions: DesignConventions | null | undefined): ConventionForm =>
    conventions
        ? {
              standard: conventions.standard,
              units: conventions.units,
              textHeight: String(conventions.textHeight),
              dimensionPrecision: String(conventions.dimensionPrecision),
              layerRules: conventions.layerRules.map((rule) => ({ ...rule })),
              notes: conventions.notes.join("\n"),
          }
        : { ...EMPTY_FORM, layerRules: [] };

// 约定内容或图纸切换时重挂表单，避免在 effect 里同步 setState 触发级联渲染。
const formSignature = (fileName?: string, conventions?: DesignConventions | null): string =>
    `${fileName ?? ""}::${JSON.stringify(conventions ?? null)}`;

interface ConventionsFormProps {
    fileName?: string;
    conventions?: DesignConventions | null;
    onSave: (conventions: DesignConventions | null) => Promise<void> | void;
    onStatus: (status: PanelStatus | null) => void;
}

const ConventionsForm: React.FC<ConventionsFormProps> = ({
    fileName,
    conventions,
    onSave,
    onStatus,
}) => {
    const [form, setForm] = useState<ConventionForm>(() => toForm(conventions));
    const [saving, setSaving] = useState(false);

    const notes = useMemo(
        () =>
            form.notes
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
        [form.notes],
    );

    const updateRule = (index: number, next: DesignLayerRule) =>
        setForm((prev) => ({
            ...prev,
            layerRules: prev.layerRules.map((rule, item) => (item === index ? next : rule)),
        }));

    const handleSave = async () => {
        const textHeight = Number(form.textHeight);
        const dimensionPrecision = Number(form.dimensionPrecision);
        const rules = form.layerRules
            .map((rule) => ({
                name: rule.name.trim(),
                ...(rule.purpose?.trim() ? { purpose: rule.purpose.trim() } : {}),
            }))
            .filter((rule) => rule.name);

        if (form.standard.trim().length > 120) {
            onStatus({ kind: "error", text: "制图标准最多 120 个字符" });
            return;
        }
        if (!Number.isFinite(textHeight) || textHeight < 0.1 || textHeight > 10000) {
            onStatus({ kind: "error", text: "字高需在 0.1–10000 之间" });
            return;
        }
        if (
            !Number.isInteger(dimensionPrecision) ||
            dimensionPrecision < 0 ||
            dimensionPrecision > 8
        ) {
            onStatus({ kind: "error", text: "尺寸精度需为 0–8 的整数" });
            return;
        }
        if (new Set(rules.map((rule) => rule.name)).size !== rules.length) {
            onStatus({ kind: "error", text: "图层名称不能重复" });
            return;
        }
        if (rules.length > 24) {
            onStatus({ kind: "error", text: "最多配置 24 条图层规则" });
            return;
        }
        if (notes.length > MAX_NOTES) {
            onStatus({ kind: "error", text: `备注最多 ${MAX_NOTES} 条` });
            return;
        }
        if (notes.some((note) => note.length > 200)) {
            onStatus({ kind: "error", text: "单条备注最多 200 个字符" });
            return;
        }

        const next: DesignConventions = {
            standard: form.standard.trim(),
            units: form.units,
            textHeight,
            dimensionPrecision,
            layerRules: rules,
            notes,
        };
        const empty =
            !next.standard &&
            next.units === "mm" &&
            next.textHeight === 3.5 &&
            next.dimensionPrecision === 2 &&
            next.layerRules.length === 0 &&
            next.notes.length === 0;

        try {
            setSaving(true);
            await onSave(empty ? null : next);
            onStatus({ kind: "hint", text: "设计约定已保存，下一次 AI 请求会按此执行" });
        } catch (saveError) {
            onStatus({
                kind: "error",
                text: saveError instanceof Error ? saveError.message : "保存失败",
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <label className="block text-[10px] text-cad-muted">
                    制图标准
                    <input
                        aria-label="制图标准"
                        value={form.standard}
                        onChange={(event) =>
                            setForm((prev) => ({ ...prev, standard: event.target.value }))
                        }
                        placeholder="例如 GB/T 14689、ISO 128"
                        className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text focus:ring-1 focus:ring-cad-primary"
                    />
                </label>

                <div className="grid grid-cols-3 gap-2">
                    <label className="block text-[10px] text-cad-muted">
                        单位
                        <select
                            aria-label="约定单位"
                            value={form.units}
                            onChange={(event) =>
                                setForm((prev) => ({
                                    ...prev,
                                    units: event.target.value as UnitType,
                                }))
                            }
                            className="mt-0.5 w-full px-1.5 py-1 rounded border border-cad-border bg-cad-panel text-xs text-cad-text"
                        >
                            {UNITS.map((unit) => (
                                <option key={unit} value={unit}>
                                    {unit}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block text-[10px] text-cad-muted">
                        字高
                        <input
                            aria-label="建议字高"
                            type="number"
                            min={0.1}
                            max={10000}
                            step={0.1}
                            value={form.textHeight}
                            onChange={(event) =>
                                setForm((prev) => ({ ...prev, textHeight: event.target.value }))
                            }
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                        />
                    </label>
                    <label className="block text-[10px] text-cad-muted">
                        尺寸精度
                        <input
                            aria-label="尺寸精度"
                            type="number"
                            min={0}
                            max={8}
                            step={1}
                            value={form.dimensionPrecision}
                            onChange={(event) =>
                                setForm((prev) => ({
                                    ...prev,
                                    dimensionPrecision: event.target.value,
                                }))
                            }
                            className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                        />
                    </label>
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-cad-text">图层规则</span>
                        <button
                            onClick={() =>
                                setForm((prev) => ({
                                    ...prev,
                                    layerRules: [...prev.layerRules, { name: "", purpose: "" }],
                                }))
                            }
                            className="text-[10px] text-cad-primary hover:underline"
                        >
                            + 添加图层
                        </button>
                    </div>
                    {form.layerRules.length === 0 ? (
                        <p className="text-[10px] text-cad-muted">
                            未配置时由 AI 按任务自行命名图层；建议至少约定墙体、标注、辅助线。
                        </p>
                    ) : (
                        form.layerRules.map((rule, index) => (
                            <div key={`rule-${index}`} className="flex items-center gap-1">
                                <input
                                    aria-label={`图层 ${index + 1} 名称`}
                                    value={rule.name}
                                    onChange={(event) =>
                                        updateRule(index, { ...rule, name: event.target.value })
                                    }
                                    placeholder="图层名"
                                    className="w-24 px-1.5 py-1 rounded border border-cad-border bg-transparent text-[11px] text-cad-text"
                                />
                                <input
                                    aria-label={`图层 ${index + 1} 用途`}
                                    value={rule.purpose ?? ""}
                                    onChange={(event) =>
                                        updateRule(index, { ...rule, purpose: event.target.value })
                                    }
                                    placeholder="用途"
                                    className="min-w-0 flex-1 px-1.5 py-1 rounded border border-cad-border bg-transparent text-[11px] text-cad-text"
                                />
                                <button
                                    onClick={() =>
                                        setForm((prev) => ({
                                            ...prev,
                                            layerRules: prev.layerRules.filter(
                                                (_, item) => item !== index,
                                            ),
                                        }))
                                    }
                                    title="删除图层规则"
                                    className="p-0.5 text-cad-muted hover:text-red-500"
                                >
                                    <span className="material-symbols-outlined text-[15px]">
                                        delete
                                    </span>
                                </button>
                            </div>
                        ))
                    )}
                </div>

                <label className="block text-[10px] text-cad-muted">
                    备注（每行一条）
                    <textarea
                        aria-label="约定备注"
                        value={form.notes}
                        onChange={(event) =>
                            setForm((prev) => ({ ...prev, notes: event.target.value }))
                        }
                        rows={4}
                        placeholder={"门洞尺寸以现场复核为准\n标注统一放在图层 DIM"}
                        className="mt-0.5 w-full px-2 py-1.5 rounded border border-cad-border bg-transparent text-xs text-cad-text resize-y focus:ring-1 focus:ring-cad-primary"
                    />
                </label>
            </div>

            <div className="border-t border-cad-border bg-cad-panel p-2 flex items-center gap-1.5">
                <button
                    onClick={handleSave}
                    disabled={saving || !fileName}
                    className="flex-1 px-2 py-1.5 rounded bg-cad-primary text-white text-[11px] font-semibold disabled:opacity-40"
                >
                    {saving ? "保存中…" : "保存约定"}
                </button>
                <button
                    onClick={() => {
                        setForm(toForm(null));
                        void onSave(null);
                        onStatus({ kind: "hint", text: "已清空设计约定" });
                    }}
                    disabled={saving || !fileName || !conventions}
                    className="px-2 py-1.5 rounded border border-cad-border text-[11px] text-cad-muted hover:text-cad-text disabled:opacity-40"
                >
                    清空
                </button>
            </div>
        </>
    );
};

const DesignConventionsPanel: React.FC<DesignConventionsPanelProps> = ({
    fileName,
    conventions,
    onSave,
}) => {
    const [status, setStatus] = useState<PanelStatus | null>(null);

    return (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="px-3 py-2 border-b border-cad-border bg-cad-panel space-y-1">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-cad-text flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[18px] text-cad-primary">
                            design_services
                        </span>
                        设计约定
                    </h3>
                    <span className="text-[10px] text-cad-muted truncate max-w-[120px]">
                        {fileName ?? "未选择图纸"}
                    </span>
                </div>
                <p className="text-[10px] text-cad-muted">
                    约定随项目保存并注入 AI 系统提示词；不改变现有图元，只约束后续设计。
                </p>
            </div>

            {status && (
                <div
                    className={`px-3 py-1.5 text-[11px] border-b ${
                        status.kind === "error"
                            ? "border-red-500/40 bg-red-500/10 text-red-500"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    }`}
                >
                    {status.text}
                </div>
            )}

            <ConventionsForm
                key={formSignature(fileName, conventions)}
                fileName={fileName}
                conventions={conventions}
                onSave={onSave}
                onStatus={setStatus}
            />
        </div>
    );
};

export default DesignConventionsPanel;
