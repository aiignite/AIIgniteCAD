/**
 * dynamicInput.test.ts — lib/dynamicInput.ts 单元测试
 *
 * 动态输入只在"已取第一点、等待第二点"阶段可用，
 * 因此重点验证锚点判定、字段顺序与键入值合成坐标。
 */

import { describe, expect, it } from "vitest";
import type { Point } from "../types";
import { ToolType } from "../types";
import {
    buildDynamicDraft,
    dynamicFieldLabel,
    dynamicFieldSuffix,
    parseDynamicValue,
    resolveDynamicAnchor,
    resolveDynamicPoint,
    type DynamicAnchorInput,
    type DynamicDraft,
} from "../lib/dynamicInput";

const ORIGIN: Point = { x: 0, y: 0 };

const anchorInput = (partial: Partial<DynamicAnchorInput> = {}): DynamicAnchorInput => ({
    tool: ToolType.LINE,
    dragMode: "DRAW",
    drawStart: { x: 0, y: 0 },
    polyPoints: [],
    dimPoints: [],
    ...partial,
});

describe("resolveDynamicAnchor", () => {
    it("直线/矩形/圆在拖拽绘制阶段返回起点", () => {
        const drawStart = { x: 5, y: 7 };
        [ToolType.LINE, ToolType.RECTANGLE, ToolType.CIRCLE].forEach((tool) => {
            expect(resolveDynamicAnchor(anchorInput({ tool, drawStart }))).toEqual(drawStart);
        });
    });

    it("尚未按下时没有锚点", () => {
        expect(resolveDynamicAnchor(anchorInput({ dragMode: null, drawStart: null }))).toBeNull();
    });

    it("多段线以最后一点为锚点", () => {
        const anchor = resolveDynamicAnchor(
            anchorInput({
                tool: ToolType.POLYLINE,
                dragMode: "POLYLINE_ADD",
                drawStart: null,
                polyPoints: [
                    { x: 0, y: 0 },
                    { x: 50, y: 0 },
                ],
            }),
        );
        expect(anchor).toEqual({ x: 50, y: 0 });
    });

    it("标注只在取满两点之间可键入长度", () => {
        expect(
            resolveDynamicAnchor(
                anchorInput({
                    tool: ToolType.DIMENSION,
                    drawStart: null,
                    dimPoints: [{ x: 1, y: 2 }],
                }),
            ),
        ).toEqual({ x: 1, y: 2 });
        expect(
            resolveDynamicAnchor(
                anchorInput({
                    tool: ToolType.DIMENSION,
                    drawStart: null,
                    dimPoints: [
                        { x: 1, y: 2 },
                        { x: 3, y: 4 },
                    ],
                }),
            ),
        ).toBeNull();
    });

    it("选择等非绘制工具不支持动态输入", () => {
        expect(resolveDynamicAnchor(anchorInput({ tool: ToolType.SELECT }))).toBeNull();
    });
});

describe("buildDynamicDraft", () => {
    it("矩形给出宽高字段并保留光标所在象限", () => {
        const draft = buildDynamicDraft(ToolType.RECTANGLE, ORIGIN, { x: -40, y: 30 });

        expect(draft?.mode).toBe("box");
        expect(draft?.fields).toEqual(["width", "height"]);
        expect(draft?.width).toBeCloseTo(40, 6);
        expect(draft?.height).toBeCloseTo(30, 6);
        expect(draft?.signX).toBe(-1);
        expect(draft?.signY).toBe(1);
    });

    it("圆以半径为唯一字段", () => {
        const draft = buildDynamicDraft(ToolType.CIRCLE, ORIGIN, { x: 6, y: 8 });

        expect(draft?.mode).toBe("radius");
        expect(draft?.fields).toEqual(["length"]);
        expect(draft?.length).toBeCloseTo(10, 6);
    });

    it("直线使用长度与角度两个字段", () => {
        const draft = buildDynamicDraft(ToolType.LINE, ORIGIN, { x: 100, y: 0 });

        expect(draft?.mode).toBe("polar");
        expect(draft?.fields).toEqual(["length", "angle"]);
        expect(draft?.angle).toBeCloseTo(0, 6);
    });

    it("缺少锚点或光标、工具不支持时返回 null", () => {
        expect(buildDynamicDraft(ToolType.LINE, null, { x: 1, y: 1 })).toBeNull();
        expect(buildDynamicDraft(ToolType.LINE, ORIGIN, null)).toBeNull();
        expect(buildDynamicDraft(ToolType.SELECT, ORIGIN, { x: 1, y: 1 })).toBeNull();
    });
});

describe("resolveDynamicPoint", () => {
    const draftOf = (tool: ToolType, cursor: Point): DynamicDraft =>
        buildDynamicDraft(tool, ORIGIN, cursor)!;

    it("未键入时沿用光标的实时值", () => {
        const draft = draftOf(ToolType.LINE, { x: 100, y: 0 });
        expect(resolveDynamicPoint(draft, {})).toMatchObject({ x: 100, y: 0 });
    });

    it("直线按键入长度与角度合成终点", () => {
        const draft = draftOf(ToolType.LINE, { x: 100, y: 0 });
        const point = resolveDynamicPoint(draft, { length: 50, angle: 90 });

        expect(point.x).toBeCloseTo(0, 6);
        expect(point.y).toBeCloseTo(50, 6);
    });

    it("矩形按符号回到原象限", () => {
        const draft = draftOf(ToolType.RECTANGLE, { x: -40, y: 30 });
        expect(resolveDynamicPoint(draft, { width: 20, height: 15 })).toEqual({ x: -20, y: 15 });
    });

    it("圆只接受半径，角度仍取光标方向", () => {
        const draft = draftOf(ToolType.CIRCLE, { x: 0, y: 40 });
        const point = resolveDynamicPoint(draft, { length: 25 });

        expect(point.x).toBeCloseTo(0, 6);
        expect(point.y).toBeCloseTo(25, 6);
    });

    it("非法数值被忽略并回落到实时值", () => {
        const draft = draftOf(ToolType.LINE, { x: 100, y: 0 });
        expect(resolveDynamicPoint(draft, { length: Number.NaN })).toMatchObject({ x: 100, y: 0 });
    });
});

describe("parseDynamicValue", () => {
    it("解析常规数值", () => {
        expect(parseDynamicValue("12.5")).toBe(12.5);
        expect(parseDynamicValue(" -30 ")).toBe(-30);
        expect(parseDynamicValue("0")).toBe(0);
    });

    it("输入未完成的符号返回 null", () => {
        expect(parseDynamicValue("")).toBeNull();
        expect(parseDynamicValue(" ")).toBeNull();
        expect(parseDynamicValue("-")).toBeNull();
        expect(parseDynamicValue(".")).toBeNull();
        expect(parseDynamicValue("-.")).toBeNull();
    });

    it("拒绝非数字与无穷", () => {
        expect(parseDynamicValue("abc")).toBeNull();
        expect(parseDynamicValue("Infinity")).toBeNull();
    });
});

describe("字段标题与单位", () => {
    it("半径模式复用 length 字段但显示为半径", () => {
        expect(dynamicFieldLabel("radius", "length")).toBe("半径");
        expect(dynamicFieldLabel("polar", "length")).toBe("长度");
        expect(dynamicFieldLabel("box", "width")).toBe("宽");
        expect(dynamicFieldLabel("box", "height")).toBe("高");
    });

    it("只有角度带度数后缀", () => {
        expect(dynamicFieldSuffix("angle")).toBe("°");
        expect(dynamicFieldSuffix("length")).toBe("");
        expect(dynamicFieldSuffix("width")).toBe("");
    });
});
