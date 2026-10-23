/**
 * grip.test.ts — 夹点计算与拖拽应用测试
 *
 * 覆盖各类图元的夹点生成规则，以及拖拽后对图元属性的改写结果。
 */

import { describe, expect, it } from "vitest";
import { applyGripDrag, getGripPoints, GripPoint } from "../lib/grip";
import { CADElement, Point } from "../types";

/** 构造 CAD 元素的最小合法对象 */
const element = (partial: Partial<CADElement> & Pick<CADElement, "type">): CADElement => ({
    id: "el-1",
    layer: "0",
    color: "#ffffff",
    ...partial,
});

/** 断言点坐标（浮点容差 1e-6） */
const expectPoint = (actual: Point | undefined, x: number, y: number) => {
    expect(actual).toBeDefined();
    expect(actual!.x).toBeCloseTo(x, 6);
    expect(actual!.y).toBeCloseTo(y, 6);
};

describe("getGripPoints", () => {
    it("线段返回两个端点夹点", () => {
        const grips = getGripPoints(
            element({ type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 5 } }),
        );
        expect(grips).toHaveLength(2);
        expect(grips.map(g => g.key)).toEqual(["start", "end"]);
        expectPoint(grips[0].point, 0, 0);
        expectPoint(grips[1].point, 10, 5);
    });

    it("矩形返回四个角点夹点", () => {
        const grips = getGripPoints(
            element({ type: "RECTANGLE", start: { x: 10, y: 20 }, width: 30, height: 40 }),
        );
        expect(grips).toHaveLength(4);
        expectPoint(grips[0].point, 10, 20);
        expectPoint(grips[1].point, 40, 20);
        expectPoint(grips[2].point, 40, 60);
        expectPoint(grips[3].point, 10, 60);
    });

    it("圆返回圆心与四个象限半径夹点", () => {
        const grips = getGripPoints(
            element({ type: "CIRCLE", center: { x: 100, y: 100 }, radius: 10 }),
        );
        expect(grips).toHaveLength(5);
        expect(grips[0].key).toBe("center");
        expectPoint(grips[0].point, 100, 100);
        expectPoint(grips[1].point, 110, 100);
        expectPoint(grips[2].point, 100, 110);
        expectPoint(grips[3].point, 90, 100);
        expectPoint(grips[4].point, 100, 90);
    });

    it("圆弧返回圆心与起止角夹点", () => {
        const grips = getGripPoints(
            element({
                type: "ARC",
                center: { x: 0, y: 0 },
                radius: 10,
                startAngle: 0,
                endAngle: 90,
            }),
        );
        expect(grips.map(g => g.key)).toEqual(["center", "arcStart", "arcEnd"]);
        expectPoint(grips[1].point, 10, 0);
        expectPoint(grips[2].point, 0, 10);
    });

    it("多段线返回全部顶点夹点", () => {
        const grips = getGripPoints(
            element({
                type: "LWPOLYLINE",
                points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                ],
            }),
        );
        expect(grips).toHaveLength(3);
        expect(grips.map(g => g.key)).toEqual(["point:0", "point:1", "point:2"]);
    });

    it("文字与标注返回定位点夹点", () => {
        const text = getGripPoints(element({ type: "TEXT", start: { x: 5, y: 6 }, text: "A" }));
        expect(text).toHaveLength(1);
        expect(text[0].key).toBe("start");

        const dim = getGripPoints(
            element({
                type: "DIMENSION",
                start: { x: 0, y: 0 },
                end: { x: 10, y: 0 },
                offsetPoint: { x: 5, y: 8 },
            }),
        );
        expect(dim.map(g => g.key)).toEqual(["start", "end", "offsetPoint"]);
    });
});

describe("applyGripDrag", () => {
    it("拖动线段端点只修改该端点", () => {
        const el = element({ type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
        const grip: GripPoint = { elementId: el.id, key: "end", point: { x: 10, y: 0 } };

        const updated = applyGripDrag(el, grip, { x: 20, y: 5 });

        expectPoint(updated.start, 0, 0);
        expectPoint(updated.end, 20, 5);
        // 原对象不应被就地修改
        expectPoint(el.end, 10, 0);
    });

    it("拖动矩形角点时保持对角固定并重算宽高", () => {
        const el = element({
            type: "RECTANGLE",
            start: { x: 0, y: 0 },
            width: 10,
            height: 10,
        });
        // 右下角（corner:2），对角为左上角 (0,0)
        const grip: GripPoint = { elementId: el.id, key: "corner:2", point: { x: 10, y: 10 } };

        const updated = applyGripDrag(el, grip, { x: 20, y: 30 });

        expectPoint(updated.start, 0, 0);
        expect(updated.width).toBe(20);
        expect(updated.height).toBe(30);
    });

    it("拖动矩形角点越过对角时自动翻转宽高", () => {
        const el = element({
            type: "RECTANGLE",
            start: { x: 0, y: 0 },
            width: 10,
            height: 10,
        });
        const grip: GripPoint = { elementId: el.id, key: "corner:2", point: { x: 10, y: 10 } };

        const updated = applyGripDrag(el, grip, { x: -5, y: -4 });

        expectPoint(updated.start, -5, -4);
        expect(updated.width).toBe(5);
        expect(updated.height).toBe(4);
    });

    it("拖动半径夹点按到圆心的距离更新半径", () => {
        const el = element({ type: "CIRCLE", center: { x: 0, y: 0 }, radius: 10 });
        const grip: GripPoint = { elementId: el.id, key: "radius", point: { x: 10, y: 0 } };

        const updated = applyGripDrag(el, grip, { x: 3, y: 4 });

        expect(updated.radius).toBeCloseTo(5, 6);
        expectPoint(updated.center, 0, 0);
    });

    it("拖动圆弧角度夹点更新起止角", () => {
        const el = element({
            type: "ARC",
            center: { x: 0, y: 0 },
            radius: 10,
            startAngle: 0,
            endAngle: 90,
        });

        const start = applyGripDrag(
            el,
            { elementId: el.id, key: "arcStart", point: { x: 10, y: 0 } },
            { x: 0, y: -10 },
        );
        expect(start.startAngle).toBeCloseTo(-90, 6);

        const end = applyGripDrag(
            el,
            { elementId: el.id, key: "arcEnd", point: { x: 0, y: 10 } },
            { x: -10, y: 0 },
        );
        expect(end.endAngle).toBeCloseTo(180, 6);
    });

    it("拖动多段线顶点只替换对应索引", () => {
        const el = element({
            type: "LWPOLYLINE",
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
            ],
        });
        const grip: GripPoint = { elementId: el.id, key: "point:1", point: { x: 10, y: 0 } };

        const updated = applyGripDrag(el, grip, { x: 15, y: -5 });

        expectPoint(updated.points![0], 0, 0);
        expectPoint(updated.points![1], 15, -5);
        expectPoint(updated.points![2], 10, 10);
    });

    it("拖动圆心夹点整体移动圆", () => {
        const el = element({ type: "CIRCLE", center: { x: 5, y: 5 }, radius: 10 });
        const grip: GripPoint = { elementId: el.id, key: "center", point: { x: 5, y: 5 } };

        const updated = applyGripDrag(el, grip, { x: 50, y: 60 });

        expectPoint(updated.center, 50, 60);
        expect(updated.radius).toBe(10);
    });
});
