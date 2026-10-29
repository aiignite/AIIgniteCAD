/**
 * hatchPatterns.ts — 填充图案清单
 *
 * 填充弹窗与属性面板共用同一份定义，避免两处图案列表漂移。
 * icon 必须是本地 Material Symbols 子集已有的连字名。
 */

import type { HatchPatternType } from "../types";
import type { TranslationKey } from "./i18n";

export interface HatchPatternOption {
    value: HatchPatternType;
    labelKey: TranslationKey;
    icon: string;
}

export const HATCH_PATTERN_OPTIONS: ReadonlyArray<HatchPatternOption> = [
    { value: "SOLID", labelKey: "hatch.pattern.solid", icon: "square" },
    { value: "HORIZONTAL", labelKey: "hatch.pattern.horizontal", icon: "horizontal_rule" },
    { value: "VERTICAL", labelKey: "hatch.pattern.vertical", icon: "vertical_align_center" },
    { value: "DIAGONAL_RIGHT", labelKey: "hatch.pattern.diagonalRight", icon: "remove" },
    { value: "DIAGONAL_LEFT", labelKey: "hatch.pattern.diagonalLeft", icon: "add" },
    { value: "CROSS", labelKey: "hatch.pattern.cross", icon: "close" },
    { value: "GRID", labelKey: "hatch.pattern.grid", icon: "grid_on" },
    { value: "DOT", labelKey: "hatch.pattern.dot", icon: "radio_button_unchecked" },
    { value: "ANSI31", labelKey: "hatch.pattern.ansi31", icon: "format_overline" },
    { value: "ANSI32", labelKey: "hatch.pattern.ansi32", icon: "vertical_align_top" },
    { value: "ISO02W100", labelKey: "hatch.pattern.iso02w100", icon: "architecture" },
];
