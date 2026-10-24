/**
 * VersionHistoryModal.tsx — 项目版本历史
 *
 * 支持手动命名保存、版本预览、两版对比，以及恢复（恢复写入撤销历史，可 Ctrl+Z 回退）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectVersion, ProjectVersionSummary } from "../types";
import { apiService } from "../services/apiService";
import { diffElementSets, summarizeElementTypes } from "../lib/versionDiff";
import { useI18n } from "../lib/i18n";
import ElementPreview from "./ElementPreview";

interface VersionHistoryModalProps {
    projectId: string;
    projectName?: string;
    currentSnapshot: ProjectVersion["snapshotData"];
    onClose: () => void;
    onRestore: (snapshot: ProjectVersion["snapshotData"], version: ProjectVersionSummary) => void;
    onNotify: (message: string) => void;
}

const PAGE_SIZE = 30;

const formatDate = (value: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
    projectId,
    projectName,
    currentSnapshot,
    onClose,
    onRestore,
    onNotify,
}) => {
    const { t } = useI18n();
    const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loadingList, setLoadingList] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [message, setMessage] = useState("");
    const [creating, setCreating] = useState(false);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [compareIds, setCompareIds] = useState<string[]>([]);
    const [details, setDetails] = useState<Record<string, ProjectVersion>>({});
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [restoring, setRestoring] = useState(false);
    const inFlightDetailsRef = useRef(new Set<string>());

    const fetchVersions = useCallback(
        (before?: number) =>
            apiService.listProjectVersions(projectId, {
                limit: PAGE_SIZE,
                before,
            }),
        [projectId],
    );

    // 首屏加载在 Promise 回调中更新状态，避免 effect 同步 setState 引发级联渲染
    useEffect(() => {
        let cancelled = false;
        fetchVersions()
            .then((result) => {
                if (cancelled) return;
                setVersions(result.versions);
                setHasMore(result.hasMore);
                if (result.versions.length > 0) {
                    setFocusedId((current) => current ?? result.versions[0].id);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setListError(
                        error instanceof Error ? error.message : t("versions.failedLoad"),
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingList(false);
            });
        return () => {
            cancelled = true;
        };
    }, [fetchVersions]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    const loadDetail = useCallback(
        async (versionId: string) => {
            if (details[versionId] || inFlightDetailsRef.current.has(versionId)) return;
            inFlightDetailsRef.current.add(versionId);
            try {
                const result = await apiService.getProjectVersion(projectId, versionId);
                setDetails((current) => ({ ...current, [versionId]: result.version }));
            } catch (error) {
                onNotify(error instanceof Error ? error.message : t("versions.failedLoad"));
            } finally {
                inFlightDetailsRef.current.delete(versionId);
            }
        },
        [projectId, details, onNotify, t],
    );

    // setState 只在 Promise 回调中执行，避免 effect 同步更新引发级联渲染
    useEffect(() => {
        const ids = new Set(compareIds);
        if (focusedId) ids.add(focusedId);
        ids.forEach((id) => void loadDetail(id));
    }, [focusedId, compareIds, loadDetail]);

    const reload = async () => {
        setLoadingList(true);
        setListError(null);
        try {
            const result = await fetchVersions();
            setVersions(result.versions);
            setHasMore(result.hasMore);
            setFocusedId((current) => current ?? result.versions[0]?.id ?? null);
        } catch (error) {
            setListError(error instanceof Error ? error.message : t("versions.failedLoad"));
        } finally {
            setLoadingList(false);
        }
    };

    const loadMore = async () => {
        const oldest = versions[versions.length - 1];
        if (!oldest || loadingList) return;
        setLoadingList(true);
        try {
            const result = await fetchVersions(oldest.versionNumber);
            setVersions((current) => [...current, ...result.versions]);
            setHasMore(result.hasMore);
        } catch (error) {
            onNotify(error instanceof Error ? error.message : t("versions.failedLoad"));
        } finally {
            setLoadingList(false);
        }
    };

    const focusedSummary = versions.find((version) => version.id === focusedId) ?? null;
    const focusedDetail = focusedId ? details[focusedId] : undefined;
    const compareSummaries = compareIds
        .map((id) => versions.find((version) => version.id === id))
        .filter((version): version is ProjectVersionSummary => Boolean(version));

    const comparison = useMemo(() => {
        if (compareSummaries.length === 2) {
            const [first, second] = [...compareSummaries].sort(
                (a, b) => a.versionNumber - b.versionNumber,
            );
            const base = details[first.id];
            const target = details[second.id];
            if (!base || !target) return null;
            return {
                label: t("versions.range", {
                    from: first.versionNumber,
                    to: second.versionNumber,
                }),
                diff: diffElementSets(
                    base.snapshotData.elements ?? [],
                    target.snapshotData.elements ?? [],
                ),
            };
        }

        if (focusedDetail) {
            return {
                label: t("versions.currentTo", { version: focusedDetail.versionNumber }),
                diff: diffElementSets(
                    currentSnapshot.elements ?? [],
                    focusedDetail.snapshotData.elements ?? [],
                ),
            };
        }

        return null;
    }, [compareSummaries, details, focusedDetail, currentSnapshot, t]);

    const previewSnapshot = useMemo(() => {
        if (compareSummaries.length === 2) {
            const [, newer] = [...compareSummaries].sort(
                (a, b) => a.versionNumber - b.versionNumber,
            );
            return details[newer.id]?.snapshotData;
        }
        return focusedDetail?.snapshotData;
    }, [compareSummaries, details, focusedDetail]);

    const handleCreate = async () => {
        if (creating) return;
        setCreating(true);
        try {
            const result = await apiService.createProjectVersion(
                projectId,
                currentSnapshot,
                message.trim() || undefined,
            );
            const summary = result.version;
            setVersions((current) => [summary, ...current]);
            setDetails((current) => ({
                ...current,
                [summary.id]: { ...summary, snapshotData: currentSnapshot },
            }));
            setFocusedId(summary.id);
            setMessage("");
            onNotify(t("versions.saved", { version: summary.versionNumber }));
        } catch (error) {
            onNotify(error instanceof Error ? error.message : t("versions.failedSave"));
        } finally {
            setCreating(false);
        }
    };

    const toggleCompare = (versionId: string) => {
        setCompareIds((current) => {
            if (current.includes(versionId)) {
                return current.filter((id) => id !== versionId);
            }
            // 最多同时对比两个版本，超出时淘汰最早的选择
            return [...current, versionId].slice(-2);
        });
    };

    const requestRestore = (version: ProjectVersionSummary) => {
        setFocusedId(version.id);
        setConfirmId(version.id);
    };

    const handleRestore = async () => {
        if (!confirmId || restoring) return;
        const version = details[confirmId];
        if (!version) return;
        setRestoring(true);
        try {
            onRestore(version.snapshotData, {
                id: version.id,
                projectId: version.projectId,
                versionNumber: version.versionNumber,
                elementCount: version.snapshotData.elements?.length ?? 0,
                commitMessage: version.commitMessage,
                createdBy: version.createdBy,
                createdAt: version.createdAt,
            });
            onClose();
        } catch (error) {
            onNotify(error instanceof Error ? error.message : t("versions.failedRestore"));
        } finally {
            setRestoring(false);
        }
    };

    return (
        <div
            className="absolute inset-0 z-40 flex flex-col bg-cad-bg"
            role="dialog"
            aria-modal="true"
            aria-label={t("versions.title")}
        >
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-cad-border bg-cad-panel">
                    <div>
                        <h2 className="text-base font-bold text-cad-text">{t("versions.title")}</h2>
                        <p className="text-[11px] text-cad-muted font-mono">
                            {projectName || projectId}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="flex items-center gap-1.5 h-8 px-2.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-border/40 hover:text-cad-text transition-colors"
                        title={t("versions.close")}
                        aria-label={t("versions.close")}
                    >
                        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                        <span className="hidden md:inline">{t("settings.backToCanvas")}</span>
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[360px_1fr]">
                    {/* 左栏：新建 + 版本列表 */}
                    <div className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-cad-border">
                        <div className="p-3 border-b border-cad-border/60">
                            <div className="flex gap-2">
                                <input
                                    value={message}
                                    onChange={(event) => setMessage(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") void handleCreate();
                                    }}
                                    placeholder={t("versions.namePlaceholder")}
                                    aria-label={t("versions.nameLabel")}
                                    maxLength={200}
                                    className="flex-1 min-w-0 bg-cad-bg border border-cad-border rounded px-2 py-1.5 text-xs text-cad-text placeholder:text-cad-muted focus:outline-none focus:border-cad-primary"
                                />
                                <button
                                    onClick={() => void handleCreate()}
                                    disabled={creating}
                                    className="px-3 py-1.5 rounded bg-cad-primary hover:bg-cad-primaryHover disabled:opacity-50 text-white text-xs font-bold transition-colors"
                                >
                                    {creating ? t("common.saving") : t("versions.save")}
                                </button>
                            </div>
                            <p className="mt-1.5 text-[10px] text-cad-muted font-mono">
                                {t("versions.autoHint")}
                            </p>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {loadingList && versions.length === 0 && (
                                <p className="text-xs text-cad-muted p-3">{t("versions.loading")}</p>
                            )}
                            {listError && (
                                <div className="p-3 text-xs text-red-400">
                                    <p>{listError}</p>
                                    <button
                                        onClick={() => void reload()}
                                        className="mt-2 px-2 py-1 rounded border border-cad-border hover:bg-cad-text/10"
                                    >
                                        {t("common.retry")}
                                    </button>
                                </div>
                            )}
                            {!loadingList && !listError && versions.length === 0 && (
                                <div className="p-4 text-xs text-cad-muted">
                                    {t("versions.empty")}
                                </div>
                            )}

                            {versions.map((version) => {
                                const focused = version.id === focusedId;
                                const compared = compareIds.includes(version.id);
                                return (
                                    <div
                                        key={version.id}
                                        className={`rounded border transition-colors ${
                                            focused
                                                ? "border-cad-primary bg-cad-primary/10"
                                                : "border-cad-border hover:bg-cad-text/5"
                                        }`}
                                    >
                                        <div className="flex items-start gap-2 p-2">
                                            <button
                                                onClick={() => setFocusedId(version.id)}
                                                className="flex-1 min-w-0 text-left"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-bold text-cad-text font-mono">
                                                        v{version.versionNumber}
                                                    </span>
                                                    <span className="text-[10px] text-cad-muted font-mono">
                                                        {t("versions.elementCount", {
                                                            count: version.elementCount,
                                                        })}
                                                    </span>
                                                    {version.changeSummary && (
                                                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                                                            +{version.changeSummary.added} / -
                                                            {version.changeSummary.removed}
                                                            {version.changeSummary.modified
                                                                ? ` / ~${version.changeSummary.modified}`
                                                                : ""}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-cad-text truncate">
                                                    {version.commitMessage || t("versions.untitled")}
                                                </div>
                                                <div className="text-[10px] text-cad-muted truncate">
                                                    {formatDate(version.createdAt)}
                                                </div>
                                            </button>
                                            <div className="flex flex-col items-end gap-1">
                                                <label
                                                    className="flex items-center gap-1 text-[10px] text-cad-muted cursor-pointer"
                                                    title={t("versions.selectToCompare")}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={compared}
                                                        onChange={() => toggleCompare(version.id)}
                                                        aria-label={t("versions.compareVersion", {
                                                            version: version.versionNumber,
                                                        })}
                                                    />
                                                    {t("versions.compare")}
                                                </label>
                                                <button
                                                    onClick={() => requestRestore(version)}
                                                    className="text-[10px] text-cad-primary hover:underline"
                                                    title={t("versions.restoreTitle", {
                                                        version: version.versionNumber,
                                                    })}
                                                >
                                                    {t("versions.restore")}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {hasMore && (
                                <button
                                    onClick={() => void loadMore()}
                                    disabled={loadingList}
                                    className="w-full py-2 text-[11px] text-cad-muted border border-cad-border rounded hover:bg-cad-text/10 disabled:opacity-50"
                                >
                                    {loadingList ? t("common.loading") : t("versions.loadMore")}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 右栏：预览与对比 */}
                    <div className="flex flex-col min-h-0 p-4 gap-3 overflow-y-auto">
                        {!previewSnapshot && (
                            <div className="flex-1 flex items-center justify-center text-xs text-cad-muted">
                                {focusedId && !focusedDetail
                                    ? t("versions.loadingSnapshot")
                                    : t("versions.selectPreview")}
                            </div>
                        )}

                        {previewSnapshot && (
                            <>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-bold text-cad-text">
                                            {compareSummaries.length === 2
                                                ? t("versions.comparison")
                                                : t("versions.version", {
                                                      version: focusedSummary?.versionNumber ?? "",
                                                  })}
                                        </div>
                                        <div className="text-[11px] text-cad-muted">
                                            {focusedSummary?.commitMessage || t("versions.untitled")}
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-cad-muted font-mono text-right">
                                        {focusedSummary ? formatDate(focusedSummary.createdAt) : ""}
                                    </div>
                                </div>

                                <ElementPreview
                                    elements={previewSnapshot.elements ?? []}
                                    dimScale={previewSnapshot.settings?.dimScale ?? 1}
                                    dimPrecision={previewSnapshot.settings?.dimPrecision ?? 2}
                                    ariaLabel={t("versions.previewAria")}
                                />

                                {comparison && (
                                    <div className="rounded border border-cad-border bg-cad-bg/60 p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[11px] font-bold text-cad-text font-mono">
                                                {comparison.label}
                                            </span>
                                            <span className="text-[10px] text-cad-muted">
                                                {t("versions.unchanged", {
                                                    count: comparison.diff.unchanged,
                                                })}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                                            <div>
                                                <div className="text-emerald-500 font-bold">
                                                    +{comparison.diff.added.length}
                                                </div>
                                                <div
                                                    className="text-cad-muted truncate"
                                                    title={summarizeElementTypes(
                                                        comparison.diff.added,
                                                    )}
                                                >
                                                    {summarizeElementTypes(comparison.diff.added)}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-red-400 font-bold">
                                                    −{comparison.diff.removed.length}
                                                </div>
                                                <div
                                                    className="text-cad-muted truncate"
                                                    title={summarizeElementTypes(
                                                        comparison.diff.removed,
                                                    )}
                                                >
                                                    {summarizeElementTypes(comparison.diff.removed)}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-amber-400 font-bold">
                                                    ~{comparison.diff.modified.length}
                                                </div>
                                                <div
                                                    className="text-cad-muted truncate"
                                                    title={summarizeElementTypes(
                                                        comparison.diff.modified.map(
                                                            (item) => item.after,
                                                        ),
                                                    )}
                                                >
                                                    {summarizeElementTypes(
                                                        comparison.diff.modified.map(
                                                            (item) => item.after,
                                                        ),
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="mt-auto pt-2 border-t border-cad-border/60">
                                    {confirmId === focusedSummary?.id ? (
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-[11px] text-cad-muted">
                                                {t("versions.restorePrompt", {
                                                    version: focusedSummary?.versionNumber ?? "",
                                                })}
                                            </p>
                                            <div className="flex gap-2 shrink-0">
                                                <button
                                                    onClick={() => setConfirmId(null)}
                                                    className="px-3 py-1.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-text/10"
                                                >
                                                    {t("versions.cancelRestore")}
                                                </button>
                                                <button
                                                    data-action="restore-confirm"
                                                    onClick={() => void handleRestore()}
                                                    disabled={restoring}
                                                    className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-bold"
                                                >
                                                    {restoring ? t("versions.restoring") : t("versions.restore")}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-[11px] text-cad-muted">
                                                {t("versions.restoreHint")}
                                            </p>
                                            <button
                                                onClick={() =>
                                                    setConfirmId(focusedSummary?.id ?? null)
                                                }
                                                disabled={!focusedSummary || !focusedDetail}
                                                className="px-3 py-1.5 rounded border border-amber-500/50 text-amber-500 text-xs font-bold hover:bg-amber-500/10 disabled:opacity-50"
                                            >
                                                {t("versions.confirmRestore")}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VersionHistoryModal;
