/**
 * dxfUnits.test.ts — DXF 单位换算与导入导出报告回归
 *
 * 覆盖：$INSUNITS 导入换算、缺失单位按 1:1、不支持实体汇总、
 * 导出单位换算与 $INSUNITS 声明、跳过图元报告、HATCH 边界导出。
 */

import { describe, it, expect } from "vitest";
import {
    exportToDXF,
    exportToDXFWithReport,
    parseDXF,
    parseDXFWithReport,
} from "../services/dxfService";
import { CADElement } from "../types";

let seq = 0;

const makeElement = (partial: Partial<CADElement> & Pick<CADElement, "type">): CADElement => ({
    id: `unit-${++seq}`,
    layer: "0",
    color: "#ffffff",
    ...partial,
});

/** 构造只含 HEADER 与 ENTITIES 的最小 DXF */
const dxfWith = (headerPairs: string[], entityPairs: string[]): string =>
    [
        "0", "SECTION", "2", "HEADER",
        ...headerPairs,
        "0", "ENDSEC",
        "0", "SECTION", "2", "ENTITIES",
        ...entityPairs,
        "0", "ENDSEC",
        "0", "EOF",
    ].join("\n");

const lineEntity = (x1: number, y1: number, x2: number, y2: number): string[] => [
    "0", "LINE", "8", "0",
    "10", String(x1), "20", String(y1),
    "11", String(x2), "21", String(y2),
];

describe("DXF 导入单位换算", () => {
    it("$INSUNITS = 1（英寸）时坐标换算为 mm", () => {
        const dxf = dxfWith(
            ["9", "$INSUNITS", "70", "1"],
            lineEntity(1, 2, 3, 4),
        );
        const { elements, report } = parseDXFWithReport(dxf);
        expect(report.insunits).toBe(1);
        expect(report.unitScale).toBe(25.4);
        expect(elements).toHaveLength(1);
        expect(elements[0].start).toEqual({ x: 25.4, y: -50.8 });
        expect(elements[0].end!.x).toBeCloseTo(76.2, 6);
        expect(elements[0].end!.y).toBeCloseTo(-101.6, 6);
    });

    it("$INSUNITS = 6（米）时坐标换算为 mm", () => {
        const dxf = dxfWith(
            ["9", "$INSUNITS", "70", "6"],
            lineEntity(1, 0, 2, 0),
        );
        const { elements, report } = parseDXFWithReport(dxf);
        expect(report.unitScale).toBe(1000);
        expect(elements[0].start).toEqual({ x: 1000, y: 0 });
        expect(elements[0].end).toEqual({ x: 2000, y: 0 });
    });

    it("$INSUNITS = 4（毫米）时按 1:1 处理", () => {
        const dxf = dxfWith(
            ["9", "$INSUNITS", "70", "4"],
            lineEntity(10, 20, 30, 40),
        );
        const { elements, report } = parseDXFWithReport(dxf);
        expect(report.unitScale).toBe(1);
        expect(elements[0].start).toEqual({ x: 10, y: -20 });
    });

    it("缺少 $INSUNITS 时按 1:1 并在报告中标注", () => {
        const dxf = dxfWith([], lineEntity(5, 6, 7, 8));
        const { elements, report } = parseDXFWithReport(dxf);
        expect(report.insunits).toBeNull();
        expect(report.unitScale).toBe(1);
        expect(elements[0].start).toEqual({ x: 5, y: -6 });
    });

    it("无法识别的 $INSUNITS 代码按 1:1 处理", () => {
        const dxf = dxfWith(
            ["9", "$INSUNITS", "70", "99"],
            lineEntity(5, 6, 7, 8),
        );
        const { elements, report } = parseDXFWithReport(dxf);
        expect(report.unitScale).toBe(1);
        expect(elements[0].start).toEqual({ x: 5, y: -6 });
    });

    it("圆半径随单位一起换算", () => {
        const dxf = dxfWith(
            ["9", "$INSUNITS", "70", "1"],
            ["0", "CIRCLE", "8", "0", "10", "0", "20", "0", "40", "2"],
        );
        const { elements } = parseDXFWithReport(dxf);
        expect(elements[0].type).toBe("CIRCLE");
        expect(elements[0].radius).toBeCloseTo(50.8, 6);
    });

    it("parseDXF 兼容旧签名（只返回图元）", () => {
        const dxf = dxfWith(
            ["9", "$INSUNITS", "70", "1"],
            lineEntity(1, 0, 1, 0),
        );
        const elements = parseDXF(dxf);
        expect(elements).toHaveLength(1);
        expect(elements[0].start).toEqual({ x: 25.4, y: 0 });
    });
});

describe("DXF 导入报告", () => {
    it("不支持的实体按类型汇总，不影响受支持实体", () => {
        const dxf = dxfWith(
            [],
            [
                ...lineEntity(0, 0, 10, 0),
                "0", "SPLINE", "8", "0", "10", "0", "20", "0",
                "0", "HATCH", "8", "0",
                "0", "SPLINE", "8", "0", "10", "1", "20", "1",
            ],
        );
        const { elements, report } = parseDXFWithReport(dxf);
        expect(elements).toHaveLength(1);
        expect(report.imported).toBe(1);
        expect(report.unsupported).toEqual([
            { type: "SPLINE", count: 2 },
            { type: "HATCH", count: 1 },
        ]);
        expect(report.dropped).toBe(0);
        expect(report.entityLimitHit).toBe(false);
    });

    it("结构性命名不算作不支持的实体", () => {
        const dxf = [
            "0", "SECTION", "2", "ENTITIES",
            ...lineEntity(0, 0, 5, 5),
            "0", "ENDSEC",
            "0", "EOF",
        ].join("\n");
        const { report } = parseDXFWithReport(dxf);
        expect(report.unsupported).toEqual([]);
        expect(report.supportedEntities).toBe(1);
    });
});

describe("DXF 导出单位与报告", () => {
    it("默认按 mm 导出，$INSUNITS = 4", () => {
        const { dxf, report } = exportToDXFWithReport([
            makeElement({ type: "LINE", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }),
        ]);
        expect(dxf).toContain("9\n$INSUNITS\n70\n4\n");
        expect(dxf).toContain("11\n100\n21\n0\n");
        expect(report.units).toBe("mm");
        expect(report.exported).toBe(1);
        expect(report.skipped).toEqual([]);
    });

    it("按英寸导出：坐标除以 25.4 且 $INSUNITS = 1", () => {
        const { dxf, report } = exportToDXFWithReport(
            [makeElement({ type: "LINE", start: { x: 0, y: 0 }, end: { x: 25.4, y: 0 } })],
            { units: "in" },
        );
        expect(dxf).toContain("9\n$INSUNITS\n70\n1\n");
        expect(dxf).toContain("11\n1\n21\n0\n");
        expect(report.units).toBe("in");
    });

    it("圆半径随单位换算", () => {
        const { dxf } = exportToDXFWithReport(
            [makeElement({ type: "CIRCLE", center: { x: 0, y: 0 }, radius: 50.8 })],
            { units: "in" },
        );
        expect(dxf).toContain("40\n2\n");
    });

    it("DIMENSION 不导出并计入 skipped 报告", () => {
        const { dxf, report } = exportToDXFWithReport([
            makeElement({ type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }),
            makeElement({
                type: "DIMENSION",
                start: { x: 0, y: 0 },
                end: { x: 10, y: 0 },
                offsetPoint: { x: 5, y: -5 },
            }),
            makeElement({
                type: "DIMENSION",
                start: { x: 0, y: 0 },
                end: { x: 20, y: 0 },
                offsetPoint: { x: 10, y: -5 },
            }),
        ]);
        expect(report.exported).toBe(1);
        expect(report.skipped).toEqual([{ type: "DIMENSION", count: 2 }]);
        expect(dxf).not.toContain("0\nDIMENSION");
    });

    it("HATCH 导出为边界多段线", () => {
        const { dxf, report } = exportToDXFWithReport([
            makeElement({
                type: "HATCH",
                hatchPattern: { type: "SOLID" } as CADElement["hatchPattern"],
                points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                ],
            }),
        ]);
        expect(report.exported).toBe(1);
        expect(report.skipped).toEqual([]);
        expect(dxf).toContain("0\nLWPOLYLINE");
        expect(dxf).toContain("70\n1\n"); // 闭合标志
    });

    it("exportToDXF 兼容旧签名（只返回文本）", () => {
        const dxf = exportToDXF([
            makeElement({ type: "LINE", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }),
        ]);
        expect(dxf).toContain("9\n$INSUNITS\n70\n4\n");
    });
});

describe("DXF 单位往返", () => {
    it("按英寸导出后再导入，几何回到 mm 数值", () => {
        const source = makeElement({
            type: "LINE",
            start: { x: 0, y: 0 },
            end: { x: 25.4, y: 0 },
        });
        const dxf = exportToDXF([source], { units: "in" });
        const parsed = parseDXF(dxf);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].start).toEqual({ x: 0, y: 0 });
        expect(parsed[0].end).toEqual({ x: 25.4, y: 0 });
    });

    it("按米导出后再导入，几何回到 mm 数值", () => {
        const source = makeElement({
            type: "CIRCLE",
            center: { x: 1000, y: 2000 },
            radius: 500,
        });
        const dxf = exportToDXF([source], { units: "m" });
        const parsed = parseDXF(dxf);
        expect(parsed[0].type).toBe("CIRCLE");
        // Y 取反后导出、导入时再取反，屏幕坐标语义保持往返一致
        expect(parsed[0].center).toEqual({ x: 1000, y: 2000 });
        expect(parsed[0].radius).toBeCloseTo(500, 3);
    });
});
