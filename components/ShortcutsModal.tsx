/**
 * ShortcutsModal.tsx — 快捷键速查
 *
 * 条目由 lib/menus.ts 的菜单模型和 lib/shortcuts.ts 的单键映射生成，
 * 这里不再手工维护第二份键位表，否则帮助内容和真实行为会分叉。
 */

import React, { useEffect, useRef } from "react";
import { buildShortcutSections, type ShortcutSection } from "../lib/menus";
import { modifierKeyLabel } from "../lib/shortcuts";
import { useI18n } from "../lib/i18n";

interface ShortcutsModalProps {
    onClose: () => void;
}

/** 组合键渲染成并排的键帽，Mod 替换成平台对应的修饰键 */
function ShortcutKeys({ keys }: { keys: string }) {
    return (
        <span className="flex items-center gap-1 shrink-0">
            {keys.split("+").map((part) => (
                <kbd
                    key={part}
                    className="min-w-6 rounded border border-cad-border bg-cad-bg px-1.5 py-0.5 text-center font-mono text-[10px] text-cad-text"
                >
                    {part === "Mod" ? modifierKeyLabel() : part}
                </kbd>
            ))}
        </span>
    );
}

const Section: React.FC<{ section: ShortcutSection }> = ({ section }) => {
    const { t } = useI18n();
    return (
        <section className="flex flex-col">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cad-muted">
                {t(section.labelKey)}
            </h3>
            <ul className="space-y-1">
                {section.rows.map((row) => (
                    <li
                        key={`${row.keys}-${row.labelKey}`}
                        className="flex items-center justify-between gap-3 rounded px-2 py-1 text-xs text-cad-text hover:bg-cad-text/5"
                    >
                        <span className="truncate">{t(row.labelKey)}</span>
                        <ShortcutKeys keys={row.keys} />
                    </li>
                ))}
            </ul>
        </section>
    );
};

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ onClose }) => {
    const { t } = useI18n();
    const sections = buildShortcutSections();

    // 监听器只注册一次：调用方传的是内联箭头函数，若把它写进依赖数组，
    // 画布每次重渲染都会 remove + add，Esc 落在重挂的空档就被吞掉。
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") onCloseRef.current();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-label={t("menu.help.shortcuts")}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="flex max-h-[85vh] w-[min(880px,96vw)] flex-col overflow-hidden rounded-xl border border-cad-border bg-cad-panel shadow-2xl">
                <div className="flex items-center justify-between border-b border-cad-border px-5 py-3">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[20px] text-cad-primary">
                            keyboard
                        </span>
                        <h2 className="text-sm font-bold text-cad-text">
                            {t("menu.help.shortcuts")}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        data-action="shortcuts-close"
                        aria-label={t("common.close")}
                        className="flex size-7 items-center justify-center rounded text-cad-muted transition-colors hover:bg-cad-text/10 hover:text-cad-text"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                <div className="grid flex-1 gap-6 overflow-y-auto px-5 py-4 md:grid-cols-2">
                    <div className="space-y-5">
                        <Section section={sections[0]} />
                        <Section section={sections[1]} />
                    </div>
                    <Section section={sections[2]} />
                </div>

                <div className="border-t border-cad-border bg-cad-bg/40 px-5 py-3">
                    <p className="text-[11px] leading-relaxed text-cad-muted">
                        {t("shortcuts.hint")}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-cad-muted">
                        {t("shortcuts.customizeHint")}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ShortcutsModal;
