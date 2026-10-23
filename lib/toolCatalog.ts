/**
 * toolCatalog.ts — 画布工具目录
 *
 * 工具的图标、名称、分组与单键快捷键只在这里定义一次，
 * 左侧工具面板与顶部菜单共用，避免两处各写一份而走样。
 */

import { ToolType } from "../types";
import type { TranslationKey } from "./i18n";

export interface ToolMeta {
    tool: ToolType;
    icon: string;
    labelKey: TranslationKey;
    /** 单键快捷键，与 lib/shortcuts.ts 的 TOOL_SHORTCUTS 保持一致 */
    shortcutKey?: string;
}

export interface ToolGroup {
    key: string;
    labelKey: TranslationKey;
    tools: ToolMeta[];
}

export const TOOL_GROUPS: ToolGroup[] = [
    {
        key: "navigate",
        labelKey: "toolbar.navigate",
        tools: [
            {
                tool: ToolType.SELECT,
                icon: "arrow_selector_tool",
                labelKey: "toolbar.select",
                shortcutKey: "m",
            },
            { tool: ToolType.PAN, icon: "drag_pan", labelKey: "toolbar.pan" },
        ],
    },
    {
        key: "draw",
        labelKey: "toolbar.draw",
        tools: [
            { tool: ToolType.LINE, icon: "remove", labelKey: "toolbar.line", shortcutKey: "l" },
            { tool: ToolType.POLYLINE, icon: "polyline", labelKey: "toolbar.polyline" },
            { tool: ToolType.CIRCLE, icon: "circle", labelKey: "toolbar.circle", shortcutKey: "c" },
            {
                tool: ToolType.RECTANGLE,
                icon: "rectangle",
                labelKey: "toolbar.rectangle",
                shortcutKey: "r",
            },
            { tool: ToolType.ARC, icon: "architecture", labelKey: "toolbar.arc", shortcutKey: "a" },
            { tool: ToolType.TEXT, icon: "title", labelKey: "toolbar.text", shortcutKey: "t" },
            { tool: ToolType.HATCH, icon: "texture", labelKey: "toolbar.hatch", shortcutKey: "h" },
        ],
    },
    {
        key: "modify",
        labelKey: "toolbar.modify",
        tools: [
            { tool: ToolType.COPY, icon: "content_copy", labelKey: "toolbar.copy" },
            { tool: ToolType.TRIM, icon: "content_cut", labelKey: "toolbar.trim" },
            { tool: ToolType.EXTEND, icon: "east", labelKey: "toolbar.extend" },
            { tool: ToolType.MIRROR, icon: "flip", labelKey: "toolbar.mirror" },
            { tool: ToolType.ROTATE, icon: "rotate_right", labelKey: "toolbar.rotate" },
            { tool: ToolType.SCALE, icon: "aspect_ratio", labelKey: "toolbar.scale" },
            {
                tool: ToolType.OFFSET,
                icon: "format_indent_increase",
                labelKey: "toolbar.offset",
                shortcutKey: "o",
            },
            { tool: ToolType.ARRAY, icon: "grid_view", labelKey: "toolbar.array" },
        ],
    },
    {
        key: "annotate",
        labelKey: "toolbar.annotate",
        tools: [
            {
                tool: ToolType.DIMENSION,
                icon: "straighten",
                labelKey: "toolbar.dimension",
                shortcutKey: "d",
            },
            { tool: ToolType.MEASURE, icon: "square_foot", labelKey: "toolbar.measure" },
        ],
    },
    {
        key: "parametric",
        labelKey: "toolbar.parametric",
        tools: [
            { tool: ToolType.GEAR, icon: "settings", labelKey: "toolbar.gear" },
            { tool: ToolType.POLYGON, icon: "hexagon", labelKey: "toolbar.polygon" },
            { tool: ToolType.ELLIPSE, icon: "circle", labelKey: "toolbar.ellipse" },
            { tool: ToolType.SPIRAL, icon: "water_voc", labelKey: "toolbar.spiral" },
            { tool: ToolType.SPRING, icon: "toys", labelKey: "toolbar.spring" },
            { tool: ToolType.INVOLUTE, icon: "show_chart", labelKey: "toolbar.involute" },
        ],
    },
];

/** 全部工具的扁平视图 */
export const ALL_TOOLS: ToolMeta[] = TOOL_GROUPS.flatMap((group) => group.tools);

/** 按工具类型查找元信息 */
export function findToolMeta(tool: ToolType): ToolMeta | undefined {
    return ALL_TOOLS.find((item) => item.tool === tool);
}
