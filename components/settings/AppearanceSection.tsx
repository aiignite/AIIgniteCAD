import React from "react";
import { useCanvas } from "../../store/canvasStore";
import type { CanvasAction } from "../../store/canvasStore";
import { useI18n, type Locale, type TranslationKey } from "../../lib/i18n";
import { useTheme, setThemePreference, type ThemePreference } from "../../store/theme";

const LOCALE_OPTIONS: ReadonlyArray<{ code: Locale; labelKey: TranslationKey }> = [
    { code: "zh", labelKey: "settings.languageZh" },
    { code: "en", labelKey: "settings.languageEn" },
];

const THEME_OPTIONS: ReadonlyArray<{
    value: ThemePreference;
    labelKey: TranslationKey;
}> = [
    { value: "light", labelKey: "settings.themeLight" },
    { value: "dark", labelKey: "settings.themeDark" },
    { value: "system", labelKey: "settings.themeSystem" },
];

/** 与状态栏同一套开关，标签复用 footer.* 以免两处文案分叉 */
type DisplayToggleKey = "gridMode" | "snapMode" | "orthoMode" | "polarMode";

const DISPLAY_TOGGLES: ReadonlyArray<{
    labelKey: TranslationKey;
    icon: string;
    stateKey: DisplayToggleKey;
}> = [
    { labelKey: "footer.grid", icon: "grid_on", stateKey: "gridMode" },
    { labelKey: "footer.snapToggle", icon: "hub", stateKey: "snapMode" },
    { labelKey: "footer.ortho", icon: "build", stateKey: "orthoMode" },
    { labelKey: "footer.polar", icon: "bolt", stateKey: "polarMode" },
];

function displayToggleAction(stateKey: DisplayToggleKey, value: boolean): CanvasAction {
    switch (stateKey) {
        case "gridMode":
            return { type: "SET_GRID_MODE", value };
        case "snapMode":
            return { type: "SET_SNAP_MODE", value };
        case "orthoMode":
            return { type: "SET_ORTHO_MODE", value };
        default:
            return { type: "SET_POLAR_MODE", value };
    }
}

/**
 * 界面外观：语言与画布显示开关。
 * 显示开关只影响视图状态，不进撤销历史，因此直接 dispatch。
 */
export const AppearanceSection: React.FC = () => {
    const { t, locale, setLocale } = useI18n();
    const { state, dispatch } = useCanvas();
    const { preference: themePreference } = useTheme();

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-cad-border bg-cad-panel p-4 space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-bold text-cad-muted uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[16px] text-cad-primary">
                        language
                    </span>
                    {t("settings.language")}
                </h4>
                <div className="flex rounded border border-cad-border overflow-hidden">
                    {LOCALE_OPTIONS.map(({ code, labelKey }) => (
                        <button
                            key={code}
                            onClick={() => setLocale(code)}
                            aria-pressed={locale === code}
                            className={`flex-1 py-1.5 text-xs transition-colors ${
                                locale === code
                                    ? "bg-cad-primary text-white"
                                    : "text-cad-muted hover:bg-cad-border/50"
                            }`}
                        >
                            {t(labelKey)}
                        </button>
                    ))}
                </div>
            </section>

            <section className="rounded-lg border border-cad-border bg-cad-panel p-4 space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-bold text-cad-muted uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[16px] text-cad-primary">
                        contrast
                    </span>
                    {t("settings.theme")}
                </h4>
                <div className="flex rounded border border-cad-border overflow-hidden">
                    {THEME_OPTIONS.map(({ value, labelKey }) => (
                        <button
                            key={value}
                            onClick={() => setThemePreference(value)}
                            aria-pressed={themePreference === value}
                            className={`flex-1 py-1.5 text-xs transition-colors ${
                                themePreference === value
                                    ? "bg-cad-primary text-white"
                                    : "text-cad-muted hover:bg-cad-border/50"
                            }`}
                        >
                            {t(labelKey)}
                        </button>
                    ))}
                </div>
            </section>

            <section className="rounded-lg border border-cad-border bg-cad-panel p-4 space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-bold text-cad-muted uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[16px] text-cad-primary">
                        display_settings
                    </span>
                    {t("menu.view")}
                </h4>
                <div className="grid grid-cols-2 gap-1">
                    {DISPLAY_TOGGLES.map(({ labelKey, icon, stateKey }) => {
                        const active = state[stateKey];
                        return (
                            <button
                                key={stateKey}
                                aria-pressed={active}
                                onClick={() => dispatch(displayToggleAction(stateKey, !active))}
                                className={`flex items-center gap-2 py-1.5 px-2 rounded text-[11px] font-medium border transition-colors ${
                                    active
                                        ? "bg-cad-primary/15 border-cad-primary text-cad-primary"
                                        : "bg-cad-bg border-cad-border text-cad-muted hover:bg-cad-border/40"
                                }`}
                            >
                                <span className="material-symbols-outlined text-[16px]">
                                    {icon}
                                </span>
                                {t(labelKey)}
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
};

export default AppearanceSection;
