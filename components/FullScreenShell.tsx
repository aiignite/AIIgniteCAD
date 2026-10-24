/**
 * FullScreenShell.tsx — 满屏工作区窗体骨架
 *
 * 与设置页同款：absolute 铺满工作区、标题栏 + 返回画布按钮 + 内容区。
 * 图纸检查 / 图纸清单这类"单次打开、看完即走"的界面复用此骨架，
 * 不再占用右侧停靠空间。
 */

import React, { useEffect } from "react";
import { useI18n } from "../lib/i18n";

interface FullScreenShellProps {
    title: string;
    subtitle?: string;
    icon?: string;
    onClose: () => void;
    /** 内容区是否滚动；列表型内容默认滚动 */
    scroll?: boolean;
    children: React.ReactNode;
}

export const FullScreenShell: React.FC<FullScreenShellProps> = ({
    title,
    subtitle,
    icon,
    onClose,
    scroll = true,
    children,
}) => {
    const { t } = useI18n();

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            const target = event.target as HTMLElement | null;
            if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
            onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    return (
        <div
            className="absolute inset-0 z-40 flex flex-col bg-cad-bg"
            role="dialog"
            aria-modal="true"
            aria-label={title}
        >
            <header className="shrink-0 flex items-start justify-between gap-3 p-4 border-b border-cad-border bg-cad-panel">
                <div className="min-w-0 flex items-start gap-2.5">
                    {icon && (
                        <span className="material-symbols-outlined text-[22px] text-cad-primary mt-0.5">
                            {icon}
                        </span>
                    )}
                    <div className="min-w-0">
                        <h3 className="text-base font-bold text-cad-text">{title}</h3>
                        {subtitle && (
                            <p className="text-xs text-cad-muted mt-0.5 truncate">{subtitle}</p>
                        )}
                    </div>
                </div>
                <button
                    data-action="shell-close"
                    onClick={onClose}
                    title={t("settings.backToCanvas")}
                    aria-label={t("settings.backToCanvas")}
                    className="shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-border/40 hover:text-cad-text transition-colors"
                >
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                    <span className="hidden md:inline">{t("settings.backToCanvas")}</span>
                    <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
            </header>

            <div
                data-shell-body={title}
                className={`flex-1 min-h-0 p-4 ${scroll ? "overflow-y-auto" : "overflow-hidden"}`}
            >
                {children}
            </div>
        </div>
    );
};

export default FullScreenShell;
