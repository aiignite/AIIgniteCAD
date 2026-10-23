/**
 * dynamicInput.ts — 光标旁数值输入的状态推导
 *
 * 把"当前工具是否处于可键入数值的阶段"与"键入后应提交到哪个点"收敛成纯函数，
 * 交互 hook 只负责键盘事件与调用工具，Canvas 只负责把 draft 画出来。
 */

import type { DragMode, Point } from "../types";
import { ToolType } from "../types";
import { pointFromPolar } from "./polar";

const validNumber = (value: number | undefined): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

export type DynamicMode = "polar" | "radius" | "box";
export type DynamicFieldKey = "length" | "angle" | "width" | "height";

export interface DynamicDraft {
    anchor: Point;
    mode: DynamicMode;
    /** 锚点到光标的实时距离（polar / radius） */
    length: number;
    /** 实时角度（度，0–360，Y 轴向下） */
    angle: number;
    /** 矩形宽高绝对值与当前象限符号 */
    width: number;
    height: number;
    signX: 1 | -1;
    signY: 1 | -1;
    /** 需要显示的输入字段顺序 */
    fields: DynamicFieldKey[];
}

export interface DynamicAnchorInput {
    tool: ToolType;
    dragMode: DragMode | null;
    drawStart: Point | null;
    polyPoints: readonly Point[];
    dimPoints: readonly Point[];
}

/**
 * 解析当前工具的数值输入锚点。
 * 仅在"已经有第一点、等待第二点"的阶段返回锚点；其余阶段返回 null。
 */
export function resolveDynamicAnchor(input: DynamicAnchorInput): Point | null {
    const { tool, dragMode, drawStart, polyPoints, dimPoints } = input;
    if (tool === ToolType.POLYLINE && polyPoints.length > 0) {
        return polyPoints[polyPoints.length - 1];
    }
    if (tool === ToolType.DIMENSION) {
        return dimPoints.length === 1 ? dimPoints[0] : null;
    }
    if (tool === ToolType.LINE || tool === ToolType.RECTANGLE || tool === ToolType.CIRCLE) {
        return dragMode === "DRAW" ? drawStart : null;
    }
    return null;
}

/** 根据工具与光标位置生成可编辑草稿；不支持数值输入的工具返回 null */
export function buildDynamicDraft(
    tool: ToolType,
    anchor: Point | null,
    cursor: Point | null,
): DynamicDraft | null {
    if (!anchor || !cursor) return null;

    const dx = cursor.x - anchor.x;
    const dy = cursor.y - anchor.y;
    const length = Math.hypot(dx, dy);
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;

    if (tool === ToolType.RECTANGLE) {
        return {
            anchor,
            mode: "box",
            length,
            angle,
            width: Math.abs(dx),
            height: Math.abs(dy),
            signX: dx < 0 ? -1 : 1,
            signY: dy < 0 ? -1 : 1,
            fields: ["width", "height"],
        };
    }
    if (tool === ToolType.CIRCLE) {
        return {
            anchor,
            mode: "radius",
            length,
            angle,
            width: Math.abs(dx),
            height: Math.abs(dy),
            signX: 1,
            signY: 1,
            fields: ["length"],
        };
    }
    if (tool === ToolType.LINE || tool === ToolType.POLYLINE || tool === ToolType.DIMENSION) {
        return {
            anchor,
            mode: "polar",
            length,
            angle,
            width: Math.abs(dx),
            height: Math.abs(dy),
            signX: 1,
            signY: 1,
            fields: ["length", "angle"],
        };
    }
    return null;
}

export interface DynamicValues {
    length?: number;
    angle?: number;
    width?: number;
    height?: number;
}

/** 把键入值合并回草稿并算出要提交的世界坐标 */
export function resolveDynamicPoint(draft: DynamicDraft, values: DynamicValues): Point {
    if (draft.mode === "box") {
        const width = validNumber(values.width) ?? draft.width;
        const height = validNumber(values.height) ?? draft.height;
        return {
            x: draft.anchor.x + draft.signX * width,
            y: draft.anchor.y + draft.signY * height,
        };
    }

    const length = validNumber(values.length) ?? draft.length;
    if (draft.mode === "radius") {
        return pointFromPolar(draft.anchor, length, draft.angle);
    }
    const angle = validNumber(values.angle) ?? draft.angle;
    return pointFromPolar(draft.anchor, length, angle);
}

/**
 * 解析输入框中的原始文本。
 * 空串、单独的负号或小数点视为"尚未输入完成"，返回 null。
 */
export function parseDynamicValue(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "-" || trimmed === "." || trimmed === "-.") return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
}

/** 字段标题：半径模式复用 length 字段但显示为"半径" */
export function dynamicFieldLabel(mode: DynamicMode, key: DynamicFieldKey): string {
    if (mode === "radius" && key === "length") return "半径";
    switch (key) {
        case "length":
            return "长度";
        case "angle":
            return "角度";
        case "width":
            return "宽";
        case "height":
            return "高";
        default:
            return key;
    }
}

/** 字段单位后缀 */
export function dynamicFieldSuffix(key: DynamicFieldKey): string {
    return key === "angle" ? "°" : "";
}
