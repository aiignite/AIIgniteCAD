/**
 * canvasStatus.ts — 画布瞬态状态（光标坐标、捕捉类型、缩放）
 *
 * 鼠标移动频率高，若提升到 App state 会触发整棵树重渲染。
 * 用轻量外部 store + useSyncExternalStore，只让状态栏订阅更新。
 */

import { SnapType } from "../types";

export interface CanvasStatus {
    x: number;
    y: number;
    /** 光标是否位于画布上；false 时坐标显示占位符 */
    active: boolean;
    snapType: SnapType | null;
    zoomPercent: number;
    /** 当前工具与下一步提示，由 Canvas 统一计算后推给状态栏 */
    hint: string;
    /** 当前选中数量 */
    selectedCount: number;
    /** 动态输入激活中（键入数值/等待第二点）；Space 重复命令在此期间让位 */
    dynamicInput: boolean;
}

const INITIAL_STATUS: CanvasStatus = {
    x: 0,
    y: 0,
    active: false,
    snapType: null,
    zoomPercent: 100,
    hint: "",
    selectedCount: 0,
    dynamicInput: false,
};

let status: CanvasStatus = INITIAL_STATUS;
const listeners = new Set<() => void>();

export function getCanvasStatus(): CanvasStatus {
    return status;
}

export function subscribeCanvasStatus(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function updateCanvasStatus(patch: Partial<CanvasStatus>): void {
    const next = { ...status, ...patch };
    if (
        next.x === status.x &&
        next.y === status.y &&
        next.active === status.active &&
        next.snapType === status.snapType &&
        next.zoomPercent === status.zoomPercent &&
        next.hint === status.hint &&
        next.selectedCount === status.selectedCount
    ) {
        return;
    }
    status = next;
    listeners.forEach((listener) => listener());
}
