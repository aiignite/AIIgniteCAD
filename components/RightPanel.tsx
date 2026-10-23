import React, { useState, useEffect, useRef } from "react";
import {
    SidePanelMode,
    BlockDefinition,
    BlockCategory,
    CADElement,
    ProjectFile,
    DesignConventions,
} from "../types";
import DrawingReviewPanel from "./DrawingReviewPanel";
import DesignConventionsPanel from "./DesignConventionsPanel";
import { getBlockTree, createCategory, createBlock, moveItem } from "../services/blockService";
import PropertyInspector from "./PropertyInspector";
import PromptDialog from "./PromptDialog";
import { useCanvas } from "../store/canvasStore";
import { useApp } from "../store/appStore";
import { zoomViewportToBounds } from "../store/viewport";
import { readUIPreferences, writeUIPreferences } from "../lib/uiPreferences";
import type { ReviewIssue } from "../lib/designReview";
import { useI18n } from "../lib/i18n";

interface RightPanelProps {
    mode: SidePanelMode;
    currentElements: CADElement[];
    onUpdateElement: (el: CADElement) => void;
    onApplyAIAction: (operation: string, elements?: CADElement[], params?: any) => void;
    /** 检查面板「让 AI 修复」：打开 AI 浮窗并带上问题摘要，可预选相关图元 */
    onAskAIFix?: (prompt: string, ids: string[]) => void;
    /** 当前项目设计约定与保存回调 */
    designConventions?: DesignConventions | null;
    onSaveDesignConventions?: (conventions: DesignConventions | null) => Promise<void> | void;
    /** 右侧面板是否展开；收起时不渲染，把画布面积让给绘图 */
    collapsed?: boolean;
    // Files Props
    files: ProjectFile[];
    activeFileId: string | null;
}

export const RightPanel: React.FC<RightPanelProps> = ({
    mode,
    currentElements,
    onUpdateElement,
    onApplyAIAction,
    onAskAIFix,
    designConventions,
    onSaveDesignConventions,
    collapsed = false,
    files,
    activeFileId,
}) => {
    const { t } = useI18n();
    const { showNotification, setSidePanelOpen } = useApp();
    // 图层可见性 / 锁定状态由画布 Store 统一维护，渲染与命中测试都依赖它
    const {
        state: canvasState,
        selectedIds,
        setSelection,
        toggleSelection,
        setLayerVisibility,
        setLayerLocked,
        addLayer,
        renameLayer,
        deleteLayer,
        setLayerColor,
        setCurrentLayer,
        moveLayer,
    } = useCanvas();

    // --- STATE ---

    // Properties Panel State: INSPECTOR (Props+Layers), STRUCTURE (Old Model List), BLOCKS
    const [propTab, setPropTab] = useState<"INSPECTOR" | "STRUCTURE" | "BLOCKS">("INSPECTOR");

    // Blocks State
    const [blockTree, setBlockTree] = useState<{
        categories: BlockCategory[];
        rootBlocks: BlockDefinition[];
    }>({ categories: [], rootBlocks: [] });
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [blockSearch, setBlockSearch] = useState("");
    // Drag and Drop
    const [draggedBlockItem, setDraggedBlockItem] = useState<{
        type: "block" | "category";
        id: string;
    } | null>(null);

    // Structure Tab State
    const [expandedLayers, setExpandedLayers] = useState<Set<string>>(
        new Set(["0", "AI_GENERATED"]),
    );
    /** 新建图层的名称与颜色 */
    const [newLayerName, setNewLayerName] = useState("");
    const [newLayerColor, setNewLayerColor] = useState("#e6edf3");
    const [showNewLayer, setShowNewLayer] = useState(false);
    /** 正在重命名的图层及输入草稿 */
    const [renamingLayer, setRenamingLayer] = useState<string | null>(null);
    const [layerNameDraft, setLayerNameDraft] = useState("");
    /** 等待二次确认删除的图层 */
    const [pendingDeleteLayer, setPendingDeleteLayer] = useState<string | null>(null);

    // Assistant panel width state (Frame 2)：初值取本地偏好，拖拽结束时写回
    const [assistantPanelWidth, setAssistantPanelWidth] = useState(
        () => readUIPreferences().rightPanelWidth,
    );
    const assistantWidthRef = useRef(assistantPanelWidth);
    const [isResizingAssistant, setIsResizingAssistant] = useState(false);
    const [dragStartX, setDragStartX] = useState(0);
    const [dragStartWidth, setDragStartWidth] = useState(assistantPanelWidth);

    const loadBlockData = async () => {
        try {
            // Load global blocks (not tied to any project) - blocks are shared across all drawings
            const data = await getBlockTree(undefined);
            setBlockTree(data);
        } catch (e) {
            console.error("Failed to load blocks", e);
        }
    };

    useEffect(() => {
        if (propTab !== "BLOCKS") return;
        let cancelled = false;
        // setState 放在 .then 回调中：effect 本体同步 setState 会触发级联渲染
        getBlockTree(undefined)
            .then((data) => {
                if (!cancelled) setBlockTree(data);
            })
            .catch((e) => console.error("Failed to load blocks", e));
        return () => {
            cancelled = true;
        };
    }, [propTab]);

    // Handle assistant panel resize
    useEffect(() => {
        if (!isResizingAssistant) return;

        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = dragStartX - e.clientX;
            const newWidth = dragStartWidth + deltaX;

            if (newWidth >= 280 && newWidth <= 800) {
                assistantWidthRef.current = newWidth;
                setAssistantPanelWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            setIsResizingAssistant(false);
            document.body.style.cursor = "";
            // 拖拽结束才落一次存储，避免 mousemove 高频写 localStorage
            writeUIPreferences({ rightPanelWidth: assistantWidthRef.current });
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        document.body.style.cursor = "col-resize";

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isResizingAssistant, dragStartX, dragStartWidth]);

    const handleAssistantResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizingAssistant(true);
        setDragStartX(e.clientX);
        setDragStartWidth(assistantPanelWidth);
    };

    // --- PROPERTY UPDATE LOGIC ---
    const toggleLayer = (layerName: string) => {
        const newSet = new Set(expandedLayers);
        if (newSet.has(layerName)) {
            newSet.delete(layerName);
        } else {
            newSet.add(layerName);
        }
        setExpandedLayers(newSet);
    };

    const handleToggleElementSelection = (elementId: string) => {
        toggleSelection(elementId);
    };

    // --- SUB-COMPONENT RENDERERS ---

    const renderPropertiesAndStructure = () => {
        // 图层 = 显式创建的顺序 + 元素中出现但未登记的图层（按名称排序追加）
        const derivedLayers: string[] = Array.from(
            new Set(currentElements.map((el): string => el.layer || "0")),
        );
        const layers: string[] = [
            ...canvasState.layerOrder,
            ...derivedLayers
                .filter((name: string) => !canvasState.layerOrder.includes(name))
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

        return (
            <div className="flex flex-col h-full bg-cad-panel">
                <div className="flex border-b border-cad-border bg-cad-panel">
                    <button
                        onClick={() => setPropTab("INSPECTOR")}
                        className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === "INSPECTOR" ? "text-cad-primary border-cad-primary bg-cad-primary/10" : "text-cad-muted border-transparent hover:text-cad-text"}`}
                    >
                        {t("panel.inspector")}
                    </button>
                    <button
                        onClick={() => setPropTab("STRUCTURE")}
                        className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === "STRUCTURE" ? "text-cad-primary border-cad-primary bg-cad-primary/10" : "text-cad-muted border-transparent hover:text-cad-text"}`}
                    >
                        {t("panel.structure")}
                    </button>
                    <button
                        onClick={() => setPropTab("BLOCKS")}
                        className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === "BLOCKS" ? "text-cad-primary border-cad-primary bg-cad-primary/10" : "text-cad-muted border-transparent hover:text-cad-text"}`}
                    >
                        {t("panel.blockLibrary")}
                    </button>
                </div>

                <div className="flex-1 overflow-hidden">
                    {propTab === "INSPECTOR" && (
                        <PropertyInspector
                            selectedElements={currentElements.filter((el) =>
                                selectedIds.has(el.id),
                            )}
                            onUpdateElement={onUpdateElement}
                            // 属性面板中的 SCALE / OFFSET / ARRAY 复用统一的 AI 动作处理器，保证历史与通知一致
                            onApplyTransform={(operation, params) =>
                                onApplyAIAction(operation, undefined, params)
                            }
                        />
                    )}

                    {propTab === "STRUCTURE" && (
                        <div className="flex flex-col gap-2 p-4 overflow-y-auto h-full">
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
                                        <span className="material-symbols-outlined text-[16px]">
                                            add
                                        </span>
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
                                        <span className="material-symbols-outlined text-[16px]">
                                            check
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowNewLayer(false);
                                            setNewLayerName("");
                                        }}
                                        title={t("common.cancel")}
                                        className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            close
                                        </span>
                                    </button>
                                </div>
                            )}

                            {layers.map((layerName: string) => {
                                const layerElements = currentElements.filter(
                                    (el) => (el.layer || "0") === layerName,
                                );
                                const isExpanded: boolean = expandedLayers.has(layerName);
                                const isHidden = canvasState.hiddenLayers.includes(layerName);
                                const isLocked = canvasState.lockedLayers.includes(layerName);
                                const isCurrent = canvasState.currentLayer === layerName;
                                const layerIndex = layers.indexOf(layerName);
                                const layerColor = canvasState.layerColors[layerName] ?? "#8b949e";
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
                                                    transform: isExpanded
                                                        ? "rotate(90deg)"
                                                        : "rotate(0deg)",
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
                                                onChange={(e) =>
                                                    setLayerColor(layerName, e.target.value)
                                                }
                                                title={t("layer.color")}
                                                className="w-4 h-4 mr-2 bg-transparent border border-cad-border rounded cursor-pointer shrink-0"
                                            />
                                            {renamingLayer === layerName ? (
                                                <input
                                                    autoFocus
                                                    value={layerNameDraft}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={(e) =>
                                                        setLayerNameDraft(e.target.value)
                                                    }
                                                    onBlur={() => setRenamingLayer(null)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter")
                                                            commitRenameLayer(layerName);
                                                        if (e.key === "Escape")
                                                            setRenamingLayer(null);
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
                                                    {isCurrent
                                                        ? "radio_button_checked"
                                                        : "radio_button_unchecked"}
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
                                                            onClick={() =>
                                                                handleToggleElementSelection(el.id)
                                                            }
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
                                                            <span className="truncate flex-1">
                                                                {el.type}
                                                            </span>
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
                    )}

                    <div className="overflow-y-auto h-full">
                        {propTab === "BLOCKS" && renderBlocksTab()}
                    </div>
                </div>
            </div>
        );
    };

    // --- Block Handlers ---
    /** 待完成的命名弹窗：建块 / 建分类共用 PromptDialog，替代原生 prompt */
    const [pendingPrompt, setPendingPrompt] = useState<"blockName" | "categoryName" | null>(null);

    /** 选中图元的形心作为块基点，取不到几何时退回原点 */
    const computeBasePoint = (selected: CADElement[]) => {
        let x = 0,
            y = 0,
            count = 0;
        selected.forEach((e) => {
            if (e.start) {
                x += e.start.x;
                y += e.start.y;
                count++;
            } else if (e.end) {
                x += e.end.x;
                y += e.end.y;
                count++;
            } else if (e.center) {
                x += e.center.x;
                y += e.center.y;
                count++;
            }
        });
        return count > 0 ? { x: x / count, y: y / count } : { x: 0, y: 0 };
    };

    const handleCreateBlock = () => {
        const selected = currentElements.filter((e) => selectedIds.has(e.id));
        if (selected.length === 0) {
            showNotification(t("block.needSelection"));
            return;
        }
        setPendingPrompt("blockName");
    };

    const submitBlockName = async (name: string) => {
        setPendingPrompt(null);
        const selected = currentElements.filter((e) => selectedIds.has(e.id));
        if (!name || selected.length === 0) return;

        try {
            // Create block as global (not tied to any project) - blocks are shared across all drawings
            await createBlock(name, selected, computeBasePoint(selected), undefined, undefined, undefined);
            await loadBlockData();
            showNotification(t("notify.blockSaved", { count: selected.length, name }));
        } catch (e) {
            showNotification(
                t("notify.blockSaveFailed", { message: e instanceof Error ? e.message : String(e) }),
            );
        }
    };

    const handleCreateCategory = () => {
        setPendingPrompt("categoryName");
    };

    const submitCategoryName = async (name: string) => {
        setPendingPrompt(null);
        if (!name) return;
        try {
            // Create category as global (not tied to any project) - categories are shared across all drawings
            await createCategory(name, undefined, undefined);
            await loadBlockData();
        } catch (e) {
            console.error(e);
        }
    };

    const handleBlockDrop = async (targetId: string | null, isCategory: boolean) => {
        if (!draggedBlockItem) return;
        if (draggedBlockItem.id === targetId) return;
        try {
            await moveItem(draggedBlockItem.type, draggedBlockItem.id, targetId || undefined);
            await loadBlockData();
        } catch (e: any) {
            console.error(e);
        }
        setDraggedBlockItem(null);
    };

    const getFilteredTree = () => {
        if (!blockSearch) return blockTree;

        const lower = blockSearch.toLowerCase();

        const filterCat = (cat: BlockCategory): BlockCategory | null => {
            const matchingBlocks =
                cat.blocks?.filter((b) => b.name.toLowerCase().includes(lower)) || [];
            const matchingChildren =
                (cat.children
                    ?.map((c) => filterCat(c))
                    .filter((c) => c !== null) as BlockCategory[]) || [];

            if (
                cat.name.toLowerCase().includes(lower) ||
                matchingBlocks.length > 0 ||
                matchingChildren.length > 0
            ) {
                return {
                    ...cat,
                    blocks: matchingBlocks,
                    children: matchingChildren,
                };
            }
            return null;
        };

        return {
            categories: blockTree.categories
                .map((c) => filterCat(c))
                .filter((c) => c !== null) as BlockCategory[],
            rootBlocks: blockTree.rootBlocks.filter((b) => b.name.toLowerCase().includes(lower)),
        };
    };

    const filteredTree = getFilteredTree();

    const renderBlockNode = (block: BlockDefinition) => (
        <div
            key={block.id}
            draggable
            onDragStart={(e) => {
                setDraggedBlockItem({ type: "block", id: block.id });
                e.dataTransfer.setData("blockId", block.id); // For Canvas Drop
                e.dataTransfer.effectAllowed = "copy";
            }}
            className="flex items-center p-2 hover:bg-cad-hover/10 cursor-pointer text-sm"
        >
            <span className="material-symbols-outlined text-base mr-2 text-cad-primary">
                deployed_code
            </span>
            {block.name}
        </div>
    );

    const renderCategoryNode = (category: BlockCategory) => {
        const isExpanded = expandedCategories.has(category.id) || blockSearch.length > 0;
        return (
            <div key={category.id} className="ml-2">
                <div
                    className={`flex items-center p-2 hover:bg-cad-hover/10 cursor-pointer text-sm ${draggedBlockItem?.id === category.id ? "opacity-50" : ""}`}
                    draggable
                    onDragStart={(e) => {
                        e.stopPropagation();
                        setDraggedBlockItem({ type: "category", id: category.id });
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleBlockDrop(category.id, true);
                    }}
                    onClick={() => {
                        const newSet = new Set(expandedCategories);
                        if (isExpanded) newSet.delete(category.id);
                        else newSet.add(category.id);
                        setExpandedCategories(newSet);
                    }}
                >
                    <span className="material-symbols-outlined text-base mr-2 text-yellow-500">
                        {isExpanded ? "folder_open" : "folder"}
                    </span>
                    {category.name}
                </div>
                {isExpanded && (
                    <div className="ml-4 border-l border-cad-border pl-1">
                        {category.children?.map(renderCategoryNode)}
                        {category.blocks?.map(renderBlockNode)}
                    </div>
                )}
            </div>
        );
    };

    const renderBlocksTab = () => (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b border-cad-border flex gap-2">
                <button
                    onClick={handleCreateBlock}
                    className="flex-1 bg-cad-primary text-white text-xs py-2 px-3 rounded flex items-center justify-center gap-2 hover:bg-cad-primaryHover"
                >
                    <span className="material-symbols-outlined text-sm">add_box</span>
                    {t("block.create")}
                </button>
                <button
                    onClick={handleCreateCategory}
                    className="flex-1 bg-cad-secondary text-cad-text text-xs py-2 px-3 rounded flex items-center justify-center gap-2 hover:bg-cad-text/10"
                >
                    <span className="material-symbols-outlined text-sm">create_new_folder</span>
                    {t("category.create")}
                </button>
            </div>

            <div
                className="flex-1 overflow-y-auto p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleBlockDrop(null, true)}
            >
                <input
                    type="text"
                    placeholder={t("panel.searchBlocks")}
                    className="w-full bg-cad-bg border border-cad-border rounded p-2 mb-2 text-xs text-cad-text outline-none"
                    value={blockSearch}
                    onChange={(e) => setBlockSearch(e.target.value)}
                />
                {filteredTree.categories.map(renderCategoryNode)}
                {filteredTree.rootBlocks.map(renderBlockNode)}

                {filteredTree.categories.length === 0 && filteredTree.rootBlocks.length === 0 && (
                    <p className="text-cad-muted text-xs text-center mt-8">{t("panel.noBlocks")}</p>
                )}
            </div>
        </div>
    );

    const handleLocateReviewIssue = (issue: ReviewIssue) => {
        setSelection(issue.elementIds);
        if (issue.bbox) zoomViewportToBounds(issue.bbox);
    };

    // 收起时不渲染整块面板，把画布面积完全让给绘图
    if (collapsed) return null;

    return (
        <div className="relative group flex h-full shrink-0 z-20 shadow-xl shadow-black/10 dark:shadow-black/50 border-l border-cad-border bg-cad-panel">
            {/* 收起把手：悬停面板时浮现，不必回左栏底部找入口 */}
            <button
                data-action="collapse-side-panel"
                onClick={() => setSidePanelOpen(false)}
                title={t("panel.collapse")}
                aria-label={t("panel.collapse")}
                className="absolute -left-3 top-1/2 z-30 flex h-12 w-6 -translate-y-1/2 items-center justify-center rounded-l border border-r-0 border-cad-border bg-cad-panel text-cad-muted opacity-0 shadow transition-opacity group-hover:opacity-100 hover:text-cad-text"
            >
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
            {/* Frame 1: 属性 / 结构 / 图块 */}
            <div className="w-64 border-r border-cad-border flex flex-col relative bg-cad-panel hidden lg:flex flex-shrink-0">
                {renderPropertiesAndStructure()}
            </div>

            {/* 可拖动分隔条 */}
            <div
                className="hidden lg:flex w-1 bg-cad-border hover:bg-cad-primary cursor-col-resize relative z-30 transition-colors flex-shrink-0"
                onMouseDown={handleAssistantResizeStart}
                title={t("panel.dragResize")}
            />

            {/* Frame 2: 动态内容（可调宽度） */}
            <div
                className="flex flex-col h-full relative bg-cad-panel border-l border-cad-border transition-all duration-300"
                style={{ width: `${assistantPanelWidth}px` }}
            >
                {mode === SidePanelMode.REVIEW && (
                    <DrawingReviewPanel
                        elements={currentElements}
                        conventions={designConventions}
                        onLocate={handleLocateReviewIssue}
                        onAskAI={onAskAIFix ?? (() => undefined)}
                    />
                )}
                {mode === SidePanelMode.CONVENTIONS && (
                    <DesignConventionsPanel
                        fileName={files.find((file) => file.id === activeFileId)?.name}
                        conventions={designConventions}
                        onSave={onSaveDesignConventions ?? (() => undefined)}
                    />
                )}
            </div>

            {/* 建块 / 建分类命名弹窗 */}
            {pendingPrompt === "blockName" && (
                <PromptDialog
                    title={t("block.nameTitle")}
                    placeholder={t("block.namePlaceholder")}
                    confirmLabel={t("common.create")}
                    cancelLabel={t("common.cancel")}
                    onConfirm={submitBlockName}
                    onCancel={() => setPendingPrompt(null)}
                />
            )}
            {pendingPrompt === "categoryName" && (
                <PromptDialog
                    title={t("category.nameTitle")}
                    placeholder={t("category.namePlaceholder")}
                    confirmLabel={t("common.create")}
                    cancelLabel={t("common.cancel")}
                    onConfirm={submitCategoryName}
                    onCancel={() => setPendingPrompt(null)}
                />
            )}
        </div>
    );
};
