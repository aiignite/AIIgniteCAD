import React, { useState, useEffect, useSyncExternalStore } from "react";
import {
    SidePanelMode,
    BlockDefinition,
    BlockCategory,
    CADElement,
    DrawingSettings,
    ProjectFile,
    SnapType,
    DEFAULT_SNAP_TYPES,
    DesignConventions,
} from "../types";
import DrawingReviewPanel from "./DrawingReviewPanel";
import DesignConventionsPanel from "./DesignConventionsPanel";
import { getBlockTree, createCategory, createBlock, moveItem } from "../services/blockService";
import PropertyInspector from "./PropertyInspector";
import { useCanvas } from "../store/canvasStore";
import { zoomViewportToBounds } from "../store/viewport";
import type { ReviewIssue } from "../lib/designReview";
import { syncService } from "../services/syncService";
import { useI18n, type TranslationKey } from "../lib/i18n";

/** 捕捉类型与界面文案键，顺序即设置面板展示顺序 */
const SNAP_TYPE_OPTIONS: Array<{ type: SnapType; labelKey: TranslationKey }> = [
    SnapType.ENDPOINT,
    SnapType.MIDPOINT,
    SnapType.CENTER,
    SnapType.QUADRANT,
    SnapType.INTERSECTION,
    SnapType.PERPENDICULAR,
    SnapType.TANGENT,
    SnapType.NEAREST,
].map((type) => ({
    type,
    labelKey: `snap.${type.toLowerCase()}` as TranslationKey,
}));

interface RightPanelProps {
    mode: SidePanelMode;
    onChangeMode: (mode: SidePanelMode) => void;
    currentElements: CADElement[];
    onUpdateElement: (el: CADElement) => void;
    onApplyAIAction: (operation: string, elements?: CADElement[], params?: any) => void;
    drawingSettings: DrawingSettings;
    onUpdateSettings: (settings: DrawingSettings) => void;
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
    // User Props
    currentUser?: any;
    onLogout?: () => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({
    mode,
    onChangeMode,
    currentElements,
    onUpdateElement,
    onApplyAIAction,
    drawingSettings,
    onUpdateSettings,
    onAskAIFix,
    designConventions,
    onSaveDesignConventions,
    collapsed = false,
    files,
    activeFileId,
    currentUser,
    onLogout,
}) => {
    const { t, locale, setLocale } = useI18n();
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

    // 同步状态直接订阅 worker，设置面板无需逐层透传 props
    const syncStatus = useSyncExternalStore(
        syncService.subscribe,
        syncService.getSnapshot,
        syncService.getSnapshot,
    );

    useEffect(() => {
        void syncService.refreshStatus();
    }, []);

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

    // User Profile Edit State
    const [editingProfile, setEditingProfile] = useState(false);
    const [profileForm, setProfileForm] = useState({
        username: currentUser?.username || "",
        email: currentUser?.email || "",
    });
    const [editingPassword, setEditingPassword] = useState(false);
    const [passwordForm, setPasswordForm] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
    });
    const [userMessage, setUserMessage] = useState<{
        type: "success" | "error";
        text: string;
    } | null>(null);

    // Assistant panel width state (Frame 2)
    const [assistantPanelWidth, setAssistantPanelWidth] = useState(320); // Default w-80 = 20rem = 320px
    const [isResizingAssistant, setIsResizingAssistant] = useState(false);
    const [dragStartX, setDragStartX] = useState(0);
    const [dragStartWidth, setDragStartWidth] = useState(320);

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
                setAssistantPanelWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            setIsResizingAssistant(false);
            document.body.style.cursor = "";
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
                                    <span className="text-[10px] text-gray-500">
                                        {t("panel.entities", { count: currentElements.length })}
                                    </span>
                                    <button
                                        onClick={() => setShowNewLayer((prev) => !prev)}
                                        title="新建图层"
                                        className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-white/10"
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
                                        placeholder="Layer name"
                                        className="flex-1 min-w-0 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text outline-none focus:border-cad-primary"
                                    />
                                    <input
                                        type="color"
                                        value={newLayerColor}
                                        onChange={(e) => setNewLayerColor(e.target.value)}
                                        title="图层颜色"
                                        className="w-7 h-7 bg-transparent border border-cad-border rounded cursor-pointer"
                                    />
                                    <button
                                        onClick={commitNewLayer}
                                        title="创建图层"
                                        className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-white/10"
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
                                        title="取消"
                                        className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-white/10"
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
                                                title="图层颜色"
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
                                                        layerName === "0" ? layerName : "双击重命名"
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
                                                title={isCurrent ? "当前绘图层" : "设为当前绘图层"}
                                                className={`p-0.5 rounded hover:bg-white/10 ${isCurrent ? "text-cad-primary" : "text-cad-muted hover:text-cad-text"}`}
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
                                                title="上移图层"
                                                className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
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
                                                title="下移图层"
                                                className="p-0.5 rounded text-cad-muted hover:text-cad-text hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
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
                                                title={isHidden ? "显示图层" : "隐藏图层"}
                                                className="p-0.5 mr-1 rounded text-cad-muted hover:text-cad-text hover:bg-white/10"
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
                                                title={isLocked ? "解锁图层" : "锁定图层"}
                                                className={`p-0.5 mr-1 rounded hover:bg-white/10 ${isLocked ? "text-amber-400" : "text-cad-muted hover:text-cad-text"}`}
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
                                                    title="删除图层"
                                                    className="p-0.5 mr-1 rounded text-cad-muted hover:text-red-400 hover:bg-red-500/10"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">
                                                        delete
                                                    </span>
                                                </button>
                                            )}
                                            <span className="text-[9px] text-cad-muted bg-cad-border/50 px-1.5 rounded-full">
                                                {layerElements.length}
                                            </span>
                                        </div>
                                        {pendingDeleteLayer === layerName && (
                                            <div className="flex items-center gap-2 px-2 py-1 bg-red-500/10 text-[10px] text-red-300">
                                                <span className="flex-1">该层元素将移至 0 层</span>
                                                <button
                                                    onClick={() => {
                                                        deleteLayer(layerName);
                                                        setPendingDeleteLayer(null);
                                                    }}
                                                    className="font-bold hover:text-red-200"
                                                >
                                                    确认
                                                </button>
                                                <button
                                                    onClick={() => setPendingDeleteLayer(null)}
                                                    className="text-cad-muted hover:text-cad-text"
                                                >
                                                    取消
                                                </button>
                                            </div>
                                        )}
                                        {isExpanded && (
                                            <div className="flex flex-col gap-0.5 p-1 bg-cad-bg/50">
                                                {layerElements.length === 0 ? (
                                                    <div className="p-2 text-center text-[10px] text-gray-500 italic">
                                                        Empty layer
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
                                                            <span className="text-[9px] text-cad-muted font-mono">
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
    const handleCreateBlock = async () => {
        const selected = currentElements.filter((e) => selectedIds.has(e.id));
        if (selected.length === 0) {
            alert("Please select elements to create a block.");
            return;
        }

        const name = prompt("Enter block name:");
        if (!name) return;

        try {
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
            const basePoint = count > 0 ? { x: x / count, y: y / count } : { x: 0, y: 0 };

            // Create block as global (not tied to any project) - blocks are shared across all drawings
            await createBlock(name, selected, basePoint, undefined, undefined, undefined);
            await loadBlockData();
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleCreateCategory = async () => {
        const name = prompt("Category Name:");
        if (!name) return;
        // Create category as global (not tied to any project) - categories are shared across all drawings
        await createCategory(name, undefined, undefined);
        await loadBlockData();
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
            <span className="material-symbols-outlined text-base mr-2 text-blue-400">
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
                    <div className="ml-4 border-l border-gray-700 pl-1">
                        {category.children?.map(renderCategoryNode)}
                        {category.blocks?.map(renderBlockNode)}
                    </div>
                )}
            </div>
        );
    };

    const renderBlocksTab = () => (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b border-gray-800 flex gap-2">
                <button
                    onClick={handleCreateBlock}
                    className="flex-1 bg-cad-primary text-white text-xs py-2 px-3 rounded flex items-center justify-center gap-2 hover:bg-blue-600"
                >
                    <span className="material-symbols-outlined text-sm">add_box</span>
                    Block
                </button>
                <button
                    onClick={handleCreateCategory}
                    className="flex-1 bg-gray-700 text-white text-xs py-2 px-3 rounded flex items-center justify-center gap-2 hover:bg-gray-600"
                >
                    <span className="material-symbols-outlined text-sm">create_new_folder</span>
                    Folder
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
                    className="w-full bg-cad-bg-secondary border border-gray-700 rounded p-2 mb-2 text-xs text-cad-text outline-none"
                    value={blockSearch}
                    onChange={(e) => setBlockSearch(e.target.value)}
                />
                {filteredTree.categories.map(renderCategoryNode)}
                {filteredTree.rootBlocks.map(renderBlockNode)}

                {filteredTree.categories.length === 0 && filteredTree.rootBlocks.length === 0 && (
                    <p className="text-gray-500 text-xs text-center mt-8">{t("panel.noBlocks")}</p>
                )}
            </div>
        </div>
    );

    const renderSettings = () => (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                <h3 className="text-sm font-bold text-cad-text">{t("settings.title")}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* 界面语言 */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                        {t("settings.language")}
                    </h4>
                    <div className="flex rounded border border-cad-border bg-cad-panel overflow-hidden">
                        {(["zh", "en"] as const).map((code) => (
                            <button
                                key={code}
                                onClick={() => setLocale(code)}
                                className={`flex-1 py-1.5 text-xs transition-colors ${
                                    locale === code
                                        ? "bg-cad-primary text-white"
                                        : "text-cad-muted hover:bg-cad-border/50"
                                }`}
                            >
                                {code === "zh" ? t("settings.languageZh") : t("settings.languageEn")}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Cloud Sync */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                        {t("settings.cloudSync")}
                    </h4>
                    <div className="rounded border border-cad-border bg-cad-panel p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-2 text-cad-text">
                                <span
                                    className={`size-2 rounded-full ${
                                        syncStatus.failedCount > 0
                                            ? "bg-red-500"
                                            : syncStatus.syncing
                                              ? "bg-cad-primary animate-pulse"
                                              : syncStatus.pendingCount > 0
                                                ? "bg-yellow-500"
                                                : "bg-green-500"
                                    }`}
                                />
                                {!syncStatus.online
                                    ? t("settings.offline")
                                    : syncStatus.syncing
                                      ? t("settings.syncing")
                                      : syncStatus.pendingCount > 0 || syncStatus.failedCount > 0
                                        ? t("settings.pendingChanges")
                                        : t("settings.upToDate")}
                            </span>
                            <span className="font-mono text-[10px] text-cad-muted">
                                {t("settings.pendingFailed", {
                                    pending: syncStatus.pendingCount,
                                    failed: syncStatus.failedCount,
                                })}
                            </span>
                        </div>

                        {syncStatus.lastSyncedAt && (
                            <p className="text-[10px] text-cad-muted">
                                {t("settings.lastSynced", {
                                    time: new Date(syncStatus.lastSyncedAt).toLocaleTimeString(),
                                })}
                            </p>
                        )}

                        {syncStatus.lastError && (
                            <p
                                className="text-[10px] text-red-500 break-words max-h-12 overflow-hidden"
                                title={syncStatus.lastError}
                            >
                                {syncStatus.lastError}
                            </p>
                        )}

                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={() => void syncService.flush()}
                                disabled={syncStatus.syncing || !syncStatus.online}
                                className="flex-1 h-7 rounded border border-cad-border text-[11px] text-cad-text hover:bg-cad-border/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {t("settings.syncNow")}
                            </button>
                            <button
                                onClick={() => void syncService.retryFailed()}
                                disabled={syncStatus.syncing || syncStatus.failedCount === 0}
                                className="flex-1 h-7 rounded border border-cad-border text-[11px] text-cad-text hover:bg-cad-border/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {t("settings.retryFailed")}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Coordinate System */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                        {t("settings.coordinateSystem")}
                    </h4>
                    <div className="space-y-2">
                        <label className="text-xs text-cad-text font-medium">
                            {t("settings.units")}
                        </label>
                        <div className="flex rounded border border-cad-border bg-cad-panel overflow-hidden">
                            {(["mm", "cm", "m", "in", "ft"] as const).map((u) => (
                                <button
                                    key={u}
                                    onClick={() =>
                                        onUpdateSettings({ ...drawingSettings, units: u })
                                    }
                                    className={`flex-1 py-1.5 text-xs font-mono transition-colors ${drawingSettings.units === u ? "bg-cad-primary text-white" : "text-cad-muted hover:bg-cad-border/50"}`}
                                >
                                    {u}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-[10px] text-cad-muted font-medium">
                                {t("settings.gridSpacing")}
                            </label>
                            <input
                                type="number"
                                value={drawingSettings.gridSpacing}
                                onChange={(e) =>
                                    onUpdateSettings({
                                        ...drawingSettings,
                                        gridSpacing: parseFloat(e.target.value) || 10,
                                    })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] text-cad-muted font-medium">
                                {t("settings.snapAperture")}
                            </label>
                            <input
                                type="number"
                                value={drawingSettings.snapDistance}
                                onChange={(e) =>
                                    onUpdateSettings({
                                        ...drawingSettings,
                                        snapDistance: parseFloat(e.target.value) || 1,
                                    })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
                            />
                        </div>
                    </div>

                    {/* 对象捕捉类型开关 */}
                    <div className="space-y-1">
                        <label className="text-[10px] text-cad-muted font-medium">
                            {t("settings.objectSnap")}
                        </label>
                        <div className="grid grid-cols-2 gap-1">
                            {SNAP_TYPE_OPTIONS.map(({ type, labelKey }) => {
                                const label = t(labelKey);
                                const enabledTypes =
                                    drawingSettings.enabledSnapTypes ?? DEFAULT_SNAP_TYPES;
                                const isEnabled = enabledTypes.includes(type);
                                return (
                                    <button
                                        key={type}
                                        onClick={() =>
                                            onUpdateSettings({
                                                ...drawingSettings,
                                                enabledSnapTypes: isEnabled
                                                    ? enabledTypes.filter((t) => t !== type)
                                                    : [...enabledTypes, type],
                                            })
                                        }
                                        className={`py-1 px-2 rounded text-[10px] font-medium border transition-colors ${
                                            isEnabled
                                                ? "bg-cad-primary/15 border-cad-primary text-cad-primary"
                                                : "bg-cad-panel border-cad-border text-cad-muted hover:bg-cad-border/40"
                                        }`}
                                        title={`${label} (${type})`}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-[10px] text-cad-muted">
                            {t("settings.nearestHint")}
                        </p>
                    </div>
                </div>

                <div className="h-px bg-cad-border"></div>

                {/* Dimension Style */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                        {t("settings.dimensionStyle")}
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-[10px] text-cad-muted font-medium">
                                {t("settings.scaleFactor")}
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                value={drawingSettings.dimScale}
                                onChange={(e) =>
                                    onUpdateSettings({
                                        ...drawingSettings,
                                        dimScale: parseFloat(e.target.value) || 1,
                                    })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] text-cad-muted font-medium">
                                {t("settings.precision")}
                            </label>
                            <input
                                type="number"
                                min="0"
                                max="8"
                                value={drawingSettings.dimPrecision}
                                onChange={(e) =>
                                    onUpdateSettings({
                                        ...drawingSettings,
                                        dimPrecision: parseInt(e.target.value) || 0,
                                    })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
                            />
                        </div>
                    </div>
                    <div className="p-3 bg-cad-panel rounded border border-cad-border flex flex-col items-center justify-center h-20 overflow-hidden relative">
                        <span className="text-[10px] text-cad-muted absolute top-1 left-2">
                            {t("settings.preview")}
                        </span>
                        {/* Mini preview of a dimension */}
                        <svg width="150" height="40" className="overflow-visible">
                            <line
                                x1="10"
                                y1="30"
                                x2="140"
                                y2="30"
                                stroke="#4ade80"
                                strokeWidth="1"
                            />
                            <line
                                x1="10"
                                y1="25"
                                x2="10"
                                y2="35"
                                stroke="#4ade80"
                                strokeWidth="1"
                            />
                            <line
                                x1="140"
                                y1="25"
                                x2="140"
                                y2="35"
                                stroke="#4ade80"
                                strokeWidth="1"
                            />
                            <text
                                x="75"
                                y="20"
                                textAnchor="middle"
                                fill="#4ade80"
                                fontSize={10 * drawingSettings.dimScale}
                                fontFamily="monospace"
                            >
                                {(100.23456).toFixed(drawingSettings.dimPrecision)}
                            </text>
                        </svg>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderUserInfo = () => {
        if (editingProfile) {
            return (
                <div className="flex flex-col h-full bg-cad-bg">
                    <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                        <h3 className="text-sm font-bold text-cad-text">{t("panel.editProfile")}</h3>
                        <button
                            onClick={() => setEditingProfile(false)}
                            className="p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-colors"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-cad-muted">{t("profile.username")}</label>
                            <input
                                type="text"
                                value={profileForm.username}
                                onChange={(e) =>
                                    setProfileForm({ ...profileForm, username: e.target.value })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-cad-muted">{t("profile.email")}</label>
                            <input
                                type="email"
                                value={profileForm.email}
                                onChange={(e) =>
                                    setProfileForm({ ...profileForm, email: e.target.value })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
                            />
                        </div>

                        {userMessage && (
                            <div
                                className={`p-3 rounded-lg border text-xs ${
                                    userMessage.type === "success"
                                        ? "bg-green-500/10 border-green-500/30 text-green-400"
                                        : "bg-red-500/10 border-red-500/30 text-red-400"
                                }`}
                            >
                                {userMessage.text}
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-cad-border flex gap-2 bg-cad-panel">
                        <button
                            onClick={() => setEditingProfile(false)}
                            className="flex-1 py-2 px-3 bg-cad-border/50 text-cad-text text-xs font-bold rounded hover:bg-cad-border/70 transition-colors"
                        >
                            {t("profile.cancel")}
                        </button>
                        <button
                            onClick={async () => {
                                try {
                                    const api = await import("../services/apiService");
                                    await api.apiService.updateProfile({
                                        username: profileForm.username,
                                        email: profileForm.email,
                                    });
                                    setUserMessage({
                                        type: "success",
                                        text: t("profile.updated"),
                                    });
                                    setTimeout(() => setEditingProfile(false), 1500);
                                } catch (e: any) {
                                    setUserMessage({
                                        type: "error",
                                        text: e.message || t("profile.updateFailed"),
                                    });
                                }
                            }}
                            className="flex-1 py-2 px-3 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors"
                        >
                            {t("profile.saveChanges")}
                        </button>
                    </div>
                </div>
            );
        }

        if (editingPassword) {
            return (
                <div className="flex flex-col h-full bg-cad-bg">
                    <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                        <h3 className="text-sm font-bold text-cad-text">{t("profile.changePassword")}</h3>
                        <button
                            onClick={() => setEditingPassword(false)}
                            className="p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-colors"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-cad-muted">
                                {t("profile.currentPassword")}
                            </label>
                            <input
                                type="password"
                                value={passwordForm.currentPassword}
                                onChange={(e) =>
                                    setPasswordForm({
                                        ...passwordForm,
                                        currentPassword: e.target.value,
                                    })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
                                placeholder={t("profile.currentPasswordPlaceholder")}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-cad-muted">{t("profile.newPassword")}</label>
                            <input
                                type="password"
                                value={passwordForm.newPassword}
                                onChange={(e) =>
                                    setPasswordForm({
                                        ...passwordForm,
                                        newPassword: e.target.value,
                                    })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
                                placeholder={t("profile.newPasswordPlaceholder")}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-cad-muted">
                                {t("profile.confirmPassword")}
                            </label>
                            <input
                                type="password"
                                value={passwordForm.confirmPassword}
                                onChange={(e) =>
                                    setPasswordForm({
                                        ...passwordForm,
                                        confirmPassword: e.target.value,
                                    })
                                }
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
                                placeholder={t("profile.confirmPasswordPlaceholder")}
                            />
                        </div>

                        {userMessage && (
                            <div
                                className={`p-3 rounded-lg border text-xs ${
                                    userMessage.type === "success"
                                        ? "bg-green-500/10 border-green-500/30 text-green-400"
                                        : "bg-red-500/10 border-red-500/30 text-red-400"
                                }`}
                            >
                                {userMessage.text}
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-cad-border flex gap-2 bg-cad-panel">
                        <button
                            onClick={() => {
                                setEditingPassword(false);
                                setPasswordForm({
                                    currentPassword: "",
                                    newPassword: "",
                                    confirmPassword: "",
                                });
                            }}
                            className="flex-1 py-2 px-3 bg-cad-border/50 text-cad-text text-xs font-bold rounded hover:bg-cad-border/70 transition-colors"
                        >
                            {t("profile.cancel")}
                        </button>
                        <button
                            onClick={async () => {
                                if (passwordForm.newPassword !== passwordForm.confirmPassword) {
                                    setUserMessage({
                                        type: "error",
                                        text: t("profile.passwordMismatch"),
                                    });
                                    return;
                                }
                                if (passwordForm.newPassword.length < 6) {
                                    setUserMessage({
                                        type: "error",
                                        text: t("profile.passwordTooShort"),
                                    });
                                    return;
                                }
                                try {
                                    const api = await import("../services/apiService");
                                    await api.apiService.changePassword({
                                        currentPassword: passwordForm.currentPassword,
                                        newPassword: passwordForm.newPassword,
                                    });
                                    setUserMessage({
                                        type: "success",
                                        text: t("profile.passwordChanged"),
                                    });
                                    setTimeout(() => {
                                        setEditingPassword(false);
                                        setPasswordForm({
                                            currentPassword: "",
                                            newPassword: "",
                                            confirmPassword: "",
                                        });
                                    }, 1500);
                                } catch (e: any) {
                                    setUserMessage({
                                        type: "error",
                                        text: e.message || t("profile.passwordChangeFailed"),
                                    });
                                }
                            }}
                            className="flex-1 py-2 px-3 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors"
                        >
                            {t("profile.updatePassword")}
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex flex-col h-full bg-cad-bg">
                <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                    <h3 className="text-sm font-bold text-cad-text">{t("panel.userProfile")}</h3>
                    <button
                        onClick={() => onChangeMode(SidePanelMode.SETTINGS)}
                        className="p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-colors"
                        title={t("profile.settings")}
                    >
                        <span className="material-symbols-outlined text-[20px]">settings</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {/* User Avatar & Basic Info */}
                    <div className="p-6 flex flex-col items-center border-b border-cad-border bg-cad-panel">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] flex items-center justify-center text-white text-2xl font-bold shadow-lg mb-4">
                            {currentUser?.username?.substring(0, 2).toUpperCase() || "U"}
                        </div>
                        <h4 className="text-lg font-bold text-cad-text">
                            {currentUser?.username || t("profile.userFallback")}
                        </h4>
                        <p className="text-xs text-cad-muted mt-1">{currentUser?.email || ""}</p>
                        <span className="mt-3 px-3 py-1 bg-cad-primary/20 text-cad-primary text-xs font-semibold rounded-full border border-cad-primary/30">
                            {t("profile.engineer")}
                        </span>
                    </div>

                    {/* Account Details */}
                    <div className="p-4 space-y-4">
                        <div className="space-y-3">
                            <h5 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                                {t("profile.accountDetails")}
                            </h5>

                            <div className="bg-cad-panel rounded-lg border border-cad-border p-3 space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-cad-muted">
                                        {t("profile.userId")}
                                    </span>
                                    <span className="text-xs font-mono text-cad-text truncate max-w-[150px]">
                                        {currentUser?.id || t("profile.na")}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-cad-muted">
                                        {t("profile.memberSince")}
                                    </span>
                                    <span className="text-xs text-cad-text">
                                        {currentUser?.createdAt
                                            ? new Date(currentUser.createdAt).toLocaleDateString()
                                            : t("profile.na")}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="space-y-3">
                            <h5 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
                                {t("profile.quickActions")}
                            </h5>

                            <button
                                onClick={() => {
                                    setEditingProfile(true);
                                    setProfileForm({
                                        username: currentUser?.username || "",
                                        email: currentUser?.email || "",
                                    });
                                }}
                                className="w-full flex items-center gap-3 p-3 bg-cad-panel hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
                            >
                                <span className="material-symbols-outlined text-[18px] text-cad-primary">
                                    account_circle
                                </span>
                                <div>
                                    <p className="text-xs font-semibold text-cad-text">
                                        {t("panel.editProfile")}
                                    </p>
                                    <p className="text-[10px] text-cad-muted">
                                        {t("panel.updateInfo")}
                                    </p>
                                </div>
                            </button>

                            <button
                                onClick={() => {
                                    setEditingPassword(true);
                                    setPasswordForm({
                                        currentPassword: "",
                                        newPassword: "",
                                        confirmPassword: "",
                                    });
                                }}
                                className="w-full flex items-center gap-3 p-3 bg-cad-panel hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
                            >
                                <span className="material-symbols-outlined text-[18px] text-cad-primary">
                                    security
                                </span>
                                <div>
                                    <p className="text-xs font-semibold text-cad-text">
                                        {t("profile.changePassword")}
                                    </p>
                                    <p className="text-[10px] text-cad-muted">
                                        {t("profile.changePasswordHint")}
                                    </p>
                                </div>
                            </button>

                            <a
                                href="https://github.com/AIIgnite/AIIgniteCAD/issues"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full flex items-center gap-3 p-3 bg-cad-panel hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
                            >
                                <span className="material-symbols-outlined text-[18px] text-cad-primary">
                                    help
                                </span>
                                <div>
                                    <p className="text-xs font-semibold text-cad-text">
                                        {t("profile.helpSupport")}
                                    </p>
                                    <p className="text-[10px] text-cad-muted">
                                        {t("profile.getAssistance")}
                                    </p>
                                </div>
                            </a>
                        </div>

                        {/* Logout Button */}
                        <div className="pt-4 border-t border-cad-border">
                            <button
                                onClick={onLogout}
                                className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 hover:text-red-400 rounded-lg border border-red-500/30 transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    logout
                                </span>
                                <span className="text-xs font-bold">{t("panel.logout")}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const handleLocateReviewIssue = (issue: ReviewIssue) => {
        setSelection(issue.elementIds);
        if (issue.bbox) zoomViewportToBounds(issue.bbox);
    };

    // 收起时不渲染整块面板，把画布面积完全让给绘图
    if (collapsed) return null;

    return (
        <div className="flex h-full shrink-0 z-20 shadow-xl shadow-black/50 border-l border-cad-border bg-cad-panel">
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
                {mode === SidePanelMode.SETTINGS && renderSettings()}
                {mode === SidePanelMode.USER_INFO && renderUserInfo()}
            </div>
        </div>
    );
};
