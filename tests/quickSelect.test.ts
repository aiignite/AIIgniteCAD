/**
 * quickSelect.test.ts — 快速选择纯函数测试
 */

import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import {
    EMPTY_QUICK_SELECT_FILTER,
    filterQuickSelect,
    quickSelectFacets,
    quickSelectIds,
    toggleQuickSelectValue,
} from "../lib/quickSelect";

const element = (
    id: string,
    type: CADElement["type"] = "LINE",
    layer = "0",
    color = "#ffffff",
): CADElement => ({
    id,
    type,
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    layer,
    color,
});

const elements: CADElement[] = [
    element("l1", "LINE", "0", "#ff0000"),
    element("l2", "LINE", "0", "#ff0000"),
    element("c1", "CIRCLE", "WALL", "#00ff00"),
    element("r1", "RECTANGLE", "WALL", "#ff0000"),
];

describe("filterQuickSelect", () => {
    it("维度全空时命中全部图元", () => {
        expect(filterQuickSelect(elements, EMPTY_QUICK_SELECT_FILTER)).toHaveLength(4);
    });

    it("同一维度内取并集", () => {
        const matched = filterQuickSelect(elements, {
            ...EMPTY_QUICK_SELECT_FILTER,
            types: ["LINE", "CIRCLE"],
        });
        expect(matched.map((item) => item.id)).toEqual(["l1", "l2", "c1"]);
    });

    it("维度之间取交集", () => {
        const matched = filterQuickSelect(elements, {
            types: ["LINE"],
            layers: ["WALL"],
            colors: [],
        });
        expect(matched).toHaveLength(0);
    });

    it("颜色比较忽略大小写", () => {
        const matched = filterQuickSelect(
            [element("a", "LINE", "0", "#FF0000")],
            { ...EMPTY_QUICK_SELECT_FILTER, colors: ["#ff0000"] },
        );
        expect(matched.map((item) => item.id)).toEqual(["a"]);
    });

    it("空图层名归一到 0 层", () => {
        const matched = filterQuickSelect(
            [{ ...element("a"), layer: "" }],
            { ...EMPTY_QUICK_SELECT_FILTER, layers: ["0"] },
        );
        expect(matched).toHaveLength(1);
    });
});

describe("quickSelectFacets", () => {
    it("给出各维度取值与数量", () => {
        const facets = quickSelectFacets(elements, EMPTY_QUICK_SELECT_FILTER);
        expect(facets.types).toEqual([
            { value: "LINE", count: 2 },
            { value: "CIRCLE", count: 1 },
            { value: "RECTANGLE", count: 1 },
        ]);
        expect(facets.layers).toEqual([
            { value: "0", count: 2 },
            { value: "WALL", count: 2 },
        ]);
        expect(facets.colors).toEqual([
            { value: "#FF0000", count: 3 },
            { value: "#00FF00", count: 1 },
        ]);
    });

    it("选中类型后其余维度的计数随之收敛", () => {
        const facets = quickSelectFacets(elements, {
            ...EMPTY_QUICK_SELECT_FILTER,
            types: ["LINE"],
        });
        expect(facets.layers).toEqual([{ value: "0", count: 2 }]);
        expect(facets.colors).toEqual([{ value: "#FF0000", count: 2 }]);
    });
});

describe("quickSelectIds", () => {
    it("返回命中的图元 id", () => {
        expect(
            quickSelectIds(elements, { ...EMPTY_QUICK_SELECT_FILTER, types: ["CIRCLE"] }),
        ).toEqual(["c1"]);
    });
});

describe("toggleQuickSelectValue", () => {
    it("已存在则移除，不存在则追加", () => {
        expect(toggleQuickSelectValue(["A"], "A")).toEqual([]);
        expect(toggleQuickSelectValue(["A"], "B")).toEqual(["A", "B"]);
    });
});
