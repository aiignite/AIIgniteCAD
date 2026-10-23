/**
 * groups.test.ts — 图元组合（聚集 / 解散）单元测试
 */

import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import {
    expandToGroups,
    groupElements,
    isGrouped,
    selectionUnit,
    ungroupElements,
} from "../lib/groups";

const line = (id: string): CADElement => ({
    id,
    type: "LINE",
    layer: "0",
    color: "#fff",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
});

const three = () => [line("a"), line("b"), line("c")];

describe("图元组合", () => {
    it("组合后选中图元共享同一个 groupId", () => {
        const elements = three();
        const grouped = groupElements(elements, new Set(["a", "b"]));

        expect(grouped).not.toBe(elements);
        expect(grouped[0].groupId).toBeTruthy();
        expect(grouped[0].groupId).toBe(grouped[1].groupId);
        expect(grouped[2].groupId).toBeUndefined();
    });

    it("少于两个图元时不组合", () => {
        const elements = three();
        expect(groupElements(elements, new Set(["a"]))).toBe(elements);
    });

    it("解散后成员恢复为独立图元", () => {
        const grouped = groupElements(three(), new Set(["a", "b"]));
        const dissolved = ungroupElements(grouped, new Set(["a"]));

        expect(dissolved[0].groupId).toBeUndefined();
        expect(dissolved[1].groupId).toBeUndefined();
        expect("groupId" in dissolved[0]).toBe(false);
    });

    it("解散未组合的图元时保持原样", () => {
        const elements = three();
        expect(ungroupElements(elements, new Set(["a"]))).toBe(elements);
    });

    it("选择单元：组合成员返回整组，普通图元返回自身", () => {
        const grouped = groupElements(three(), new Set(["a", "b"]));

        expect(selectionUnit(grouped, "a")).toEqual(["a", "b"]);
        expect(selectionUnit(grouped, "c")).toEqual(["c"]);
    });

    it("展开组合：任一成员的 id 都展开为整组", () => {
        const grouped = groupElements(three(), new Set(["a", "b"]));

        expect(expandToGroups(grouped, ["b", "c"])).toEqual(["a", "b", "c"]);
    });

    it("isGrouped 反映组合状态", () => {
        const grouped = groupElements(three(), new Set(["a", "b"]));

        expect(isGrouped(grouped[0])).toBe(true);
        expect(isGrouped(grouped[2])).toBe(false);
    });
});
