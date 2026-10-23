import React, { useMemo, useState } from "react";
import type { DesignConventions, DesignLayerRule, UnitType } from "../types";
import { useI18n } from "../lib/i18n";

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
    const { t } = useI18n();
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
            onStatus({ kind: "error", text: t("conventions.error.standard") });
            return;
        }
        if (!Number.isFinite(textHeight) || textHeight < 0.1 || textHeight > 10000) {
            onStatus({ kind: "error", text: t("conventions.error.textHeight") });
            return;
        }
        if (
            !Number.isInteger(dimensionPrecision) ||
            dimensionPrecision < 0 ||
            dimensionPrecision > 8
        ) {
            onStatus({ kind: "error", text: t("conventions.error.precision") });
            return;
        }
        if (new Set(rules.map((rule) => rule.name)).size !== rules.length) {
            onStatus({ kind: "error", text: t("conventions.error.duplicate") });
            return;
        }
        if (rules.length > 24) {
            onStatus({ kind: "error", text: t("conventions.error.tooManyRules") });
            return;
        }
        if (notes.length > MAX_NOTES) {
            onStatus({
                kind: "error",
                text: t("conventions.error.tooManyNotes", { max: MAX_NOTES }),
            });
            return;
        }
        if (notes.some((note) => note.length > 200)) {
            onStatus({ kind: "error", text: t("conventions.error.noteLength") });
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
            onStatus({ kind: "hint", text: t("conventions.saved") });
        } catch (saveError) {
            onStatus({
                kind: "error",
                text: saveError instanceof Error ? saveError.message : t("conventions.saveFailed"),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <label className="block text-[10px] text-cad-muted">
                    {t("conventions.standard")}
                    <input
                        aria-label={t("conventions.standard")}
                        value={form.standard}
                        onChange={(event) =>
                            setForm((prev) => ({ ...prev, standard: event.target.value }))
                        }
                        placeholder={t("conventions.standardPlaceholder")}
                        className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text focus:ring-1 focus:ring-cad-primary"
                    />
                </label>

                <div className="grid grid-cols-3 gap-2">
                    <label className="block text-[10px] text-cad-muted">
                        {t("conventions.units")}
                        <select
                            aria-label={t("conventions.unitsAria")}
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
                        {t("conventions.textHeight")}
                        <input
                            aria-label={t("conventions.textHeightAria")}
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
                        {t("conventions.precision")}
                        <input
                            aria-label={t("conventions.precisionAria")}
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
                        <span className="text-[10px] font-semibold text-cad-text">
                            {t("conventions.layerRules")}
                        </span>
                        <button
                            onClick={() =>
                                setForm((prev) => ({
                                    ...prev,
                                    layerRules: [...prev.layerRules, { name: "", purpose: "" }],
                                }))
                            }
                            className="text-[10px] text-cad-primary hover:underline"
                        >
                            {t("conventions.addLayer")}
                        </button>
                    </div>
                    {form.layerRules.length === 0 ? (
                        <p className="text-[10px] text-cad-muted">
                            {t("conventions.noRules")}
                        </p>
                    ) : (
                        form.layerRules.map((rule, index) => (
                            <div key={`rule-${index}`} className="flex items-center gap-1">
                                <input
                                    aria-label={t("conventions.layerNameAria", { index: index + 1 })}
                                    value={rule.name}
                                    onChange={(event) =>
                                        updateRule(index, { ...rule, name: event.target.value })
                                    }
                                    placeholder={t("conventions.layerName")}
                                    className="w-24 px-1.5 py-1 rounded border border-cad-border bg-transparent text-[11px] text-cad-text"
                                />
                                <input
                                    aria-label={t("conventions.layerPurposeAria", {
                                        index: index + 1,
                                    })}
                                    value={rule.purpose ?? ""}
                                    onChange={(event) =>
                                        updateRule(index, { ...rule, purpose: event.target.value })
                                    }
                                    placeholder={t("conventions.layerPurpose")}
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
                                    title={t("conventions.deleteRule")}
                                    className="p-0.5 text-cad-muted hover:text-red-500"
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        delete
                                    </span>
                                </button>
                            </div>
                        ))
                    )}
                </div>

                <label className="block text-[10px] text-cad-muted">
                    {t("conventions.notes")}
                    <textarea
                        aria-label={t("conventions.notesAria")}
                        value={form.notes}
                        onChange={(event) =>
                            setForm((prev) => ({ ...prev, notes: event.target.value }))
                        }
                        rows={4}
                        placeholder={t("conventions.notesPlaceholder")}
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
                    {saving ? t("conventions.saving") : t("conventions.save")}
                </button>
                <button
                    onClick={() => {
                        setForm(toForm(null));
                        void onSave(null);
                        onStatus({ kind: "hint", text: t("conventions.cleared") });
                    }}
                    disabled={saving || !fileName || !conventions}
                    className="px-2 py-1.5 rounded border border-cad-border text-[11px] text-cad-muted hover:text-cad-text disabled:opacity-40"
                >
                    {t("common.clear")}
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
    const { t } = useI18n();
    const [status, setStatus] = useState<PanelStatus | null>(null);

    return (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="px-3 py-2 border-b border-cad-border bg-cad-panel space-y-1">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-cad-text flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[18px] text-cad-primary">
                            design_services
                        </span>
                         {t("conventions.title")}
                    </h3>
                    <span className="text-[10px] text-cad-muted truncate max-w-[120px]">
                        {fileName ?? t("conventions.noFile")}
                    </span>
                </div>
                <p className="text-[10px] text-cad-muted">
                    {t("conventions.description")}
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
