/**
 * RightPanel.tsx — 右侧属性面板
 *
 * 常规布局：常驻右侧、可折叠的属性检查器（属性 / 结构两个页签）。
 * 图块库在左侧工具面板，图纸检查 / 设计约定分别收进满屏窗体与设置页，
 * 本面板只承担「看选中、改属性」这一件事。
 */

import React, { useState } from "react";
import { CADElement } from "../types";
import PropertyInspector from "./PropertyInspector";
import { useCanvas } from "../store/canvasStore";
import { useApp } from "../store/appStore";
import { useI18n } from "../lib/i18n";

interface RightPanelProps {
    currentElements: CADElement[];
    onUpdateElement: (el: CADElement) => void;
    onApplyAIAction: (operation: string, elements?: CADElement[], params?: any) => void;
    /** 右侧面板是否展开；收起时不渲染，把画布面积让给绘图 */
    collapsed?: boolean;
}

export const RightPanel: React.FC<RightPanelProps> = ({
    currentElements,
    onUpdateElement,
    onApplyAIAction,
    collapsed = false,
}) => {
    const { t } = useI18n();
    const { setSidePanelOpen } = useApp();
    // 图层可见性 / 锁定状态由画布 Store 统一维护，渲染与命中测试都依赖它
    const { selectedIds, toggleSelection } = useCanvas();

    const [propTab, setPropTab] = useState<"INSPECTOR" | "STRUCTURE">("INSPECTOR");

    const handleToggleElementSelection = (elementId: string) => {
        toggleSelection(elementId);
    };

    // 收起时不渲染整块面板，把画布面积完全让给绘图
    if (collapsed) return null;

    return (
        <div className="relative group flex h-full w-64 shrink-0 z-20 shadow-xl shadow-black/10 dark:shadow-black/50 border-l border-cad-border bg-cad-panel flex-col">
            {/* 收起把手：悬停面板时浮现 */}
            <button
                data-action="collapse-side-panel"
                onClick={() => setSidePanelOpen(false)}
                title={t("panel.collapse")}
                aria-label={t("panel.collapse")}
                className="absolute -left-3 top-1/2 z-30 flex h-12 w-6 -translate-y-1/2 items-center justify-center rounded-l border border-r-0 border-cad-border bg-cad-panel text-cad-muted opacity-0 shadow transition-opacity group-hover:opacity-100 hover:text-cad-text"
            >
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>

            <div className="flex border-b border-cad-border bg-cad-panel">
                <button
                    onClick={() => setPropTab("INSPECTOR")}
                    className={`flex-1 py-2.5 text-xs font-bold transition-colors border-b-2 ${propTab === "INSPECTOR" ? "text-cad-primary border-cad-primary bg-cad-primary/10" : "text-cad-muted border-transparent hover:text-cad-text"}`}
                >
                    {t("panel.inspector")}
                </button>
                <button
                    onClick={() => setPropTab("STRUCTURE")}
                    className={`flex-1 py-2.5 text-xs font-bold transition-colors border-b-2 ${propTab === "STRUCTURE" ? "text-cad-primary border-cad-primary bg-cad-primary/10" : "text-cad-muted border-transparent hover:text-cad-text"}`}
                >
                    {t("panel.structure")}
                </button>
            </div>

            <div className="flex-1 overflow-hidden">
                {propTab === "INSPECTOR" && (
                    <PropertyInspector
                        selectedElements={currentElements.filter((el) => selectedIds.has(el.id))}
                        onUpdateElement={onUpdateElement}
                        // 属性面板中的 SCALE / OFFSET / ARRAY 复用统一的 AI 动作处理器，保证历史与通知一致
                        onApplyTransform={(operation, params) =>
                            onApplyAIAction(operation, undefined, params)
                        }
                    />
                )}

                {propTab === "STRUCTURE" && (
                    <StructureTab
                        currentElements={currentElements}
                        onToggleElementSelection={handleToggleElementSelection}
                    />
                )}
            </div>
        </div>
    );
};

/* ─── 结构（图层管理器） ──────────────────────────────────── */

function StructureTab({
    currentElements,
    onToggleElementSelection,
}: {
    currentElements: CADElement[];
    onToggleElementSelection: (elementId: string) => void;
}) {
    const { t } = useI18n();
    const { state, selectedIds, setLayerVisibility, setLayerLocked, addLayer, renameLayer, deleteLayer, setLayerColor, setCurrentLayer, moveLayer } =
        useCanvas();

    const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set(["0", "AI_GENERATED"]));
    const [newLayerName, setNewLayerName] = useState("");
    const [newLayerColor, setNewLayerColor] = useState("#e6edf3");
    const [showNewLayer, setShowNewLayer] = useState(false);
    const [renamingLayer, setRenamingLayer] = useState<string | null>(null);
    const [layerNameDraft, setLayerNameDraft] = useState("");
    const [pendingDeleteLayer, setPendingDeleteLayer] = useState<string | null>(null);

    // 图层 = 显式创建的顺序 + 元素中出现但未登记的图层（按名称排序追加）
    const derivedLayers: string[] = Array.from(
        new Set(currentElements.map((el): string => el.layer || "0")),
    );
    const layers: string[] = [
        ...state.layerOrder,
        ...derivedLayers
            .filter((name: string) => !state.layerOrder.includes(name))
            .sort(),
    ];

    /** 提交新建图层，空名或重名时忽略 */
    const commitNewLayer = () => {
        const name = newLayerName.trim();
        if (!name || layers.includes(name)) return;
        addLayer(name, newLayerColor);
        setNewLayerName("");
        setShowNewLayer(false);
    };

    /** 提交图层重命名 */
    const commitRenameLayer = (from: string) => {
        renameLayer(from, layerNameDraft);
        setRenamingLayer(null);
        setLayerNameDraft("");
    };

    const toggleLayer = (layerName: string) => {
        const newSet = new Set(expandedLayers);
        if (newSet.has(layerName)) {
            newSet.delete(layerName);
        } else {
            newSet.add(layerName);
        }
        setExpandedLayers(newSet);
    };

    return (
        <div className="flex flex-col gap-2 p-4 overflow-y-auto h-full bg-cad-panel">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-cad-muted font-bold uppercase">
                    {t("panel.layers")}
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-cad-muted">
                        {t("panel.entities", { count: currentElements.length })}
                    </span>
                    <button
                        onClick={() => setShowNewLayer((prev) => !prev)}
                        title={t("layer.new")}
                        className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                    >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                    </button>
                </div>
            </div>

            {/* 新建图层：名称 + 颜色，回车确认 / Esc 取消 */}
            {showNewLayer && (
                <div className="flex items-center gap-1 mb-1">
                    <input
                        autoFocus
                        value={newLayerName}
                        onChange={(e) => setNewLayerName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitNewLayer();
                            if (e.key === "Escape") {
                                setShowNewLayer(false);
                                setNewLayerName("");
                            }
                        }}
                        placeholder={t("layer.namePlaceholder")}
                        className="flex-1 min-w-0 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text outline-none focus:border-cad-primary"
                    />
                    <input
                        type="color"
                        value={newLayerColor}
                        onChange={(e) => setNewLayerColor(e.target.value)}
                        title={t("layer.color")}
                        className="w-7 h-7 bg-transparent border border-cad-border rounded cursor-pointer"
                    />
                    <button
                        onClick={commitNewLayer}
                        title={t("layer.create")}
                        className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                    >
                        <span className="material-symbols-outlined text-[16px]">check</span>
                    </button>
                    <button
                        onClick={() => {
                            setShowNewLayer(false);
                            setNewLayerName("");
                        }}
                        title={t("common.cancel")}
                        className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            )}

            {layers.map((layerName: string) => {
                const layerElements = currentElements.filter(
                    (el) => (el.layer || "0") === layerName,
                );
                const isExpanded: boolean = expandedLayers.has(layerName);
                const isHidden = state.hiddenLayers.includes(layerName);
                const isLocked = state.lockedLayers.includes(layerName);
                const isCurrent = state.currentLayer === layerName;
                const layerIndex = layers.indexOf(layerName);
                const layerColor = state.layerColors[layerName] ?? "#8b949e";
                return (
                    <div
                        key={layerName}
                        className="border border-cad-border rounded bg-cad-bg overflow-hidden"
                    >
                        <div
                            className="flex items-center p-2 bg-cad-panel hover:bg-cad-border/50 cursor-pointer transition-colors"
                            onClick={() => toggleLayer(layerName)}
                        >
                            <span
                                className="material-symbols-outlined text-[16px] text-cad-muted mr-2 transform transition-transform duration-200"
                                style={{
                                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                }}
                            >
                                chevron_right
                            </span>
                            <span className="material-symbols-outlined text-[16px] text-cad-muted mr-2">
                                layers
                            </span>
                            {/* 图层颜色：同时作为该层新绘图元的默认颜色 */}
                            <input
                                type="color"
                                value={layerColor}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setLayerColor(layerName, e.target.value)}
                                title={t("layer.color")}
                                className="w-4 h-4 mr-2 bg-transparent border border-cad-border rounded cursor-pointer shrink-0"
                            />
                            {renamingLayer === layerName ? (
                                <input
                                    autoFocus
                                    value={layerNameDraft}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setLayerNameDraft(e.target.value)}
                                    onBlur={() => setRenamingLayer(null)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") commitRenameLayer(layerName);
                                        if (e.key === "Escape") setRenamingLayer(null);
                                    }}
                                    className="flex-1 min-w-0 bg-cad-bg border border-cad-primary rounded px-1 py-0.5 text-xs text-cad-text outline-none"
                                />
                            ) : (
                                <span
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        if (layerName === "0") return;
                                        setRenamingLayer(layerName);
                                        setLayerNameDraft(layerName);
                                    }}
                                    title={
                                        layerName === "0" ? layerName : t("layer.renameHint")
                                    }
                                    className={`text-xs font-bold flex-1 truncate ${isHidden ? "text-cad-muted line-through" : "text-cad-text"}`}
                                >
                                    {layerName}
                                </span>
                            )}
                            {/* 当前绘图层：新建图元写入该层 */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentLayer(layerName);
                                }}
                                title={isCurrent ? t("layer.current") : t("layer.setCurrent")}
                                className={`p-0.5 rounded hover:bg-cad-text/10 ${isCurrent ? "text-cad-primary" : "text-cad-muted hover:text-cad-text"}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">
                                    {isCurrent ? "radio_button_checked" : "radio_button_unchecked"}
                                </span>
                            </button>
                            {/* 图层排序 */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    moveLayer(layerName, -1);
                                }}
                                disabled={layerIndex <= 0}
                                title={t("layer.moveUp")}
                                className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10 disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                                <span className="material-symbols-outlined text-[14px]">
                                    arrow_upward
                                </span>
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    moveLayer(layerName, 1);
                                }}
                                disabled={layerIndex >= layers.length - 1}
                                title={t("layer.moveDown")}
                                className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10 disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                                <span className="material-symbols-outlined text-[14px]">
                                    arrow_downward
                                </span>
                            </button>
                            {/* 可见性开关：隐藏后该层元素不渲染、不可选、不可捕捉 */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setLayerVisibility(layerName, isHidden);
                                }}
                                title={isHidden ? t("layer.show") : t("layer.hide")}
                                className="p-0.5 mr-1 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                            >
                                <span className="material-symbols-outlined text-[16px]">
                                    {isHidden ? "visibility_off" : "visibility"}
                                </span>
                            </button>
                            {/* 锁定开关：锁定后仍渲染与捕捉，但不可选中/编辑 */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setLayerLocked(layerName, !isLocked);
                                }}
                                title={isLocked ? t("layer.unlock") : t("layer.lock")}
                                className={`p-0.5 mr-1 rounded hover:bg-cad-text/10 ${isLocked ? "text-amber-400" : "text-cad-muted hover:text-cad-text"}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">
                                    {isLocked ? "lock" : "lock_open"}
                                </span>
                            </button>
                            {/* 删除图层："0" 层不可删除，其余层需二次确认 */}
                            {layerName !== "0" && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setPendingDeleteLayer(layerName);
                                    }}
                                    title={t("layer.delete")}
                                    className="p-0.5 mr-1 rounded text-cad-muted hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10"
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        delete
                                    </span>
                                </button>
                            )}
                            <span className="text-[10px] text-cad-muted bg-cad-border/50 px-1.5 rounded-full">
                                {layerElements.length}
                            </span>
                        </div>
                        {pendingDeleteLayer === layerName && (
                            <div className="flex items-center gap-2 px-2 py-1 bg-red-500/10 text-[10px] text-red-500 dark:text-red-300">
                                <span className="flex-1">{t("layer.deleteHint")}</span>
                                <button
                                    onClick={() => {
                                        deleteLayer(layerName);
                                        setPendingDeleteLayer(null);
                                    }}
                                    className="font-bold hover:text-red-600 dark:hover:text-red-200"
                                >
                                    {t("common.confirm")}
                                </button>
                                <button
                                    onClick={() => setPendingDeleteLayer(null)}
                                    className="text-cad-muted hover:text-cad-text"
                                >
                                    {t("common.cancel")}
                                </button>
                            </div>
                        )}
                        {isExpanded && (
                            <div className="flex flex-col gap-0.5 p-1 bg-cad-bg/50">
                                {layerElements.length === 0 ? (
                                    <div className="p-2 text-center text-[10px] text-cad-muted italic">
                                        {t("layer.empty")}
                                    </div>
                                ) : (
                                    layerElements.map((el: CADElement) => (
                                        <div
                                            key={el.id}
                                            onClick={() => onToggleElementSelection(el.id)}
                                            className={`flex items-center p-1.5 rounded-sm hover:bg-cad-text/5 cursor-pointer text-xs ml-2 border-l-2 border-transparent transition-all ${selectedIds.has(el.id) ? "bg-cad-primary/10 border-l-cad-primary text-cad-primary font-medium" : "text-cad-text"}`}
                                        >
                                            <span className="material-symbols-outlined text-[14px] mr-2 opacity-70">
                                                {el.type === "LINE"
                                                    ? "remove"
                                                    : el.type === "CIRCLE"
                                                      ? "circle"
                                                      : el.type === "RECTANGLE"
                                                        ? "rectangle"
                                                        : el.type === "TEXT"
                                                          ? "title"
                                                          : el.type === "DIMENSION"
                                                            ? "straighten"
                                                            : el.type === "ARC"
                                                              ? "architecture"
                                                              : "polyline"}
                                            </span>
                                            <span className="truncate flex-1">{el.type}</span>
                                            <span className="text-[10px] text-cad-muted font-mono">
                                                {el.id.slice(0, 4)}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export default RightPanel;
