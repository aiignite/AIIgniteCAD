import React, { useState } from "react";
import { ProjectFile } from "../types";

interface WelcomeModalProps {
    visible: boolean;
    files: ProjectFile[];
    currentUser?: any;
    onLoadFile: (file: ProjectFile) => void;
    onCreateFile: (name: string) => void;
    onImportFile: () => void;
    onClose: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
    visible,
    files,
    currentUser,
    onLoadFile,
    onCreateFile,
    onImportFile,
    onClose,
}) => {
    const [newFileName, setNewFileName] = useState("");
    const [showNewFileInput, setShowNewFileInput] = useState(false);

    if (!visible) return null;

    const handleCreateNew = () => {
        if (showNewFileInput) {
            const name = newFileName.trim() || `Drawing-${Date.now()}`;
            onCreateFile(name);
            setNewFileName("");
            setShowNewFileInput(false);
            onClose();
        } else {
            setShowNewFileInput(true);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleCreateNew();
        } else if (e.key === "Escape") {
            setShowNewFileInput(false);
            setNewFileName("");
        }
    };

    const recentFiles = files
        .sort((a, b) => {
            const aDate = new Date(a.lastModified || a.lastOpened || 0);
            const bDate = new Date(b.lastModified || b.lastOpened || 0);
            return bDate.getTime() - aDate.getTime();
        })
        .slice(0, 10);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-cad-panel border border-cad-border rounded-xl shadow-2xl w-[700px] max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-cad-border bg-gradient-to-r from-cad-primary/5 to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="size-10 shrink-0">
                            <svg
                                viewBox="0 0 200 200"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className="w-full h-full drop-shadow-md"
                            >
                                <defs>
                                    <linearGradient
                                        id="welcome-cad-bg-gradient"
                                        x1="0"
                                        y1="0"
                                        x2="200"
                                        y2="200"
                                        gradientUnits="userSpaceOnUse"
                                    >
                                        <stop offset="0%" stopColor="#137fec" />
                                        <stop offset="100%" stopColor="#0b63c1" />
                                    </linearGradient>
                                </defs>
                                <rect
                                    width="200"
                                    height="200"
                                    rx="40"
                                    fill="url(#welcome-cad-bg-gradient)"
                                />
                                <path
                                    d="M100 142 C 78 142, 70 115, 88 92 C 98 80, 115 65, 105 40 C 128 65, 138 100, 122 128 C 115 140, 110 142, 100 142Z"
                                    fill="white"
                                />
                                <circle cx="100.5" cy="138" r="3" fill="white" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-cad-text font-display">
                                Welcome to AI Ignite CAD
                            </h2>
                            <p className="text-xs text-cad-muted">
                                {currentUser?.username ? `Hi, ${currentUser.username}!` : "Start designing"}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-cad-border/50 rounded-lg transition-colors"
                        title="Close"
                    >
                        <span className="material-symbols-outlined text-[20px] text-cad-muted">
                            close
                        </span>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
                    {/* Quick Actions */}
                    <section className="mb-6">
                        <h3 className="text-xs font-bold text-cad-muted uppercase tracking-wider mb-3">
                            Start
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            {/* New File Card */}
                            <button
                                onClick={() => setShowNewFileInput(true)}
                                className="group flex flex-col items-start gap-2 p-4 bg-cad-bg border border-cad-border hover:border-cad-primary/50 rounded-lg transition-all hover:shadow-md hover:scale-[1.02] text-left"
                            >
                                <div className="flex items-center justify-center size-12 bg-cad-primary/10 text-cad-primary rounded-lg group-hover:bg-cad-primary group-hover:text-white transition-colors">
                                    <span className="material-symbols-outlined text-[28px]">
                                        add
                                    </span>
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-cad-text">
                                        New Drawing
                                    </div>
                                    <div className="text-xs text-cad-muted">
                                        Start from scratch
                                    </div>
                                </div>
                            </button>

                            {/* Import File Card */}
                            <button
                                onClick={() => {
                                    onImportFile();
                                    onClose();
                                }}
                                className="group flex flex-col items-start gap-2 p-4 bg-cad-bg border border-cad-border hover:border-cad-primary/50 rounded-lg transition-all hover:shadow-md hover:scale-[1.02] text-left"
                            >
                                <div className="flex items-center justify-center size-12 bg-cad-primary/10 text-cad-primary rounded-lg group-hover:bg-cad-primary group-hover:text-white transition-colors">
                                    <span className="material-symbols-outlined text-[28px]">
                                        upload_file
                                    </span>
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-cad-text">
                                        Import DXF
                                    </div>
                                    <div className="text-xs text-cad-muted">
                                        Open existing file
                                    </div>
                                </div>
                            </button>
                        </div>

                        {/* New File Input (inline) */}
                        {showNewFileInput && (
                            <div className="mt-3 p-3 bg-cad-bg border border-cad-primary rounded-lg animate-in slide-in-from-top-2 duration-200">
                                <label className="block text-xs font-bold text-cad-muted mb-2">
                                    File Name
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        autoFocus
                                        type="text"
                                        className="flex-1 bg-white dark:bg-black/20 border border-cad-border rounded px-3 py-2 text-sm outline-none focus:border-cad-primary transition-colors"
                                        placeholder="My Drawing"
                                        value={newFileName}
                                        onChange={(e) => setNewFileName(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                    />
                                    <button
                                        onClick={handleCreateNew}
                                        className="px-4 py-2 bg-cad-primary text-white text-sm font-bold rounded hover:bg-cad-primaryHover transition-colors"
                                    >
                                        Create
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowNewFileInput(false);
                                            setNewFileName("");
                                        }}
                                        className="px-4 py-2 bg-cad-border/50 text-cad-muted text-sm rounded hover:bg-cad-border transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Recent Files */}
                    {recentFiles.length > 0 && (
                        <section>
                            <h3 className="text-xs font-bold text-cad-muted uppercase tracking-wider mb-3">
                                Recent
                            </h3>
                            <div className="space-y-1">
                                {recentFiles.map((file) => {
                                    const lastDate = new Date(
                                        file.lastOpened || file.lastModified || 0
                                    );
                                    const timeAgo = formatTimeAgo(lastDate);

                                    return (
                                        <button
                                            key={file.id}
                                            onClick={() => {
                                                onLoadFile(file);
                                                onClose();
                                            }}
                                            className="group flex items-center gap-3 w-full p-3 bg-cad-bg hover:bg-cad-border/30 border border-transparent hover:border-cad-border rounded-lg transition-all text-left"
                                        >
                                            <div className="flex items-center justify-center size-10 bg-cad-primary/10 text-cad-primary rounded-lg group-hover:bg-cad-primary/20 transition-colors shrink-0">
                                                <span className="material-symbols-outlined text-[24px]">
                                                    draft
                                                </span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-cad-text truncate">
                                                    {file.name}
                                                </div>
                                                <div className="text-xs text-cad-muted">
                                                    {file.description || `${file.elementCount || 0} elements`} · {timeAgo}
                                                </div>
                                            </div>
                                            <span className="material-symbols-outlined text-[18px] text-cad-muted opacity-0 group-hover:opacity-100 transition-opacity">
                                                arrow_forward
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {recentFiles.length === 0 && !showNewFileInput && (
                        <div className="text-center py-8 text-cad-muted">
                            <span className="material-symbols-outlined text-[48px] opacity-30 mb-2">
                                folder_open
                            </span>
                            <p className="text-sm">No recent files</p>
                            <p className="text-xs">Create a new drawing to get started</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-cad-border bg-cad-bg/50 flex items-center justify-between">
                    <div className="text-xs text-cad-muted">
                        Press <kbd className="px-1.5 py-0.5 bg-cad-border rounded text-[10px] font-mono">Esc</kbd> to close
                    </div>
                    <button
                        onClick={onClose}
                        className="text-xs text-cad-primary hover:underline"
                    >
                        Continue without opening
                    </button>
                </div>
            </div>
        </div>
    );
};

function formatTimeAgo(date: Date): string {
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}
