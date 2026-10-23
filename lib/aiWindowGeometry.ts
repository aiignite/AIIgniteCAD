/**
 * aiWindowGeometry.ts — AI 助手浮窗的纯几何计算
 *
 * 两种形态：
 * - float：顶部图标下方弹出，可拖动、八向缩放；
 * - drawer：贴右、顶部让出应用 Header，只拖左边缘改宽度。
 * 不含 DOM / React，便于单测。
 */

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Viewport {
    w: number;
    h: number;
}

export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type DragMode = "move" | ResizeDir;
export type WindowMode = "float" | "drawer";

export const MIN_W = 360;
export const MIN_H = 420;
export const MARGIN = 8;
/** 应用 Header 高度 h-14(56px) + 间距 */
export const TOP_INSET = 64;
export const DEFAULT_W = 430;
export const COMPACT_BREAKPOINT = 640;

export const RECT_STORAGE_KEY = "cad_ai_window_rect_v1";
export const MODE_STORAGE_KEY = "cad_ai_window_mode_v1";
export const DRAWER_WIDTH_STORAGE_KEY = "cad_ai_drawer_width_v1";

const clamp = (value: number, low: number, high: number): number =>
    Math.min(Math.max(value, low), Math.max(low, high));

export function isCompactViewport(viewport: Viewport): boolean {
    return viewport.w < COMPACT_BREAKPOINT;
}

/** 小屏：铺满 Header 以下，禁用拖动与缩放 */
export function compactRect(viewport: Viewport): Rect {
    return {
        x: 0,
        y: TOP_INSET,
        w: viewport.w,
        h: Math.max(0, viewport.h - TOP_INSET),
    };
}

export function defaultRect(viewport: Viewport): Rect {
    const w = clamp(DEFAULT_W, MIN_W, viewport.w - MARGIN * 2);
    const h = clamp(Math.round(viewport.h * 0.72), MIN_H, viewport.h - TOP_INSET - MARGIN * 2);
    return clampRect({ x: viewport.w - w - 16, y: TOP_INSET + 8, w, h }, viewport);
}

export function clampRect(rect: Rect, viewport: Viewport): Rect {
    const w = clamp(rect.w, MIN_W, viewport.w - MARGIN * 2);
    const h = clamp(rect.h, MIN_H, viewport.h - TOP_INSET - MARGIN * 2);
    const x = clamp(rect.x, MARGIN, viewport.w - w - MARGIN);
    const y = clamp(rect.y, TOP_INSET, viewport.h - h - MARGIN);
    return { x, y, w, h };
}

export function moveRect(start: Rect, dx: number, dy: number, viewport: Viewport): Rect {
    return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, viewport);
}

export function resizeRect(
    start: Rect,
    dir: ResizeDir,
    dx: number,
    dy: number,
    viewport: Viewport,
): Rect {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;

    if (dir.includes("e")) right = clamp(right + dx, left + MIN_W, viewport.w - MARGIN);
    if (dir.includes("w")) left = clamp(left + dx, MARGIN, right - MIN_W);
    if (dir.includes("s")) bottom = clamp(bottom + dy, top + MIN_H, viewport.h - MARGIN);
    if (dir.includes("n")) top = clamp(top + dy, TOP_INSET, bottom - MIN_H);

    return { x: left, y: top, w: right - left, h: bottom - top };
}

export function rectsEqual(a: Rect, b: Rect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function clampDrawerWidth(width: number, viewport: Viewport): number {
    const maxByRatio = Math.round(viewport.w * 0.55);
    const maxByWorkspace = viewport.w - MIN_W - MARGIN;
    const high = Math.max(0, Math.min(maxByRatio, maxByWorkspace, viewport.w - MARGIN));
    const low = Math.min(MIN_W, high);
    return clamp(Math.round(width), low, Math.max(low, high));
}

/** 抽屉贴在右侧、顶部让出 Header；右边缘与工作区共用一条边 */
export function drawerRect(viewport: Viewport, width: number): Rect {
    const w = clampDrawerWidth(width, viewport);
    return { x: viewport.w - w, y: TOP_INSET, w, h: Math.max(0, viewport.h - TOP_INSET) };
}

export function resizeDrawerWidth(startWidth: number, dx: number, viewport: Viewport): number {
    return clampDrawerWidth(startWidth - dx, viewport);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
        return null;
    }
}

function isFiniteRect(value: unknown): value is Rect {
    if (!value || typeof value !== "object") return false;
    const rect = value as Record<string, unknown>;
    return ["x", "y", "w", "h"].every(
        (key) => typeof rect[key] === "number" && Number.isFinite(rect[key] as number),
    );
}

export function loadRect(viewport: Viewport, storage: StorageLike | null = defaultStorage()): Rect {
    const base = defaultRect(viewport);
    if (!storage) return base;
    try {
        const raw = storage.getItem(RECT_STORAGE_KEY);
        if (!raw) return base;
        const parsed: unknown = JSON.parse(raw);
        return isFiniteRect(parsed) ? clampRect(parsed, viewport) : base;
    } catch {
        return base;
    }
}

export function saveRect(rect: Rect, storage: StorageLike | null = defaultStorage()): void {
    if (!storage) return;
    try {
        storage.setItem(RECT_STORAGE_KEY, JSON.stringify(rect));
    } catch {
        /* 存储不可用时只影响下次位置记忆 */
    }
}

export function loadWindowMode(storage: StorageLike | null = defaultStorage()): WindowMode {
    if (!storage) return "float";
    try {
        return storage.getItem(MODE_STORAGE_KEY) === "drawer" ? "drawer" : "float";
    } catch {
        return "float";
    }
}

export function saveWindowMode(
    mode: WindowMode,
    storage: StorageLike | null = defaultStorage(),
): void {
    if (!storage) return;
    try {
        storage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
        /* ignore */
    }
}

export function loadDrawerWidth(
    viewport: Viewport,
    storage: StorageLike | null = defaultStorage(),
): number {
    const fallback = clampDrawerWidth(DEFAULT_W, viewport);
    if (!storage) return fallback;
    try {
        const raw = storage.getItem(DRAWER_WIDTH_STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? clampDrawerWidth(parsed, viewport) : fallback;
    } catch {
        return fallback;
    }
}

export function saveDrawerWidth(
    width: number,
    storage: StorageLike | null = defaultStorage(),
): void {
    if (!storage) return;
    try {
        storage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(Math.round(width)));
    } catch {
        /* ignore */
    }
}
