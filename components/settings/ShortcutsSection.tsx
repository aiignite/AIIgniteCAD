/**
 * ShortcutsSection.tsx — 设置页「快捷键」分区
 *
 * 单键键位可视化重绑：点击键帽后按下新键（Backspace 清除、Esc 取消），
 * 冲突时给出占用提示且不写入；支持一键恢复默认。
 * 功能键（F3/F7/F8/F10）与组合键为固定键位，不在此编辑。
 */

import React, { useEffect, useState } from "react";
import { ToolType } from "../../types";
import {
    SHORTCUT_BINDINGS,
    findShortcutConflict,
    getEffectiveShortcutKey,
    resetShortcutBindings,
    setShortcutBinding,
    shortcutActionLabel,
    type ShortcutBinding,
} from "../../lib/shortcuts";
import { findToolMeta } from "../../lib/toolCatalog";
import { useI18n, type TranslationKey } from "../../lib/i18n";
import { useApp } from "../../store/appStore";

/** 绑定的展示名 */
function bindingLabel(binding: ShortcutBinding, t: (key: TranslationKey) => string): string {
    if (binding.scope === "tool") {
        return t(findToolMeta(binding.tool!)?.labelKey ?? "toolbar.title");
    }
    return t(shortcutActionLabel(binding.action!));
}

const ShortcutsSection: React.FC = () => {
    const { t } = useI18n();
    const { showNotification } = useApp();
    const [capturingId, setCapturingId] = useState<string | null>(null);
    /** 冲突记录：正在改的绑定与占用者的 id */
    const [conflict, setConflict] = useState<{ id: string; occupantId: string } | null>(null);

    // 捕获模式下监听按键：新键写入，Backspace 清除，Esc 取消
    useEffect(() => {
        if (!capturingId) return undefined;
        const handler = (event: KeyboardEvent) => {
            event.preventDefault();
            if (event.key === "Escape") {
                setCapturingId(null);
                setConflict(null);
                return;
            }
            if (event.key === "Backspace") {
                setShortcutBinding(capturingId, null);
                setCapturingId(null);
                setConflict(null);
                return;
            }
            if (/^[a-zA-Z0-9]$/.test(event.key)) {
                const occupantId = findShortcutConflict(capturingId, event.key);
                if (occupantId) {
                    setConflict({ id: capturingId, occupantId });
                    return;
                }
                setShortcutBinding(capturingId, event.key);
                setCapturingId(null);
                setConflict(null);
            }
        };
        window.addEventListener("keydown", handler, true);
        return () => window.removeEventListener("keydown", handler, true);
    }, [capturingId]);

    const renderGroup = (scope: "tool" | "action", labelKey: TranslationKey) => {
        const bindings = SHORTCUT_BINDINGS.filter((binding) => binding.scope === scope);
        return (
            <section className="space-y-2">
                <h4 className="text-[10px] font-bold text-cad-muted uppercase tracking-wider">
                    {t(labelKey)}
                </h4>
                <div className="grid gap-1.5 md:grid-cols-2">
                    {bindings.map((binding) => {
                        const effective = getEffectiveShortcutKey(binding.id);
                        const isCapturing = capturingId === binding.id;
                        const hasConflict = conflict?.id === binding.id;
                        const occupant = hasConflict
                            ? bindingLabel(
                                  SHORTCUT_BINDINGS.find((item) => item.id === conflict!.occupantId)!,
                                  t,
                              )
                            : "";
                        return (
                            <div
                                key={binding.id}
                                className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 transition-colors ${
                                    isCapturing
                                        ? "border-cad-primary bg-cad-primary/10"
                                        : "border-cad-border bg-cad-panel"
                                }`}
                            >
                                <span className="min-w-0 truncate text-xs text-cad-text">
                                    {bindingLabel(binding, t)}
                                </span>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    {hasConflict && (
                                        <span className="text-[10px] text-red-500 dark:text-red-400">
                                            {t("shortcuts.occupied", { name: occupant })}
                                        </span>
                                    )}
                                    <button
                                        data-shortcut-id={binding.id}
                                        onClick={() => {
                                            setConflict(null);
                                            setCapturingId(isCapturing ? null : binding.id);
                                        }}
                                        aria-label={t("shortcuts.pressKey")}
                                        className={`min-w-[28px] rounded px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase transition-colors ${
                                            isCapturing
                                                ? "animate-pulse bg-cad-primary text-white"
                                                : effective
                                                  ? "border border-cad-border bg-cad-bg text-cad-text hover:border-cad-primary"
                                                  : "border border-dashed border-cad-border text-cad-muted"
                                        }`}
                                    >
                                        {isCapturing
                                            ? t("shortcuts.pressKey")
                                            : (effective ?? "—").toUpperCase()}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        );
    };

    return (
        <div className="mx-auto max-w-3xl space-y-5" data-testid="shortcuts-section">
            <p className="rounded-lg border border-cad-border bg-cad-panel p-3 text-[11px] leading-relaxed text-cad-muted">
                {t("shortcuts.editorHint")}
            </p>

            {renderGroup("tool", "shortcuts.tools")}
            {renderGroup("action", "shortcuts.edit")}

            <div className="flex items-center justify-between">
                <p className="text-[11px] text-cad-muted">{t("shortcuts.fixedHint")}</p>
                <button
                    data-action="shortcuts-reset"
                    onClick={() => {
                        resetShortcutBindings();
                        setCapturingId(null);
                        setConflict(null);
                        showNotification(t("shortcuts.resetDone"));
                    }}
                    className="h-8 shrink-0 rounded border border-cad-border px-3 text-xs font-medium text-cad-text transition-colors hover:bg-cad-text/10"
                >
                    {t("shortcuts.resetAll")}
                </button>
            </div>
        </div>
    );
};

export default ShortcutsSection;
