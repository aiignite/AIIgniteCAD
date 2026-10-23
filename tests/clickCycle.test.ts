import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import {
    CLICK_CYCLE_WINDOW_MS,
    EMPTY_CLICK_CYCLE_STATE,
    resolveClickCycle,
} from "../lib/clickCycle";

const line = (id: string): CADElement => ({
    id,
    type: "LINE",
    start: { x: 0, y: 0 },
    end: { x: 100, y: 100 },
    layer: "0",
    color: "#ffffff",
});

const hits = [line("top"), line("middle"), line("bottom")];
const point = { x: 10, y: 10 };
const tolerance = 2;

describe("resolveClickCycle", () => {
    it("第一次点击命中最上面的图元", () => {
        const result = resolveClickCycle(hits, point, EMPTY_CLICK_CYCLE_STATE, 1000, tolerance);
        expect(result.target?.id).toBe("top");
        expect(result.state.index).toBe(0);
    });

    it("同一位置短时间重复点击依次循环到下层图元", () => {
        const first = resolveClickCycle(hits, point, EMPTY_CLICK_CYCLE_STATE, 1000, tolerance);
        const second = resolveClickCycle(hits, point, first.state, 1100, tolerance);
        const third = resolveClickCycle(hits, point, second.state, 1200, tolerance);

        expect(second.target?.id).toBe("middle");
        expect(third.target?.id).toBe("bottom");
    });

    it("循环到最后一个后回到第一个", () => {
        let state = EMPTY_CLICK_CYCLE_STATE;
        for (let i = 0; i < 3; i++) {
            state = resolveClickCycle(hits, point, state, 1000 + i * 10, tolerance).state;
        }
        const wrapped = resolveClickCycle(hits, point, state, 1100, tolerance);
        expect(wrapped.target?.id).toBe("top");
    });

    it("超过时间窗口后重新从最上层开始", () => {
        const first = resolveClickCycle(hits, point, EMPTY_CLICK_CYCLE_STATE, 1000, tolerance);
        const later = resolveClickCycle(
            hits,
            point,
            first.state,
            1000 + CLICK_CYCLE_WINDOW_MS + 1,
            tolerance,
        );
        expect(later.target?.id).toBe("top");
    });

    it("点击位置偏移超出容差时不循环", () => {
        const first = resolveClickCycle(hits, point, EMPTY_CLICK_CYCLE_STATE, 1000, tolerance);
        const moved = resolveClickCycle(
            hits,
            { x: 40, y: 40 },
            first.state,
            1100,
            tolerance,
        );
        expect(moved.target?.id).toBe("top");
    });

    it("没有命中时清空循环状态", () => {
        const result = resolveClickCycle([], point, EMPTY_CLICK_CYCLE_STATE, 1000, tolerance);
        expect(result.target).toBeNull();
        expect(result.state).toEqual(EMPTY_CLICK_CYCLE_STATE);
    });

    it("只有一个命中图元时始终选中它", () => {
        const single = [line("only")];
        const first = resolveClickCycle(single, point, EMPTY_CLICK_CYCLE_STATE, 1000, tolerance);
        const second = resolveClickCycle(single, point, first.state, 1100, tolerance);
        expect(second.target?.id).toBe("only");
    });
});
