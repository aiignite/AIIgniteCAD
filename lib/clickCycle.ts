/**
 * clickCycle.ts — 重叠图元的点击循环选择
 *
 * 图元重叠时单次点击只能命中最上面那个，用户很难选到下层对象。
 * 这里约定：同一位置在短时间窗口内重复点击，就按命中顺序（后绘制优先）循环切换。
 */

import { CADElement, Point } from "../types";

/** 循环窗口：两次点击间隔超过它就重新从最上层开始 */
export const CLICK_CYCLE_WINDOW_MS = 300;

export interface ClickCycleState {
    /** 上一次点击的世界坐标 */
    point: Point | null;
    /** 上一次点击的时间戳（毫秒） */
    timestamp: number;
    /** 上一次命中的图元在命中列表里的下标 */
    index: number;
}

export const EMPTY_CLICK_CYCLE_STATE: ClickCycleState = {
    point: null,
    timestamp: 0,
    index: 0,
};

export interface ClickCycleResult {
    /** 本次应当选中的图元；null 表示没有命中 */
    target: CADElement | null;
    /** 更新后的循环状态 */
    state: ClickCycleState;
}

/**
 * 解析一次点击该选中谁。
 *
 * hits 必须按"后绘制优先"排序，与命中测试顺序一致。
 * tolerance 是两次点击允许的偏移（世界单位），用来判断是否点在了同一处。
 */
export function resolveClickCycle(
    hits: CADElement[],
    point: Point,
    state: ClickCycleState,
    now: number,
    tolerance: number,
): ClickCycleResult {
    if (hits.length === 0) {
        return { target: null, state: EMPTY_CLICK_CYCLE_STATE };
    }

    const sameSpot =
        state.point !== null &&
        Math.abs(state.point.x - point.x) <= tolerance &&
        Math.abs(state.point.y - point.y) <= tolerance;
    const withinWindow = now - state.timestamp <= CLICK_CYCLE_WINDOW_MS;
    const index = sameSpot && withinWindow && hits.length > 1
        ? (state.index + 1) % hits.length
        : 0;

    return { target: hits[index], state: { point, timestamp: now, index } };
}
