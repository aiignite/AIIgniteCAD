import React, { useState, useEffect, useRef } from "react";
import { exportToDXF } from "../services/dxfService";
import { CADElement } from "../types";
import { useI18n } from "../lib/i18n";

interface HeaderProps {
    elements: CADElement[];
    onImportClick: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    currentUser?: any;
    onLogout?: () => Promise<void>;
    fileName?: string;
    onSave?: () => void;
    onSaveVersion?: () => void;
    onOpenVersions?: () => void;
    onOpenPlot?: () => void;
    onOpenImageTrace?: () => void;
    /** 顶部 AI 助手入口：打开非模态浮窗 */
    aiOpen?: boolean;
    onToggleAI?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
    elements,
    onImportClick,
    onUndo,
    onRedo,
    currentUser,
    onLogout,
    fileName,
    onSave,
    onSaveVersion,
    onOpenVersions,
    onOpenPlot,
    onOpenImageTrace,
    aiOpen = false,
    onToggleAI,
}) => {
    const { locale, setLocale, t } = useI18n();
    // 初始值直接从 DOM 读取，避免挂载后再 setState 触发级联渲染
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const fileMenuRef = useRef<HTMLDivElement>(null);
    const displayName = fileName ?? `${t("common.untitled")}.dxf`;

    useEffect(() => {
        if (!fileMenuOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenuOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [fileMenuOpen]);

    const toggleTheme = () => {
        if (document.documentElement.classList.contains("dark")) {
            document.documentElement.classList.remove("dark");
            setIsDark(false);
        } else {
            document.documentElement.classList.add("dark");
            setIsDark(true);
        }
    };

    const handleExport = () => {
        const dxfContent = exportToDXF(elements);
        const blob = new Blob([dxfContent], { type: "application/dxf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `drawing-${Date.now()}.dxf`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <header className="flex items-center justify-between whitespace-nowrap border-b border-cad-border bg-cad-bg pl-2 pr-4 h-14 shrink-0 z-30 shadow-sm transition-colors duration-300">
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
                                id="cad-bg-gradient"
                                x1="0"
                                y1="0"
                                x2="200"
                                y2="200"
                                gradientUnits="userSpaceOnUse"
                            >
                                <stop offset="0%" stopColor="#137fec" />
                                <stop offset="100%" stopColor="#0b63c1" />
                            </linearGradient>

                            <radialGradient
                                id="cad-halo-gradient"
                                cx="100"
                                cy="110"
                                r="60"
                                gradientUnits="userSpaceOnUse"
                            >
                                <stop offset="20%" stopColor="white" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="white" stopOpacity="0" />
                            </radialGradient>

                            <mask id="cad-fire-mask">
                                <path
                                    d="M100 142 C 78 142, 70 115, 88 92 C 98 80, 115 65, 105 40 C 128 65, 138 100, 122 128 C 115 140, 110 142, 100 142Z"
                                    fill="white"
                                />
                                <path
                                    d="M101 142 C 94 130, 92 115, 96 100 C 100 85, 108 75, 106 40 H 102 C 104 75, 96 85, 92 100 C 88 115, 90 130, 97 142 Z"
                                    fill="black"
                                />
                            </mask>
                        </defs>

                        <rect width="200" height="200" rx="40" fill="url(#cad-bg-gradient)" />

                        <path
                            d="M100 148 C 65 148, 55 115, 80 85 C 95 65, 125 55, 105 25 C 135 55, 150 95, 130 125 C 120 142, 115 148, 100 148Z"
                            fill="url(#cad-halo-gradient)"
                        />

                        <path
                            d="M100 142 C 78 142, 70 115, 88 92 C 98 80, 115 65, 105 40 C 128 65, 138 100, 122 128 C 115 140, 110 142, 100 142Z"
                            fill="white"
                            mask="url(#cad-fire-mask)"
                        />

                        <g>
                            <path
                                d="M 70 165 H 130"
                                stroke="#E0F2FE"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                            />
                            <path
                                d="M 70 161 V 169"
                                stroke="#E0F2FE"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                            />
                            <path
                                d="M 130 161 V 169"
                                stroke="#E0F2FE"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                            />
                            <rect
                                x="94"
                                y="159"
                                width="12"
                                height="12"
                                stroke="#E0F2FE"
                                strokeWidth="2"
                                fill="none"
                                strokeLinejoin="round"
                            />
                        </g>

                        <circle cx="100.5" cy="138" r="3" fill="white" />
                    </svg>
                </div>

                <div className="flex items-baseline gap-2">
                    <h2 className="text-cad-text text-lg font-bold leading-none tracking-tight font-display">
                        AI Ignite CAD
                    </h2>
                    <span className="text-[10px] text-cad-muted font-mono transform translate-y-[-1px]">
                        {displayName}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-cad-muted">
                    <button
                        onClick={onUndo}
                        className="p-1.5 hover:text-cad-text hover:bg-cad-text/10 rounded transition-colors"
                        title={t("header.undo")}
                    >
                        <span className="material-symbols-outlined text-[20px]">undo</span>
                    </button>
                    <button
                        onClick={onRedo}
                        className="p-1.5 hover:text-cad-text hover:bg-cad-text/10 rounded transition-colors"
                        title={t("header.redo")}
                    >
                        <span className="material-symbols-outlined text-[20px]">redo</span>
                    </button>
                </div>

                <div className="h-5 w-px bg-cad-border"></div>

                <button
                    onClick={onSave}
                    className="flex items-center gap-1.5 h-8 px-2.5 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10 text-xs font-medium transition-colors"
                    title={t("header.save")}
                >
                    <span className="material-symbols-outlined text-[18px]">save</span>
                    <span className="hidden md:inline">{t("header.save")}</span>
                </button>

                <div className="relative" ref={fileMenuRef}>
                    <button
                        data-action="file-menu"
                        onClick={() => setFileMenuOpen((open) => !open)}
                        aria-haspopup="menu"
                        aria-expanded={fileMenuOpen}
                        className={`flex items-center gap-1.5 h-8 px-2.5 rounded text-xs font-medium transition-colors ${
                            fileMenuOpen
                                ? "bg-cad-text/10 text-cad-text"
                                : "text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                        }`}
                        title={t("header.fileMenu")}
                    >
                        <span className="material-symbols-outlined text-[18px]">folder_open</span>
                        <span>{t("header.fileMenu")}</span>
                        <span className="material-symbols-outlined text-[16px]">expand_more</span>
                    </button>
                    {fileMenuOpen && (
                        <div
                            role="menu"
                            aria-label={t("header.fileMenu")}
                            className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-cad-border bg-cad-panel shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                        >
                            <FileMenuItem
                                icon="upload_file"
                                label={t("header.import")}
                                onClick={() => {
                                    setFileMenuOpen(false);
                                    onImportClick?.();
                                }}
                            />
                            <FileMenuItem
                                icon="image"
                                label={t("header.trace")}
                                onClick={() => {
                                    setFileMenuOpen(false);
                                    onOpenImageTrace?.();
                                }}
                            />
                            <div className="h-px bg-cad-border my-1" />
                            <FileMenuItem
                                icon="download"
                                label={t("header.exportDxf")}
                                onClick={() => {
                                    setFileMenuOpen(false);
                                    handleExport();
                                }}
                            />
                            <FileMenuItem
                                icon="print"
                                label={t("header.plot")}
                                onClick={() => {
                                    setFileMenuOpen(false);
                                    onOpenPlot?.();
                                }}
                            />
                            <div className="h-px bg-cad-border my-1" />
                            <FileMenuItem
                                icon="history"
                                label={t("header.versions")}
                                onClick={() => {
                                    setFileMenuOpen(false);
                                    onOpenVersions?.();
                                }}
                            />
                            <FileMenuItem
                                icon="save_as"
                                label={t("header.saveVersion")}
                                onClick={() => {
                                    setFileMenuOpen(false);
                                    onSaveVersion?.();
                                }}
                            />
                        </div>
                    )}
                </div>

                <div className="h-5 w-px bg-cad-border"></div>

                <button
                    onClick={onToggleAI}
                    aria-label={aiOpen ? t("header.aiClose") : t("header.aiOpen")}
                    aria-pressed={aiOpen}
                    title={aiOpen ? t("header.aiClose") : t("header.aiOpen")}
                    className={`flex items-center gap-2 h-8 px-3 rounded transition-colors ${
                        aiOpen
                            ? "bg-cad-primary text-white shadow-lg shadow-blue-500/20"
                            : "border border-cad-border text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                    }`}
                >
                    <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                    <span className="hidden lg:inline text-xs font-bold">AI</span>
                </button>

                <button
                    onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                    title={t("header.languageToggle", {
                        language: locale === "zh" ? t("header.languageZh") : t("header.languageEn"),
                    })}
                    aria-label={t("header.languageToggle", {
                        language: locale === "zh" ? t("header.languageZh") : t("header.languageEn"),
                    })}
                    className="flex items-center gap-1 h-8 px-2 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">translate</span>
                    <span className="text-[11px] font-bold">{locale === "zh" ? "中文" : "EN"}</span>
                </button>

                <button
                    onClick={toggleTheme}
                    className="size-8 rounded-full bg-cad-panel border border-cad-border flex items-center justify-center text-xs font-bold text-cad-text cursor-pointer hover:bg-cad-border transition-colors"
                    title={isDark ? t("header.themeToLight") : t("header.themeToDark")}
                    aria-label={isDark ? t("header.themeToLight") : t("header.themeToDark")}
                >
                    <span className="material-symbols-outlined text-[18px]">
                        {isDark ? "light_mode" : "dark_mode"}
                    </span>
                </button>

                <button
                    onClick={handleExport}
                    className="hidden sm:flex items-center gap-2 h-8 px-4 bg-cad-primary hover:bg-cad-primaryHover text-white text-sm font-bold rounded transition-colors shadow-lg shadow-blue-500/20"
                >
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    <span>{t("header.export")}</span>
                </button>
            </div>
        </header>
    );
};

const FileMenuItem: React.FC<{
    icon: string;
    label: string;
    onClick: () => void;
}> = ({ icon, label, onClick }) => (
    <button
        role="menuitem"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-xs text-cad-text hover:bg-cad-text/10 transition-colors text-left"
    >
        <span className="material-symbols-outlined text-[18px] text-cad-muted">{icon}</span>
        <span>{label}</span>
    </button>
);

export default Header;
