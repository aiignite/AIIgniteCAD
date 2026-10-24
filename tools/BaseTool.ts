/**
 * BaseTool.ts — 画布工具状态机的共享契约
 *
 * 每个工具只实现 onMouseDown / onMouseUp，读取 ToolContext 中的交互态并调用动作。
 * 坐标换算、捕捉约束、命中测试、pan/zoom 与预览仍由 useCanvasInteraction 负责。
 */

import { ToolType } from "../types";
import type { CADElement, DragMode, DrawingSettings, Point } from "../types";
import type { GripPoint } from "../lib/grip";
import type { DynamicValues } from "../lib/dynamicInput";
import { dist } from "../lib/canvasGeometry";
import { expandToGroups, selectionUnit } from "../lib/groups";
import { elementsInSelectionRect, getSelectionMode, rectFromPoints } from "../lib/selection";
import * as Transform from "../lib/transform";

export type StateSetter<T> = (value: T | ((prev: T) => T)) => void;

export interface ToolContext {
    /** 未经约束的原始点，用于命中测试与拖拽位移 */
    rawPoint: Point;
    /** 经过网格 / 捕捉 / 正交约束后的点 */
    point: Point;
    client: Point;
    button: number;
    shiftKey: boolean;
    activeTool: ToolType;

    dragMode: DragMode | null;
    drawStart: Point | null;
    currentPoint: Point | null;
    polyPoints: Point[];
    arcPoints: Point[];
    dimPoints: Point[];
    activeGrip: GripPoint | null;

    elements: CADElement[];
    selectedIds: ReadonlySet<string>;
    drawingSettings: DrawingSettings;
    orthoMode: boolean;
    currentLayer: string;
    currentLayerColor: string;
    lockedLayers: string[];

    grips: GripPoint[];
    findHitElement: (point: Point) => CADElement | undefined;
    /** 重叠图元的点击循环：同一位置短时间重复点击时切换到下一个命中图元 */
    resolveClickTarget?: (point: Point) => CADElement | undefined;
    /** 按下时命中的图元；跨按下 / 松开保留，用于点击后收窄选择集 */
    pressTargetRef?: { current: CADElement | undefined };
    worldTolerance: (pixels: number) => number;
    queryRect: (minX: number, minY: number, maxX: number, maxY: number) => CADElement[];

    setDragMode: StateSetter<DragMode | null>;
    setDrawStart: StateSetter<Point | null>;
    setCurrentPoint: StateSetter<Point | null>;
    setPolyPoints: StateSetter<Point[]>;
    setArcPoints: StateSetter<Point[]>;
    setDimPoints: StateSetter<Point[]>;
    setActiveGrip: StateSetter<GripPoint | null>;
    /** 切换画布工具；拖拽复制完成后回到选择工具 */
    setActiveTool?: (tool: ToolType) => void;

    addElement: (element: CADElement) => void;
    commitAction: (elements: CADElement[]) => void;
    setSelection: (ids: string[]) => void;
    addToSelection: (ids: string[]) => void;
    clearSelection: () => void;

    /** 动态输入键入的距离（OFFSET 用）；null 表示未键入，按交互语义取值 */
    dynamicDistance: number | null;

    onNotification: (message: string) => void;
    onRequestTextEntry: (position: Point) => void;
    onRequestAdvancedShape?: (tool: ToolType, position: Point) => void;
}

export interface ToolResult {
    /** 多步工具在 mouseup 后仍需保留当前拖拽态 */
    keepDragState?: boolean;
}

export interface CanvasTool {
    onMouseDown?: (ctx: ToolContext) => void;
    onMouseUp?: (ctx: ToolContext) => ToolResult | void;
    /**
     * 动态输入的 Enter 提交：工具以键入值（角度 / 倍率等）自行完成并提交一步撤销。
     * 未实现的工具由交互层回退为"合成一次点击"。
     */
    onDynamicSubmit?: (ctx: ToolContext, values: DynamicValues) => void;
}

export const createElementId = (): string =>
    Math.random().toString(36).substr(2, 9);

export const getSelectedElements = (ctx: ToolContext): CADElement[] =>
    ctx.elements.filter((element) => ctx.selectedIds.has(element.id));

/** 拖拽位移按正交模式约束到单一轴 */
export const getOrthoDelta = (ctx: ToolContext, delta: Point): Point => {
    if (!ctx.orthoMode) return delta;
    return Math.abs(delta.x) > Math.abs(delta.y)
        ? { x: delta.x, y: 0 }
        : { x: 0, y: delta.y };
};

/**
 * 选择工具与复制工具共用的按下逻辑：命中则进入拖拽，否则开始框选。
 *
 * 命中解析有两种：
 * - 多选状态下点中已选成员时保留整个选择集（便于整体拖动），不参与点击循环；
 * - 单选状态下按点击循环解析，同一位置短时间重复点击可在重叠图元间切换。
 *
 * 组合中的图元按整组处理：点中任一成员即选中整组。
 * Shift + 点击沿用 AutoCAD 语义：未选中则加入选择集、已选中则移出；
 * 该路径不进入拖拽——否则 mouseup 的收窄会把加选抵消（历史缺陷）。
 */
export function handleSelectionPress(
    ctx: ToolContext,
    mode: "MOVE_ITEMS" | "COPY_ITEMS",
): void {
    const keepMultiSelection = ctx.selectedIds.size > 1;
    const hit = keepMultiSelection || !ctx.resolveClickTarget
        ? ctx.findHitElement(ctx.rawPoint)
        : ctx.resolveClickTarget(ctx.rawPoint);
    if (hit) {
        if (ctx.pressTargetRef) ctx.pressTargetRef.current = hit;
        const unit = selectionUnit(ctx.elements, hit.id);
        const unitSelected = unit.every((id) => ctx.selectedIds.has(id));
        if (ctx.shiftKey) {
            if (unitSelected) {
                const remaining = [...ctx.selectedIds].filter((id) => !unit.includes(id));
                ctx.setSelection(remaining);
            } else {
                ctx.addToSelection(unit);
            }
            return;
        }
        if (!unitSelected) {
            ctx.setSelection(unit);
        }
        ctx.setDragMode(mode);
        ctx.setDrawStart(ctx.rawPoint);
        return;
    }

    if (!ctx.shiftKey) ctx.clearSelection();
    ctx.setDragMode("SELECT_BOX");
    ctx.setDrawStart(ctx.rawPoint);
}

/** 完成窗口 / 交叉框选；组合中的图元按整组计入选择集 */
export function finishSelectionBox(ctx: ToolContext): void {
    if (!ctx.drawStart) return;
    const rect = rectFromPoints(ctx.drawStart, ctx.rawPoint);
    const mode = getSelectionMode(ctx.drawStart, ctx.rawPoint);
    const candidates = ctx.queryRect(rect.minX, rect.minY, rect.maxX, rect.maxY);
    const matched = elementsInSelectionRect(candidates, rect, mode)
        .filter((element) => !ctx.lockedLayers.includes(element.layer || "0"))
        .map((element) => element.id);
    const expanded = expandToGroups(ctx.elements, matched);
    if (ctx.shiftKey) ctx.addToSelection(expanded);
    else ctx.setSelection(expanded);
}

/** 完成选中对象的移动 */
export function finishMove(ctx: ToolContext): void {
    if (!ctx.drawStart) return;
    const delta = getOrthoDelta(ctx, {
        x: ctx.rawPoint.x - ctx.drawStart.x,
        y: ctx.rawPoint.y - ctx.drawStart.y,
    });
    if (delta.x === 0 && delta.y === 0) return;

    const moved = new Map(
        Transform.moveElements(getSelectedElements(ctx), delta).map((element) => [
            element.id,
            element,
        ]),
    );
    ctx.commitAction(ctx.elements.map((element) => moved.get(element.id) ?? element));
}

/**
 * 松开后的收尾：
 * - 拖拽过：整体移动选中对象；
 * - 只是点击（未拖拽）已选中的对象：把选择集收窄到该对象或其所在组合，
 *   使复制 / 粘贴后的多个对象可以逐个单独选中移动。
 */
export function finishMoveOrNarrow(ctx: ToolContext): void {
    if (!ctx.drawStart) return;
    // Shift 加选路径不进入拖拽；此处兜底，防止松开时把加选收窄掉
    if (ctx.shiftKey) return;
    const target = ctx.pressTargetRef?.current;
    const dragged = dist(ctx.drawStart, ctx.rawPoint) > ctx.worldTolerance(3);
    if (!dragged && target) {
        narrowSelectionTo(ctx, target);
        return;
    }
    finishMove(ctx);
}

/** 把选择集收窄到目标对象或其所在组合；目标不在选择集内时保持原样 */
export function narrowSelectionTo(ctx: ToolContext, target: CADElement): void {
    const unit = selectionUnit(ctx.elements, target.id);
    if (unit.length >= ctx.selectedIds.size) return;
    if (!unit.every((id) => ctx.selectedIds.has(id))) return;
    ctx.setSelection(unit);
}

/** 完成选中对象的复制，并选中新副本 */
export function finishCopy(ctx: ToolContext): void {
    if (!ctx.drawStart) return;
    const delta = getOrthoDelta(ctx, {
        x: ctx.rawPoint.x - ctx.drawStart.x,
        y: ctx.rawPoint.y - ctx.drawStart.y,
    });
    if (delta.x === 0 && delta.y === 0) return;

    const copies = Transform.copyElements(getSelectedElements(ctx), delta);
    if (copies.length === 0) return;
    ctx.commitAction([...ctx.elements, ...copies]);
    ctx.setSelection(copies.map((element) => element.id));
    // 回到选择工具：副本保持选中，随后可逐个单独选中移动
    ctx.setActiveTool?.(ToolType.SELECT);
}

/** 判断一次点击是否构成有效拖拽（世界单位） */
export const isDragBeyond = (from: Point, to: Point, threshold = 2): boolean =>
    dist(from, to) > threshold;
