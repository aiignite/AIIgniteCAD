/**
 * DrawingsSection.tsx — 设置页「图纸管理」分区
 *
 * 主从布局：左侧图纸列表（搜索 / 新建），点击图纸进入右侧详情
 * 才能重命名 / 打开 / 删除；与设置页其余分区同一套满屏版式。
 */

import React, { useMemo, useState } from "react";
import type { ProjectFile } from "../../types";
import { useI18n } from "../../lib/i18n";

export interface DrawingsSectionProps {
    files: ProjectFile[];
    activeFileId: string | null;
    onLoadFile: (file: ProjectFile) => void;
    onCreateFile: (name: string) => void;
    onRenameFile: (id: string, newName: string) => void;
    onDeleteFile: (id: string) => void;
    /** 把选中的图纸作为快照插入当前图纸（一次性复制，不是持续引用） */
    onInsertIntoActive?: (file: ProjectFile) => void;
}

const DrawingsSection: React.FC<DrawingsSectionProps> = ({
    files,
    activeFileId,
    onLoadFile,
    onCreateFile,
    onRenameFile,
    onDeleteFile,
    onInsertIntoActive,
}) => {
    const { t } = useI18n();
    const [searchQuery, setSearchQuery] = useState("");
    // 主从选择：点列表进入详情，编辑动作都在详情区完成
    const [selectedId, setSelectedId] = useState<string | null>(activeFileId);
    const [editName, setEditName] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);

    const filteredFiles = useMemo(
        () =>
            files
                .filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .sort((a, b) => (b.lastModified ?? "").localeCompare(a.lastModified ?? "")),
        [files, searchQuery],
    );

    // 列表变化后保持选中项有效；默认选中当前打开的图纸
    const selected =
        filteredFiles.find((file) => file.id === selectedId) ??
        filteredFiles.find((file) => file.id === activeFileId) ??
        null;

    const beginRename = (file: ProjectFile) => {
        setSelectedId(file.id);
        setEditName(file.name);
        setConfirmDelete(false);
    };

    const commitRename = () => {
        if (selected && editName.trim() && editName.trim() !== selected.name) {
            onRenameFile(selected.id, editName.trim());
        }
        setEditName("");
    };

    const card = (file: ProjectFile) => {
        const isSelected = selected?.id === file.id;
        return (
            <button
                key={file.id}
                data-testid="drawing-item"
                onClick={() => {
                    setSelectedId(file.id);
                    setConfirmDelete(false);
                    setEditName("");
                }}
                aria-current={isSelected ? "true" : undefined}
                className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                    isSelected
                        ? "bg-cad-primary/10 border-cad-primary/40"
                        : "border-transparent hover:bg-cad-text/5 hover:border-cad-border"
                }`}
            >
                <span
                    className={`size-8 rounded flex items-center justify-center shrink-0 ${
                        activeFileId === file.id
                            ? "bg-cad-primary text-white"
                            : "bg-cad-secondary text-cad-primary"
                    }`}
                >
                    <span className="material-symbols-outlined text-[20px]">description</span>
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-cad-text truncate">
                        {file.name}
                    </span>
                    <span className="block text-[10px] text-cad-muted">{file.lastModified}</span>
                </span>
                {activeFileId === file.id && (
                    <span className="shrink-0 font-mono text-[10px] text-cad-primary">
                        {t("panel.currentDrawing")}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="h-full flex gap-4 min-h-0">
            {/* 主视图：图纸列表 */}
            <div className="w-80 shrink-0 flex flex-col rounded-lg border border-cad-border bg-cad-panel">
                <div className="p-3 space-y-2 border-b border-cad-border">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <span className="material-symbols-outlined text-[16px] text-cad-muted absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                                search
                            </span>
                            <input
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder={t("panel.searchFiles")}
                                aria-label={t("panel.searchFiles")}
                                className="w-full h-8 pl-8 pr-2 rounded bg-cad-bg border border-cad-border text-xs text-cad-text focus:border-cad-primary outline-none"
                            />
                        </div>
                        <button
                            data-action="create-drawing"
                            onClick={() => onCreateFile(t("panel.untitledDrawing"))}
                            className="h-8 px-2.5 rounded bg-cad-primary text-white text-xs font-medium hover:bg-cad-primaryHover transition-colors flex items-center gap-1"
                            title={t("panel.newFile")}
                        >
                            <span className="material-symbols-outlined text-[16px]">add</span>
                            {t("panel.newFile")}
                        </button>
                    </div>
                    <p className="font-mono text-[10px] text-cad-muted">
                        {t("panel.filesCount", { count: filteredFiles.length })}
                    </p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
                    {filteredFiles.map(card)}
                    {filteredFiles.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-cad-muted">
                            <span className="material-symbols-outlined text-[48px] opacity-20 mb-2">
                                folder_off
                            </span>
                            <p className="text-xs">{t("panel.noFiles")}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* 从视图：选中图纸的详情与编辑 */}
            <div className="flex-1 min-w-0 rounded-lg border border-cad-border bg-cad-panel p-5 overflow-y-auto">
                {selected ? (
                    <div className="max-w-xl space-y-5" data-testid="drawing-detail">
                        <div className="flex items-start gap-3">
                            <span className="size-10 rounded-lg bg-cad-secondary text-cad-primary flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-[24px]">
                                    description
                                </span>
                            </span>
                            <div className="min-w-0 flex-1">
                                {editName ? (
                                    <input
                                        autoFocus
                                        value={editName}
                                        onChange={(event) => setEditName(event.target.value)}
                                        onBlur={commitRename}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") commitRename();
                                            if (event.key === "Escape") setEditName("");
                                        }}
                                        aria-label={t("panel.editFile")}
                                        className="w-full bg-cad-bg border border-cad-primary rounded px-2 py-1 text-sm text-cad-text outline-none"
                                    />
                                ) : (
                                    <h4 className="text-base font-bold text-cad-text truncate">
                                        {selected.name}
                                    </h4>
                                )}
                                <p className="text-[11px] text-cad-muted mt-0.5 font-mono">
                                    {selected.id}
                                </p>
                            </div>
                        </div>

                        <dl className="rounded-lg border border-cad-border bg-cad-bg p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <dt className="text-cad-muted">{t("panel.lastModified")}</dt>
                            <dd className="text-cad-text font-mono">{selected.lastModified}</dd>
                            <dt className="text-cad-muted">{t("panel.elementCount")}</dt>
                            <dd className="text-cad-text font-mono">
                                {selected.elementCount ?? selected.elements?.length ?? 0}
                            </dd>
                        </dl>

                        <div className="flex flex-wrap gap-2">
                            <button
                                data-action="open-drawing"
                                onClick={() => onLoadFile(selected)}
                                className="h-8 px-3 rounded bg-cad-primary text-white text-xs font-medium hover:bg-cad-primaryHover transition-colors flex items-center gap-1.5"
                            >
                                <span className="material-symbols-outlined text-[16px]">
                                    open_in_new
                                </span>
                                {t("panel.openDrawing")}
                            </button>
                            <button
                                data-action="rename-drawing"
                                onClick={() => beginRename(selected)}
                                className="h-8 px-3 rounded border border-cad-border text-cad-text text-xs font-medium hover:bg-cad-text/10 transition-colors flex items-center gap-1.5"
                            >
                                <span className="material-symbols-outlined text-[16px]">edit</span>
                                {t("panel.editFile")}
                            </button>
                            {onInsertIntoActive && selected.id !== activeFileId && (
                                <button
                                    data-action="insert-drawing-snapshot"
                                    onClick={() => onInsertIntoActive(selected)}
                                    title={t("panel.insertDrawingHint")}
                                    className="h-8 px-3 rounded border border-cad-border text-cad-text text-xs font-medium hover:bg-cad-text/10 transition-colors flex items-center gap-1.5"
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        content_copy
                                    </span>
                                    {t("panel.insertDrawing")}
                                </button>
                            )}
                            {confirmDelete ? (
                                <div className="h-8 flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-2.5">
                                    <span className="text-[11px] text-red-500 dark:text-red-300">
                                        {t("panel.deleteConfirm")}
                                    </span>
                                    <button
                                        data-action="confirm-delete-drawing"
                                        onClick={() => {
                                            onDeleteFile(selected.id);
                                            setConfirmDelete(false);
                                            setSelectedId(null);
                                        }}
                                        className="text-[11px] font-bold text-red-500 dark:text-red-300 hover:underline"
                                    >
                                        {t("common.confirm")}
                                    </button>
                                    <button
                                        onClick={() => setConfirmDelete(false)}
                                        className="text-[11px] text-cad-muted hover:text-cad-text"
                                    >
                                        {t("common.cancel")}
                                    </button>
                                </div>
                            ) : (
                                <button
                                    data-action="delete-drawing"
                                    onClick={() => setConfirmDelete(true)}
                                    className="h-8 px-3 rounded border border-cad-border text-cad-muted text-xs font-medium hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1.5"
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        delete
                                    </span>
                                    {t("common.delete")}
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-cad-muted">
                        <span className="material-symbols-outlined text-[40px] opacity-20">
                            touch_app
                        </span>
                        <p className="text-xs">{t("panel.selectDrawingHint")}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DrawingsSection;
