import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import { computeAIActionOutcome } from "../lib/aiActions";
import { alignElements, assignLayer, deleteElements, distributeElements } from "../lib/designOps";
import { getElementBoundingBox } from "../lib/geometry";

const rect = (id: string, x: number, y: number, width = 10, height = 10): CADElement => ({
    id,
    type: "RECTANGLE",
    start: { x, y },
    width,
    height,
    layer: "0",
    color: "#fff",
});

const line = (id: string, x1: number, y1: number, x2: number, y2: number): CADElement => ({
    id,
    type: "LINE",
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    layer: "0",
    color: "#fff",
});

const box = (element: CADElement) => {
    const bounds = getElementBoundingBox(element);
    return {
        minX: Math.min(bounds.minX, bounds.maxX),
        minY: Math.min(bounds.minY, bounds.maxY),
        maxX: Math.max(bounds.minX, bounds.maxX),
        maxY: Math.max(bounds.minY, bounds.maxY),
    };
};

describe("alignElements", () => {
    const base = [rect("a", 0, 0), rect("b", 50, 20), rect("c", 120, 60)];

    it("按最左 / 最右 / 顶边对齐且保持未参与图元不变", () => {
        const outside = rect("outside", 500, 500);
        const withOutside = [...base, outside];
        const left = alignElements(withOutside, base, "left");
        expect(left).not.toBeNull();
        expect(
            base.map((element) => box(left!.elements.find((item) => item.id === element.id)!).minX),
        ).toEqual([0, 0, 0]);
        expect(left!.elements.find((item) => item.id === "outside")).toBe(outside);

        const right = alignElements(base, base, "right");
        const rights = base.map(
            (element) => box(right!.elements.find((item) => item.id === element.id)!).maxX,
        );
        expect(rights).toEqual([130, 130, 130]);
    });

    it("水平 / 垂直居中", () => {
        const centeredX = alignElements(base, base, "centerX");
        const centersX = base.map((element) => {
            const bounds = box(centeredX!.elements.find((item) => item.id === element.id)!);
            return (bounds.minX + bounds.maxX) / 2;
        });
        expect(centersX[0]).toBeCloseTo(centersX[1]);
        expect(centersX[1]).toBeCloseTo(centersX[2]);

        const centeredY = alignElements(base, base, "centerY");
        const centersY = base.map((element) => {
            const bounds = box(centeredY!.elements.find((item) => item.id === element.id)!);
            return (bounds.minY + bounds.maxY) / 2;
        });
        expect(centersY[0]).toBeCloseTo(centersY[1]);
    });

    it("少于两个目标或非法模式时返回 null", () => {
        expect(alignElements(base, [base[0]], "left")).toBeNull();
        expect(alignElements(base, base, "diagonal" as never)).toBeNull();
    });
});

describe("distributeElements", () => {
    it("水平等距分布，保持首尾图元不动", () => {
        const base = [rect("a", 0, 0), rect("b", 30, 0), rect("c", 80, 0), rect("d", 200, 0)];
        const result = distributeElements(base, base, "horizontal");
        expect(result).not.toBeNull();
        const boxes = base.map((element) =>
            box(result!.elements.find((item) => item.id === element.id)!),
        );
        const gaps = boxes.slice(1).map((item, index) => item.minX - boxes[index].maxX);
        expect(gaps[0]).toBeCloseTo(gaps[1]);
        expect(gaps[1]).toBeCloseTo(gaps[2]);
        expect(boxes[0].minX).toBe(0);
        expect(boxes[3].maxX).toBe(210);
    });

    it("垂直分布与异常输入", () => {
        const base = [rect("a", 0, 0), rect("b", 0, 50), rect("c", 0, 200)];
        const result = distributeElements(base, base, "vertical");
        const boxes = base.map((element) =>
            box(result!.elements.find((item) => item.id === element.id)!),
        );
        expect(boxes[1].minY - boxes[0].maxY).toBeCloseTo(boxes[2].minY - boxes[1].maxY);

        expect(distributeElements(base, base.slice(0, 2), "horizontal")).toBeNull();
        expect(distributeElements(base, base, "diagonal" as never)).toBeNull();
        const overlapping = [rect("x", 0, 0, 100), rect("y", 10, 0, 100), rect("z", 20, 0, 100)];
        expect(distributeElements(overlapping, overlapping, "horizontal")).toBeNull();
    });
});

describe("assignLayer / deleteElements", () => {
    it("只改目标图层并返回变更 id", () => {
        const base = [line("a", 0, 0, 10, 0), rect("b", 0, 0)];
        const result = assignLayer(base, [base[0]], "WALLS");
        expect(result?.elements[0].layer).toBe("WALLS");
        expect(result?.elements[1]).toBe(base[1]);
        expect(result?.changedIds).toEqual(["a"]);
        expect(assignLayer(base, [base[0]], "   ")).toBeNull();
    });

    it("删除目标图元并保留其余引用", () => {
        const base = [line("a", 0, 0, 10, 0), rect("b", 0, 0), line("c", 5, 5, 15, 15)];
        const result = deleteElements(base, [base[0], base[1]]);
        expect(result.elements.map((element) => element.id)).toEqual(["c"]);
        expect(result.changedIds).toEqual(["a", "b"]);
    });
});

describe("computeAIActionOutcome 设计操作", () => {
    const base = [rect("a", 0, 0), rect("b", 50, 20), rect("c", 120, 60)];

    it("ALIGN / DISTRIBUTE / SET_LAYER / DELETE 均可落图", () => {
        const aligned = computeAIActionOutcome("ALIGN", base, { mode: "left" }, base, base);
        expect(aligned).not.toBeNull();
        expect(
            base.map(
                (element) => box(aligned!.elements.find((item) => item.id === element.id)!).minX,
            ),
        ).toEqual([0, 0, 0]);

        const distributed = computeAIActionOutcome(
            "DISTRIBUTE",
            base,
            { axis: "horizontal" },
            base,
            base,
        );
        expect(distributed).not.toBeNull();

        const layered = computeAIActionOutcome("SET_LAYER", [base[0]], { layer: "DIM" }, base, []);
        expect(layered?.elements.find((element) => element.id === "a")?.layer).toBe("DIM");

        const deleted = computeAIActionOutcome("DELETE", [base[0]], {}, base, []);
        expect(deleted?.elements.map((element) => element.id)).toEqual(["b", "c"]);
    });
});
