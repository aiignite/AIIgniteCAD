/**
 * isolation.test.ts — 隔离 / 隐藏对象纯函数测试
 */

import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import {
    countHiddenObjects,
    displayableElements,
    isolateIds,
    mergeHiddenIds,
    selectSimilarIds,
} from "../lib/isolation";

const element = (id: string, type: CADElement["type"] = "LINE", layer = "0"): CADElement => ({
    id,
    type,
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    layer,
    color: "#fff",
});

describe("displayableElements", () => {
    it("同时排除隐藏图层与临时隐藏的图元", () => {
        const elements = [element("a"), element("dim", "LINE", "DIM"), element("b")];
        const visible = displayableElements(elements, ["DIM"], new Set(["b"]));
        expect(visible.map((item) => item.id)).toEqual(["a"]);
    });

    it("缺省图层按 0 层处理", () => {
        const noLayer = { ...element("a"), layer: "" };
        expect(displayableElements([noLayer], [], new Set())).toHaveLength(1);
        expect(displayableElements([noLayer], ["0"], new Set())).toHaveLength(0);
    });
});

describe("isolateIds", () => {
    it("返回选择集之外的图层可见图元", () => {
        const elements = [element("a"), element("b"), element("c", "LINE", "DIM")];
        expect(isolateIds(elements, ["DIM"], new Set(["a"]))).toEqual(["b"]);
    });

    it("选择集为空时隐藏全部可显示图元", () => {
        const elements = [element("a"), element("b")];
        expect(isolateIds(elements, [], new Set())).toEqual(["a", "b"]);
    });
});

describe("mergeHiddenIds", () => {
    it("保留既有顺序且不会重复", () => {
        expect(mergeHiddenIds(["c", "a"], ["a", "b"])).toEqual(["c", "a", "b"]);
    });

    it("接受空的隐藏集", () => {
        expect(mergeHiddenIds([], ["a"])).toEqual(["a"]);
    });
});

describe("selectSimilarIds", () => {
    it("按已选图元的类型集合匹配候选", () => {
        const elements = [
            element("a"),
            element("c1", "CIRCLE"),
            element("b"),
            element("r", "RECTANGLE"),
        ];
        const selected = [element("a"), element("c1", "CIRCLE")];
        expect(selectSimilarIds(elements, selected)).toEqual(["a", "c1", "b"]);
    });

    it("没有已选图元时不返回任何 id", () => {
        expect(selectSimilarIds([element("a")], [])).toEqual([]);
    });
});

describe("countHiddenObjects", () => {
    it("忽略已不存在的失效 id", () => {
        expect(countHiddenObjects([element("a")], new Set(["a", "gone"]))).toBe(1);
    });
});
