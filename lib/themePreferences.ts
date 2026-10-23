/**
 * themePreferences.ts — 主题偏好的本地存储边界
 *
 * 只负责「浅色 / 深色 / 跟随系统」这一项偏好的读写与解析；
 * 存储不可用（隐私模式 / SSR）时静默退化为跟随系统。
 * 与 lib/aiPreferences.ts 一致，读写函数接受注入的 storage 以便单测。
 */

export const THEME_STORAGE_KEY = "aiignitecad.theme";

export type ThemePreference = "light" | "dark" | "system";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
        return null;
    }
}

function normalizePreference(value: unknown): ThemePreference {
    return value === "light" || value === "dark" || value === "system"
        ? value
        : DEFAULT_THEME_PREFERENCE;
}

export function readThemePreference(storage: StorageLike | null = defaultStorage()): ThemePreference {
    if (!storage) return DEFAULT_THEME_PREFERENCE;
    try {
        return normalizePreference(storage.getItem(THEME_STORAGE_KEY));
    } catch {
        return DEFAULT_THEME_PREFERENCE;
    }
}

/** 写失败不影响本会话生效的主题，返回 false 让调用方可提示 */
export function writeThemePreference(
    preference: ThemePreference,
    storage: StorageLike | null = defaultStorage(),
): boolean {
    if (!storage) return false;
    try {
        storage.setItem(THEME_STORAGE_KEY, normalizePreference(preference));
        return true;
    } catch {
        return false;
    }
}

/** 偏好 + 系统配色 → 实际生效的主题；prefersDark 由调用方注入，保持纯函数 */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): "light" | "dark" {
    if (preference === "system") return prefersDark ? "dark" : "light";
    return preference;
}
