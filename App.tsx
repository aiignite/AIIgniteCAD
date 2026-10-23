/**
 * App.tsx — 应用主组件
 * 管理全局业务逻辑，组合各 UI 组件
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Header } from "./components/Header";
import { Toolbar } from "./components/Toolbar";
import { Canvas } from "./components/Canvas";
import { RightPanel } from "./components/RightPanel";
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
import { ConfirmDialog } from "./components/ConfirmDialog";
import {
    ToolType,
    SidePanelMode,
    CADElement,
    Point,
    ProjectFile,
    ProjectVersion,
    AIActionResponse,
    DesignConventions,
} from "./types";
import { useCanvas } from "./store/canvasStore";
import { useApp } from "./store/appStore";
import { useCollaboration } from "./hooks/useCollaboration";
import { apiService } from "./services/apiService";
import { indexedDBService } from "./services/indexedDBService";
import { syncService } from "./services/syncService";
import { telemetryService } from "./services/telemetryService";
import { getBlock, insertBlockReference } from "./services/blockService";
import { getExampleDrawing } from "./services/examples";
import { parseDXF } from "./services/dxfService";
import { createHatch } from "./services/hatchService";
import { isEditableTarget } from "./lib/keyboard";
import { executeCommand } from "./lib/commands/registry";
import { buildVersionSnapshot } from "./lib/versionSnapshot";
import { summarizeElementTypes } from "./lib/versionDiff";
import { computeAIActionOutcome } from "./lib/aiActions";
import { planAIGhostPreview } from "./lib/aiGhost";
import { countHiddenObjects, displayableElements } from "./lib/isolation";
import { getViewBox, setViewBox, zoomViewportToBounds } from "./store/viewport";
import { loadNamedViews, saveNamedView as persistNamedView } from "./services/namedViews";
import type { TurnMeta } from "./hooks/useAIChat";
import {
    generateGear,
    generatePolygon,
    generateEllipse,
    generateSpiral,
    generateSpring,
    generateInvolute,
} from "./services/advancedShapesService";

/** 空图纸复用同一引用，避免加载/新建后立即触发一次无意义的自动保存 */
const EMPTY_ELEMENTS: CADElement[] = [];

/** 每 N 次提交自动保存一个版本；失败后最多每 60 秒重试一次 */
const AUTO_VERSION_INTERVAL = 20;
const AUTO_VERSION_RETRY_MS = 60_000;

/** 超过该数量的删除需要二次确认，避免误删整片图形 */
const BULK_DELETE_THRESHOLD = 5;

/** AI 变更后脉冲高亮的时长，与 index.css 的 cad-ai-flash 动画保持一致 */
const AI_FLASH_MS = 1200;

interface AIPreviewState {
    actions: AIActionResponse[];
    beforeElements: CADElement[];
    afterElements: CADElement[];
    selection?: string[];
    /** 来自 Agent 回合的元信息，用于把采纳/放弃结果回写服务端 */
    turn?: TurnMeta;
}

/** 兼容旧工程数据：选中状态已迁移到独立 selectedIds，图元上不再保留 selected 字段 */
const stripLegacySelection = (elements: CADElement[]): CADElement[] =>
    elements.map((element) => {
        if (!("selected" in element)) return element;
        const clean = { ...element };
        delete (clean as { selected?: boolean }).selected;
        return clean;
    });

function App() {
    const startupRef = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const propertyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSavedRef = useRef<{ fileId: string; elements: CADElement[] } | null>(null);
    const autoVersionBaselineRef = useRef<{ projectId: string; revision: number } | null>(null);
    const autoVersionAttemptRef = useRef(0);
    const aiFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [showWelcomeModal, setShowWelcomeModal] = useState(false);

    // Canvas state from store
    const {
        state: canvasState,
        selectedIds,
        setSelection,
        clearSelection,
        addElement,
        updateElement,
        bulkUpdate,
        setElements,
        commitAction,
        commitCurrent,
        getElements,
        setActiveTool,
        setDrawingSettings,
        undo,
        redo,
        loadHistory,
        resetCanvas,
        addLayer,
        setCurrentLayer,
        loadLayerState,
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
        updateFile,
        setSideMode,
        setLoading,
        showNotification,
        clearNotification,
    } = useApp();
    const { isLoggedIn, currentUser, files, activeFile, sideMode, loading, notification } =
        appState;

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

    // 同步事件：冲突提示与离线新建后的项目 id 迁移
    useEffect(() => {
        return syncService.onEvent((event) => {
            if (event.type === "conflict") {
                showNotification(
                    `Cloud changes to "${event.projectName}" were overwritten by this save (last write wins).`,
                );
                return;
            }

            if (event.type === "sync-error") {
                showNotification(`Cloud sync failed: ${event.message}`);
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
            if (lastSavedRef.current?.fileId === event.oldId) {
                lastSavedRef.current = {
                    ...lastSavedRef.current,
                    fileId: event.newId,
                };
            }
        });
    }, [files, activeFile, showNotification, setFiles, setActiveFile]);

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

    /** 立即提交尚未落盘的属性编辑（撤销/重做/手动保存前调用） */
    const flushPropertyCommit = useCallback(() => {
        if (!propertyCommitTimerRef.current) return;
        clearTimeout(propertyCommitTimerRef.current);
        propertyCommitTimerRef.current = null;
        commitCurrent();
    }, [commitCurrent]);

    const handleUndo = useCallback(() => {
        flushPropertyCommit();
        undo();
    }, [flushPropertyCommit, undo]);

    const handleRedo = useCallback(() => {
        flushPropertyCommit();
        redo();
    }, [flushPropertyCommit, redo]);

    const handleBlockDrop = useCallback(
        async (blockId: string, position: Point) => {
            try {
                setLoading(true);
                const blockDef = await getBlock(blockId);
                if (!blockDef) {
                    showNotification("Block not found.");
                    setLoading(false);
                    return;
                }

                const clones = blockDef.elements.map((el) => {
                    const clone = JSON.parse(JSON.stringify(el));
                    clone.id = Math.random().toString(36).substr(2, 9);
                    const dx = position.x - blockDef.basePoint.x;
                    const dy = position.y - blockDef.basePoint.y;
                    if (clone.start) {
                        clone.start.x += dx;
                        clone.start.y += dy;
                    }
                    if (clone.end) {
                        clone.end.x += dx;
                        clone.end.y += dy;
                    }
                    if (clone.center) {
                        clone.center.x += dx;
                        clone.center.y += dy;
                    }
                    if (clone.points) {
                        clone.points = clone.points.map((p: Point) => ({
                            x: p.x + dx,
                            y: p.y + dy,
                        }));
                    }
                    return clone;
                });
                commitAction([...elements, ...clones]);
                setSelection(clones.map((el: CADElement) => el.id));
                showNotification(`Inserted block '${blockDef.name}'`);
            } catch (e: any) {
                console.error(e);
                showNotification("Failed to insert block");
            } finally {
                setLoading(false);
            }
        },
        [elements, commitAction, setSelection, setLoading, showNotification],
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
            const projectsData = await apiService.getProjects();
            setFiles(projectsData.projects);
            setLoggedIn(true);
            await syncService.refreshStatus();
            syncService.requestFlush();
        } catch (error) {
            console.error("Failed to load user data:", error);
            apiService.clearToken();
            setLoggedIn(false);
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
            showNotification(error.message || "Login failed");
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
            showNotification(error.message || "Registration failed");
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
            showNotification("Logged out successfully");
        } catch (error: any) {
            console.error("Logout error:", error);
        }
    };

    const handleShowUserProfile = () => {
        setSideMode(SidePanelMode.USER_INFO);
    };

    /** F3 / F7 / F8 / F10 分别切换捕捉、栅格、正交与极轴（沿用 AutoCAD 键位） */
    const toggleCanvasMode = useCallback(
        (key: string): { label: string; on: boolean } | null => {
            switch (key) {
                case "F3": {
                    const on = !snapMode;
                    canvasDispatch({ type: "SET_SNAP_MODE", value: on });
                    return { label: "捕捉", on };
                }
                case "F7": {
                    const on = !gridMode;
                    canvasDispatch({ type: "SET_GRID_MODE", value: on });
                    return { label: "栅格", on };
                }
                case "F8": {
                    const on = !orthoMode;
                    canvasDispatch({ type: "SET_ORTHO_MODE", value: on });
                    return { label: "正交", on };
                }
                case "F10": {
                    const on = !polarMode;
                    canvasDispatch({ type: "SET_POLAR_MODE", value: on });
                    return { label: "极轴", on };
                }
                default:
                    return null;
            }
        },
        [snapMode, gridMode, orthoMode, polarMode, canvasDispatch],
    );

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
        showNotification(`已删除 ${ids.size} 个图元 · Ctrl+Z 可撤销`);
    }, [activeTool, selectedIds, commitAction, getElements, clearSelection, showNotification]);

    /** 显示全部：清除隔离 / 隐藏对象产生的临时隐藏集 */
    const showAllObjects = useCallback(() => {
        if (hiddenObjectIds.size === 0) return;
        setHiddenIds([]);
        if (hiddenCount > 0) showNotification(`已显示 ${hiddenCount} 个隐藏图元`);
    }, [hiddenObjectIds, hiddenCount, showNotification]);

    /** 「问 AI」：切到对话面板，把针对选择集的问题写成草稿供用户改后发送 */
    const handleAskAboutSelection = useCallback(() => {
        const selected = getElements().filter((el) => selectedIds.has(el.id));
        if (selected.length === 0) return;
        setSideMode(SidePanelMode.CHAT);
        setChatDraft((prev) => ({
            text: `检查选中的 ${selected.length} 个图元（${summarizeElementTypes(selected)}）是否符合制图规范`,
            nonce: (prev?.nonce ?? 0) + 1,
        }));
    }, [getElements, selectedIds, setSideMode]);

    /** 设计约定面板保存：本地立即生效并随项目同步队列写回服务端 */
    const handleSaveDesignConventions = useCallback(
        async (conventions: DesignConventions | null) => {
            if (!activeFile) throw new Error("请先打开一张图纸");
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
        [activeFile, files, getElements],
    );

    /** 图纸检查面板的「让 AI 修复」：预选相关图元并把问题摘要写进对话草稿 */
    const handleAskAIFix = useCallback(
        (prompt: string, ids: string[]) => {
            if (ids.length > 0) setSelection(ids);
            setSideMode(SidePanelMode.CHAT);
            setChatDraft((prev) => ({
                text: prompt,
                nonce: (prev?.nonce ?? 0) + 1,
            }));
        },
        [setSelection, setSideMode],
    );

    // Keyboard shortcuts handle undo/redo via store
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // 输入控件内保留原生编辑行为（命令栏、聊天框、属性编辑）
            if (isEditableTarget(e.target)) return;
            const toggled = toggleCanvasMode(e.key);
            if (toggled) {
                e.preventDefault();
                showNotification(`${toggled.label} ${toggled.on ? "已开启" : "已关闭"}`);
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
            }
            if (
                ((e.ctrlKey || e.metaKey) && e.key === "y") ||
                ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey)
            ) {
                e.preventDefault();
                handleRedo();
            }
            if (e.key === "Delete" || e.key === "Backspace") {
                if (document.activeElement === document.body) requestDeleteSelection();
            }
            if (e.key === "Escape") {
                if (activeTool !== ToolType.SELECT) {
                    setActiveTool(ToolType.SELECT);
                    showNotification("已取消当前命令");
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
        handleUndo,
        handleRedo,
        activeTool,
        requestDeleteSelection,
        toggleCanvasMode,
        setActiveTool,
        showNotification,
    ]);

    // Command Line Handler：解析、别名、参数与执行全部委托给命令注册表
    const handleCommand = (cmd: string) => {
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

            if (currentElements === baseElements) return;
            setAiPreview({
                actions,
                beforeElements: baseElements,
                afterElements: currentElements,
                selection: finalSelection,
                turn,
            });
            showNotification("AI 变更已生成，请预览后应用");
        },
        [getElements, selectedIds, showNotification],
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

    const applyAIPreview = useCallback(() => {
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
        commitAction(next);
        if (aiPreview.selection) setSelection(aiPreview.selection);
        flashElements(plan.incoming.map((el) => el.id));
        reportTurnOutcome(aiPreview.turn, "applied");
        setAiPreview(null);
        showNotification(`已应用 AI 变更 · ${plan.incoming.length} 个图元 · Ctrl+Z 可撤销`);
    }, [
        aiPreview,
        commitAction,
        getElements,
        setSelection,
        flashElements,
        showNotification,
        reportTurnOutcome,
    ]);

    const cancelAIPreview = useCallback(() => {
        if (aiPreview) reportTurnOutcome(aiPreview.turn, "discarded", "cancelled");
        setAiPreview(null);
        showNotification("已放弃 AI 变更");
    }, [aiPreview, showNotification, reportTurnOutcome]);

    const confirmPendingDelete = useCallback(() => {
        if (!pendingDeleteIds) return;
        const ids = new Set(pendingDeleteIds);
        commitAction(getElements().filter((el) => !ids.has(el.id)));
        clearSelection();
        setPendingDeleteIds(null);
        showNotification(`已删除 ${ids.size} 个图元 · Ctrl+Z 可撤销`);
    }, [pendingDeleteIds, commitAction, getElements, clearSelection, showNotification]);

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
            showNotification("Select boundary elements first (先选择边界元素)");
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
                showNotification("Hatch created successfully");
            } catch (error) {
                console.error("Error creating hatch:", error);
                showNotification("Failed to create hatch");
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
                showNotification(`${pendingShapeTool} created successfully`);
            }
        } catch (error) {
            console.error("Error creating advanced shape:", error);
            showNotification("Failed to create shape");
        }
        setShowAdvancedShapeModal(false);
        setPendingShapePosition(null);
        setPendingShapeTool(null);
        setActiveTool(ToolType.SELECT);
    };

    // File Management
    /** 持久化图纸快照；自动保存与手动保存共用，不触发通知或 UI 状态更新 */
    const persistFile = useCallback(async (file: ProjectFile, snapshot: CADElement[]) => {
        const updatedFile = {
            ...file,
            elements: snapshot,
            lastModified: new Date().toISOString(),
            elementCount: snapshot.length,
        };
        await indexedDBService.saveProject(updatedFile);
        await indexedDBService.saveElements(snapshot, file.id);
        syncService.requestFlush();
        lastSavedRef.current = { fileId: file.id, elements: snapshot };
        return updatedFile;
    }, []);

    const handleSave = useCallback(async () => {
        if (!activeFile) return;
        flushPropertyCommit();
        telemetryService.recordAction("save", { fileId: activeFile.id });
        try {
            const updatedFile = await persistFile(activeFile, elements);
            updateFile(updatedFile);
            showNotification("Saved successfully");
        } catch (error: any) {
            showNotification("Save failed: " + error.message);
        }
    }, [activeFile, elements, flushPropertyCommit, persistFile, updateFile, showNotification]);

    const handleOpenVersionHistory = useCallback(() => {
        if (!activeFile) {
            showNotification("Open a drawing first");
            return;
        }
        if (!isLoggedIn) {
            showNotification("Sign in to use version history");
            return;
        }
        setShowVersionHistory(true);
    }, [activeFile, isLoggedIn, showNotification]);

    /**
     * 恢复版本：图元通过 commitAction 写入撤销历史，图层与设置同步替换。
     * 随后立即持久化，避免自动保存延迟窗口内刷新丢失恢复结果。
     */
    const handleRestoreVersion = useCallback(
        (snapshot: ProjectVersion["snapshotData"]) => {
            flushPropertyCommit();
            const restoredElements = snapshot.elements ?? [];
            commitAction(restoredElements);

            const layers = snapshot.layers ?? [];
            if (layers.length > 0) {
                loadLayerState({
                    layerOrder: layers.map((layer) => layer.name),
                    layerColors: Object.fromEntries(
                        layers.map((layer) => [layer.name, layer.color]),
                    ),
                    hiddenLayers: layers
                        .filter((layer) => !layer.isVisible)
                        .map((layer) => layer.name),
                    lockedLayers: layers
                        .filter((layer) => layer.isLocked)
                        .map((layer) => layer.name),
                });
            }
            if (snapshot.settings) setDrawingSettings(snapshot.settings);

            showNotification(`Restored ${restoredElements.length} elements — Ctrl+Z to undo`);

            if (activeFile) {
                void persistFile(activeFile, restoredElements)
                    .then(updateFile)
                    .catch((error) => {
                        console.error("Restore save failed", error);
                    });
            }
        },
        [
            flushPropertyCommit,
            commitAction,
            loadLayerState,
            setDrawingSettings,
            showNotification,
            activeFile,
            persistFile,
            updateFile,
        ],
    );

    // Auto-save：仅在图形内容真正变化后触发，选择/工具等瞬态状态不会引起写盘
    useEffect(() => {
        if (!activeFile) return;
        const saved = lastSavedRef.current;
        if (saved && saved.fileId === activeFile.id && saved.elements === elements) return;
        const timer = setTimeout(async () => {
            try {
                await persistFile(activeFile, elements);
            } catch (e) {
                console.error("Auto-save failed", e);
            }
        }, 3000);
        return () => clearTimeout(timer);
    }, [elements, activeFile, persistFile]);

    // 自动版本：按提交次数触发，与自动保存解耦，避免每次写盘都产生版本
    useEffect(() => {
        if (!activeFile || !isLoggedIn) {
            autoVersionBaselineRef.current = null;
            return;
        }

        const baseline = autoVersionBaselineRef.current;
        if (!baseline || baseline.projectId !== activeFile.id) {
            autoVersionBaselineRef.current = {
                projectId: activeFile.id,
                revision: canvasState.revision,
            };
            return;
        }
        if (canvasState.revision - baseline.revision < AUTO_VERSION_INTERVAL) return;

        const now = Date.now();
        if (now - autoVersionAttemptRef.current < AUTO_VERSION_RETRY_MS) return;
        autoVersionAttemptRef.current = now;

        const revision = canvasState.revision;
        const snapshot = buildVersionSnapshot(
            getElements(),
            {
                layerOrder: canvasState.layerOrder,
                layerColors: canvasState.layerColors,
                hiddenLayers: canvasState.hiddenLayers,
                lockedLayers: canvasState.lockedLayers,
            },
            canvasState.drawingSettings,
        );

        void apiService
            .createProjectVersion(activeFile.id, snapshot, `Auto · ${revision} edits`)
            .then((result) => {
                if (autoVersionBaselineRef.current?.projectId !== activeFile.id) return;
                autoVersionBaselineRef.current = { projectId: activeFile.id, revision };
                showNotification(`Auto version v${result.version.versionNumber} saved`);
            })
            .catch(() => {
                // 离线或服务不可用时保留基线，后续提交按退避重试
            });
    }, [
        activeFile,
        isLoggedIn,
        canvasState.revision,
        canvasState.layerOrder,
        canvasState.layerColors,
        canvasState.hiddenLayers,
        canvasState.lockedLayers,
        canvasState.drawingSettings,
        getElements,
        showNotification,
    ]);

    const handleLoadFile = async (file: ProjectFile) => {
        if (activeFile && activeFile.id === file.id) return;
        try {
            if (activeFile && elements.length > 0) {
                await persistFile(activeFile, elements);
            }
            let loadedElements: CADElement[] = [];
            let loadedConventions = file.designConventions ?? null;
            if (apiService.isAuthenticated()) {
                await apiService.openProject(file.id);
                const projectData = await apiService.getProject(file.id);
                void syncService.setServerCursor(file.id, projectData.project.updatedAt);
                loadedElements =
                    (projectData.project.elements || []).map((el: any) => ({
                        ...el.geometryData,
                    })) || [];
                loadedConventions =
                    (projectData.project.designConventions as ProjectFile["designConventions"]) ??
                    loadedConventions;
            } else {
                loadedElements = await indexedDBService.getElementsByProject(file.id);
            }
            loadedElements = stripLegacySelection(loadedElements);
            setElements(loadedElements);
            loadHistory([loadedElements], 0);
            setHiddenIds([]);
            setActiveFile({ ...file, designConventions: loadedConventions });
            lastSavedRef.current = { fileId: file.id, elements: loadedElements };
            showNotification(`Loaded ${file.name}`);
        } catch (error: any) {
            showNotification(error.message || "Failed to load file");
        }
    };

    const handleCreateFile = async (name: string) => {
        try {
            setLoading(true);
            const newFile: ProjectFile = {
                id: Math.random().toString(36).substr(2, 9),
                name,
                lastModified: new Date().toISOString(),
                elements: [],
                elementCount: 0,
            };
            await indexedDBService.saveNewProject(newFile);
            setFiles([...files, newFile]);
            setActiveFile(newFile);
            setElements(EMPTY_ELEMENTS);
            loadHistory([EMPTY_ELEMENTS], 0);
            setHiddenIds([]);
            lastSavedRef.current = { fileId: newFile.id, elements: EMPTY_ELEMENTS };
            syncService.requestFlush();
            showNotification(`Created '${name}'`);
        } catch (error: any) {
            showNotification(error.message || "Failed to create file");
        } finally {
            setLoading(false);
        }
    };

    const handleRenameFile = async (id: string, newName: string) => {
        try {
            const project = await indexedDBService.getProject(id);
            if (project) {
                await indexedDBService.saveProject({ ...project, name: newName });
                syncService.requestFlush();
            }
            const updatedFiles = files.map((f: ProjectFile) =>
                f.id === id ? { ...f, name: newName } : f,
            );
            setFiles(updatedFiles);
            if (activeFile?.id === id) {
                setActiveFile({ ...activeFile, name: newName });
            }
            showNotification(`Renamed to '${newName}'`);
        } catch (error: any) {
            showNotification(error.message || "Failed to rename file");
        }
    };

    const handleDeleteFile = async (id: string) => {
        try {
            await indexedDBService.deleteProject(id);
            syncService.requestFlush();
            setFiles(files.filter((f: ProjectFile) => f.id !== id));
            if (activeFile?.id === id) {
                setActiveFile(null);
                setElements([]);
                loadHistory([[]], 0);
                setHiddenIds([]);
            }
            showNotification("File deleted");
        } catch (error: any) {
            showNotification(error.message || "Failed to delete file");
        }
    };

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
            showNotification(`已插入 ${traced.length} 条参考图轮廓 · Ctrl+Z 可撤销`);
        },
        [commitAction, getElements, setSelection, flashElements, showNotification],
    );

    // Auth pages
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

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    /**
     * 打开内置示例：解析 DXF 后作为新文件落库并激活，
     * 与导入共用同一套 IndexedDB + 同步流程。
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
            };
            await indexedDBService.saveNewProject(newFile);
            setFiles([...files, newFile]);
            setActiveFile(newFile);
            setElements(elements);
            loadHistory([elements], 0);
            setHiddenIds([]);
            lastSavedRef.current = { fileId: newFile.id, elements };
            syncService.requestFlush();
            showNotification(`已打开示例：${example.name}`);
        } catch (error) {
            showNotification(error instanceof Error ? error.message : "示例图纸打开失败");
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target?.result as string;
                const imported = parseDXF(text);
                handleImport(imported);
                showNotification(`Imported ${file.name}`);
            };
            reader.readAsText(file);
        }
    };

    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-cad-bg text-cad-text font-display relative">
            {/* HIDDEN FILE INPUT FOR IMPORT */}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".dxf"
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

            {/* TEXT INPUT MODAL */}
            {showTextModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
                    <div className="bg-cad-panel border border-cad-border p-4 rounded-lg shadow-xl w-80 animate-in zoom-in-95 duration-200">
                        <h3 className="text-sm font-bold mb-3">Enter Text</h3>
                        <input
                            autoFocus
                            className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm mb-4 outline-none focus:border-cad-primary"
                            value={textInputValue}
                            onChange={(e) => setTextInputValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && confirmTextEntry()}
                            placeholder="Type here..."
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowTextModal(false)}
                                className="px-3 py-1.5 text-xs text-cad-muted hover:bg-cad-border/50 rounded"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmTextEntry}
                                className="px-3 py-1.5 text-xs bg-cad-primary text-white rounded hover:bg-cad-primaryHover"
                            >
                                Add Text
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
                        showNotification(`已选中 ${ids.length} 个图元`);
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
                    title="Delete selected elements?"
                    message={`This will remove ${pendingDeleteIds.length} elements from the drawing. You can undo the deletion with Ctrl/Cmd+Z.`}
                    confirmLabel="Delete"
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

            <Header
                elements={elements}
                onImport={handleImport}
                onUndo={handleUndo}
                onRedo={handleRedo}
                currentUser={currentUser}
                onLogout={handleLogout}
                fileName={activeFile?.name}
                onSave={handleSave}
                onOpenVersions={handleOpenVersionHistory}
                onOpenPlot={() => setShowPlot(true)}
                onOpenImageTrace={() => setShowImageTrace(true)}
            />

            <div className="flex flex-1 overflow-hidden relative">
                <Toolbar />
                <Canvas
                    onRequestTextEntry={handleRequestTextEntry}
                    onRequestAdvancedShape={handleRequestAdvancedShape}
                    onNotification={showNotification}
                    onBlockDrop={handleBlockDrop}
                    aiPreview={aiPreview}
                    flashIds={flashIds}
                    onRequestDeleteSelection={requestDeleteSelection}
                    onAskAboutSelection={handleAskAboutSelection}
                    hiddenObjectIds={hiddenObjectIds}
                />
                <RightPanel
                    key={currentUser?.id || "no-user"}
                    mode={sideMode}
                    onChangeMode={setSideMode}
                    currentElements={elements}
                    drawingSettings={drawingSettings}
                    onUpdateSettings={setDrawingSettings}
                    onUpdateElement={handlePropertyUpdate}
                    onApplyAIAction={handleAIAction}
                    onPreviewAIActions={handleAIPreview}
                    chatDraft={chatDraft}
                    onAskAIFix={handleAskAIFix}
                    designConventions={activeFile?.designConventions ?? null}
                    onSaveDesignConventions={handleSaveDesignConventions}
                    files={files}
                    activeFileId={activeFile?.id || null}
                    projectChatKey={activeFile?.chatKey ?? activeFile?.id ?? null}
                    hiddenObjectCount={hiddenIds.length}
                    onLoadFile={handleLoadFile}
                    onCreateFile={handleCreateFile}
                    onRenameFile={handleRenameFile}
                    onDeleteFile={handleDeleteFile}
                    currentUser={currentUser}
                    onLogout={handleLogout}
                    onShowUserProfile={handleShowUserProfile}
                />
            </div>
            <Footer
                onCommand={handleCommand}
                hiddenCount={hiddenCount}
                onShowAllObjects={showAllObjects}
            />
        </div>
    );
}

export default App;
