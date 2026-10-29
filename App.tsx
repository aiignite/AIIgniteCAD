/**
 * App.tsx — 应用主组件
 * 管理全局业务逻辑，组合各 UI 组件
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Header } from "./components/Header";
import { Toolbar } from "./components/Toolbar";
import { Canvas } from "./components/Canvas";
import { RightPanel } from "./components/RightPanel";
import FullScreenShell from "./components/FullScreenShell";
import DrawingReviewPanel from "./components/DrawingReviewPanel";
import DrawingsSection from "./components/settings/DrawingsSection";
import type { ReviewIssue } from "./lib/designReview";
import { Footer } from "./components/Footer";
import { LoginPage } from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";
import { WelcomeModal } from "./components/WelcomeModal";
import { AdvancedShapeModal } from "./components/AdvancedShapeModal";
import { HatchModal } from "./components/HatchModal";
import { VersionHistoryModal } from "./components/VersionHistoryModal";
import { AIPreviewModal } from "./components/AIPreviewModal";
import { PlotModal } from "./components/PlotModal";
import { QuickSelectModal } from "./components/QuickSelectModal";
import ImageTraceModal from "./components/ImageTraceModal";
import MenuBar from "./components/MenuBar";
import SettingsView from "./components/SettingsView";
import ShortcutsModal from "./components/ShortcutsModal";
import AIAssistantWindow from "./components/ai/AIAssistantWindow";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "./components/ContextMenu";
import {
    ToolType,
    CADElement,
    Point,
    ProjectFile,
    AIActionResponse,
    DesignConventions,
    BlockDefinition,
} from "./types";
import { useCanvas } from "./store/canvasStore";
import { useApp } from "./store/appStore";
import { useDrawingFiles } from "./hooks/useDrawingFiles";
import { useCollaboration } from "./hooks/useCollaboration";
import { useAlignDistribute } from "./hooks/useAlignDistribute";
import { apiService } from "./services/apiService";
import { indexedDBService } from "./services/indexedDBService";
import { syncService } from "./services/syncService";
import { getCanvasStatus } from "./store/canvasStatus";
import { telemetryService } from "./services/telemetryService";
import { createBlock, getBlock } from "./services/blockService";
import { getExampleDrawing } from "./services/examples";
import { parseDXF, exportToDXFWithReport } from "./services/dxfService";
import { isDwgFile, parseDrawingFileWithReport } from "./services/drawingImport";
import { createHatch } from "./services/hatchService";
import { isEditableTarget } from "./lib/keyboard";
import { executeCommand } from "./lib/commands/registry";
import { buildVersionSnapshot } from "./lib/versionSnapshot";
import {
    createDefaultDrawingSettings,
    createDefaultLayers,
} from "./lib/projectDocument";
import { summarizeElementTypes } from "./lib/versionDiff";
import { computeAIActionOutcome } from "./lib/aiActions";
import { planAIGhostPreview } from "./lib/aiGhost";
import { useI18n } from "./lib/i18n";
import {
    countHiddenObjects,
    displayableElements,
    isolateIds,
    mergeHiddenIds,
} from "./lib/isolation";
import { groupElements, ungroupElements } from "./lib/groups";
import {
    isCanvasModeKey,
    modifierKeyLabel,
    resolveActionShortcut,
    resolveToolShortcut,
} from "./lib/shortcuts";
import { toolLabel } from "./lib/toolHints";
import {
    type MenuActionId,
    type MenuItem,
    type MenuToggleId,
    type SettingsSection,
} from "./lib/menus";
import { ZOOM_STEP } from "./lib/viewport";
import {
    getViewBox,
    resetViewport,
    setViewBox,
    zoomViewportBy,
    zoomViewportToBounds,
} from "./store/viewport";
import { elementClipboard } from "./store/clipboard";
import { createBlockReference, explodeBlockReference } from "./lib/block";
import { GROUP_ID_PREFIX } from "./lib/groups";
import * as Transform from "./lib/transform";
import { loadNamedViews, saveNamedView as persistNamedView } from "./services/namedViews";
import { loadDrawingElements } from "./services/drawingLoader";
import { buildXrefInsert } from "./lib/crossDrawing";
import { getElementBoundingBox } from "./lib/geometry";
import type { DrawingFacts } from "./lib/projectConsistency";
import type { TurnMeta } from "./hooks/useAIChat";
import {
    generateGear,
    generatePolygon,
    generateEllipse,
    generateSpiral,
    generateSpring,
    generateInvolute,
} from "./services/advancedShapesService";

/** 超过该数量的删除需要二次确认，避免误删整片图形 */
const BULK_DELETE_THRESHOLD = 5;

/** AI 变更后脉冲高亮的时长，与 index.css 的 cad-ai-flash 动画保持一致 */
const AI_FLASH_MS = 1200;

/** 菜单里的绘图辅助命令用哪个功能键触发，和菜单栏显示的键位一致 */
const TOGGLE_MODE_KEYS: Record<MenuToggleId, string> = {
    snap: "F3",
    grid: "F7",
    ortho: "F8",
    polar: "F10",
};

interface AIPreviewState {
    actions: AIActionResponse[];
    beforeElements: CADElement[];
    afterElements: CADElement[];
    selection?: string[];
    /** 来自 Agent 回合的元信息，用于把采纳/放弃结果回写服务端 */
    turn?: TurnMeta;
}

function App() {
    const { t, locale } = useI18n();
    const startupRef = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    /** 最近一次执行的命令，供 Space 重复 */
    const lastCommandRef = useRef<string | null>(null);
    /** handleCommand 每次渲染重建；keydown 闭包经 ref 取最新（声明在其后，effect 回填） */
    const handleCommandRef = useRef<(cmd: string) => void>(() => undefined);
    const propertyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const aiFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [showWelcomeModal, setShowWelcomeModal] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    // Canvas state from store
    const {
        state: canvasState,
        selectedIds,
        setSelection,
        clearSelection,
        addElement,
        updateElement,
        commitAction,
        commitCurrent,
        getElements,
        setActiveTool,
        undo,
        redo,
        resetCanvas,
        addLayer,
        setCurrentLayer,
        dispatch: canvasDispatch,
    } = useCanvas();
    const { elements, activeTool, drawingSettings, snapMode, gridMode, orthoMode, polarMode } =
        canvasState;
    const selectedElements = useMemo(
        () => elements.filter((el) => selectedIds.has(el.id)),
        [elements, selectedIds],
    );
    const versionSnapshot = useMemo(
        () =>
            buildVersionSnapshot(
                elements,
                {
                    layerOrder: canvasState.layerOrder,
                    layerColors: canvasState.layerColors,
                    hiddenLayers: canvasState.hiddenLayers,
                    lockedLayers: canvasState.lockedLayers,
                },
                drawingSettings,
            ),
        [
            elements,
            canvasState.layerOrder,
            canvasState.layerColors,
            canvasState.hiddenLayers,
            canvasState.lockedLayers,
            drawingSettings,
        ],
    );

    // App state from store
    const {
        state: appState,
        setLoggedIn,
        setCurrentUser,
        setFiles,
        setActiveFile,
        setSidePanelOpen,
        setLoading,
        showNotification,
        clearNotification,
    } = useApp();
    const {
        isLoggedIn,
        currentUser,
        files,
        activeFile,
        sidePanelOpen,
        loading,
        notification,
    } = appState;

    // 实验性实时协作：关闭时不建立连接，也不影响单机编辑
    useCollaboration();

    // 记录工具切换，作为错误上报时的操作序列
    useEffect(() => {
        telemetryService.recordAction("tool-change", { tool: activeTool });
    }, [activeTool]);

    // --- UI STATE (local modals) ---
    const [showTextModal, setShowTextModal] = useState(false);
    const [textInputPos, setTextInputPos] = useState<Point | null>(null);
    const [textInputValue, setTextInputValue] = useState("");
    const [showAdvancedShapeModal, setShowAdvancedShapeModal] = useState(false);
    const [pendingShapePosition, setPendingShapePosition] = useState<Point | null>(null);
    const [pendingShapeTool, setPendingShapeTool] = useState<ToolType | null>(null);
    const [showHatchModal, setShowHatchModal] = useState(false);
    const [selectedForHatch, setSelectedForHatch] = useState<CADElement[]>([]);
    const [showVersionHistory, setShowVersionHistory] = useState(false);
    const [showPlot, setShowPlot] = useState(false);
    const [showQuickSelect, setShowQuickSelect] = useState(false);
    const [showImageTrace, setShowImageTrace] = useState(false);
    /** 图纸检查满屏窗体；原右侧栏承载，现与版本历史同款骨架 */
    const [showReview, setShowReview] = useState(false);
    /** 图纸清单满屏窗体（文件菜单 / 工具栏入口） */
    const [showDrawings, setShowDrawings] = useState(false);
    const [aiOpen, setAiOpen] = useState(false);
    /** 快捷键速查表 */
    const [showShortcuts, setShowShortcuts] = useState(false);
    /** 设置页打开时所在的分区；null 表示未打开 */
    const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
    const [aiPreview, setAiPreview] = useState<AIPreviewState | null>(null);
    const [flashIds, setFlashIds] = useState<Set<string> | null>(null);
    /** 「问 AI」写入对话草稿；nonce 递增表示一次新的请求 */
    const [chatDraft, setChatDraft] = useState<{ text: string; nonce: number } | null>(null);
    const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
    /** 隔离 / 隐藏对象的临时隐藏集：纯视图态，不入 store、不进撤销历史 */
    const [hiddenIds, setHiddenIds] = useState<string[]>([]);
    const hiddenObjectIds = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const hiddenCount = useMemo(
        () => countHiddenObjects(elements, hiddenObjectIds),
        [elements, hiddenObjectIds],
    );
    /**
     * 项目内图纸的清单级事实：跨图纸一致性检查与 AI 的项目视图共用。
     * 当前图纸用实时图元数，其余用列表里的计数（不为此逐张加载图纸）。
     */
    const drawingFacts = useMemo<DrawingFacts[]>(
        () =>
            files.map((file) => ({
                id: file.id,
                name: file.name,
                elementCount:
                    file.id === activeFile?.id
                        ? elements.length
                        : (file.elementCount ?? file.elements?.length ?? 0),
                conventions: file.designConventions ?? null,
            })),
        [files, activeFile?.id, elements.length],
    );
    /** 右键上下文菜单：菜单项在打开瞬间按当前选择集生成 */
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        items: ContextMenuItem[];
    } | null>(null);

    /** 弹窗打开时不响应单键快捷键，避免误触切换工具 */
    const modalOpen =
        showTextModal ||
        showAdvancedShapeModal ||
        showHatchModal ||
        showVersionHistory ||
        showPlot ||
        showQuickSelect ||
        showImageTrace ||
        showWelcomeModal ||
        showShortcuts ||
        settingsSection !== null ||
        showReview ||
        showDrawings ||
        aiPreview !== null ||
        pendingDeleteIds !== null ||
        activeTool === ToolType.ARRAY;

    /** AI 落图后让受影响图元脉冲一次，帮用户定位"改在了哪里" */
    const flashElements = useCallback((ids: string[]) => {
        if (ids.length === 0) return;
        if (aiFlashTimerRef.current) clearTimeout(aiFlashTimerRef.current);
        setFlashIds(new Set(ids));
        aiFlashTimerRef.current = setTimeout(() => {
            setFlashIds(null);
            aiFlashTimerRef.current = null;
        }, AI_FLASH_MS);
    }, []);

    useEffect(
        () => () => {
            if (aiFlashTimerRef.current) clearTimeout(aiFlashTimerRef.current);
        },
        [],
    );

    // Auto-clear notification
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(clearNotification, 3000);
            return () => clearTimeout(timer);
        }
    }, [notification, clearNotification]);

    /** 立即提交尚未落盘的属性编辑（撤销/重做/手动保存前调用） */
    const flushPropertyCommit = useCallback(() => {
        if (!propertyCommitTimerRef.current) return;
        clearTimeout(propertyCommitTimerRef.current);
        propertyCommitTimerRef.current = null;
        commitCurrent();
    }, [commitCurrent]);

    // 图纸文件管理与文档持久化：统一 ProjectDocument（图元 + 图层 + 设置 + 约定）
    const {
        handleSave,
        activateNewFile,
        handleSaveVersion,
        handleOpenVersionHistory,
        handleRestoreVersion,
        handleLoadFile,
        handleCreateFile,
        handleRenameFile,
        handleDeleteFile,
        noteProjectRemapped,
    } = useDrawingFiles({
        isLoggedIn,
        flushPropertyCommit,
        setHiddenIds,
        onOpenVersionHistory: () => setShowVersionHistory(true),
    });

    // 同步事件：冲突提示与离线新建后的项目 id 迁移
    useEffect(() => {
        return syncService.onEvent((event) => {
            if (event.type === "conflict") {
                showNotification(t("notify.syncConflict", { name: event.projectName }));
                return;
            }

            if (event.type === "sync-error") {
                showNotification(t("notify.syncFailed", { message: event.message }));
                telemetryService.reportSyncError(event.message, {
                    projectId: event.projectId,
                });
                return;
            }

            setFiles(
                files.map((file) =>
                    file.id === event.oldId
                        ? { ...file, id: event.newId, chatKey: file.chatKey ?? event.oldId }
                        : file,
                ),
            );
            if (activeFile?.id === event.oldId) {
                setActiveFile({
                    ...activeFile,
                    id: event.newId,
                    chatKey: activeFile.chatKey ?? event.oldId,
                });
            }
            noteProjectRemapped(event.oldId, event.newId);
        });
    }, [files, activeFile, showNotification, setFiles, setActiveFile, t, noteProjectRemapped]);

    // 前端遥测：全局错误由 service 监听，这里同步上报积压状态
    useEffect(() => {
        telemetryService.init();
        telemetryService.reportSyncStatus(syncService.getSnapshot());
        return syncService.subscribe(() => {
            telemetryService.reportSyncStatus(syncService.getSnapshot());
        });
    }, []);

    /** 属性面板连续输入合并为一步撤销：停止输入 400ms 后才提交历史 */
    const handlePropertyUpdate = useCallback(
        (el: CADElement) => {
            updateElement(el);
            if (propertyCommitTimerRef.current) clearTimeout(propertyCommitTimerRef.current);
            propertyCommitTimerRef.current = setTimeout(() => {
                propertyCommitTimerRef.current = null;
                commitCurrent();
            }, 400);
        },
        [updateElement, commitCurrent],
    );

    const handleUndo = useCallback(() => {
        flushPropertyCommit();
        undo();
    }, [flushPropertyCommit, undo]);

    const handleRedo = useCallback(() => {
        flushPropertyCommit();
        redo();
    }, [flushPropertyCommit, redo]);

    /**
     * 插入块（符号展开复制）：
     * 把块定义展开为普通图元并共享 groupId，整体可移动、可解散。
     * 语义说明：这是"展开复制"而不是持续关联的块引用——编辑块定义不会
     * 传播到已插入的实例；需要新形态时应重新插入。
     */
    const insertBlockElements = useCallback(
        (blockDef: BlockDefinition, position: Point) => {
            // 定义内图元已相对基点归一化，插入点减去基点得到平移量
            const reference = createBlockReference(
                blockDef.id,
                { x: position.x - blockDef.basePoint.x, y: position.y - blockDef.basePoint.y },
                canvasState.currentLayer,
            );
            const expanded = explodeBlockReference(reference, blockDef);
            if (expanded.length === 0) {
                showNotification(t("notify.blockInsertFailed"));
                return 0;
            }
            const groupId = `${GROUP_ID_PREFIX}${Math.random().toString(36).slice(2, 9)}`;
            const inserted = expanded.map((element) => ({ ...element, groupId }));
            commitAction([...getElements(), ...inserted]);
            setSelection(inserted.map((element) => element.id));
            showNotification(
                t("notify.blockInserted", { name: blockDef.name, count: inserted.length }),
            );
            return inserted.length;
        },
        [canvasState.currentLayer, commitAction, getElements, setSelection, showNotification, t],
    );

    /** 面板按钮插入：展开到当前视口中心 */
    const handleInsertBlock = useCallback(
        (blockDef: BlockDefinition) => {
            const viewBox = getViewBox();
            insertBlockElements(blockDef, {
                x: viewBox.x + viewBox.w / 2,
                y: viewBox.y + viewBox.h / 2,
            });
        },
        [insertBlockElements],
    );

    const handleBlockDrop = useCallback(
        async (blockId: string, position: Point) => {
            try {
                setLoading(true);
                const blockDef = await getBlock(blockId);
                if (!blockDef) {
                    showNotification(t("notify.blockNotFound", { name: blockId }));
                    return;
                }
                insertBlockElements(blockDef, position);
            } catch (e: any) {
                console.error(e);
                showNotification(t("notify.blockInsertFailed"));
            } finally {
                setLoading(false);
            }
        },
        [getBlock, insertBlockElements, setLoading, showNotification, t],
    );

    /**
     * 跨图纸快照插入：把另一张图纸的图元一次性复制进当前图纸。
     * 与块插入同一取舍（展开复制 + 共享 groupId），不做持续引用，
     * 因此不会出现外部引用丢失、循环引用或版本漂移。
     */
    const handleInsertDrawingSnapshot = useCallback(
        async (file: ProjectFile) => {
            if (!activeFile || file.id === activeFile.id) return;
            try {
                setLoading(true);
                const sourceElements = await loadDrawingElements(file.id);
                if (!sourceElements) {
                    showNotification(t("notify.xrefLoadFailed", { name: file.name }));
                    return;
                }
                const current = getElements();
                // 目标点放在当前内容右侧、纵向对齐左下角；空图从原点开始
                let target: Point = { x: 0, y: 0 };
                if (current.length > 0) {
                    let minY = Infinity;
                    let maxX = -Infinity;
                    for (const element of current) {
                        const box = getElementBoundingBox(element);
                        minY = Math.min(minY, box.minY, box.maxY);
                        maxX = Math.max(maxX, box.minX, box.maxX);
                    }
                    if (Number.isFinite(minY) && Number.isFinite(maxX)) {
                        target = { x: maxX + 50, y: minY };
                    }
                }
                const insert = buildXrefInsert(
                    { id: file.id, name: file.name, elements: sourceElements },
                    { target },
                );
                if (insert.elements.length === 0) {
                    showNotification(t("notify.xrefEmpty", { name: file.name }));
                    return;
                }
                commitAction([...current, ...insert.elements]);
                setSelection(insert.selection);
                const notes = [
                    t("notify.xrefInserted", { name: file.name, count: insert.elements.length }),
                ];
                if (insert.skipped > 0) {
                    notes.push(t("notify.xrefSkipped", { count: insert.skipped }));
                }
                if (insert.truncated > 0) {
                    notes.push(t("notify.xrefTruncated", { count: insert.truncated }));
                }
                showNotification(notes.join(" · "));
            } catch (error) {
                console.error(error);
                showNotification(t("notify.xrefLoadFailed", { name: file.name }));
            } finally {
                setLoading(false);
            }
        },
        [activeFile, commitAction, getElements, setLoading, setSelection, showNotification, t],
    );

    // Load user and projects on mount（放在 loadUserAndProjects 定义之后，避免 TDZ 访问）
    useEffect(() => {
        if (!startupRef.current && !loading) {
            startupRef.current = true;
        }
    }, [loading, activeFile]);

    const loadUserAndProjects = async () => {
        try {
            setLoading(true);
            const userData = await apiService.getCurrentUser();
            setCurrentUser(userData.user);
            await indexedDBService.saveUser({
                ...userData.user,
                updatedAt: userData.user.updatedAt ?? userData.user.createdAt,
            }).catch((error) => {
                console.error("Failed to cache user:", error);
            });
            const projectsData = await apiService.getProjects();
            setFiles(projectsData.projects);
            setLoggedIn(true);
            await syncService.refreshStatus();
            syncService.requestFlush();
        } catch (error: any) {
            const status = typeof error?.status === "number" ? error.status : undefined;
            if (status === 401 || status === 404) {
                console.error("Failed to load user data:", error);
                apiService.clearToken();
                setLoggedIn(false);
                return;
            }

            // 网络或服务端故障不应把有效登录态判成失效：保留 token，进入本地图纸模式
            console.error("Failed to load user data; using local projects:", error);
            const [localProjects, localUser] = await Promise.all([
                indexedDBService.getAllProjects(),
                indexedDBService.getCurrentUser(),
            ]);
            setFiles(localProjects);
            if (localUser) setCurrentUser(localUser);
            setLoggedIn(true);
            showNotification(t("notify.offlineProjectsLoaded"));
        } finally {
            setLoading(false);
        }
    };

    // 首次挂载：初始化本地数据库，登录态则拉取用户与项目
    useEffect(() => {
        const init = async () => {
            try {
                await indexedDBService.init();
                syncService.init();
                if (apiService.isAuthenticated()) {
                    await loadUserAndProjects();
                    setShowWelcomeModal(true);
                } else {
                    const localProjects = await indexedDBService.getAllProjects();
                    setFiles(localProjects);
                }
            } catch (e) {
                console.error("Initialization error:", e);
            }
        };
        init();
    }, []);

    const handleLogin = async (email: string, password: string) => {
        try {
            setLoading(true);
            const data = await apiService.login(email, password);
            setCurrentUser(data.user);
            await loadUserAndProjects();
            setShowWelcomeModal(true);
        } catch (error: any) {
            showNotification(error.message || t("auth.loginFailed"));
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async (username: string, email: string, password: string) => {
        try {
            setLoading(true);
            const data = await apiService.register(username, email, password);
            setCurrentUser(data.user);
            await loadUserAndProjects();
            setShowWelcomeModal(true);
        } catch (error: any) {
            showNotification(error.message || t("auth.registerFailed"));
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        try {
            await apiService.logout();
            setCurrentUser(null);
            setFiles([]);
            setActiveFile(null);
            resetCanvas();
            setLoggedIn(false);
            showNotification(t("notify.loggedOut"));
        } catch (error: any) {
            console.error("Logout error:", error);
        }
    };

    /** 打开设置页的指定分区（工具面板与菜单都指向同一个界面） */
    const openSettings = useCallback((section: SettingsSection) => {
        setSettingsSection(section);
    }, []);

    /** 把当前图纸导出为 DXF 文件（坐标按图纸单位换算，$INSUNITS 同步声明） */
    const handleExportDXF = useCallback(() => {
        const { dxf, report } = exportToDXFWithReport(getElements(), {
            units: canvasState.drawingSettings.units,
        });
        const blob = new Blob([dxf], { type: "application/dxf" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `drawing-${Date.now()}.dxf`;
        anchor.click();
        URL.revokeObjectURL(url);
        const skippedCount = report.skipped.reduce((sum, entry) => sum + entry.count, 0);
        if (skippedCount > 0) {
            showNotification(
                t("notify.dxfExportSkipped", {
                    count: skippedCount,
                    types: report.skipped.map((entry) => entry.type).join(", "),
                }),
            );
        }
    }, [getElements, canvasState.drawingSettings.units, showNotification, t]);

    /** F3 / F7 / F8 / F10 分别切换捕捉、栅格、正交与极轴（沿用 AutoCAD 键位） */
    const toggleCanvasMode = useCallback(
        (key: string): { label: string; on: boolean } | null => {
            switch (key) {
                case "F3": {
                    const on = !snapMode;
                    canvasDispatch({ type: "SET_SNAP_MODE", value: on });
                    return { label: t("footer.snapToggle"), on };
                }
                case "F7": {
                    const on = !gridMode;
                    canvasDispatch({ type: "SET_GRID_MODE", value: on });
                    return { label: t("footer.grid"), on };
                }
                case "F8": {
                    const on = !orthoMode;
                    canvasDispatch({ type: "SET_ORTHO_MODE", value: on });
                    return { label: t("footer.ortho"), on };
                }
                case "F10": {
                    const on = !polarMode;
                    canvasDispatch({ type: "SET_POLAR_MODE", value: on });
                    return { label: t("footer.polar"), on };
                }
                default:
                    return null;
            }
        },
        [snapMode, gridMode, orthoMode, polarMode, canvasDispatch, t],
    );

    /** 功能键与菜单勾选共用一条切换路径，保证两处都给出同样的状态提示 */
    const toggleView = useCallback(
        (key: string) => {
            const toggled = toggleCanvasMode(key);
            if (!toggled) return;
            showNotification(
                toggled.on
                    ? t("notify.modeOn", { name: toggled.label })
                    : t("notify.modeOff", { name: toggled.label }),
            );
        },
        [toggleCanvasMode, showNotification, t],
    );

    /** 复制选中的图元到剪贴板 */
    const handleCopySelection = useCallback(() => {
        const selected = getElements().filter((el) => selectedIds.has(el.id));
        if (selected.length === 0) {
            showNotification(t("notify.copyNothing"));
            return;
        }
        elementClipboard.write(selected);
        showNotification(t("notify.copied", { count: selected.length }));
    }, [getElements, selectedIds, showNotification, t]);

    /**
     * 粘贴剪贴板中的图元。
     * 副本重新生成 id 并脱离组合，因此粘贴后可逐个单独选中移动。
     * 连续粘贴按步进逐次错开，避免多次粘贴的副本完全重叠。
     */
    const handlePasteClipboard = useCallback(() => {
        const buffer = elementClipboard.read();
        if (buffer.length === 0) {
            showNotification(t("notify.clipboardEmpty"));
            return;
        }
        const view = getViewBox();
        const step = elementClipboard.nextPasteStep();
        const copies = Transform.copyElements(buffer, {
            x: view.w * 0.02 * step,
            y: view.h * 0.02 * step,
        });
        commitAction([...getElements(), ...copies]);
        setSelection(copies.map((el) => el.id));
        showNotification(t("notify.pasted", { count: copies.length }));
    }, [commitAction, getElements, setSelection, showNotification, t]);

    /** 删除当前选择集：达到阈值时要求显式确认，避免误删整片图形 */
    const requestDeleteSelection = useCallback(() => {
        if (activeTool !== ToolType.SELECT || selectedIds.size === 0) return;
        if (selectedIds.size >= BULK_DELETE_THRESHOLD) {
            setPendingDeleteIds([...selectedIds]);
            return;
        }
        const ids = new Set(selectedIds);
        commitAction(getElements().filter((el) => !ids.has(el.id)));
        clearSelection();
        showNotification(t("notify.deleted", { count: ids.size }));
    }, [activeTool, selectedIds, commitAction, getElements, clearSelection, showNotification, t]);

    /** 把选中的图元聚为一个组合 */
    const handleGroupSelection = useCallback(() => {
        if (selectedIds.size < 2) {
            showNotification(t("notify.groupNeedMore"));
            return;
        }
        commitAction(groupElements(getElements(), selectedIds));
        showNotification(t("notify.grouped", { count: selectedIds.size }));
    }, [commitAction, getElements, selectedIds, showNotification, t]);

    /** 解散选中图元所在的组合 */
    const handleUngroupSelection = useCallback(() => {
        const current = getElements();
        const next = ungroupElements(current, selectedIds);
        if (next === current) {
            showNotification(t("notify.notGrouped"));
            return;
        }
        commitAction(next);
        showNotification(t("notify.ungrouped"));
    }, [commitAction, getElements, selectedIds, showNotification, t]);

    /** 隐藏选中图元：只改视图态，不进撤销历史 */
    const handleHideSelection = useCallback(() => {
        if (selectedIds.size === 0) return;
        const ids = getElements()
            .filter((el) => selectedIds.has(el.id))
            .map((el) => el.id);
        setHiddenIds(mergeHiddenIds(hiddenObjectIds, ids));
        clearSelection();
        showNotification(t("notify.hidden", { count: ids.length }));
    }, [clearSelection, getElements, hiddenObjectIds, selectedIds, showNotification, t]);

    /** 隔离：隐藏除选择集以外的全部可见图元 */
    const handleIsolateSelection = useCallback(() => {
        if (selectedIds.size === 0) return;
        setHiddenIds(isolateIds(getElements(), canvasState.hiddenLayers, selectedIds));
        showNotification(t("notify.isolated", { count: selectedIds.size }));
    }, [canvasState.hiddenLayers, getElements, selectedIds, showNotification, t]);

    /** 全选：选中所有可见且未锁定的图元 */
    const handleSelectAll = useCallback(() => {
        const visible = displayableElements(
            getElements(),
            canvasState.hiddenLayers,
            hiddenObjectIds,
        ).filter((el) => !canvasState.lockedLayers.includes(el.layer || "0"));
        setSelection(visible.map((el) => el.id));
        showNotification(t("notify.selected", { count: visible.length }));
    }, [
        canvasState.hiddenLayers,
        canvasState.lockedLayers,
        getElements,
        hiddenObjectIds,
        setSelection,
        showNotification,
        t,
    ]);

    /** 缩放到全部可见图元 */
    const handleZoomExtents = useCallback(() => {
        const visible = displayableElements(
            getElements(),
            canvasState.hiddenLayers,
            hiddenObjectIds,
        );
        if (visible.length === 0) return;
        zoomViewportToBounds(Transform.getCombinedBoundingBox(visible));
    }, [canvasState.hiddenLayers, getElements, hiddenObjectIds]);

    /** 显示全部：清除隔离 / 隐藏对象产生的临时隐藏集 */
    const showAllObjects = useCallback(() => {
        if (hiddenObjectIds.size === 0) return;
        setHiddenIds([]);
        if (hiddenCount > 0) showNotification(t("notify.shownHidden", { count: hiddenCount }));
    }, [hiddenObjectIds, hiddenCount, showNotification, t]);

    /** 「问 AI」：打开 AI 浮窗，把针对选择集的问题写成草稿供用户改后发送 */
    const handleAskAboutSelection = useCallback(() => {
        const selected = getElements().filter((el) => selectedIds.has(el.id));
        if (selected.length === 0) return;
        setAiOpen(true);
        setChatDraft((prev) => ({
            text: t("notify.askSelection", {
                count: selected.length,
                types: summarizeElementTypes(selected),
            }),
            nonce: (prev?.nonce ?? 0) + 1,
        }));
    }, [getElements, selectedIds, t]);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    // 对齐 / 分布：右键菜单与属性面板共用的执行入口
    const { applyAlign, applyDistribute } = useAlignDistribute();

    /** 右键菜单：按当前选择集组装菜单项 */
    const openContextMenu = useCallback(
        (position: { client: Point; world: Point }) => {
            const mod = modifierKeyLabel();
            const items: ContextMenuItem[] = [];

            if (selectedIds.size > 0) {
                items.push(
                    {
                        id: "copy",
                        label: t("context.copy"),
                        icon: "content_copy",
                        shortcut: `${mod}+C`,
                        onSelect: handleCopySelection,
                    },
                    {
                        id: "paste",
                        label: t("context.paste"),
                        icon: "content_paste",
                        shortcut: `${mod}+V`,
                        onSelect: handlePasteClipboard,
                    },
                    {
                        id: "move",
                        label: t("context.move"),
                        icon: "open_with",
                        separator: true,
                        onSelect: () => setActiveTool(ToolType.SELECT),
                    },
                    {
                        id: "copyTool",
                        label: t("context.copyTool"),
                        icon: "content_copy",
                        onSelect: () => setActiveTool(ToolType.COPY),
                    },
                    {
                        id: "rotate",
                        label: t("context.rotate"),
                        icon: "rotate_right",
                        onSelect: () => setActiveTool(ToolType.ROTATE),
                    },
                    {
                        id: "scale",
                        label: t("context.scale"),
                        icon: "aspect_ratio",
                        onSelect: () => setActiveTool(ToolType.SCALE),
                    },
                    {
                        id: "mirror",
                        label: t("context.mirror"),
                        icon: "flip",
                        onSelect: () => setActiveTool(ToolType.MIRROR),
                    },
                    {
                        id: "offset",
                        label: t("context.offset"),
                        icon: "format_indent_increase",
                        onSelect: () => setActiveTool(ToolType.OFFSET),
                    },
                    {
                        id: "array",
                        label: t("context.array"),
                        icon: "grid_view",
                        onSelect: () => setActiveTool(ToolType.ARRAY),
                    },
                    ...(selectedIds.size >= 2
                        ? ([
                              {
                                  id: "alignLeft",
                                  label: t("context.alignLeft"),
                                  icon: "align_horizontal_left",
                                  separator: true,
                                  onSelect: () => applyAlign("left"),
                              },
                              {
                                  id: "alignRight",
                                  label: t("context.alignRight"),
                                  icon: "align_horizontal_right",
                                  onSelect: () => applyAlign("right"),
                              },
                              {
                                  id: "alignCenterX",
                                  label: t("context.alignCenterX"),
                                  icon: "align_horizontal_center",
                                  onSelect: () => applyAlign("centerX"),
                              },
                              {
                                  id: "alignTop",
                                  label: t("context.alignTop"),
                                  icon: "align_vertical_top",
                                  onSelect: () => applyAlign("top"),
                              },
                              {
                                  id: "alignBottom",
                                  label: t("context.alignBottom"),
                                  icon: "align_vertical_bottom",
                                  onSelect: () => applyAlign("bottom"),
                              },
                              {
                                  id: "alignCenterY",
                                  label: t("context.alignCenterY"),
                                  icon: "align_vertical_center",
                                  onSelect: () => applyAlign("centerY"),
                              },
                          ] as ContextMenuItem[])
                        : []),
                    ...(selectedIds.size >= 3
                        ? ([
                              {
                                  id: "distributeH",
                                  label: t("context.distributeH"),
                                  icon: "align_justify_space_between",
                                  onSelect: () => applyDistribute("horizontal"),
                              },
                              {
                                  id: "distributeV",
                                  label: t("context.distributeV"),
                                  icon: "align_justify_space_between",
                                  onSelect: () => applyDistribute("vertical"),
                              },
                          ] as ContextMenuItem[])
                        : []),
                    {
                        id: "group",
                        label: t("context.group"),
                        icon: "group_work",
                        separator: true,
                        onSelect: handleGroupSelection,
                    },
                    {
                        id: "ungroup",
                        label: t("context.ungroup"),
                        icon: "ungroup",
                        onSelect: handleUngroupSelection,
                    },
                    {
                        id: "hide",
                        label: t("context.hide"),
                        icon: "visibility_off",
                        onSelect: handleHideSelection,
                    },
                    {
                        id: "isolate",
                        label: t("context.isolate"),
                        icon: "center_focus_strong",
                        onSelect: handleIsolateSelection,
                    },
                    {
                        id: "askAi",
                        label: t("context.askAi"),
                        icon: "smart_toy",
                        separator: true,
                        onSelect: handleAskAboutSelection,
                    },
                    {
                        id: "delete",
                        label: t("context.delete"),
                        icon: "delete",
                        shortcut: "Del",
                        danger: true,
                        onSelect: requestDeleteSelection,
                    },
                );
            } else {
                items.push(
                    {
                        id: "selectAll",
                        label: t("context.selectAll"),
                        icon: "select_all",
                        shortcut: `${mod}+A`,
                        onSelect: handleSelectAll,
                    },
                    {
                        id: "paste",
                        label: t("context.paste"),
                        icon: "content_paste",
                        shortcut: `${mod}+V`,
                        onSelect: handlePasteClipboard,
                    },
                    {
                        id: "zoomExtents",
                        label: t("context.zoomExtents"),
                        icon: "crop_free",
                        separator: true,
                        onSelect: handleZoomExtents,
                    },
                );
                if (hiddenObjectIds.size > 0) {
                    items.push({
                        id: "showAll",
                        label: t("context.showAll"),
                        icon: "visibility",
                        onSelect: showAllObjects,
                    });
                }
            }

            setContextMenu({ x: position.client.x, y: position.client.y, items });
        },
        [
            applyAlign,
            applyDistribute,
            handleAskAboutSelection,
            handleCopySelection,
            handleGroupSelection,
            handleHideSelection,
            handleIsolateSelection,
            handlePasteClipboard,
            handleSelectAll,
            handleUngroupSelection,
            handleZoomExtents,
            hiddenObjectIds.size,
            requestDeleteSelection,
            selectedIds.size,
            setActiveTool,
            showAllObjects,
            t,
        ],
    );

    /** 设计约定面板保存：本地立即生效并随项目同步队列写回服务端 */
    const handleSaveDesignConventions = useCallback(
        async (conventions: DesignConventions | null) => {
            if (!activeFile) throw new Error(t("notify.openDrawingFirst"));
            // 必须用画布当前快照而不是 IDB 里的旧副本：同步队列的项目负载含图元，
            // 用旧副本会把自动保存窗口内（3s）的编辑回滚到服务端
            const snapshot = getElements();
            const updated: ProjectFile = {
                ...activeFile,
                elements: snapshot,
                elementCount: snapshot.length,
                designConventions: conventions,
                lastModified: new Date().toISOString(),
            };
            setActiveFile(updated);
            setFiles(files.map((file) => (file.id === updated.id ? updated : file)));
            await indexedDBService.saveProject(updated);
            await indexedDBService.saveElements(snapshot, updated.id);
            syncService.requestFlush();
        },
        [activeFile, files, getElements, t],
    );

    /** 图纸检查面板的「让 AI 修复」：预选相关图元并把问题摘要写进对话草稿 */
    const handleAskAIFix = useCallback(
        (prompt: string, ids: string[]) => {
            if (ids.length > 0) setSelection(ids);
            setAiOpen(true);
            setChatDraft((prev) => ({
                text: prompt,
                nonce: (prev?.nonce ?? 0) + 1,
            }));
        },
        [setSelection],
    );

    /** 图纸检查的「定位」：选中问题图元并缩放到包围盒 */
    const handleLocateReviewIssue = useCallback(
        (issue: ReviewIssue) => {
            setSelection(issue.elementIds);
            if (issue.bbox) zoomViewportToBounds(issue.bbox);
        },
        [setSelection],
    );

    // Command Line Handler：解析、别名、参数与执行全部委托给命令注册表
    const handleCommand = (cmd: string) => {
        // Space 重复上一条命令：记录最近一次非空命令
        if (cmd.trim()) lastCommandRef.current = cmd.trim();
        telemetryService.recordAction("command", { command: cmd });
        const outcome = executeCommand(cmd, {
            elements,
            selectedIds,
            selectedElements,
            orthoMode: canvasState.orthoMode,
            gridMode: canvasState.gridMode,
            snapMode: canvasState.snapMode,
            currentLayer: canvasState.currentLayer,
            layerOrder: canvasState.layerOrder,
            hiddenLayers: canvasState.hiddenLayers,
            lockedLayers: canvasState.lockedLayers,
            hiddenObjectIds,
            setHiddenObjectIds: setHiddenIds,
            setActiveTool,
            setSelection,
            clearSelection,
            commitAction,
            confirmBulkDelete: (ids) => {
                if (ids.length < BULK_DELETE_THRESHOLD) return true;
                setPendingDeleteIds(ids);
                return false;
            },
            showNotification,
            setOrthoMode: (value) => canvasDispatch({ type: "SET_ORTHO_MODE", value }),
            setGridMode: (value) => canvasDispatch({ type: "SET_GRID_MODE", value }),
            setSnapMode: (value) => canvasDispatch({ type: "SET_SNAP_MODE", value }),
            undo: handleUndo,
            redo: handleRedo,
            addLayer,
            setCurrentLayer,
            openPlot: () => setShowPlot(true),
            openQuickSelect: () => setShowQuickSelect(true),
            zoomToBounds: (bounds) => zoomViewportToBounds(bounds),
            currentViewBox: () => getViewBox(),
            saveNamedView: (view) => {
                persistNamedView(activeFile?.id ?? "", view);
                return true;
            },
            restoreNamedView: (name) => {
                const view = loadNamedViews(activeFile?.id ?? "").find(
                    (item) => item.name === name,
                );
                if (!view) return false;
                setViewBox(view.viewBox);
                return true;
            },
            listNamedViews: () => loadNamedViews(activeFile?.id ?? "").map((view) => view.name),
        });

        if (outcome.message) showNotification(outcome.message);
    };

    // AI Action Handler：单个动作直接执行；一批动作先预览，确认后一次性提交
    const runAIAction = useCallback(
        (operation: string, aiElements?: CADElement[], params?: any) => {
            // 连续应用多个工具调用时，必须读取最新图元，避免闭包拿到旧数组
            const baseElements = getElements();
            const selected = baseElements.filter((el) => selectedIds.has(el.id));
            return computeAIActionOutcome(operation, aiElements, params, baseElements, selected);
        },
        [getElements, selectedIds],
    );

    const handleAIAction = useCallback(
        (operation: string, aiElements?: CADElement[], params?: any) => {
            const outcome = runAIAction(operation, aiElements, params);
            if (!outcome) return;
            commitAction(outcome.elements);
            if (outcome.selection) {
                setSelection(outcome.selection);
                flashElements(outcome.selection);
            }
        },
        [runAIAction, commitAction, setSelection, flashElements],
    );

    const handleAIPreview = useCallback(
        (actions: AIActionResponse[], turn?: TurnMeta) => {
            if (actions.length === 0) return;
            const baseElements = getElements();
            let currentElements = baseElements;
            let currentSelection = new Set(selectedIds);
            let finalSelection: string[] | undefined;

            for (const action of actions) {
                if (!action.operation) continue;
                const selected = currentElements.filter((el) => currentSelection.has(el.id));
                const outcome = computeAIActionOutcome(
                    action.operation,
                    action.elements,
                    action.params,
                    currentElements,
                    selected,
                );
                if (!outcome) continue;
                currentElements = outcome.elements;
                if (outcome.selection) {
                    currentSelection = new Set(outcome.selection);
                    finalSelection = outcome.selection;
                }
            }

            // 建块/存版本不改画布，但同样需要在预览里确认后再执行
            const hasSideEffect = actions.some(
                (action) =>
                    action.operation === "SAVE_BLOCK" || action.operation === "SAVE_VERSION",
            );
            if (currentElements === baseElements && !hasSideEffect) return;
            setAiPreview({
                actions,
                beforeElements: baseElements,
                afterElements: currentElements,
                selection: finalSelection,
                turn,
            });
            showNotification(t("notify.aiPreviewReady"));
        },
        [getElements, selectedIds, showNotification, t],
    );

    /** 采纳率是评估 AI 输出的唯一真值来源，落库失败不影响本次操作 */
    const reportTurnOutcome = useCallback(
        (turn: TurnMeta | undefined, outcome: "applied" | "discarded", reason?: string) => {
            if (!turn?.sessionId) return;
            void apiService
                .recordTurnOutcome({
                    sessionId: turn.sessionId,
                    turnId: turn.turnId,
                    outcome,
                    reason,
                    changedIds: turn.changedIds,
                    skillCodes: turn.skillCodes,
                })
                .catch(() => undefined);
        },
        [],
    );

    const applyAIPreview = useCallback(async () => {
        if (!aiPreview) return;
        telemetryService.recordAction("apply-ai-preview", {
            actions: aiPreview.actions.length,
        });
        // 按差分增量落图：预览期间用户自己画的图元不会被整表覆盖丢弃
        const plan = planAIGhostPreview(aiPreview.beforeElements, aiPreview.afterElements);
        const incomingIds = new Set(plan.incoming.map((el) => el.id));
        const next = [
            ...getElements().filter(
                (el) => !plan.outgoingIds.has(el.id) && !incomingIds.has(el.id),
            ),
            ...plan.incoming,
        ];
        const changed = plan.incoming.length > 0 || plan.outgoingIds.size > 0;
        if (changed) {
            commitAction(next);
            if (aiPreview.selection) setSelection(aiPreview.selection);
            flashElements(plan.incoming.map((el) => el.id));
        }

        const sideEffects = aiPreview.actions.filter(
            (action) => action.operation === "SAVE_BLOCK" || action.operation === "SAVE_VERSION",
        );
        for (const action of sideEffects) {
            if (!activeFile) {
                showNotification(t("notify.openDrawingFirst"));
                continue;
            }
            if (!isLoggedIn) {
                showNotification(t("notify.signInForVersions"));
                continue;
            }
            if (action.operation === "SAVE_BLOCK") {
                const name = action.params?.blockName?.trim();
                const elementsToSave = action.elements ?? [];
                if (!name || elementsToSave.length === 0) continue;
                try {
                    await createBlock(
                        name,
                        elementsToSave,
                        action.params?.basePoint ?? { x: 0, y: 0 },
                        action.params?.blockDescription,
                        activeFile.id,
                    );
                    showNotification(
                        t("notify.blockSaved", { count: elementsToSave.length, name }),
                    );
                } catch (error) {
                    showNotification(
                        t("notify.blockSaveFailed", {
                            message: error instanceof Error ? error.message : String(error),
                        }),
                    );
                }
                continue;
            }

            const snapshot = buildVersionSnapshot(
                next,
                {
                    layerOrder: canvasState.layerOrder,
                    layerColors: canvasState.layerColors,
                    hiddenLayers: canvasState.hiddenLayers,
                    lockedLayers: canvasState.lockedLayers,
                },
                canvasState.drawingSettings,
            );
            const message = action.params?.versionMessage || `AI · ${new Date().toLocaleString()}`;
            try {
                const result = await apiService.createProjectVersion(
                    activeFile.id,
                    snapshot,
                    message,
                );
                showNotification(
                    t("notify.versionSaved", { version: result.version.versionNumber }),
                );
            } catch (error) {
                showNotification(
                    t("notify.versionSaveFailed", {
                        message: error instanceof Error ? error.message : String(error),
                    }),
                );
            }
        }

        reportTurnOutcome(aiPreview.turn, "applied");
        setAiPreview(null);
        if (changed) {
            showNotification(t("notify.aiApplied", { count: plan.incoming.length }));
        }
    }, [
        aiPreview,
        activeFile,
        isLoggedIn,
        canvasState.layerOrder,
        canvasState.layerColors,
        canvasState.hiddenLayers,
        canvasState.lockedLayers,
        canvasState.drawingSettings,
        commitAction,
        getElements,
        setSelection,
        flashElements,
        showNotification,
        reportTurnOutcome,
        t,
    ]);

    const cancelAIPreview = useCallback(() => {
        if (aiPreview) reportTurnOutcome(aiPreview.turn, "discarded", "cancelled");
        setAiPreview(null);
        showNotification(t("notify.aiDiscarded"));
    }, [aiPreview, showNotification, reportTurnOutcome, t]);

    const confirmPendingDelete = useCallback(() => {
        if (!pendingDeleteIds) return;
        const ids = new Set(pendingDeleteIds);
        commitAction(getElements().filter((el) => !ids.has(el.id)));
        clearSelection();
        setPendingDeleteIds(null);
        showNotification(t("notify.deleted", { count: ids.size }));
    }, [pendingDeleteIds, commitAction, getElements, clearSelection, showNotification, t]);

    // Text Tool Logic
    const handleRequestTextEntry = (pos: Point) => {
        setTextInputPos(pos);
        setTextInputValue("");
        setShowTextModal(true);
    };

    const confirmTextEntry = () => {
        if (textInputValue && textInputPos) {
            const uid = Math.random().toString(36).substr(2, 9);
            const newEl: CADElement = {
                id: uid,
                type: "TEXT",
                layer: canvasState.currentLayer,
                color: canvasState.layerColors[canvasState.currentLayer] ?? "#e6edf3",
                start: textInputPos,
                text: textInputValue,
                fontSize: 12,
            };
            addElement(newEl);
        }
        setShowTextModal(false);
        setActiveTool(ToolType.SELECT);
    };

    const handleRequestHatch = () => {
        const selected = selectedElements;
        if (selected.length === 0) {
            showNotification(t("notify.hatchNeedsSelection"));
            return;
        }
        setSelectedForHatch(selected);
        setShowHatchModal(true);
    };

    const confirmHatch = (pattern: any, color: string) => {
        if (selectedForHatch.length > 0) {
            try {
                const hatchElement = createHatch(selectedForHatch, pattern, color, "HATCH");
                addElement(hatchElement);
                showNotification(t("notify.hatchCreated"));
            } catch (error) {
                console.error("Error creating hatch:", error);
                showNotification(t("notify.hatchCreateFailed"));
            }
        }
        setShowHatchModal(false);
        setSelectedForHatch([]);
    };

    // Advanced Shape Tool Logic
    const handleRequestAdvancedShape = (tool: ToolType, pos: Point) => {
        setPendingShapePosition(pos);
        setPendingShapeTool(tool);
        setShowAdvancedShapeModal(true);
    };

    const confirmAdvancedShape = (params: any) => {
        if (!pendingShapePosition || !pendingShapeTool) {
            setShowAdvancedShapeModal(false);
            return;
        }
        let newElement: CADElement | null = null;
        try {
            switch (pendingShapeTool) {
                case ToolType.GEAR:
                    newElement = generateGear(
                        pendingShapePosition,
                        params.numTeeth || 20,
                        params.module || 5,
                        params.pressureAngle || 20,
                        canvasState.layerColors[canvasState.currentLayer] ?? "#e6edf3",
                        canvasState.currentLayer,
                    );
                    break;
                case ToolType.POLYGON:
                    newElement = generatePolygon(
                        pendingShapePosition,
                        100,
                        params.sides || 6,
                        params.rotation || 0,
                        canvasState.layerColors[canvasState.currentLayer] ?? "#e6edf3",
                        canvasState.currentLayer,
                    );
                    break;
                case ToolType.ELLIPSE:
                    newElement = generateEllipse(
                        pendingShapePosition,
                        params.radiusX || 100,
                        params.radiusY || 60,
                        params.rotation || 0,
                        canvasState.layerColors[canvasState.currentLayer] ?? "#e6edf3",
                        canvasState.currentLayer,
                    );
                    break;
                case ToolType.SPIRAL:
                    newElement = generateSpiral(
                        pendingShapePosition,
                        params.startRadius || 20,
                        params.turns || 3,
                        params.radiusIncrement || 30,
                        canvasState.layerColors[canvasState.currentLayer] ?? "#e6edf3",
                        canvasState.currentLayer,
                    );
                    break;
                case ToolType.SPRING: {
                    const endPoint = { x: pendingShapePosition.x + 200, y: pendingShapePosition.y };
                    newElement = generateSpring(
                        pendingShapePosition,
                        endPoint,
                        params.coils || 8,
                        params.springRadius || 20,
                        canvasState.layerColors[canvasState.currentLayer] ?? "#e6edf3",
                        canvasState.currentLayer,
                    );
                    break;
                }
                case ToolType.INVOLUTE:
                    newElement = generateInvolute(
                        pendingShapePosition,
                        params.baseRadius || 50,
                        params.turns || 2,
                        canvasState.layerColors[canvasState.currentLayer] ?? "#e6edf3",
                        canvasState.currentLayer,
                    );
                    break;
            }
            if (newElement) {
                addElement(newElement);
                showNotification(t("notify.shapeCreated", { name: pendingShapeTool }));
            }
        } catch (error) {
            console.error("Error creating advanced shape:", error);
            showNotification(t("notify.shapeCreateFailed"));
        }
        setShowAdvancedShapeModal(false);
        setPendingShapePosition(null);
        setPendingShapeTool(null);
        setActiveTool(ToolType.SELECT);
    };

    // handleCommand 每次渲染重建；keydown 闭包经 ref 取最新
    useEffect(() => {
        handleCommandRef.current = handleCommand;
    });

    // 全局快捷键：撤销 / 重做 / 复制粘贴 / 删除 / 文件操作 / 绘图辅助开关
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // 输入控件内保留原生编辑行为（命令栏、聊天框、属性编辑）
            if (isEditableTarget(e.target)) return;

            // F1 打开速查表：与浏览器默认的帮助行为无关，必须尽早拦下
            if (e.key === "F1") {
                e.preventDefault();
                setShowShortcuts(true);
                return;
            }
            if (e.key === "F2") {
                e.preventDefault();
                document.getElementById("command-input")?.focus();
                return;
            }

            if (isCanvasModeKey(e.key)) {
                e.preventDefault();
                toggleView(e.key);
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                const shift = e.shiftKey;

                if (key === "z" && !shift) {
                    e.preventDefault();
                    handleUndo();
                    return;
                }
                if (key === "y" || (key === "z" && shift)) {
                    e.preventDefault();
                    handleRedo();
                    return;
                }
                if (key === "c" && !shift) {
                    e.preventDefault();
                    handleCopySelection();
                    return;
                }
                if (key === "v" && !shift) {
                    e.preventDefault();
                    handlePasteClipboard();
                    return;
                }
                if (key === "a" && !shift) {
                    e.preventDefault();
                    handleSelectAll();
                    return;
                }
                // 文件类快捷键：接管浏览器默认的保存 / 打印 / 新建 / 打开
                if (key === "s") {
                    e.preventDefault();
                    void handleSave();
                    return;
                }
                if (key === "p") {
                    e.preventDefault();
                    setShowPlot(true);
                    return;
                }
                if (key === "1") {
                    e.preventDefault();
                    setSidePanelOpen(!sidePanelOpen);
                    return;
                }
                if (key === "o" || key === "n") {
                    e.preventDefault();
                    setShowDrawings(true);
                    return;
                }
                return;
            }

            // 单键换工具 / 动作：沿用 AutoCAD 键位；弹窗打开时让位给弹窗
            if (!e.altKey && !modalOpen) {
                const tool = resolveToolShortcut(e.key);
                if (tool) {
                    e.preventDefault();
                    setActiveTool(tool);
                    showNotification(t("notify.toolSwitched", { tool: toolLabel(tool, locale) }));
                    return;
                }
                const action = resolveActionShortcut(e.key);
                if (action === "erase") {
                    e.preventDefault();
                    requestDeleteSelection();
                    return;
                }
                if (action === "group") {
                    e.preventDefault();
                    handleGroupSelection();
                    return;
                }
                if (action === "ungroup") {
                    e.preventDefault();
                    handleUngroupSelection();
                    return;
                }
            }

            // Space 重复上一条命令（AutoCAD 习惯）；动态输入键入中让位
            if (e.key === " " && !e.altKey && !modalOpen && lastCommandRef.current) {
                if (getCanvasStatus().dynamicInput) return;
                e.preventDefault();
                handleCommandRef.current(lastCommandRef.current);
                return;
            }

            // 删除不依赖焦点位置：点过工具栏按钮后仍能删掉选中集
            if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                requestDeleteSelection();
                return;
            }
            if (e.key === "Escape") {
                if (contextMenu) {
                    setContextMenu(null);
                    return;
                }
                if (activeTool !== ToolType.SELECT) {
                    setActiveTool(ToolType.SELECT);
                    showNotification(t("notify.commandCancelled"));
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
        handleUndo,
        handleRedo,
        handleCopySelection,
        handlePasteClipboard,
        handleSelectAll,
        handleGroupSelection,
        handleUngroupSelection,
        handleSave,
        activeTool,
        contextMenu,
        locale,
        modalOpen,
        requestDeleteSelection,
        toggleView,
        setActiveTool,
        setShowPlot,
        showNotification,
        t,
    ]);

    // 图纸文件管理（保存 / 版本 / 加载 / 新建 / 自动保存）已抽至 useDrawingFiles，
    // 统一基于 ProjectDocument 持久化图元、图层、绘图设置与设计约定

    const handleImport = (importedElements: CADElement[]) => {
        commitAction(importedElements);
    };

    /** 参考图矢量化结果追加到当前图纸，占一步撤销并选中新轮廓 */
    const handleInsertTracedElements = useCallback(
        (traced: CADElement[]) => {
            if (traced.length === 0) return;
            commitAction([...getElements(), ...traced]);
            setSelection(traced.map((element) => element.id));
            flashElements(traced.map((element) => element.id));
            showNotification(t("notify.tracedInserted", { count: traced.length }));
        },
        [commitAction, getElements, setSelection, flashElements, showNotification, t],
    );

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    /**
     * 菜单栏命令落地：工具类直接切工具，带 section 的命令打开设置页对应分区，
     * 其余命令映射到已经在键盘 / 工具面板 / 顶栏里使用的同一批处理函数，
     * 避免菜单成为第二套实现。
     */
    const handleMenuAction = useCallback(
        (action: MenuActionId, item: MenuItem) => {
            if (action.startsWith("activate:")) {
                setActiveTool(action.slice("activate:".length) as ToolType);
                return;
            }
            if (item.kind === "command" && item.section) {
                setSettingsSection(item.section);
                return;
            }

            switch (action) {
                case "file.new":
                case "file.open":
                    setShowDrawings(true);
                    return;
                case "file.save":
                    void handleSave();
                    return;
                case "file.saveVersion":
                    void handleSaveVersion();
                    return;
                case "file.versions":
                    handleOpenVersionHistory();
                    return;
                case "file.import":
                    handleImportClick();
                    return;
                case "file.imageTrace":
                    setShowImageTrace(true);
                    return;
                case "file.export":
                    handleExportDXF();
                    return;
                case "file.plot":
                    setShowPlot(true);
                    return;
                case "file.logout":
                    void handleLogout();
                    return;
                case "edit.undo":
                    handleUndo();
                    return;
                case "edit.redo":
                    handleRedo();
                    return;
                case "edit.copy":
                    handleCopySelection();
                    return;
                case "edit.paste":
                    handlePasteClipboard();
                    return;
                case "edit.delete":
                    requestDeleteSelection();
                    return;
                case "edit.selectAll":
                    handleSelectAll();
                    return;
                case "edit.group":
                    handleGroupSelection();
                    return;
                case "edit.ungroup":
                    handleUngroupSelection();
                    return;
                case "edit.hide":
                    handleHideSelection();
                    return;
                case "edit.isolate":
                    handleIsolateSelection();
                    return;
                case "edit.showAll":
                    showAllObjects();
                    return;
                case "view.zoomIn":
                    zoomViewportBy(1 / ZOOM_STEP);
                    return;
                case "view.zoomOut":
                    zoomViewportBy(ZOOM_STEP);
                    return;
                case "view.zoomExtents":
                    handleZoomExtents();
                    return;
                case "view.reset":
                    resetViewport();
                    return;
                case "view.grid":
                case "view.snap":
                case "view.ortho":
                case "view.polar":
                    toggleView(TOGGLE_MODE_KEYS[action.slice("view.".length) as MenuToggleId]);
                    return;
                case "view.properties":
                    setSidePanelOpen(!sidePanelOpen);
                    return;
                case "view.commandline":
                    document.getElementById("command-input")?.focus();
                    return;
                case "view.review":
                    setShowReview(true);
                    return;
                case "view.conventions":
                    setSettingsSection("conventions");
                    return;
                case "file.manage":
                    setShowDrawings(true);
                    return;
                case "tool.aiWindow":
                    setAiOpen(true);
                    return;
                case "help.shortcuts":
                    setShowShortcuts(true);
                    return;
                case "help.support":
                    window.open(
                        "https://github.com/AIIgnite/AIIgniteCAD/issues",
                        "_blank",
                        "noopener,noreferrer",
                    );
                    return;
                default:
                    break;
            }
        },
        [
            handleCopySelection,
            handleExportDXF,
            handleGroupSelection,
            handleHideSelection,
            handleImportClick,
            handleIsolateSelection,
            handlePasteClipboard,
            handleRedo,
            handleSave,
            handleSaveVersion,
            handleSelectAll,
            handleUngroupSelection,
            handleUndo,
            handleZoomExtents,
            requestDeleteSelection,
            setActiveTool,
                setSidePanelOpen,
            showAllObjects,
            toggleView,
        ],
    );

    // 登录页分支必须放在最后一个 Hook 之后：菜单栏命令也是 Hook，提前 return 会让它变成条件调用
    if (!isLoggedIn) {
        if (authMode === "register") {
            return (
                <RegisterPage
                    onRegister={handleRegister}
                    loading={loading}
                    onBackToLogin={() => setAuthMode("login")}
                />
            );
        }
        return (
            <LoginPage
                onLogin={handleLogin}
                loading={loading}
                onRegisterClick={() => setAuthMode("register")}
            />
        );
    }

    /**
     * 打开内置示例：解析 DXF 后作为新文件落库并激活，
     * 与新建共用同一套 IndexedDB + 文档快照 + 同步流程。
     */
    const handleOpenExample = async (exampleId: string) => {
        const example = getExampleDrawing(exampleId);
        if (!example) return;
        try {
            setLoading(true);
            const elements = parseDXF(example.dxf);
            const newFile: ProjectFile = {
                id: Math.random().toString(36).substr(2, 9),
                name: `${example.name}.dxf`,
                lastModified: new Date().toISOString(),
                elements,
                elementCount: elements.length,
                layers: createDefaultLayers(),
                drawingSettings: createDefaultDrawingSettings(),
            };
            await activateNewFile(newFile);
            showNotification(t("notify.exampleOpened", { name: example.name }));
        } catch (error) {
            showNotification(
                error instanceof Error ? error.message : t("notify.exampleOpenFailed"),
            );
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const file = input.files?.[0];
        // 清空 value，保证连续选择同一个文件也能再次触发
        input.value = "";
        if (!file) return;

        setIsImporting(true);
        try {
            const { elements: imported, report } = await parseDrawingFileWithReport(file);
            if (imported.length === 0) {
                showNotification(
                    isDwgFile(file.name) ? t("notify.dwgNoElements") : t("notify.dxfNoElements"),
                );
                return;
            }
            handleImport(imported);
            showNotification(t("notify.imported", { name: file.name, count: imported.length }));
            if (report.unitScale !== 1) {
                showNotification(t("notify.dxfUnitsConverted"));
            }
            if (report.unsupported.length > 0) {
                showNotification(
                    t("notify.dxfUnsupportedSkipped", {
                        types: report.unsupported.map((entry) => entry.type).join(", "),
                    }),
                );
            }
        } catch (error) {
            showNotification(error instanceof Error ? error.message : t("notify.importFailed"));
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-cad-bg text-cad-text font-sans relative">
            {/* HIDDEN FILE INPUT FOR IMPORT */}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".dxf,.dwg"
                onChange={handleFileChange}
            />

            {/* WELCOME MODAL */}
            <WelcomeModal
                visible={showWelcomeModal}
                files={files}
                currentUser={currentUser}
                onLoadFile={handleLoadFile}
                onCreateFile={handleCreateFile}
                onImportFile={handleImportClick}
                onOpenExample={handleOpenExample}
                onClose={() => setShowWelcomeModal(false)}
            />

            {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

            {/* TEXT INPUT MODAL */}
            {showTextModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
                    <div className="bg-cad-panel border border-cad-border p-4 rounded-lg shadow-xl w-80 animate-in zoom-in-95 duration-200">
                        <h3 className="text-sm font-bold mb-3">{t("textModal.title")}</h3>
                        <input
                            autoFocus
                            className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1.5 text-sm mb-4 outline-none focus:border-cad-primary"
                            value={textInputValue}
                            onChange={(e) => setTextInputValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && confirmTextEntry()}
                            placeholder={t("textModal.placeholder")}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowTextModal(false)}
                                className="px-3 py-1.5 text-xs text-cad-muted hover:bg-cad-border/50 rounded"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                onClick={confirmTextEntry}
                                className="px-3 py-1.5 text-xs bg-cad-primary text-white rounded hover:bg-cad-primaryHover"
                            >
                                {t("textModal.confirm")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showAdvancedShapeModal && pendingShapeTool && (
                <AdvancedShapeModal
                    tool={pendingShapeTool}
                    onConfirm={confirmAdvancedShape}
                    onCancel={() => {
                        setShowAdvancedShapeModal(false);
                        setPendingShapePosition(null);
                        setPendingShapeTool(null);
                    }}
                />
            )}

            {showHatchModal && (
                <HatchModal
                    visible={showHatchModal}
                    onConfirm={confirmHatch}
                    onCancel={() => {
                        setShowHatchModal(false);
                        setSelectedForHatch([]);
                    }}
                />
            )}

            {showVersionHistory && activeFile && (
                <VersionHistoryModal
                    projectId={activeFile.id}
                    projectName={activeFile.name}
                    currentSnapshot={versionSnapshot}
                    onClose={() => setShowVersionHistory(false)}
                    onRestore={handleRestoreVersion}
                    onNotify={showNotification}
                />
            )}

            {showPlot && (
                <PlotModal
                    elements={elements}
                    drawingSettings={drawingSettings}
                    projectName={activeFile?.name}
                    author={currentUser?.username}
                    onClose={() => setShowPlot(false)}
                />
            )}

            {showQuickSelect && (
                <QuickSelectModal
                    elements={displayableElements(
                        elements,
                        canvasState.hiddenLayers,
                        hiddenObjectIds,
                    )}
                    onConfirm={(ids) => {
                        setShowQuickSelect(false);
                        setSelection(ids);
                        showNotification(t("notify.selected", { count: ids.length }));
                    }}
                    onCancel={() => setShowQuickSelect(false)}
                />
            )}

            {showImageTrace && (
                <ImageTraceModal
                    onClose={() => setShowImageTrace(false)}
                    onInsert={handleInsertTracedElements}
                />
            )}

            {aiPreview && (
                <AIPreviewModal
                    actions={aiPreview.actions}
                    beforeElements={aiPreview.beforeElements}
                    afterElements={aiPreview.afterElements}
                    conventions={activeFile?.designConventions ?? null}
                    onApply={applyAIPreview}
                    onCancel={cancelAIPreview}
                />
            )}

            {pendingDeleteIds && (
                <ConfirmDialog
                    title={t("deleteConfirm.title")}
                    message={t("deleteConfirm.message", { count: pendingDeleteIds.length })}
                    confirmLabel={t("deleteConfirm.confirm")}
                    danger
                    onConfirm={confirmPendingDelete}
                    onCancel={() => setPendingDeleteIds(null)}
                />
            )}

            {notification && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4 fade-in duration-300">
                    <div className="bg-cad-panel/90 border border-cad-primary/50 text-cad-text px-4 py-2 rounded-lg shadow-lg shadow-black/20 flex items-center gap-2 backdrop-blur-sm">
                        <span className="material-symbols-outlined text-cad-primary text-[20px]">
                            info
                        </span>
                        <span className="text-sm font-medium">{notification}</span>
                    </div>
                </div>
            )}

            {isImporting && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[1px]">
                    <div className="flex items-center gap-3 rounded-lg border border-cad-border bg-cad-panel px-4 py-3 shadow-xl">
                        <span className="size-4 animate-spin rounded-full border-2 border-cad-primary/30 border-t-cad-primary" />
                        <span className="text-sm font-medium text-cad-text">
                            {t("notify.importing")}
                        </span>
                    </div>
                </div>
            )}

            <Header
                onUndo={handleUndo}
                onRedo={handleRedo}
                fileName={activeFile?.name}
                onSave={handleSave}
                onExport={handleExportDXF}
                onOpenSettings={openSettings}
                aiOpen={aiOpen}
                onToggleAI={() => setAiOpen((open) => !open)}
            />

            <MenuBar
                onAction={handleMenuAction}
                toggles={{ grid: gridMode, snap: snapMode, ortho: orthoMode, polar: polarMode }}
            />

            <div className="flex flex-1 overflow-hidden relative">
                <Toolbar
                    onOpenSettings={openSettings}
                    onOpenReview={() => setShowReview(true)}
                    onOpenDrawings={() => setShowDrawings(true)}
                    onInsertBlock={handleInsertBlock}
                    currentUser={currentUser}
                />
                <Canvas
                    onRequestTextEntry={handleRequestTextEntry}
                    onRequestAdvancedShape={handleRequestAdvancedShape}
                    onRequestHatch={handleRequestHatch}
                    onNotification={showNotification}
                    onBlockDrop={handleBlockDrop}
                    aiPreview={aiPreview}
                    flashIds={flashIds}
                    hiddenObjectIds={hiddenObjectIds}
                    onRequestContextMenu={openContextMenu}
                />
                <RightPanel
                    key={currentUser?.id || "no-user"}
                    collapsed={!sidePanelOpen}
                    currentElements={elements}
                    onUpdateElement={handlePropertyUpdate}
                    onApplyAIAction={handleAIAction}
                />
                <AIAssistantWindow
                    open={aiOpen}
                    onClose={() => setAiOpen(false)}
                    projectId={activeFile?.id || null}
                    projectKey={activeFile?.chatKey ?? activeFile?.id ?? null}
                    currentElements={elements}
                    selectedIds={selectedIds}
                    units={drawingSettings.units}
                    conventions={activeFile?.designConventions ?? null}
                    projectDrawings={drawingFacts}
                    projectName={activeFile?.name}
                    blockCount={activeFile?.blockReferences?.length ?? 0}
                    hiddenObjectCount={hiddenIds.length}
                    onPreviewActions={handleAIPreview}
                    draft={chatDraft}
                />
                {settingsSection && (
                    <SettingsView
                        section={settingsSection}
                        onSectionChange={setSettingsSection}
                        onClose={() => setSettingsSection(null)}
                        onLogout={handleLogout}
                        currentUserRole={currentUser?.role ?? null}
                        drawingName={activeFile?.name}
                        designConventions={activeFile?.designConventions ?? null}
                        onSaveDesignConventions={handleSaveDesignConventions}
                        onOpenDrawings={() => setShowDrawings(true)}
                    />
                )}
            </div>
            {showReview && (
                <FullScreenShell
                    title={t("review.title")}
                    icon="fact_check"
                    subtitle={activeFile?.name}
                    onClose={() => setShowReview(false)}
                >
                    <DrawingReviewPanel
                        elements={elements}
                        conventions={activeFile?.designConventions ?? null}
                        drawings={drawingFacts}
                        activeDrawingId={activeFile?.id}
                        onLocate={handleLocateReviewIssue}
                        onAskAI={handleAskAIFix}
                    />
                </FullScreenShell>
            )}

            {showDrawings && (
                <FullScreenShell
                    title={t("panel.drawingsList")}
                    icon="library_books"
                    subtitle={t("panel.drawingsListSubtitle")}
                    onClose={() => setShowDrawings(false)}
                    scroll={false}
                >
                    <DrawingsSection
                        files={files}
                        activeFileId={activeFile?.id || null}
                        onLoadFile={(file) => {
                            setShowDrawings(false);
                            void handleLoadFile(file);
                        }}
                        onCreateFile={(name) => void handleCreateFile(name)}
                        onRenameFile={(id, name) => void handleRenameFile(id, name)}
                        onDeleteFile={(id) => void handleDeleteFile(id)}
                        onInsertIntoActive={(file) => {
                            setShowDrawings(false);
                            void handleInsertDrawingSnapshot(file);
                        }}
                    />
                </FullScreenShell>
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenu.items}
                    onClose={closeContextMenu}
                />
            )}
            <Footer
                onCommand={handleCommand}
                hiddenCount={hiddenCount}
                onShowAllObjects={showAllObjects}
                drawingName={activeFile?.name}
            />
        </div>
    );
}

export default App;
