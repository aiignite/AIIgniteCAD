/**
 * lineStyle.ts — 图元线型 / 线宽的显示与交换规则
 *
 * 线宽在数据模型里沿用 CAD 习惯以毫米记录，屏幕渲染使用 non-scaling-stroke，
 * 因此统一在这里换算成固定屏幕像素，保证缩放时线宽不随图形放大。
 */

import type { LineType } from "../types";

export const LINE_TYPES: LineType[] = ["CONTINUOUS", "DASHED", "DOTTED", "DASHDOT"];

/** 线宽预设（毫米），覆盖 AutoCAD 常用档位 */
export const LINE_WEIGHT_PRESETS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0];

/** SVG 虚线图案（屏幕像素）；实线不设置 dasharray */
const DASH_PATTERNS: Record<LineType, string | undefined> = {
    CONTINUOUS: undefined,
    DASHED: "8 4",
    DOTTED: "1 3",
    DASHDOT: "10 3 1 3",
};

const PX_PER_MM = 96 / 25.4;
const MIN_STROKE_PX = 0.5;
const MAX_STROKE_PX = 12;

export function normalizeLineType(value: unknown): LineType {
    return typeof value === "string" && (LINE_TYPES as string[]).includes(value)
        ? (value as LineType)
        : "CONTINUOUS";
}

/** 非法、非正或缺失的线宽返回 undefined，表示沿用默认线宽 */
export function normalizeLineWeight(value: unknown): number | undefined {
    const parsed = typeof value === "string" ? Number(value) : value;
    if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.round(parsed * 100) / 100;
}

export function dashArrayForLineType(lineType: unknown, scale = 1): string | undefined {
    const pattern = DASH_PATTERNS[normalizeLineType(lineType)];
    if (!pattern || scale === 1) return pattern;
    // 打印时图案按世界坐标绘制，需要按出图比例换算，否则 1:100 下会退化成实线
    return pattern
        .split(" ")
        .map((value) => String(Math.round(Number(value) * scale * 100) / 100))
        .join(" ");
}

/** 毫米 → 屏幕像素；未设置线宽时返回 undefined，由渲染器取默认值 */
export function lineWeightToScreenPx(value: unknown): number | undefined {
    const mm = normalizeLineWeight(value);
    if (mm === undefined) return undefined;
    const px = Math.round(mm * PX_PER_MM * 100) / 100;
    return Math.min(MAX_STROKE_PX, Math.max(MIN_STROKE_PX, px));
}

/** DXF group 370 以 1/100 mm 记录线宽 */
export function lineWeightToDxfHundredths(value: unknown): number | undefined {
    const mm = normalizeLineWeight(value);
    if (mm === undefined) return undefined;
    return Math.max(0, Math.round(mm * 100));
}

/** DXF 370 → 毫米；BYLAYER / BYBLOCK（负数）与 0 都按"未设置"处理 */
export function dxfHundredthsToLineWeight(value: unknown): number | undefined {
    const hundredths = typeof value === "string" ? Number(value) : value;
    if (typeof hundredths !== "number" || !Number.isFinite(hundredths) || hundredths <= 0) {
        return undefined;
    }
    return Math.round(hundredths) / 100;
}
