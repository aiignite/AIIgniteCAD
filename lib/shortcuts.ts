/**
 * shortcuts.ts — 单键快捷键映射
 *
 * 沿用 AutoCAD 习惯的单键：L 直线、C 圆、R 矩形、A 圆弧、T 文字、H 填充、
 * D 标注、O 偏移、M 移动；E 删除、G 组合、X 解散。
 * 只在没有修饰键、焦点不在输入控件、且没有弹窗打开时生效。
 */

import { ToolType } from "../types";
import type { TranslationKey } from "./i18n";

/** 单键可切换的画布工具 */
export interface ToolShortcut {
    key: string;
    tool: ToolType;
}

/** 单键可触发的编辑动作 */
export type ShortcutAction = "erase" | "group" | "ungroup";

export const TOOL_SHORTCUTS: ToolShortcut[] = [
    { key: "l", tool: ToolType.LINE },
    { key: "c", tool: ToolType.CIRCLE },
    { key: "r", tool: ToolType.RECTANGLE },
    { key: "a", tool: ToolType.ARC },
    { key: "t", tool: ToolType.TEXT },
    { key: "h", tool: ToolType.HATCH },
    { key: "d", tool: ToolType.DIMENSION },
    { key: "o", tool: ToolType.OFFSET },
    { key: "m", tool: ToolType.SELECT },
];

export const ACTION_SHORTCUTS: Record<string, ShortcutAction> = {
    e: "erase",
    g: "group",
    x: "ungroup",
};

/** 绘图辅助开关的功能键，沿用 AutoCAD 键位 */
export const CANVAS_MODE_KEYS: readonly string[] = ["F3", "F7", "F8", "F10"];

/** 是否由绘图辅助开关处理该功能键 */
export function isCanvasModeKey(key: string): boolean {
    return CANVAS_MODE_KEYS.includes(key);
}

/** 菜单里的修饰键提示：macOS 用 ⌘，其余用 Ctrl */
export function modifierKeyLabel(): string {
    if (typeof navigator === "undefined") return "Ctrl";
    return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
}

/** 编辑动作对应的菜单命令名，保证速查表与菜单文案一致 */
export function shortcutActionLabel(action: ShortcutAction): TranslationKey {
    switch (action) {
        case "erase":
            return "menu.edit.delete";
        case "group":
            return "menu.edit.group";
        case "ungroup":
            return "menu.edit.ungroup";
    }
}

/* ─── 可自定义的单键键位 ─────────────────────────────────────── */

export type ShortcutScope = "tool" | "action";

/** 一个可重绑定的单键：id 形如 tool:LINE / action:erase */
export interface ShortcutBinding {
    id: string;
    scope: ShortcutScope;
    key: string;
    tool?: ToolType;
    action?: ShortcutAction;
}

/** 默认键位注册表；速查表、工具栏提示与按键解析都以这里为基准 */
export const SHORTCUT_BINDINGS: ShortcutBinding[] = [
    ...TOOL_SHORTCUTS.map((item) => ({
        id: `tool:${item.tool}` as string,
        scope: "tool" as const,
        key: item.key,
        tool: item.tool,
    })),
    ...Object.entries(ACTION_SHORTCUTS).map(([key, action]) => ({
        id: `action:${action}` as string,
        scope: "action" as const,
        key,
        action,
    })),
];

export const SHORTCUTS_STORAGE_KEY = "aiignitecad.shortcuts.v1";

export type ShortcutOverrides = Record<string, string>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
        return null;
    }
}

const normalizeKey = (value: string): string | null => {
    const trimmed = value.trim().toLowerCase();
    return /^[a-z0-9]$/.test(trimmed) ? trimmed : null;
};

const isKnownBindingId = (id: string): boolean =>
    SHORTCUT_BINDINGS.some((binding) => binding.id === id);

/** 损坏的存档整体丢弃，回退到默认键位 */
function sanitizeOverrides(value: unknown): ShortcutOverrides {
    if (!value || typeof value !== "object") return {};
    const result: ShortcutOverrides = {};
    for (const [id, key] of Object.entries(value as Record<string, unknown>)) {
        if (typeof key !== "string") continue;
        if (!isKnownBindingId(id)) continue;
        // 空串 = 显式禁用（默认键也停用）；否则必须是单个字母/数字
        if (key === "") {
            result[id] = "";
            continue;
        }
        const normalized = normalizeKey(key);
        if (normalized) result[id] = normalized;
    }
    return result;
}

/* 模块级缓存：按键解析在 keydown 回调里发生，必须同步可读 */
let overridesCache: ShortcutOverrides = readOverridesFromStorage();
const shortcutListeners = new Set<() => void>();

function readOverridesFromStorage(): ShortcutOverrides {
    const storage = defaultStorage();
    if (!storage) return {};
    try {
        const raw = storage.getItem(SHORTCUTS_STORAGE_KEY);
        if (!raw) return {};
        return sanitizeOverrides(JSON.parse(raw));
    } catch {
        return {};
    }
}

function persistOverrides(overrides: ShortcutOverrides): void {
    const storage = defaultStorage();
    if (!storage) return;
    try {
        storage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(overrides));
    } catch {
        // 写失败保持本会话生效即可
    }
}

function publishOverrides(next: ShortcutOverrides): void {
    overridesCache = next;
    persistOverrides(next);
    shortcutListeners.forEach((listener) => listener());
}

/** 设置某个绑定的键位；key 为 null 表示清除（该命令停用单键，含默认键） */
export function setShortcutBinding(id: string, key: string | null): boolean {
    if (!isKnownBindingId(id)) return false;
    const next = { ...overridesCache };
    if (key === null) next[id] = "";
    else {
        const normalized = normalizeKey(key);
        if (!normalized) return false;
        next[id] = normalized;
    }
    publishOverrides(next);
    return true;
}

/** 全部恢复默认键位 */
export function resetShortcutBindings(): void {
    publishOverrides({});
}

export function subscribeShortcutOverrides(listener: () => void): () => void {
    shortcutListeners.add(listener);
    return () => shortcutListeners.delete(listener);
}

export function getShortcutOverrides(): ShortcutOverrides {
    return overridesCache;
}

/** 生效键位：覆盖优先（空串 = 显式禁用），否则默认 */
export function getEffectiveShortcutKey(id: string): string | null {
    const binding = SHORTCUT_BINDINGS.find((item) => item.id === id);
    if (!binding) return null;
    const override = overridesCache[id];
    if (override === "") return null;
    return override ?? binding.key;
}

export function getEffectiveToolKey(tool: ToolType): string | null {
    return getEffectiveShortcutKey(`tool:${tool}`);
}

export function getEffectiveActionKey(action: ShortcutAction): string | null {
    return getEffectiveShortcutKey(`action:${action}`);
}

/** 该键位已被哪个绑定占用；排除自身。返回占用者的 id */
export function findShortcutConflict(id: string, key: string): string | null {
    const normalized = normalizeKey(key);
    if (!normalized) return null;
    const effectiveFor = (binding: ShortcutBinding): string | null => {
        const override = overridesCache[binding.id];
        if (override === "") return null;
        return override ?? binding.key;
    };
    const other = SHORTCUT_BINDINGS.find(
        (binding) => binding.id !== id && effectiveFor(binding) === normalized,
    );
    return other?.id ?? null;
}

/** 按键解析：按「生效键位 = 覆盖 ?? 默认」匹配，被改键的旧默认键自然失效 */
export function resolveToolShortcut(key: string): ToolType | null {
    const normalized = normalizeKey(key);
    if (!normalized) return null;
    const binding = SHORTCUT_BINDINGS.find((item) => {
        if (item.scope !== "tool") return false;
        const override = overridesCache[item.id];
        if (override === "") return false;
        return (override ?? item.key) === normalized;
    });
    return binding?.tool ?? null;
}

export function resolveActionShortcut(key: string): ShortcutAction | null {
    const normalized = normalizeKey(key);
    if (!normalized) return null;
    const binding = SHORTCUT_BINDINGS.find((item) => {
        if (item.scope !== "action") return false;
        const override = overridesCache[item.id];
        if (override === "") return false;
        return (override ?? item.key) === normalized;
    });
    return binding?.action ?? null;
}
