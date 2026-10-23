/**
 * aiActions.test.ts — AI 动作纯计算层
 *
 * 覆盖预览所需的关键保证：不直接改写入参、副本生成新 id、
 * 各操作的目标选择与返回 null 的无效场景。
 */

import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import { computeAIActionOutcome } from "../lib/aiActions";

const line = (
    id: string,
    start = { x: 10, y: 0 },
    end = { x: 20, y: 0 },
    layer = "0",
): CADElement => ({
    id,
    type: "LINE",
    start,
    end,
    layer,
    color: "#fff",
});

const circle = (id: string): CADElement => ({
    id,
    type: "CIRCLE",
    center: { x: 50, y: 50 },
    radius: 10,
    layer: "WALLS",
    color: "#fff",
});

describe("computeAIActionOutcome", () => {
    it("CLEAR 返回空图元数组", () => {
        expect(computeAIActionOutcome("CLEAR", undefined, undefined, [line("a")], [])).toEqual({
            elements: [],
        });
    });

    it("DELETE_LAST 删除最后一个图元，空画布返回 null", () => {
        const outcome = computeAIActionOutcome(
            "DELETE_LAST",
            undefined,
            undefined,
            [line("a"), line("b")],
            [],
        );
        expect(outcome?.elements.map((element) => element.id)).toEqual(["a"]);
        expect(computeAIActionOutcome("DELETE_LAST", undefined, undefined, [], [])).toBeNull();
    });

    it("ADD 追加图元且不修改原数组", () => {
        const base = [line("a")];
        const outcome = computeAIActionOutcome(
            "ADD",
            [circle("new-circle")],
            undefined,
            base,
            [],
        );

        expect(outcome?.elements.map((element) => element.id)).toEqual(["a", "new-circle"]);
        expect(base).toHaveLength(1);
    });

    it("ADD 将带 points 的 LINE 规范为 LWPOLYLINE", () => {
        const polyline: CADElement = {
            ...line("curve"),
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 5 },
            ],
        };
        const outcome = computeAIActionOutcome("ADD", [polyline], undefined, [], []);

        expect(outcome?.elements[0].type).toBe("LWPOLYLINE");
    });

    it("COPY 为副本生成新 id 并应用默认位移", () => {
        const outcome = computeAIActionOutcome(
            "COPY",
            undefined,
            undefined,
            [line("a")],
            [line("a")],
        );

        const [original, copy] = outcome!.elements;
        expect(original.id).toBe("a");
        expect(copy.id).not.toBe("a");
        expect(copy.start).toEqual({ x: 60, y: 50 });
        expect(outcome?.selection).toEqual([copy.id]);
    });

    it("MOVE 按 dx/dy 移动选中图元并保留其他图元", () => {
        const outcome = computeAIActionOutcome(
            "MOVE",
            undefined,
            { dx: 5, dy: -3 },
            [line("a"), line("b", { x: 100, y: 100 }, { x: 110, y: 100 })],
            [line("a")],
        );

        expect(outcome?.elements[0].start).toEqual({ x: 15, y: -3 });
        expect(outcome?.elements[1].start).toEqual({ x: 100, y: 100 });
    });

    it("MOVE 在无位移时应用模型返回的图元更新", () => {
        const updated = line("a", { x: 1, y: 2 }, { x: 3, y: 4 });
        const outcome = computeAIActionOutcome("MOVE", [updated], {}, [line("a")], []);

        expect(outcome?.elements[0].start).toEqual({ x: 1, y: 2 });
        expect(outcome?.elements[0].end).toEqual({ x: 3, y: 4 });
    });

    it("ROTATE 围绕形心旋转并保持端点距离", () => {
        const base = line("a", { x: 0, y: 0 }, { x: 10, y: 0 });
        const outcome = computeAIActionOutcome("ROTATE", undefined, { angle: 90 }, [base], [base]);
        const rotated = outcome!.elements[0];

        const length = Math.hypot(
            rotated.end!.x - rotated.start!.x,
            rotated.end!.y - rotated.start!.y,
        );
        expect(length).toBeCloseTo(10);
        expect(rotated.start).not.toEqual({ x: 0, y: 0 });
    });

    it("MIRROR 生成镜像副本并使用新 id", () => {
        const outcome = computeAIActionOutcome(
            "MIRROR",
            undefined,
            { p1: { x: 400, y: 0 }, p2: { x: 400, y: 600 } },
            [line("a", { x: 10, y: 0 }, { x: 20, y: 0 })],
            [],
        );

        expect(outcome?.elements).toHaveLength(2);
        const mirrored = outcome!.elements[1];
        expect(mirrored.id).not.toBe("a");
        expect(mirrored.start!.x).toBeCloseTo(790);
        expect(mirrored.start!.y).toBeCloseTo(0);
        expect(mirrored.end!.x).toBeCloseTo(780);
        expect(mirrored.end!.y).toBeCloseTo(0);
    });

    it("SCALE 围绕形心缩放选中图元", () => {
        const outcome = computeAIActionOutcome(
            "SCALE",
            undefined,
            { factor: 2 },
            [line("a")],
            [line("a")],
        );

        expect(outcome?.elements[0].start).toEqual({ x: 5, y: 0 });
        expect(outcome?.elements[0].end).toEqual({ x: 25, y: 0 });
    });

    it("SCALE 拒绝非正数", () => {
        expect(
            computeAIActionOutcome("SCALE", undefined, { factor: 0 }, [line("a")], [line("a")]),
        ).toBeNull();
    });

    it("OFFSET 与 ARRAY 追加带新 id 的副本", () => {
        const offset = computeAIActionOutcome(
            "OFFSET",
            undefined,
            { distance: 20 },
            [line("a")],
            [line("a")],
        );
        expect(offset!.elements.length).toBeGreaterThan(1);
        expect(offset!.elements[1].id).not.toBe("a");

        const array = computeAIActionOutcome(
            "ARRAY",
            undefined,
            { rows: 2, columns: 2, rowSpacing: 50, columnSpacing: 50 },
            [line("a")],
            [line("a")],
        );
        expect(array?.elements).toHaveLength(4);
    });

    it("无目标或未知操作时返回 null", () => {
        expect(computeAIActionOutcome("COPY", undefined, undefined, [], [])).toBeNull();
        expect(computeAIActionOutcome("EXPLODE", undefined, undefined, [line("a")], [])).toBeNull();
    });
});
