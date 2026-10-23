/**
 * transform.test.ts — lib/transform.ts 单元测试
 * 覆盖移动、复制、阵列、旋转、缩放、镜像、对齐/分布与包围盒计算。
 */

import { describe, it, expect } from "vitest";
import {
    moveElement,
    moveElements,
    moveElementFromTo,
    copyElement,
    copyElements,
    linearArray,
    rectangularArray,
    polarArray,
    rotateElement,
    rotateElements,
    scaleElement,
    scaleElements,
    uniformScale,
    mirrorElement,
    mirrorElements,
    mirrorHorizontal,
    mirrorVertical,
    getElementsCentroid,
    getCombinedBoundingBox,
    alignLeft,
    alignRight,
    alignTop,
    alignBottom,
    alignCenterVertical,
    alignCenterHorizontal,
    distributeHorizontally,
    distributeVertically,
    stretchElement,
} from "../lib/transform";
import { CADElement, Point } from "../types";

let seq = 0;

/** 构造测试用 CAD 元素 */
const makeElement = (partial: Partial<CADElement> & Pick<CADElement, "type">): CADElement => ({
    id: `el-${++seq}`,
    layer: "0",
    color: "#ffffff",
    ...partial,
});

/** 构造线段元素 */
const lineElement = (sx: number, sy: number, ex: number, ey: number): CADElement =>
    makeElement({ type: "LINE", start: { x: sx, y: sy }, end: { x: ex, y: ey } });

/** 构造圆元素 */
const circleElement = (cx: number, cy: number, radius: number): CADElement =>
    makeElement({ type: "CIRCLE", center: { x: cx, y: cy }, radius });

/** 断言点坐标（浮点容差 1e-6） */
const expectPoint = (actual: Point | undefined, x: number, y: number) => {
    expect(actual).toBeDefined();
    expect(actual!.x).toBeCloseTo(x, 6);
    expect(actual!.y).toBeCloseTo(y, 6);
};

describe("移动与复制", () => {
    it("移动线段、圆与多段线，且不修改原对象", () => {
        const line = lineElement(0, 0, 10, 0);
        const movedLine = moveElement(line, { x: 5, y: -5 });
        expectPoint(movedLine.start, 5, -5);
        expectPoint(movedLine.end, 15, -5);
        // 原对象保持不变
        expectPoint(line.start, 0, 0);

        const movedCircle = moveElement(circleElement(10, 10, 5), { x: -10, y: 20 });
        expectPoint(movedCircle.center, 0, 30);
        expect(movedCircle.radius).toBe(5);

        const polyline = makeElement({
            type: "LWPOLYLINE",
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
            ],
        });
        const movedPolyline = moveElement(polyline, { x: 1, y: 2 });
        expect(movedPolyline.points).toEqual([
            { x: 1, y: 2 },
            { x: 11, y: 12 },
        ]);
    });

    it("批量移动与按起止点移动", () => {
        const elements = [lineElement(0, 0, 1, 1), circleElement(0, 0, 1)];
        const moved = moveElements(elements, { x: 10, y: 10 });
        expect(moved).toHaveLength(2);
        expectPoint(moved[0].start, 10, 10);
        expectPoint(moved[1].center, 10, 10);

        const fromTo = moveElementFromTo(lineElement(0, 0, 1, 0), { x: 0, y: 0 }, { x: 5, y: 5 });
        expectPoint(fromTo.start, 5, 5);
        expectPoint(fromTo.end, 6, 5);
    });

    it("复制生成新 id", () => {
        const source = lineElement(0, 0, 10, 0);

        const copied = copyElement(source, { x: 20, y: 0 });
        expect(copied.id).not.toBe(source.id);
        expectPoint(copied.start, 20, 0);
        expectPoint(copied.end, 30, 0);

        const copies = copyElements([source, circleElement(0, 0, 1)], { x: 1, y: 1 });
        expect(copies).toHaveLength(2);
        expect(copies[0].id).not.toBe(copies[1].id);
    });
});

describe("阵列", () => {
    it("线性阵列按间距生成指定数量的副本", () => {
        const copies = linearArray([lineElement(0, 0, 1, 0)], 3, { x: 10, y: 0 });
        expect(copies).toHaveLength(3);
        expectPoint(copies[0].start, 10, 0);
        expectPoint(copies[1].start, 20, 0);
        expectPoint(copies[2].start, 30, 0);
    });

    it("矩形阵列跳过原始对象并覆盖所有行列", () => {
        const copies = rectangularArray([lineElement(0, 0, 1, 0)], 3, 2, 100, 50);
        // 3 行 × 2 列，去掉原始对象后应有 5 个副本
        expect(copies).toHaveLength(5);
        // 先行后列：第 0 行依次向右，第 1 行再向右
        expectPoint(copies[0].start, 50, 0);
        expectPoint(copies[1].start, 0, 100);
        expectPoint(copies[2].start, 50, 100);
        expectPoint(copies[3].start, 0, 200);
        expectPoint(copies[4].start, 50, 200);

        const multi = rectangularArray([lineElement(0, 0, 1, 0), circleElement(0, 0, 1)], 2, 2, 10, 10);
        expect(multi).toHaveLength(6);
    });

    it("环形阵列在不旋转元素时按角度分布副本", () => {
        const copies = polarArray([circleElement(100, 0, 10)], { x: 0, y: 0 }, 4, 90, false);
        // count=4 表示包含原始对象在内的总数，因此生成 3 个副本
        expect(copies).toHaveLength(3);
        expectPoint(copies[0].center, 0, 100);
        expectPoint(copies[1].center, -100, 0);
        expectPoint(copies[2].center, 0, -100);
    });

    it("环形阵列旋转元素时只应用一次旋转（回归）", () => {
        const copies = polarArray([lineElement(100, 0, 110, 0)], { x: 0, y: 0 }, 4, 90, true);
        expect(copies).toHaveLength(3);

        // 三角形绕原点旋转 90°：起点 (100,0) → (0,100)，终点 (110,0) → (0,110)
        expectPoint(copies[0].start, 0, 100);
        expectPoint(copies[0].end, 0, 110);

        expectPoint(copies[1].start, -100, 0);
        expectPoint(copies[1].end, -110, 0);

        expectPoint(copies[2].start, 0, -100);
        expectPoint(copies[2].end, 0, -110);
    });
});

describe("旋转、缩放与镜像", () => {
    it("绕基点旋转线段与圆", () => {
        const rotated = rotateElement(lineElement(0, 0, 10, 0), { x: 0, y: 0 }, 90);
        expectPoint(rotated.start, 0, 0);
        expectPoint(rotated.end, 0, 10);

        const rotatedCircle = rotateElement(circleElement(10, 0, 5), { x: 0, y: 0 }, 180);
        expectPoint(rotatedCircle.center, -10, 0);
        expect(rotatedCircle.radius).toBe(5);
    });

    it("旋转圆弧时同步更新起止角", () => {
        const arc = makeElement({
            type: "ARC",
            center: { x: 0, y: 0 },
            radius: 10,
            startAngle: 0,
            endAngle: 90,
        });

        const rotated = rotateElement(arc, { x: 0, y: 0 }, 45);
        expect(rotated.startAngle).toBeCloseTo(45, 10);
        expect(rotated.endAngle).toBeCloseTo(135, 10);

        expect(rotateElements([arc], { x: 0, y: 0 }, 45)).toHaveLength(1);
    });

    it("以基点缩放坐标、半径、宽高与字号", () => {
        const line = scaleElement(lineElement(10, 0, 20, 0), { x: 0, y: 0 }, 2, 2);
        expectPoint(line.start, 20, 0);
        expectPoint(line.end, 40, 0);

        const circle = scaleElement(circleElement(10, 10, 5), { x: 0, y: 0 }, 2, 2);
        expectPoint(circle.center, 20, 20);
        expect(circle.radius).toBe(10);

        const rect = scaleElement(
            makeElement({ type: "RECTANGLE", start: { x: 10, y: 10 }, width: 10, height: 5 }),
            { x: 0, y: 0 },
            2,
            3
        );
        expectPoint(rect.start, 20, 30);
        expect(rect.width).toBe(20);
        expect(rect.height).toBe(15);

        const text = scaleElement(
            makeElement({ type: "TEXT", start: { x: 10, y: 10 }, text: "A", fontSize: 12 }),
            { x: 0, y: 0 },
            2,
            2
        );
        expect(text.fontSize).toBe(24);

        expect(scaleElements([line], { x: 0, y: 0 }, 1, 1)).toHaveLength(1);
        expectPoint(uniformScale([lineElement(0, 0, 10, 0)], { x: 0, y: 0 }, 3)[0].end, 30, 0);
    });

    it("按镜面线镜像，并支持水平/垂直快捷方式", () => {
        const mirrored = mirrorElement(circleElement(5, 5, 2), {
            start: { x: 0, y: -1000 },
            end: { x: 0, y: 1000 },
        });
        expectPoint(mirrored.center, -5, 5);
        expect(mirrored.radius).toBe(2);

        // 以 x=10 为轴水平镜像：x' = 20 - x
        const horizontal = mirrorHorizontal([circleElement(5, 5, 2)], 10);
        expectPoint(horizontal[0].center, 15, 5);

        // 以 y=10 为轴垂直镜像：y' = 20 - y
        const vertical = mirrorVertical([circleElement(5, 5, 2)], 10);
        expectPoint(vertical[0].center, 5, 15);

        expect(
            mirrorElements(
                [lineElement(0, 0, 10, 0)],
                { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } }
            )
        ).toHaveLength(1);
    });
});

describe("质心与联合包围盒", () => {
    it("按采样点计算元素质心", () => {
        expectPoint(getElementsCentroid([lineElement(0, 0, 10, 0)]), 5, 0);
        expectPoint(getElementsCentroid([circleElement(10, 10, 5)]), 10, 10);
        expect(getElementsCentroid([])).toEqual({ x: 0, y: 0 });
    });

    it("计算多个元素的联合包围盒", () => {
        const box = getCombinedBoundingBox([lineElement(0, 0, 10, 0), circleElement(20, 20, 5)]);
        expect(box).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
        expect(getCombinedBoundingBox([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    });
});

describe("标注点与圆弧变换细节", () => {
    it("移动、旋转、缩放时同步处理标注偏移点", () => {
        const dimension = makeElement({
            type: "DIMENSION",
            start: { x: 0, y: 0 },
            end: { x: 10, y: 0 },
            offsetPoint: { x: 5, y: 5 },
        });

        expectPoint(moveElement(dimension, { x: 1, y: 1 }).offsetPoint, 6, 6);
        expectPoint(rotateElement(dimension, { x: 0, y: 0 }, 90).offsetPoint, -5, 5);
        expectPoint(scaleElement(dimension, { x: 0, y: 0 }, 2, 2).offsetPoint, 10, 10);
    });

    it("镜像圆弧时交换起止角并翻转方向", () => {
        const arc = makeElement({
            type: "ARC",
            center: { x: 5, y: 5 },
            radius: 10,
            startAngle: 0,
            endAngle: 90,
            clockwise: false,
        });

        const mirrored = mirrorElement(arc, {
            start: { x: 0, y: -1000 },
            end: { x: 0, y: 1000 },
        });

        expect(mirrored.startAngle).toBeCloseTo(90, 10);
        expect(mirrored.endAngle).toBeCloseTo(180, 10);
        expect(mirrored.clockwise).toBe(true);
        expectPoint(mirrored.center, -5, 5);
    });
});

describe("对齐、分布与拉伸", () => {
    /** 构造用于对齐测试的两个线段：A 左上，B 右下 */
    const pair = (): CADElement[] => [lineElement(0, 0, 10, 10), lineElement(20, 5, 30, 15)];

    it("左/右/上/下对齐到边界", () => {
        expectPoint(alignLeft(pair())[1].start, 0, 5);
        expectPoint(alignRight(pair())[0].end, 30, 10);
        expectPoint(alignTop(pair())[1].start, 20, 0);
        expectPoint(alignBottom(pair())[0].start, 0, 5);

        // 空数组原样返回
        expect(alignLeft([])).toEqual([]);
    });

    it("按中心线对齐", () => {
        // 垂直居中（X 方向中心）：中心 5 与 25 的平均值为 15
        const vertical = alignCenterVertical(pair());
        expectPoint(vertical[0].start, 10, 0);
        expectPoint(vertical[1].start, 10, 5);

        // 水平居中（Y 方向中心）：中心 5 与 10 的平均值为 7.5
        const horizontal = alignCenterHorizontal(pair());
        expectPoint(horizontal[0].start, 0, 2.5);
        expectPoint(horizontal[1].start, 20, 2.5);
    });

    it("水平/垂直等距分布，少于 3 个元素时原样返回", () => {
        const elements = [
            lineElement(0, 0, 0, 0),
            lineElement(10, 80, 10, 80),
            lineElement(100, 20, 100, 20),
        ];

        // 水平分布后中间元素中心 X 落在 50，Y 保持不变
        const horizontal = distributeHorizontally(elements);
        expectPoint(horizontal[1].start, 50, 80);

        // 垂直分布后按 Y 排序的中间元素中心 Y 落在 40
        const vertical = distributeVertically(elements);
        expectPoint(vertical[1].start, 100, 40);

        expect(distributeHorizontally(elements.slice(0, 2))).toHaveLength(2);
        expect(distributeVertically(elements.slice(0, 2))).toHaveLength(2);
    });

    it("拉伸仅移动落在拉伸框内的端点或顶点", () => {
        const box = { minX: -1, minY: -1, maxX: 11, maxY: 1 };

        const line = stretchElement(lineElement(0, 0, 20, 0), box, { x: 0, y: 10 });
        expectPoint(line.start, 0, 10);
        // 终点在框外，保持不动
        expectPoint(line.end, 20, 0);

        const polyline = stretchElement(
            makeElement({
                type: "LWPOLYLINE",
                points: [
                    { x: 0, y: 0 },
                    { x: 20, y: 0 },
                ],
            }),
            box,
            { x: 5, y: 5 }
        );
        expect(polyline.points).toEqual([
            { x: 5, y: 5 },
            { x: 20, y: 0 },
        ]);

        // 其他类型：任一采样点落在框内则整体移动
        const circle = stretchElement(circleElement(0, 0, 5), box, { x: 3, y: 3 });
        expectPoint(circle.center, 3, 3);
        expect(circle.radius).toBe(5);
    });
});
