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

export type DynamicMode = "polar" | "radius" | "box" | "scale" | "distance";
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
    // 变换工具的第二阶段：基点已定，等待角度 / 倍率
    if (
        (tool === ToolType.ROTATE && dragMode === "ROTATE_ITEMS") ||
        (tool === ToolType.SCALE && dragMode === "SCALE_ITEMS") ||
        (tool === ToolType.MIRROR && dragMode === "MIRROR_LINE")
    ) {
        return drawStart;
    }
    return null;
}

/** 根据工具与光标位置生成可编辑草稿；不支持数值输入的工具返回 null */
export function buildDynamicDraft(
    tool: ToolType,
    anchor: Point | null,
    cursor: Point | null,
): DynamicDraft | null {
    // OFFSET 没有锚点阶段：任何时刻都可键入距离（不依赖光标是否已在画布上移动过）
    if (tool === ToolType.OFFSET) {
        return {
            anchor: cursor ?? { x: 0, y: 0 },
            mode: "distance",
            length: 0,
            angle: 0,
            width: 0,
            height: 0,
            signX: 1,
            signY: 1,
            fields: ["length"],
        };
    }

    if (!cursor) return null;
    if (!anchor) return null;

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
    // 旋转 / 镜像只需角度；角度锁定后沿当前光标方向提交
    if (tool === ToolType.ROTATE || tool === ToolType.MIRROR) {
        return {
            anchor,
            mode: "polar",
            length,
            angle,
            width: Math.abs(dx),
            height: Math.abs(dy),
            signX: 1,
            signY: 1,
            fields: ["angle"],
        };
    }
    // 缩放键入倍率：提交点 = 基点 + 实时方向 × (实时距离 × 倍率)，
    // 工具按"光标距离 / 实时距离"反推倍率，结果即键入值
    if (tool === ToolType.SCALE) {
        return {
            anchor,
            mode: "scale",
            length,
            angle,
            width: Math.abs(dx),
            height: Math.abs(dy),
            signX: 1,
            signY: 1,
            fields: ["length"],
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

    // 缩放键入倍率：沿实时方向把光标距离放大 factor 倍，
    // 工具端按"提交点到基点距离 / 实时距离"反推，得到的正是键入倍率
    if (draft.mode === "scale") {
        const factor = validNumber(values.length) ?? 1;
        return pointFromPolar(draft.anchor, draft.length * factor, draft.angle);
    }

    // 距离模式不产生提交点：数值由交互层暂存，等待下一次真实点击
    if (draft.mode === "distance") {
        return draft.anchor;
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

/** 字段标题：半径模式复用 length 字段但显示为"半径"；缩放显示倍率；偏移显示距离 */
export function dynamicFieldLabel(mode: DynamicMode, key: DynamicFieldKey): string {
    if (mode === "radius" && key === "length") return "半径";
    if (mode === "scale" && key === "length") return "倍率";
    if (mode === "distance" && key === "length") return "距离";
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
