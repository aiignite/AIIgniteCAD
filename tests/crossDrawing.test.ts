import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import {
    MAX_XREF_ELEMENTS,
    buildXrefInsert,
    xrefBounds,
    xrefGroupId,
} from "../lib/crossDrawing";

const line = (id: string, x1: number, y1: number, x2: number, y2: number): CADElement => ({
    id,
    type: "LINE",
    layer: "0",
    color: "#fff",
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
});

const circle = (id: string, cx: number, cy: number, r: number): CADElement => ({
    id,
    type: "CIRCLE",
    layer: "OUTLINE",
    color: "#f00",
    center: { x: cx, y: cy },
    radius: r,
});

describe("xrefBounds", () => {
    it("合并所有图元包围盒并处理负宽高", () => {
        const box = xrefBounds([line("a", 100, 100, 0, 0), circle("c", 50, 200, 10)]);
        expect(box).toMatchObject({ minX: 0, minY: 0, maxX: 100, maxY: 210 });
    });

    it("没有图元时返回 null", () => {
        expect(xrefBounds([])).toBeNull();
    });
});

describe("buildXrefInsert", () => {
    const source = {
        id: "p-src",
        name: "标准层",
        elements: [line("a", 100, 100, 200, 100), circle("b", 150, 150, 20)],
    };

    it("把包围盒左下角对齐到目标点", () => {
        const result = buildXrefInsert(source, { target: { x: 0, y: 0 } });
        // 源包围盒 (100,100)→(200,170)，整体平移 (-100,-100)
        expect(result.bounds).toMatchObject({ minX: 0, minY: 0, maxX: 100, maxY: 70 });
        expect(result.elements).toHaveLength(2);
    });

    it("不给目标点时保持原位", () => {
        const result = buildXrefInsert(source);
        expect(result.bounds).toMatchObject({ minX: 100, minY: 100, maxX: 200, maxY: 170 });
    });

    it("重新编号并共享来源分组", () => {
        const result = buildXrefInsert(source, { target: { x: 0, y: 0 } });
        expect(result.elements.map((element) => element.id)).toEqual([
            "xref:p-src:1",
            "xref:p-src:2",
        ]);
        expect(new Set(result.elements.map((element) => element.groupId))).toEqual(
            new Set([xrefGroupId("p-src")]),
        );
        expect(result.selection).toEqual(["xref:p-src:1", "xref:p-src:2"]);
    });

    it("保留图层与颜色，不与源图元共享引用", () => {
        const result = buildXrefInsert(source, { target: { x: 0, y: 0 } });
        const copiedCircle = result.elements[1];
        expect(copiedCircle.layer).toBe("OUTLINE");
        expect(copiedCircle.color).toBe("#f00");
        expect(copiedCircle).not.toBe(source.elements[1]);
    });

    it("跳过依赖块定义的块引用并计数", () => {
        const result = buildXrefInsert({
            id: "p-src",
            name: "带块",
            elements: [
                line("a", 0, 0, 10, 0),
                {
                    id: "ref",
                    type: "BLOCK_REFERENCE",
                    layer: "0",
                    color: "#fff",
                    blockReferenceId: "blk-1",
                    start: { x: 0, y: 0 },
                },
            ],
        });
        expect(result.elements).toHaveLength(1);
        expect(result.skipped).toBe(1);
    });

    it("超过上限时截断并标记", () => {
        const many = Array.from({ length: MAX_XREF_ELEMENTS + 3 }, (_, index) =>
            line(`e-${index}`, index, 0, index + 1, 10),
        );
        const result = buildXrefInsert({ id: "big", name: "大图", elements: many });
        expect(result.elements).toHaveLength(MAX_XREF_ELEMENTS);
        expect(result.truncated).toBe(3);
    });

    it("空图纸不产生插入", () => {
        const result = buildXrefInsert({ id: "empty", name: "空图", elements: [] });
        expect(result.elements).toHaveLength(0);
        expect(result.bounds).toBeNull();
        expect(result.selection).toHaveLength(0);
    });
});
