/**
 * useDrawingFiles.ts — 图纸文件管理与文档持久化
 *
 * 从 App.tsx 抽出的跨领域编排：日常保存、版本、加载 / 新建 / 重命名 / 删除、
 * 自动保存与自动版本。所有持久化都基于统一 ProjectDocument：
 * 图元、图层、绘图设置、块引用与设计约定一起原子落盘并进入同步队列，
 * 不再出现"图元存了、图层没存"的分裂状态。
 */

import { useCallback, useEffect, useRef } from "react";
import type {
    CADElement,
    DrawingSettings,
    ProjectFile,
    ProjectVersion,
} from "../types";
import { useCanvas } from "../store/canvasStore";
import { useApp } from "../store/appStore";
import { useI18n } from "../lib/i18n";
import { apiService } from "../services/apiService";
import { indexedDBService } from "../services/indexedDBService";
import { syncService } from "../services/syncService";
import { telemetryService } from "../services/telemetryService";
import { buildVersionSnapshot, type LayerSnapshotInput } from "../lib/versionSnapshot";
import {
    PROJECT_DOCUMENT_VERSION,
    createDefaultDrawingSettings,
    createDefaultLayers,
    layerSnapshotFromLayers,
    layersFromLayerSnapshot,
    normalizeProjectDocument,
    projectFileFromDocument,
    type ProjectDocument,
} from "../lib/projectDocument";

/** 空图纸复用同一引用，避免加载/新建后立即触发一次无意义的自动保存 */
const EMPTY_ELEMENTS: CADElement[] = [];

/** 每 N 次提交自动保存一个版本；失败后最多每 60 秒重试一次 */
const AUTO_VERSION_INTERVAL = 20;
const AUTO_VERSION_RETRY_MS = 60_000;

/** 自动保存防抖：图形停止变化后多久落盘 */
const AUTOSAVE_DEBOUNCE_MS = 3000;

/** 兼容旧工程数据：选中状态已迁移到独立 selectedIds，图元上不再保留 selected 字段 */
const stripLegacySelection = (elements: CADElement[]): CADElement[] =>
    elements.map((element) => {
        if (!("selected" in element)) return element;
        const clean = { ...element };
        delete (clean as { selected?: boolean }).selected;
        return clean;
    });

/** 自动保存基线：图层与设置的引用变化也要触发保存 */
interface SavedBaseline {
    fileId: string;
    elements: CADElement[];
    layerOrder: string[];
    layerColors: Record<string, string>;
    hiddenLayers: string[];
    lockedLayers: string[];
    settings: DrawingSettings;
}

export interface UseDrawingFilesOptions {
    isLoggedIn: boolean;
    /** 立即提交尚未落盘的属性编辑（保存 / 撤销前调用） */
    flushPropertyCommit: () => void;
    /** 隔离 / 隐藏对象的临时隐藏集：加载图纸时重置 */
    setHiddenIds: (ids: string[]) => void;
    /** 版本历史窗体由 App 持有：校验通过后打开 */
    onOpenVersionHistory: () => void;
}

export function useDrawingFiles({
    isLoggedIn,
    flushPropertyCommit,
    setHiddenIds,
    onOpenVersionHistory,
}: UseDrawingFilesOptions) {
    const { t } = useI18n();
    const appStore = useApp();
    const {
        state: appState,
        showNotification,
        setLoading,
        setFiles,
        setActiveFile,
        updateFile,
        setLoggedIn,
    } = appStore;
    const { files, activeFile } = appState;
    const {
        state: canvasState,
        setElements,
        commitAction,
        getElements,
        loadHistory,
        setDrawingSettings,
        loadLayerState,
    } = useCanvas();
    const { elements } = canvasState;

    const lastSavedRef = useRef<SavedBaseline | null>(null);
    const autoVersionBaselineRef = useRef<{ projectId: string; revision: number } | null>(null);
    const autoVersionAttemptRef = useRef(0);

    /** 当前画布对应的图层快照输入：版本与日常文档保存共用 */
    const layerSnapshotInput = useCallback(
        (): LayerSnapshotInput => ({
            layerOrder: canvasState.layerOrder,
            layerColors: canvasState.layerColors,
            hiddenLayers: canvasState.hiddenLayers,
            lockedLayers: canvasState.lockedLayers,
        }),
        [
            canvasState.layerOrder,
            canvasState.layerColors,
            canvasState.hiddenLayers,
            canvasState.lockedLayers,
        ],
    );

    const rememberBaseline = useCallback(
        (fileId: string, snapshot: CADElement[]) => {
            lastSavedRef.current = {
                fileId,
                elements: snapshot,
                layerOrder: canvasState.layerOrder,
                layerColors: canvasState.layerColors,
                hiddenLayers: canvasState.hiddenLayers,
                lockedLayers: canvasState.lockedLayers,
                settings: canvasState.drawingSettings,
            };
        },
        [
            canvasState.layerOrder,
            canvasState.layerColors,
            canvasState.hiddenLayers,
            canvasState.lockedLayers,
            canvasState.drawingSettings,
        ],
    );

    const isBaselineCurrent = useCallback(
        (fileId: string, snapshot: CADElement[]) => {
            const saved = lastSavedRef.current;
            if (!saved || saved.fileId !== fileId) return false;
            return (
                saved.elements === snapshot &&
                saved.layerOrder === canvasState.layerOrder &&
                saved.layerColors === canvasState.layerColors &&
                saved.hiddenLayers === canvasState.hiddenLayers &&
                saved.lockedLayers === canvasState.lockedLayers &&
                saved.settings === canvasState.drawingSettings
            );
        },
        [
            canvasState.layerOrder,
            canvasState.layerColors,
            canvasState.hiddenLayers,
            canvasState.lockedLayers,
            canvasState.drawingSettings,
        ],
    );

    /** 服务端回填新 id 后同步基线，避免自动保存把旧 id 当成另一张图纸 */
    const noteProjectRemapped = useCallback((oldId: string, newId: string) => {
        if (lastSavedRef.current?.fileId === oldId) {
            lastSavedRef.current = { ...lastSavedRef.current, fileId: newId };
        }
    }, []);

    /** 应用文档到画布与文件状态：图元、撤销历史、图层、设置与约定一次到位 */
    const applyDocument = useCallback(
        (doc: ProjectDocument, baseFile: ProjectFile) => {
            const loadedElements = stripLegacySelection(doc.elements);
            setElements(loadedElements);
            loadHistory([loadedElements], 0);
            setHiddenIds([]);
            loadLayerState(layerSnapshotFromLayers(doc.layers));
            setDrawingSettings(doc.drawingSettings);
            const loadedFile: ProjectFile = {
                ...baseFile,
                ...projectFileFromDocument(doc),
                designConventions: doc.designConventions ?? null,
            };
            setActiveFile(loadedFile);
            rememberBaseline(doc.id, loadedElements);
            return loadedFile;
        },
        [setElements, loadHistory, setHiddenIds, loadLayerState, setDrawingSettings, setActiveFile, rememberBaseline],
    );

    /** 持久化图纸快照；自动保存与手动保存共用，不触发通知或 UI 状态更新 */
    const persistFile = useCallback(
        async (file: ProjectFile, snapshot: CADElement[]) => {
            const doc: ProjectDocument = {
                schemaVersion: PROJECT_DOCUMENT_VERSION,
                id: file.id,
                name: file.name,
                description: file.description,
                lastModified: new Date().toISOString(),
                elements: snapshot,
                layers: layersFromLayerSnapshot(snapshot, layerSnapshotInput()),
                drawingSettings: canvasState.drawingSettings,
                blockReferences: file.blockReferences,
                designConventions: file.designConventions ?? null,
                thumbnail: file.thumbnail,
                userId: file.userId,
                chatKey: file.chatKey,
            };
            await indexedDBService.saveDocument(doc);
            const updatedFile = projectFileFromDocument(doc);
            await indexedDBService.enqueueProjectUpdate(updatedFile);
            syncService.requestFlush();
            rememberBaseline(file.id, snapshot);
            return updatedFile;
        },
        [layerSnapshotInput, canvasState.drawingSettings, rememberBaseline],
    );

    const handleSave = useCallback(async () => {
        if (!activeFile) return;
        flushPropertyCommit();
        telemetryService.recordAction("save", { fileId: activeFile.id });
        try {
            const updatedFile = await persistFile(activeFile, elements);
            updateFile(updatedFile);
            showNotification(t("notify.saved"));
        } catch (error: unknown) {
            showNotification(
                t("notify.saveFailed", {
                    message: error instanceof Error ? error.message : String(error),
                }),
            );
        }
    }, [activeFile, elements, flushPropertyCommit, persistFile, updateFile, showNotification, t]);

    /** 手动保存一个版本；AI 的 save_version 工具复用同一快照结构 */
    const handleSaveVersion = useCallback(async () => {
        if (!activeFile) {
            showNotification(t("notify.openDrawingFirst"));
            return;
        }
        if (!isLoggedIn) {
            showNotification(t("notify.signInForVersions"));
            return;
        }
        const snapshot = buildVersionSnapshot(
            getElements(),
            layerSnapshotInput(),
            canvasState.drawingSettings,
            activeFile.designConventions ?? null,
        );
        try {
            const result = await apiService.createProjectVersion(
                activeFile.id,
                snapshot,
                `Manual · ${new Date().toLocaleString()}`,
            );
            showNotification(t("notify.versionSaved", { version: result.version.versionNumber }));
        } catch (error) {
            showNotification(
                t("notify.versionSaveFailed", {
                    message: error instanceof Error ? error.message : String(error),
                }),
            );
        }
    }, [
        activeFile,
        isLoggedIn,
        layerSnapshotInput,
        canvasState.drawingSettings,
        getElements,
        showNotification,
        t,
    ]);

    const handleOpenVersionHistory = useCallback(() => {
        if (!activeFile) {
            showNotification(t("notify.openDrawingFirst"));
            return;
        }
        if (!isLoggedIn) {
            showNotification(t("notify.signInForVersions"));
            return;
        }
        onOpenVersionHistory();
    }, [activeFile, isLoggedIn, showNotification, t, onOpenVersionHistory]);

    /**
     * 恢复版本：图元通过 commitAction 写入撤销历史，图层、设置与设计约定同步替换。
     * 随后立即持久化，避免自动保存延迟窗口内刷新丢失恢复结果。
     */
    const handleRestoreVersion = useCallback(
        (snapshot: ProjectVersion["snapshotData"]) => {
            flushPropertyCommit();
            const restoredElements = snapshot.elements ?? [];
            commitAction(restoredElements);

            const layers = snapshot.layers ?? [];
            if (layers.length > 0) {
                loadLayerState(layerSnapshotFromLayers(layers));
            }
            if (snapshot.settings) setDrawingSettings(snapshot.settings);

            let restoredFile = activeFile;
            if (
                activeFile &&
                Object.prototype.hasOwnProperty.call(snapshot, "designConventions")
            ) {
                restoredFile = {
                    ...activeFile,
                    designConventions: snapshot.designConventions ?? null,
                };
                setActiveFile(restoredFile);
            }

            showNotification(t("notify.restored", { count: restoredElements.length }));

            if (restoredFile) {
                void persistFile(restoredFile, restoredElements).catch((error) => {
                    console.error("Restore save failed", error);
                });
            }
        },
        [
            flushPropertyCommit,
            commitAction,
            loadLayerState,
            setDrawingSettings,
            activeFile,
            setActiveFile,
            showNotification,
            t,
            persistFile,
        ],
    );

    const handleLoadFile = useCallback(
        async (file: ProjectFile) => {
            if (activeFile && activeFile.id === file.id) return;
            try {
                if (activeFile && elements.length > 0) {
                    await persistFile(activeFile, elements);
                }

                let loadedDoc: ProjectDocument | null = null;
                let fromServer = false;
                if (apiService.isAuthenticated()) {
                    try {
                        await apiService.openProject(file.id);
                        const projectData = await apiService.getProject(file.id);
                        void syncService.setServerCursor(
                            file.id,
                            projectData.project.updatedAt,
                        );
                        loadedDoc = normalizeProjectDocument({
                            id: projectData.project.id ?? file.id,
                            name: projectData.project.name ?? file.name,
                            description: projectData.project.description,
                            lastModified: projectData.project.updatedAt,
                            elements: (projectData.project.elements || []).map((el: { geometryData?: unknown }) => ({
                                ...(el.geometryData as Record<string, unknown>),
                            })),
                            layers: projectData.project.layers,
                            drawingSettings: projectData.project.drawingSettings,
                            blockReferences: projectData.project.blockReferences,
                            designConventions: projectData.project.designConventions,
                            thumbnail: projectData.project.thumbnail,
                        });
                        fromServer = true;
                    } catch (error: unknown) {
                        const status =
                            error && typeof error === "object" && "status" in error
                                ? (error as { status?: number }).status
                                : undefined;
                        if (status === 401) {
                            apiService.clearToken();
                            setLoggedIn(false);
                        }
                        // 服务端不可用或项目缺失时回退本地快照，避免已登录用户完全打不开图纸
                        console.error(
                            "Failed to load project from server; using local snapshot:",
                            error,
                        );
                    }
                }

                if (!loadedDoc) {
                    loadedDoc = await indexedDBService.loadDocument(file.id);
                }

                if (!loadedDoc) {
                    // 旧存档可能只有图元快照：按默认图层与设置迁移
                    const legacyElements = await indexedDBService.getElementsByProject(file.id);
                    loadedDoc = normalizeProjectDocument({
                        ...file,
                        elements: legacyElements,
                    });
                }

                if (!loadedDoc) {
                    showNotification(t("notify.fileLoadFailed"));
                    return;
                }

                applyDocument(loadedDoc, file);
                if (fromServer) {
                    showNotification(t("notify.fileLoaded", { name: file.name }));
                } else {
                    showNotification(t("notify.offlineFileLoaded", { name: file.name }));
                }
            } catch (error: unknown) {
                showNotification(
                    (error instanceof Error ? error.message : String(error)) ||
                        t("notify.fileLoadFailed"),
                );
            }
        },
        [
            activeFile,
            elements,
            persistFile,
            applyDocument,
            showNotification,
            t,
            setLoggedIn,
        ],
    );

    /**
     * 激活一张新图纸：本地落库 + 写入文档快照 + 重置画布到默认图层与设置。
     * 新建空白图纸与打开内置示例共用，保证两者加载链路一致。
     */
    const activateNewFile = useCallback(
        async (newFile: ProjectFile) => {
            await indexedDBService.saveNewProject(newFile);
            // 同时写入文档快照：本地立即可按完整文档加载，不等首次同步
            const newDoc = normalizeProjectDocument(newFile);
            if (newDoc) {
                await indexedDBService.saveDocument(newDoc);
            }
            setFiles([...files, newFile]);
            setActiveFile(newFile);
            const initialElements = newFile.elements ?? EMPTY_ELEMENTS;
            setElements(initialElements);
            loadHistory([initialElements], 0);
            setHiddenIds([]);
            // 新图纸使用默认图层与设置，不继承上一张图的画布状态
            loadLayerState(layerSnapshotFromLayers(createDefaultLayers()));
            setDrawingSettings(createDefaultDrawingSettings());
            rememberBaseline(newFile.id, initialElements);
            syncService.requestFlush();
            return newFile;
        },
        [
            files,
            setFiles,
            setActiveFile,
            setElements,
            loadHistory,
            setHiddenIds,
            loadLayerState,
            setDrawingSettings,
            rememberBaseline,
        ],
    );

    const handleCreateFile = useCallback(
        async (name: string) => {
            try {
                setLoading(true);
                const newFile: ProjectFile = {
                    id: Math.random().toString(36).substr(2, 9),
                    name,
                    lastModified: new Date().toISOString(),
                    elements: [],
                    elementCount: 0,
                    layers: createDefaultLayers(),
                    drawingSettings: createDefaultDrawingSettings(),
                };
                await activateNewFile(newFile);
                showNotification(t("notify.fileCreated", { name }));
            } catch (error: unknown) {
                showNotification(
                    (error instanceof Error ? error.message : String(error)) ||
                        t("notify.fileCreateFailed"),
                );
            } finally {
                setLoading(false);
            }
        },
        [activateNewFile, setLoading, showNotification, t],
    );

    const handleRenameFile = useCallback(
        async (id: string, newName: string) => {
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
                showNotification(t("notify.fileRenamed", { name: newName }));
            } catch (error: unknown) {
                showNotification(
                    (error instanceof Error ? error.message : String(error)) ||
                        t("notify.fileRenameFailed"),
                );
            }
        },
        [files, activeFile, setFiles, setActiveFile, showNotification, t],
    );

    const handleDeleteFile = useCallback(
        async (id: string) => {
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
                showNotification(t("notify.fileDeleted"));
            } catch (error: unknown) {
                showNotification(
                    (error instanceof Error ? error.message : String(error)) ||
                        t("notify.fileDeleteFailed"),
                );
            }
        },
        [files, activeFile, setFiles, setActiveFile, setElements, loadHistory, setHiddenIds, showNotification, t],
    );

    // Auto-save：图形、图层或设置真正变化后触发，选择/工具等瞬态状态不会引起写盘
    useEffect(() => {
        if (!activeFile) return;
        if (isBaselineCurrent(activeFile.id, elements)) return;
        const timer = setTimeout(async () => {
            try {
                await persistFile(activeFile, elements);
            } catch (error) {
                console.error("Auto-save failed", error);
            }
        }, AUTOSAVE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [
        elements,
        activeFile,
        persistFile,
        isBaselineCurrent,
        canvasState.layerOrder,
        canvasState.layerColors,
        canvasState.hiddenLayers,
        canvasState.lockedLayers,
        canvasState.drawingSettings,
    ]);

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
            layerSnapshotInput(),
            canvasState.drawingSettings,
            activeFile.designConventions ?? null,
        );

        void apiService
            .createProjectVersion(activeFile.id, snapshot, `Auto · ${revision} edits`)
            .then((result) => {
                if (autoVersionBaselineRef.current?.projectId !== activeFile.id) return;
                autoVersionBaselineRef.current = { projectId: activeFile.id, revision };
                showNotification(
                    t("notify.autoVersionSaved", { version: result.version.versionNumber }),
                );
            })
            .catch(() => {
                // 离线或服务不可用时保留基线，后续提交按退避重试
            });
    }, [
        activeFile,
        isLoggedIn,
        canvasState.revision,
        layerSnapshotInput,
        canvasState.drawingSettings,
        getElements,
        showNotification,
        t,
    ]);

    return {
        persistFile,
        activateNewFile,
        handleSave,
        handleSaveVersion,
        handleOpenVersionHistory,
        handleRestoreVersion,
        handleLoadFile,
        handleCreateFile,
        handleRenameFile,
        handleDeleteFile,
        noteProjectRemapped,
    };
}

export default useDrawingFiles;
