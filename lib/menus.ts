/**
 * menus.ts — AutoCAD 风格菜单模型
 *
 * 这里只描述「有哪些菜单、菜单里有哪些命令」，不绑定具体回调：
 * 动作由 App.tsx 通过 action id 映射到真实实现，菜单栏只负责渲染与派发。
 * 这样菜单结构可以脱离 React 单测，也让命令只有一个权威入口。
 */

import { ToolType } from "../types";
import { findToolMeta } from "./toolCatalog";
import { ACTION_SHORTCUTS, TOOL_SHORTCUTS, shortcutActionLabel } from "./shortcuts";
import type { TranslationKey } from "./i18n";

/** 设置页分区，菜单与设置页左侧导航共用同一套标识 */
export type SettingsSection =
    "models" | "assistants" | "skills" | "drawing" | "appearance" | "account";

/** 菜单命令的动作 id */
export type MenuActionId =
    // 文件
    | "file.new"
    | "file.open"
    | "file.save"
    | "file.saveVersion"
    | "file.versions"
    | "file.import"
    | "file.imageTrace"
    | "file.export"
    | "file.plot"
    | "file.logout"
    // 编辑
    | "edit.undo"
    | "edit.redo"
    | "edit.copy"
    | "edit.paste"
    | "edit.delete"
    | "edit.selectAll"
    | "edit.group"
    | "edit.ungroup"
    | "edit.hide"
    | "edit.isolate"
    | "edit.showAll"
    // 视图
    | "view.zoomIn"
    | "view.zoomOut"
    | "view.zoomExtents"
    | "view.reset"
    | "view.grid"
    | "view.snap"
    | "view.ortho"
    | "view.polar"
    | "view.review"
    | "view.conventions"
    // 插入
    | "insert.text"
    | "insert.dimension"
    | "insert.hatch"
    // 设置
    | "settings.models"
    | "settings.assistants"
    | "settings.skills"
    | "settings.units"
    | "settings.dimensionStyle"
    | "settings.appearance"
    | "settings.account"
    // AI 浮窗
    | "tool.aiWindow"
    // 帮助
    | "help.shortcuts"
    | "help.support"
    // 画布工具
    | `activate:${ToolType}`;

/** 可勾选的视图开关 */
export type MenuToggleId = "grid" | "snap" | "ortho" | "polar";

export type MenuItem =
    | {
          kind: "command";
          id: string;
          action: MenuActionId;
          labelKey: TranslationKey;
          icon?: string;
          /** 快捷键提示；"Mod" 会被替换成 ⌘ / Ctrl */
          shortcut?: string;
          /** 勾选型命令，勾选状态由外部注入 */
          toggle?: MenuToggleId;
          /** 打开设置页时携带的分区 */
          section?: SettingsSection;
      }
    | { kind: "separator"; id?: string }
    | { kind: "heading"; id: string; labelKey: TranslationKey };

export interface MenuDef {
    id: string;
    labelKey: TranslationKey;
    items: MenuItem[];
}

/** 工具命令：菜单里复用工具目录里的图标与名称 */
function toolItem(
    id: string,
    tool: ToolType,
    labelKey: TranslationKey,
    icon: string,
    shortcut?: string,
): MenuItem {
    return {
        kind: "command",
        id,
        action: `activate:${tool}`,
        labelKey,
        icon,
        shortcut,
    };
}

export const MENUS: MenuDef[] = [
    {
        id: "file",
        labelKey: "menu.file",
        items: [
            {
                kind: "command",
                id: "file.new",
                action: "file.new",
                labelKey: "menu.file.new",
                icon: "note_add",
                shortcut: "Mod+N",
            },
            {
                kind: "command",
                id: "file.open",
                action: "file.open",
                labelKey: "menu.file.open",
                icon: "folder_open",
                shortcut: "Mod+O",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "file.save",
                action: "file.save",
                labelKey: "menu.file.save",
                icon: "save",
                shortcut: "Mod+S",
            },
            {
                kind: "command",
                id: "file.saveVersion",
                action: "file.saveVersion",
                labelKey: "menu.file.saveVersion",
                icon: "save_as",
            },
            {
                kind: "command",
                id: "file.versions",
                action: "file.versions",
                labelKey: "menu.file.versions",
                icon: "history",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "file.import",
                action: "file.import",
                labelKey: "menu.file.import",
                icon: "upload_file",
            },
            {
                kind: "command",
                id: "file.imageTrace",
                action: "file.imageTrace",
                labelKey: "menu.file.imageTrace",
                icon: "image",
            },
            {
                kind: "command",
                id: "file.export",
                action: "file.export",
                labelKey: "menu.file.export",
                icon: "download",
            },
            {
                kind: "command",
                id: "file.plot",
                action: "file.plot",
                labelKey: "menu.file.plot",
                icon: "print",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "file.logout",
                action: "file.logout",
                labelKey: "menu.file.logout",
                icon: "logout",
            },
        ],
    },
    {
        id: "edit",
        labelKey: "menu.edit",
        items: [
            {
                kind: "command",
                id: "edit.undo",
                action: "edit.undo",
                labelKey: "menu.edit.undo",
                icon: "undo",
                shortcut: "Mod+Z",
            },
            {
                kind: "command",
                id: "edit.redo",
                action: "edit.redo",
                labelKey: "menu.edit.redo",
                icon: "redo",
                shortcut: "Mod+Y",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "edit.copy",
                action: "edit.copy",
                labelKey: "menu.edit.copy",
                icon: "content_copy",
                shortcut: "Mod+C",
            },
            {
                kind: "command",
                id: "edit.paste",
                action: "edit.paste",
                labelKey: "menu.edit.paste",
                icon: "content_paste",
                shortcut: "Mod+V",
            },
            {
                kind: "command",
                id: "edit.delete",
                action: "edit.delete",
                labelKey: "menu.edit.delete",
                icon: "delete",
                shortcut: "Del",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "edit.selectAll",
                action: "edit.selectAll",
                labelKey: "menu.edit.selectAll",
                icon: "select_all",
                shortcut: "Mod+A",
            },
            {
                kind: "command",
                id: "edit.group",
                action: "edit.group",
                labelKey: "menu.edit.group",
                icon: "group_work",
                shortcut: "G",
            },
            {
                kind: "command",
                id: "edit.ungroup",
                action: "edit.ungroup",
                labelKey: "menu.edit.ungroup",
                icon: "group_off",
                shortcut: "X",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "edit.hide",
                action: "edit.hide",
                labelKey: "menu.edit.hide",
                icon: "visibility_off",
            },
            {
                kind: "command",
                id: "edit.isolate",
                action: "edit.isolate",
                labelKey: "menu.edit.isolate",
                icon: "center_focus_strong",
            },
            {
                kind: "command",
                id: "edit.showAll",
                action: "edit.showAll",
                labelKey: "menu.edit.showAll",
                icon: "visibility",
            },
        ],
    },
    {
        id: "view",
        labelKey: "menu.view",
        items: [
            {
                kind: "command",
                id: "view.zoomIn",
                action: "view.zoomIn",
                labelKey: "menu.view.zoomIn",
                icon: "zoom_in",
            },
            {
                kind: "command",
                id: "view.zoomOut",
                action: "view.zoomOut",
                labelKey: "menu.view.zoomOut",
                icon: "zoom_out",
            },
            {
                kind: "command",
                id: "view.zoomExtents",
                action: "view.zoomExtents",
                labelKey: "menu.view.zoomExtents",
                icon: "fit_screen",
            },
            {
                kind: "command",
                id: "view.reset",
                action: "view.reset",
                labelKey: "menu.view.reset",
                icon: "restart_alt",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "view.grid",
                action: "view.grid",
                labelKey: "menu.view.grid",
                icon: "grid_on",
                shortcut: "F7",
                toggle: "grid",
            },
            {
                kind: "command",
                id: "view.snap",
                action: "view.snap",
                labelKey: "menu.view.snap",
                icon: "my_location",
                shortcut: "F3",
                toggle: "snap",
            },
            {
                kind: "command",
                id: "view.ortho",
                action: "view.ortho",
                labelKey: "menu.view.ortho",
                icon: "straighten",
                shortcut: "F8",
                toggle: "ortho",
            },
            {
                kind: "command",
                id: "view.polar",
                action: "view.polar",
                labelKey: "menu.view.polar",
                icon: "explore",
                shortcut: "F10",
                toggle: "polar",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "view.review",
                action: "view.review",
                labelKey: "menu.view.review",
                icon: "rule",
            },
            {
                kind: "command",
                id: "view.conventions",
                action: "view.conventions",
                labelKey: "menu.view.conventions",
                icon: "design_services",
            },
        ],
    },
    {
        id: "insert",
        labelKey: "menu.insert",
        items: [
            toolItem("insert.text", ToolType.TEXT, "toolbar.text", "title", "T"),
            toolItem(
                "insert.dimension",
                ToolType.DIMENSION,
                "toolbar.dimension",
                "straighten",
                "D",
            ),
            toolItem("insert.hatch", ToolType.HATCH, "toolbar.hatch", "texture", "H"),
        ],
    },
    {
        id: "format",
        labelKey: "menu.format",
        items: [
            {
                kind: "command",
                id: "format.units",
                action: "settings.units",
                labelKey: "menu.format.units",
                icon: "straighten",
                section: "drawing",
            },
            {
                kind: "command",
                id: "format.dimensionStyle",
                action: "settings.dimensionStyle",
                labelKey: "menu.format.dimensionStyle",
                icon: "open_with",
                section: "drawing",
            },
            {
                kind: "command",
                id: "format.appearance",
                action: "settings.appearance",
                labelKey: "menu.format.appearance",
                icon: "palette",
                section: "appearance",
            },
        ],
    },
    {
        id: "tools",
        labelKey: "menu.tools",
        items: [
            {
                kind: "command",
                id: "tools.aiWindow",
                action: "tool.aiWindow",
                labelKey: "menu.tools.aiWindow",
                icon: "smart_toy",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "tools.models",
                action: "settings.models",
                labelKey: "menu.tools.models",
                icon: "psychology",
                section: "models",
            },
            {
                kind: "command",
                id: "tools.assistants",
                action: "settings.assistants",
                labelKey: "menu.tools.assistants",
                icon: "support_agent",
                section: "assistants",
            },
            {
                kind: "command",
                id: "tools.skills",
                action: "settings.skills",
                labelKey: "menu.tools.skills",
                icon: "extension",
                section: "skills",
            },
            { kind: "separator" },
            {
                kind: "command",
                id: "tools.account",
                action: "settings.account",
                labelKey: "menu.tools.account",
                icon: "manage_accounts",
                section: "account",
            },
        ],
    },
    {
        id: "draw",
        labelKey: "menu.draw",
        items: [
            toolItem("draw.line", ToolType.LINE, "toolbar.line", "remove", "L"),
            toolItem("draw.polyline", ToolType.POLYLINE, "toolbar.polyline", "polyline"),
            toolItem("draw.circle", ToolType.CIRCLE, "toolbar.circle", "circle", "C"),
            toolItem("draw.rectangle", ToolType.RECTANGLE, "toolbar.rectangle", "rectangle", "R"),
            toolItem("draw.arc", ToolType.ARC, "toolbar.arc", "architecture", "A"),
            toolItem("draw.text", ToolType.TEXT, "toolbar.text", "title", "T"),
            toolItem("draw.hatch", ToolType.HATCH, "toolbar.hatch", "texture", "H"),
        ],
    },
    {
        id: "dimension",
        labelKey: "menu.dimension",
        items: [
            toolItem(
                "dimension.linear",
                ToolType.DIMENSION,
                "toolbar.dimension",
                "straighten",
                "D",
            ),
            toolItem("dimension.measure", ToolType.MEASURE, "toolbar.measure", "square_foot"),
        ],
    },
    {
        id: "modify",
        labelKey: "menu.modify",
        items: [
            toolItem("modify.copy", ToolType.COPY, "toolbar.copy", "content_copy"),
            toolItem("modify.trim", ToolType.TRIM, "toolbar.trim", "content_cut"),
            toolItem("modify.extend", ToolType.EXTEND, "toolbar.extend", "east"),
            toolItem("modify.mirror", ToolType.MIRROR, "toolbar.mirror", "flip"),
            toolItem("modify.rotate", ToolType.ROTATE, "toolbar.rotate", "rotate_right"),
            toolItem("modify.scale", ToolType.SCALE, "toolbar.scale", "aspect_ratio"),
            toolItem(
                "modify.offset",
                ToolType.OFFSET,
                "toolbar.offset",
                "format_indent_increase",
                "O",
            ),
            toolItem("modify.array", ToolType.ARRAY, "toolbar.array", "grid_view"),
        ],
    },
    {
        id: "parametric",
        labelKey: "menu.parametric",
        items: [
            toolItem("parametric.gear", ToolType.GEAR, "toolbar.gear", "settings"),
            toolItem("parametric.polygon", ToolType.POLYGON, "toolbar.polygon", "hexagon"),
            toolItem("parametric.ellipse", ToolType.ELLIPSE, "toolbar.ellipse", "circle"),
            toolItem("parametric.spiral", ToolType.SPIRAL, "toolbar.spiral", "water_voc"),
            toolItem("parametric.spring", ToolType.SPRING, "toolbar.spring", "toys"),
            toolItem("parametric.involute", ToolType.INVOLUTE, "toolbar.involute", "show_chart"),
        ],
    },
    {
        id: "help",
        labelKey: "menu.help",
        items: [
            {
                kind: "command",
                id: "help.shortcuts",
                action: "help.shortcuts",
                labelKey: "menu.help.shortcuts",
                icon: "keyboard",
                shortcut: "F1",
            },
            {
                kind: "command",
                id: "help.support",
                action: "help.support",
                labelKey: "menu.help.support",
                icon: "help",
            },
        ],
    },
];

/** 按 id 查找菜单 */
export function findMenu(menuId: string): MenuDef | undefined {
    return MENUS.find((menu) => menu.id === menuId);
}

/** 收集菜单里出现的所有动作 id，用于测试与查漏 */
export function collectMenuActions(): MenuActionId[] {
    const actions: MenuActionId[] = [];
    for (const menu of MENUS) {
        for (const item of menu.items) {
            if (item.kind === "command") actions.push(item.action);
        }
    }
    return actions;
}

/** 速查表一行：键位 + 命令名 */
export interface ShortcutRow {
    keys: string;
    labelKey: TranslationKey;
}

/** 速查表一个分区 */
export interface ShortcutSection {
    id: string;
    labelKey: TranslationKey;
    rows: ShortcutRow[];
}

/** 组合键与功能键：菜单已声明的 Mod 组合、F 功能键与 Del，避免与单键区重复 */
function collectComboRows(): ShortcutRow[] {
    const rows: ShortcutRow[] = [];
    const seen = new Set<string>();
    for (const menu of MENUS) {
        for (const item of menu.items) {
            if (item.kind !== "command" || !item.shortcut) continue;
            const shortcut = item.shortcut;
            const isCombo = shortcut.includes("+") || /^F\d+$/.test(shortcut) || shortcut === "Del";
            if (!isCombo || seen.has(shortcut)) continue;
            seen.add(shortcut);
            rows.push({ keys: shortcut, labelKey: item.labelKey });
        }
    }
    return rows;
}

/**
 * 速查表直接从菜单模型与单键映射生成，新增键位只需改这两处，
 * 否则帮助窗口会和真实行为漂移。
 */
export function buildShortcutSections(): ShortcutSection[] {
    return [
        {
            id: "tools",
            labelKey: "shortcuts.tools",
            rows: TOOL_SHORTCUTS.map((item) => ({
                keys: item.key.toUpperCase(),
                labelKey: findToolMeta(item.tool)?.labelKey ?? ("toolbar.title" as TranslationKey),
            })),
        },
        {
            id: "edit",
            labelKey: "shortcuts.edit",
            rows: Object.keys(ACTION_SHORTCUTS).map((key) => ({
                keys: key.toUpperCase(),
                labelKey: shortcutActionLabel(ACTION_SHORTCUTS[key]),
            })),
        },
        { id: "combos", labelKey: "shortcuts.combos", rows: collectComboRows() },
    ];
}
