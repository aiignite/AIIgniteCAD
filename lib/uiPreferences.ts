/**
 * uiPreferences.ts — 界面布局偏好的本地存储边界
 *
 * 记录右侧面板展开状态与拖拽宽度，刷新后保持工作区布局。
 * 与 lib/aiPreferences.ts 一致：注入 storage、损坏静默回退、写失败不影响本会话。
 */

export const UI_PREFERENCES_STORAGE_KEY = "aiignitecad.ui.v1";

export const RIGHT_PANEL_WIDTH_MIN = 280;
export const RIGHT_PANEL_WIDTH_MAX = 800;

export interface UIPreferences {
    /** 右侧面板是否展开 */
    sidePanelOpen: boolean;
    /** 右侧动态面板（Frame 2）宽度 */
    rightPanelWidth: number;
}

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
    sidePanelOpen: false,
    rightPanelWidth: 320,
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
        return null;
    }
}

function normalizePreferences(value: unknown): UIPreferences {
    if (!value || typeof value !== "object") return { ...DEFAULT_UI_PREFERENCES };
    const raw = value as Record<string, unknown>;
    const width = typeof raw.rightPanelWidth === "number" ? raw.rightPanelWidth : Number.NaN;
    return {
        sidePanelOpen:
            typeof raw.sidePanelOpen === "boolean"
                ? raw.sidePanelOpen
                : DEFAULT_UI_PREFERENCES.sidePanelOpen,
        rightPanelWidth: Number.isFinite(width)
            ? Math.min(
                  RIGHT_PANEL_WIDTH_MAX,
                  Math.max(RIGHT_PANEL_WIDTH_MIN, Math.round(width)),
              )
            : DEFAULT_UI_PREFERENCES.rightPanelWidth,
    };
}

export function readUIPreferences(storage: StorageLike | null = defaultStorage()): UIPreferences {
    if (!storage) return { ...DEFAULT_UI_PREFERENCES };
    try {
        const raw = storage.getItem(UI_PREFERENCES_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_UI_PREFERENCES };
        return normalizePreferences(JSON.parse(raw));
    } catch {
        return { ...DEFAULT_UI_PREFERENCES };
    }
}

/** 合并写入：只覆盖传入字段，其余保留存储中的现值 */
export function writeUIPreferences(
    partial: Partial<UIPreferences>,
    storage: StorageLike | null = defaultStorage(),
): boolean {
    if (!storage) return false;
    try {
        const current = readUIPreferences(storage);
        storage.setItem(
            UI_PREFERENCES_STORAGE_KEY,
            JSON.stringify(normalizePreferences({ ...current, ...partial })),
        );
        return true;
    } catch {
        return false;
    }
}
