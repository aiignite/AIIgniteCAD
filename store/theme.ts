/**
 * theme.ts — 主题外部 store
 *
 * 主题切换频率低且跨组件（顶栏、设置页），用模块级外部 store 而非 Context，
 * 与 store/canvasStatus.ts 同款模式：useSyncExternalStore 订阅，模块导入即应用主题。
 * 快照必须缓存复用——getSnapshot 每次返回新对象会让 React 陷入无限重渲染。
 */

import { useSyncExternalStore } from "react";
import {
    readThemePreference,
    writeThemePreference,
    resolveTheme,
    type ThemePreference,
} from "../lib/themePreferences";

export type { ThemePreference };

export interface ThemeState {
    preference: ThemePreference;
    /** 实际生效主题（system 已按系统配色解析） */
    effective: "light" | "dark";
}

const listeners = new Set<() => void>();

function prefersDark(): boolean {
    try {
        return typeof matchMedia !== "undefined"
            ? matchMedia("(prefers-color-scheme: dark)").matches
            : false;
    } catch {
        return false;
    }
}

let preference: ThemePreference = readThemePreference();

/** 缓存的快照，只在 publish 时重建 */
let currentSnapshot: ThemeState = {
    preference,
    effective: resolveTheme(preference, prefersDark()),
};

function snapshot(): ThemeState {
    return currentSnapshot;
}

/** 把生效主题落到 <html class="dark">，并通知订阅者 */
function publish(): void {
    currentSnapshot = {
        preference,
        effective: resolveTheme(preference, prefersDark()),
    };
    if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("dark", currentSnapshot.effective === "dark");
    }
    listeners.forEach((listener) => listener());
}

let mediaBound = false;

/** 跟随系统时，系统配色变化要实时反映；监听器只挂一次 */
function ensureMediaListener(): void {
    if (mediaBound || typeof matchMedia === "undefined") return;
    mediaBound = true;
    try {
        matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if (preference === "system") publish();
        });
    } catch {
        // Safari 旧版 addEventListener 不可用时忽略，系统配色变化需刷新生效
    }
}

export function setThemePreference(next: ThemePreference): void {
    preference = next;
    writeThemePreference(next);
    ensureMediaListener();
    publish();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    ensureMediaListener();
    return () => {
        listeners.delete(listener);
    };
}

/** 模块导入即恢复主题，避免刷新后闪回浅色 */
publish();

export function useTheme(): ThemeState {
    return useSyncExternalStore(subscribe, snapshot, snapshot);
}
