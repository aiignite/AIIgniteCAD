/**
 * skillStats.test.ts — 技能统计刷新信号的订阅/退订
 *
 * 采纳与反馈回执只推进版本号，面板靠订阅重新拉取统计，
 * 因此必须保证退订后不再收到通知，避免卸载后的组件继续 setState。
 */

import { describe, expect, it, vi } from "vitest";
import {
    getSkillStatsRevision,
    markSkillStatsDirty,
    subscribeSkillStats,
} from "../store/skillStats";

describe("skillStats 刷新信号", () => {
    it("回执后版本号递增并通知订阅者", () => {
        const listener = vi.fn();
        const before = getSkillStatsRevision();
        const unsubscribe = subscribeSkillStats(listener);

        markSkillStatsDirty();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(getSkillStatsRevision()).toBe(before + 1);

        unsubscribe();
        markSkillStatsDirty();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(getSkillStatsRevision()).toBe(before + 2);
    });

    it("多个订阅者各自收到通知", () => {
        const first = vi.fn();
        const second = vi.fn();
        const off = [subscribeSkillStats(first), subscribeSkillStats(second)];

        markSkillStatsDirty();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);

        off.forEach((unsubscribe) => unsubscribe());
    });
});
