/**
 * shortcuts.ts — 单键快捷键映射
 *
 * 沿用 AutoCAD 习惯的单键：L 直线、C 圆、R 矩形、A 圆弧、T 文字、H 填充、
 * D 标注、O 偏移、M 移动；E 删除、G 组合、X 解散。
 * 只在没有修饰键、焦点不在输入控件、且没有弹窗打开时生效。
 */

import { ToolType } from "../types";

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

/** 命中的工具；无匹配时返回 null */
export function resolveToolShortcut(key: string): ToolType | null {
    const normalized = key.toLowerCase();
    return TOOL_SHORTCUTS.find((item) => item.key === normalized)?.tool ?? null;
}

/** 命中的编辑动作；无匹配时返回 null */
export function resolveActionShortcut(key: string): ShortcutAction | null {
    return ACTION_SHORTCUTS[key.toLowerCase()] ?? null;
}

/** 菜单里的修饰键提示：macOS 用 ⌘，其余用 Ctrl */
export function modifierKeyLabel(): string {
    if (typeof navigator === "undefined") return "Ctrl";
    return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
}
