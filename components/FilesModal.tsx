/**
 * FilesModal.tsx — 图纸（文件夹）管理弹窗
 *
 * 从右侧面板中独立出来，用弹窗承载列表与新建 / 重命名 / 删除，
 * 把画布面积完整让给绘图操作。
 */

import React, { useEffect, useState } from "react";
import type { ProjectFile } from "../types";
import { useI18n } from "../lib/i18n";

interface FilesModalProps {
    open: boolean;
    files: ProjectFile[];
    activeFileId: string | null;
    onClose: () => void;
    onLoadFile: (file: ProjectFile) => void;
    onCreateFile: (name: string) => void;
    onRenameFile: (id: string, newName: string) => void;
    onDeleteFile: (id: string) => void;
}

const FilesModal: React.FC<FilesModalProps> = ({
    open,
    files,
    activeFileId,
    onClose,
    onLoadFile,
    onCreateFile,
    onRenameFile,
    onDeleteFile,
}) => {
    const { t } = useI18n();
    const [searchQuery, setSearchQuery] = useState("");
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    const filteredFiles = files.filter((file) =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const commitName = (id: string) => {
        if (editName.trim()) onRenameFile(id, editName);
        setEditingFileId(null);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-cad-panel border border-cad-border rounded-xl shadow-2xl w-[min(760px,92vw)] max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(event) => event.stopPropagation()}
                data-testid="files-modal"
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-cad-border">
                    <h2 className="text-sm font-bold text-cad-text flex items-center gap-2">
                        <span className="material-symbols-outlined text-[20px] text-cad-primary">
                            folder_open
                        </span>
                        {t("panel.projectFiles")}
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onCreateFile(t("panel.untitledDrawing"))}
                            className="flex items-center gap-1 h-7 px-2.5 rounded bg-cad-primary text-white text-xs font-medium hover:bg-cad-primaryHover transition-colors"
                            title={t("panel.newFile")}
                        >
                            <span className="material-symbols-outlined text-[16px]">add</span>
                            {t("panel.newFile")}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-cad-border/50 rounded-lg text-cad-muted hover:text-cad-text transition-colors"
                            title={t("common.close")}
                            aria-label={t("common.close")}
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>
                </div>

                <div className="px-5 py-3 border-b border-cad-border">
                    <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-gray-400">
                            search
                        </span>
                        <input
                            type="text"
                            placeholder={t("panel.searchFiles")}
                            className="w-full h-8 pl-8 pr-3 rounded bg-cad-bg border border-cad-border text-xs text-cad-text focus:border-cad-primary focus:ring-1 focus:ring-cad-primary outline-none transition-all placeholder-gray-500"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {filteredFiles.map((file) => (
                        <div
                            key={file.id}
                            onClick={() => onLoadFile(file)}
                            className={`group relative flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                                activeFileId === file.id
                                    ? "bg-cad-primary/10 border-cad-primary/30"
                                    : "hover:bg-cad-text/5 border-transparent hover:border-cad-border"
                            }`}
                        >
                            <div
                                className={`size-8 rounded flex items-center justify-center mr-3 shrink-0 ${
                                    activeFileId === file.id
                                        ? "bg-cad-primary text-white"
                                        : "bg-blue-100 dark:bg-blue-900/30 text-cad-primary"
                                }`}
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    description
                                </span>
                            </div>

                            <div className="flex-1 min-w-0">
                                {editingFileId === file.id ? (
                                    <input
                                        autoFocus
                                        value={editName}
                                        onChange={(event) => setEditName(event.target.value)}
                                        onBlur={() => commitName(file.id)}
                                        onKeyDown={(event) =>
                                            event.key === "Enter" && commitName(file.id)
                                        }
                                        onClick={(event) => event.stopPropagation()}
                                        className="w-full bg-cad-bg border border-cad-primary rounded px-1 py-0.5 text-xs text-cad-text outline-none"
                                    />
                                ) : (
                                    <h4 className="text-sm font-medium text-cad-text truncate">
                                        {file.name}
                                    </h4>
                                )}
                                <span className="text-[10px] text-cad-muted">
                                    {file.lastModified}
                                </span>
                            </div>

                            <button
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingFileId(file.id);
                                    setEditName(file.name);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-opacity"
                                title={t("panel.editFile")}
                            >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>

                            <button
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteFile(file.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-red-400 transition-opacity"
                                title={t("common.delete")}
                            >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                        </div>
                    ))}

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
        </div>
    );
};

export default FilesModal;
