import React, { useState } from "react";
import { useI18n, type Translate } from "../lib/i18n";
import { useTheme, setThemePreference } from "../store/theme";
import { useCanvas } from "../store/canvasStore";
import type { CommandHistoryEntry } from "../lib/command";

interface HeaderProps {
    onUndo?: () => void;
    onRedo?: () => void;
    fileName?: string;
    onSave?: () => void;
    /** 导出 DXF：与菜单栏「文件 → 导出 DXF」走同一个入口 */
    onExport?: () => void;
    /** 打开设置页（顶栏齿轮，指向常用分区） */
    onOpenSettings?: (section: "drawing" | "account") => void;
    /** 顶部 AI 助手入口：打开非模态浮窗 */
    aiOpen?: boolean;
    onToggleAI?: () => void;
}

/** 历史条目 → 展示文案：单一增/删/改给出精确数量，混合变更给总数，无统计给步数 */
function historyEntryLabel(entry: CommandHistoryEntry, t: Translate): string {
    const { added, removed, modified } = entry;
    if (added > 0 && removed === 0 && modified === 0) return t("history.added", { count: added });
    if (removed > 0 && added === 0 && modified === 0) return t("history.removed", { count: removed });
    if (modified > 0 && added === 0 && removed === 0) return t("history.modified", { count: modified });
    if (added === 0 && removed === 0 && modified === 0) return t("history.step", { n: entry.index + 1 });
    return t("history.changed", { count: added + removed + modified });
}

export const Header: React.FC<HeaderProps> = ({
    onUndo,
    onRedo,
    fileName,
    onSave,
    onExport,
    onOpenSettings,
    aiOpen = false,
    onToggleAI,
}) => {
    const { t } = useI18n();
    // 主题走外部 store：持久化、跟随系统；顶栏按钮在明暗间切换（写入显式偏好）
    const { effective } = useTheme();
    const isDark = effective === "dark";
    const { historyOverview, jumpTo } = useCanvas();
    const [historyOpen, setHistoryOpen] = useState(false);
    const displayName = fileName ?? `${t("common.untitled")}.dxf`;

    const toggleTheme = () => {
        setThemePreference(isDark ? "light" : "dark");
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
                        disabled={!historyOverview.canUndo}
                        className="size-8 flex items-center justify-center rounded transition-colors hover:text-cad-text hover:bg-cad-text/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-cad-muted"
                        title={t("header.undo")}
                        aria-disabled={!historyOverview.canUndo}
                    >
                        <span className="material-symbols-outlined text-[18px]">undo</span>
                    </button>
                    <button
                        onClick={onRedo}
                        disabled={!historyOverview.canRedo}
                        className="size-8 flex items-center justify-center rounded transition-colors hover:text-cad-text hover:bg-cad-text/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-cad-muted"
                        title={t("header.redo")}
                        aria-disabled={!historyOverview.canRedo}
                    >
                        <span className="material-symbols-outlined text-[18px]">redo</span>
                    </button>
                    {/* 撤销历史：列表展示并可点击跳转到任意一步 */}
                    {historyOverview.entries.length > 0 && (
                        <div className="relative">
                            <button
                                onClick={() => setHistoryOpen((prev) => !prev)}
                                aria-haspopup="menu"
                                aria-expanded={historyOpen}
                                title={t("header.history")}
                                aria-label={t("header.history")}
                                className="size-8 flex items-center justify-center rounded transition-colors hover:text-cad-text hover:bg-cad-text/10"
                            >
                                <span className="material-symbols-outlined text-[18px]">history</span>
                            </button>
                            {historyOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-30"
                                        onClick={() => setHistoryOpen(false)}
                                    />
                                    <div
                                        role="menu"
                                        aria-label={t("header.history")}
                                        className="absolute right-0 top-full z-40 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-cad-border bg-cad-panel py-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
                                    >
                                        {/* 最新在上；当前位置之前的步骤可点击回跳，之后的步骤可重做 */}
                                        {[...historyOverview.entries].reverse().map((entry) => (
                                            <button
                                                key={entry.index}
                                                role="menuitem"
                                                onClick={() => {
                                                    setHistoryOpen(false);
                                                    jumpTo(entry.index);
                                                }}
                                                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                                                    entry.index === historyOverview.currentIndex
                                                        ? "bg-cad-primary/15 font-medium text-cad-primary"
                                                        : "text-cad-text hover:bg-cad-text/10"
                                                }`}
                                            >
                                                <span className="font-mono text-[10px] text-cad-muted">
                                                    {entry.index + 1}
                                                </span>
                                                {historyEntryLabel(entry, t)}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="h-5 w-px bg-cad-border"></div>

                <button
                    onClick={onSave}
                    className="size-8 flex items-center justify-center rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                    title={t("header.save")}
                    aria-label={t("header.save")}
                >
                    <span className="material-symbols-outlined text-[18px]">save</span>
                </button>

                <button
                    onClick={onToggleAI}
                    aria-label={aiOpen ? t("header.aiClose") : t("header.aiOpen")}
                    aria-pressed={aiOpen}
                    title={aiOpen ? t("header.aiClose") : t("header.aiOpen")}
                    className={`size-8 flex items-center justify-center rounded transition-colors ${
                        aiOpen
                            ? "bg-cad-primary text-white"
                            : "text-cad-muted hover:text-cad-text hover:bg-cad-text/10"
                    }`}
                >
                    <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                </button>

                <button
                    onClick={toggleTheme}
                    className="size-8 flex items-center justify-center rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                    title={isDark ? t("header.themeToLight") : t("header.themeToDark")}
                    aria-label={isDark ? t("header.themeToLight") : t("header.themeToDark")}
                >
                    <span className="material-symbols-outlined text-[18px]">
                        {isDark ? "light_mode" : "dark_mode"}
                    </span>
                </button>

                {onOpenSettings && (
                    <button
                        onClick={() => onOpenSettings("drawing")}
                        className="size-8 flex items-center justify-center rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                        title={t("settings.navTitle")}
                        aria-label={t("settings.navTitle")}
                    >
                        <span className="material-symbols-outlined text-[18px]">settings</span>
                    </button>
                )}

                {onExport && (
                    <button
                        onClick={onExport}
                        className="hidden sm:flex size-8 items-center justify-center bg-cad-primary hover:bg-cad-primaryHover text-white rounded transition-colors"
                        title={t("header.export")}
                        aria-label={t("header.export")}
                    >
                        <span className="material-symbols-outlined text-[18px]">download</span>
                    </button>
                )}
            </div>
        </header>
    );
};

export default Header;
