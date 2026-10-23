/**
 * QuickSelectModal.tsx — 快速选择弹窗
 *
 * 按类型 / 图层 / 颜色过滤当前可显示图元，实时预览命中数量；
 * 确认后由调用方把命中 id 写入选择集。
 */

import React, { useMemo, useState } from "react";
import type { CADElement } from "../types";
import { useI18n, type TranslationKey, type Translate } from "../lib/i18n";
import {
    EMPTY_QUICK_SELECT_FILTER,
    filterQuickSelect,
    quickSelectFacets,
    toggleQuickSelectValue,
    type QuickSelectFacetValue,
    type QuickSelectFilter,
} from "../lib/quickSelect";

interface QuickSelectModalProps {
    /** 参与筛选的图元（调用方只传可显示的图元） */
    elements: CADElement[];
    /** 确认回调：参数为命中的图元 id */
    onConfirm: (ids: string[]) => void;
    /** 取消回调 */
    onCancel: () => void;
}

/** 图元类型对应的界面文案 */
const TYPE_LABEL_KEYS: Record<string, TranslationKey> = {
    LINE: "toolbar.line",
    CIRCLE: "toolbar.circle",
    RECTANGLE: "toolbar.rectangle",
    LWPOLYLINE: "toolbar.polyline",
    TEXT: "toolbar.text",
    DIMENSION: "toolbar.dimension",
    ARC: "toolbar.arc",
    BLOCK_REFERENCE: "common.element.blockReference",
    ELLIPSE: "toolbar.ellipse",
    GEAR: "toolbar.gear",
    SPIRAL: "toolbar.spiral",
    SPRING: "toolbar.spring",
    HATCH: "toolbar.hatch",
};

const typeLabel = (type: string, t: Translate): string => {
    const key = TYPE_LABEL_KEYS[type];
    return key ? t(key) : type;
};

export const QuickSelectModal: React.FC<QuickSelectModalProps> = ({
    elements,
    onConfirm,
    onCancel,
}) => {
    const { t } = useI18n();
    const [filter, setFilter] = useState<QuickSelectFilter>(EMPTY_QUICK_SELECT_FILTER);

    const facets = useMemo(() => quickSelectFacets(elements, filter), [elements, filter]);
    const matched = useMemo(() => filterQuickSelect(elements, filter), [elements, filter]);

    const toggle = (dimension: keyof QuickSelectFilter, value: string) => {
        setFilter((previous) => ({
            ...previous,
            [dimension]: toggleQuickSelectValue(previous[dimension], value),
        }));
    };

    const renderRow = (
        label: string,
        dimension: keyof QuickSelectFilter,
        values: QuickSelectFacetValue[],
        renderLabel: (value: string) => React.ReactNode,
    ) => (
        <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-cad-muted">{label}</span>
                <button
                    type="button"
                    data-action={`clear-${dimension}`}
                    onClick={() =>
                        setFilter((previous) => ({ ...previous, [dimension]: [] }))
                    }
                    className="text-[10px] text-cad-muted hover:text-cad-text"
                >
                    {t("common.any")}
                </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {values.length === 0 && (
                    <span className="text-[11px] text-cad-muted">{t("quickSelect.empty")}</span>
                )}
                {values.map((item) => {
                    const active = filter[dimension].includes(item.value);
                    return (
                        <button
                            type="button"
                            key={item.value}
                            data-value={item.value}
                            onClick={() => toggle(dimension, item.value)}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border transition-colors ${
                                active
                                    ? "bg-cad-primary/10 border-cad-primary/40 text-cad-primary"
                                    : "border-cad-border text-cad-text hover:bg-cad-text/5"
                            }`}
                        >
                            {renderLabel(item.value)}
                            <span className="text-[10px] opacity-60">{item.count}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
            <div
                data-action="quick-select-modal"
                className="bg-cad-panel border border-cad-border p-4 rounded-lg shadow-xl w-96 animate-in zoom-in-95 duration-200"
            >
                <h3 className="text-sm font-bold mb-1">{t("quickSelect.title")}</h3>
                <p className="text-[11px] text-cad-muted mb-4">{t("quickSelect.hint")}</p>

                {renderRow(t("quickSelect.type"), "types", facets.types, (value) => (
                    <span>{typeLabel(value, t)}</span>
                ))}
                {renderRow(t("quickSelect.layer"), "layers", facets.layers, (value) => (
                    <span>{value}</span>
                ))}
                {renderRow(
                    t("quickSelect.color"),
                    "colors",
                    facets.colors,
                    (value) => (
                        <>
                            <span
                                className="size-2.5 rounded-sm border border-cad-border"
                                style={{ backgroundColor: value }}
                            />
                            <span>{value}</span>
                        </>
                    ),
                )}

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-cad-border">
                    <span
                        data-action="quick-select-count"
                        className="text-xs text-cad-muted"
                    >
                        {t("quickSelect.result", { count: matched.length })}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-3 py-1.5 text-xs text-cad-muted hover:bg-cad-border/50 rounded"
                        >
                            {t("common.cancel")}
                        </button>
                        <button
                            type="button"
                            data-action="quick-select-apply"
                            onClick={() => onConfirm(matched.map((element) => element.id))}
                            disabled={matched.length === 0}
                            className="px-3 py-1.5 text-xs bg-cad-primary text-white rounded hover:bg-cad-primaryHover disabled:opacity-40 disabled:hover:bg-cad-primary"
                        >
                            {t("common.select")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
