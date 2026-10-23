/**
 * dxf.test.ts — services/dxfService.ts 单元测试
 * 覆盖 DXF 导出结构、Y 轴翻转、颜色/图层表、闭合多段线、椭圆与外部 DXF 导入。
 */

import { describe, it, expect } from "vitest";
import { exportToDXF, parseDXF } from "../services/dxfService";
import { CADElement } from "../types";

let seq = 0;

const makeElement = (partial: Partial<CADElement> & Pick<CADElement, "type">): CADElement => ({
    id: `dxf-${++seq}`,
    layer: "0",
    color: "#ffffff",
    ...partial,
});

/** 从 DXF 中截取指定实体的片段，便于精确断言（按组码行定位，避免把值为 0 的行当成分隔符） */
const entityBlock = (dxf: string, type: string): string => {
    const lines = dxf.split("\n");
    const start = lines.findIndex(
        (line, index) => index % 2 === 0 && line === "0" && lines[index + 1] === type,
    );
    if (start < 0) return "";
    let end = lines.length;
    for (let i = start + 2; i < lines.length; i += 2) {
        if (lines[i] === "0") {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join("\n") + "\n";
};

describe("DXF 导出", () => {
    it("为空图纸提供默认范围，写入单位并正确闭合文件", () => {
        const dxf = exportToDXF([]);
        expect(dxf).toContain("9\n$INSUNITS\n70\n4\n");
        expect(dxf).toContain("9\n$EXTMIN\n10\n0\n20\n0\n30\n0\n");
        expect(dxf).toContain("9\n$EXTMAX\n10\n100\n20\n100\n30\n0\n");
        expect(dxf.endsWith("0\nENDSEC\n0\nEOF")).toBe(true);
    });

    it("导出 LINE 时翻转 Y 轴并计算 DXF 范围", () => {
        const dxf = exportToDXF([
            makeElement({
                type: "LINE",
                layer: "WALLS",
                start: { x: 0, y: 0 },
                end: { x: 100, y: 50 },
            }),
        ]);

        const block = entityBlock(dxf, "LINE");
        expect(block).toContain("8\nWALLS");
        expect(block).toContain("10\n0\n20\n0\n11\n100\n21\n-50\n");
        // 屏幕 y 0..50 → DXF y -50..0，再各加 10 留白
        expect(dxf).toContain("9\n$EXTMIN\n10\n-10\n20\n-60\n30\n0\n");
        expect(dxf).toContain("9\n$EXTMAX\n10\n110\n20\n10\n30\n0\n");
    });

    it("导出 CIRCLE、TEXT、LWPOLYLINE 与 ARC 的专有字段", () => {
        const dxf = exportToDXF([
            makeElement({ type: "CIRCLE", layer: "C", center: { x: 50, y: 50 }, radius: 25 }),
            makeElement({
                type: "TEXT",
                layer: "T",
                start: { x: 1, y: 2 },
                text: "HELLO",
                fontSize: 18,
            }),
            makeElement({
                type: "LWPOLYLINE",
                layer: "P",
                points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 10 },
                ],
            }),
            makeElement({
                type: "ARC",
                layer: "A",
                center: { x: 5, y: 5 },
                radius: 10,
                startAngle: 30,
                endAngle: 120,
            }),
        ]);

        expect(entityBlock(dxf, "CIRCLE")).toContain("10\n50\n20\n-50\n40\n25\n");
        expect(entityBlock(dxf, "TEXT")).toContain("10\n1\n20\n-2\n30\n0\n40\n18\n1\nHELLO\n");
        expect(entityBlock(dxf, "LWPOLYLINE")).toContain(
            "90\n2\n70\n0\n10\n0\n20\n0\n10\n10\n20\n-10\n",
        );
        // 屏幕上逆时针圆弧（30°→120°）在 DXF 中为 330°→240°
        expect(entityBlock(dxf, "ARC")).toContain(
            "10\n5\n20\n-5\n40\n10\n50\n330\n51\n240\n",
        );
    });

    it("矩形按闭合 LWPOLYLINE 导出，不重复闭合点", () => {
        const dxf = exportToDXF([
            makeElement({
                type: "RECTANGLE",
                layer: "R",
                start: { x: 100, y: 100 },
                width: -40,
                height: -20,
            }),
        ]);

        const block = entityBlock(dxf, "LWPOLYLINE");
        expect(block).toContain("90\n4\n70\n1\n");
        expect(block).toContain("10\n60\n20\n-80\n");
        expect(block).toContain("10\n100\n20\n-80\n");
        expect(block).toContain("10\n100\n20\n-100\n");
        expect(block).toContain("10\n60\n20\n-100\n");
    });

    it("闭合 LWPOLYLINE 写入 70=1 并去掉重复末点", () => {
        const dxf = exportToDXF([
            makeElement({
                type: "LWPOLYLINE",
                points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 0 },
                ],
                closed: true,
            }),
        ]);

        const block = entityBlock(dxf, "LWPOLYLINE");
        expect(block).toContain("90\n3\n70\n1\n");
        const xCodeCount = block
            .split("\n")
            .filter((line, index) => index % 2 === 0 && line === "10").length;
        expect(xCodeCount).toBe(3);
    });

    it("写入 true color 与 ACI 兼容色号", () => {
        const dxf = exportToDXF([
            makeElement({
                type: "LINE",
                color: "#ff0000",
                start: { x: 0, y: 0 },
                end: { x: 10, y: 0 },
            }),
        ]);

        expect(entityBlock(dxf, "LINE")).toContain("62\n1\n420\n16711680\n");
    });

    it("生成 LAYER 与 LTYPE 表", () => {
        const dxf = exportToDXF([
            makeElement({
                type: "LINE",
                layer: "WALLS",
                color: "#00ff00",
                start: { x: 0, y: 0 },
                end: { x: 1, y: 1 },
            }),
        ]);

        expect(dxf).toContain("0\nTABLE\n2\nLTYPE\n70\n4\n");
        expect(dxf).toContain("0\nLTYPE\n2\nCONTINUOUS\n");
        expect(dxf).toContain("0\nTABLE\n2\nLAYER\n70\n2\n");
        expect(dxf).toContain("0\nLAYER\n2\nWALLS\n70\n0\n62\n3\n420\n65280\n6\nCONTINUOUS\n");
    });

    it("导出 ELLIPSE 为原生椭圆实体", () => {
        const dxf = exportToDXF([
            makeElement({
                type: "ELLIPSE",
                center: { x: 10, y: 20 },
                radiusX: 20,
                radiusY: 10,
                rotation: 0,
            }),
        ]);

        const block = entityBlock(dxf, "ELLIPSE");
        expect(block).toContain("10\n10\n20\n-20\n30\n0\n");
        expect(block).toContain("11\n20\n21\n0\n31\n0\n");
        expect(block).toContain("40\n0.5\n41\n0\n42\n6.283185\n");
    });

    it("高级曲线（GEAR）按闭合多段线导出", () => {
        const dxf = exportToDXF([
            makeElement({
                type: "GEAR",
                points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 5, y: 8 },
                ],
            }),
        ]);

        const block = entityBlock(dxf, "LWPOLYLINE");
        expect(block).toContain("90\n3\n70\n1\n");
    });
});

describe("DXF 导入", () => {
    const externalDxf = (entities: string[], tables = ""): string =>
        [
            "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
            ...(tables
                ? ["0", "SECTION", "2", "TABLES", ...tables.split(/\r?\n/), "0", "ENDSEC"]
                : []),
            "0", "SECTION", "2", "ENTITIES",
            ...entities,
            "0", "ENDSEC", "0", "EOF",
        ].join("\n");

    it("空内容解析为空数组", () => {
        expect(parseDXF("")).toEqual([]);
    });

    it("导入时翻转 Y 轴并保留图层", () => {
        const dxf = externalDxf([
            "0", "LINE", "8", "WALLS", "10", "0", "20", "0", "11", "100", "21", "50",
        ]);

        const parsed = parseDXF(dxf);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].type).toBe("LINE");
        expect(parsed[0].layer).toBe("WALLS");
        expect(parsed[0].start).toEqual({ x: 0, y: 0 });
        expect(parsed[0].end).toEqual({ x: 100, y: -50 });
    });

    it("读取闭合标志并丢弃重复末点", () => {
        const dxf = externalDxf([
            "0", "LWPOLYLINE", "8", "0", "90", "4", "70", "1",
            "10", "0", "20", "0",
            "10", "10", "20", "0",
            "10", "10", "20", "10",
            "10", "0", "20", "0",
        ]);

        const parsed = parseDXF(dxf);
        expect(parsed[0].type).toBe("LWPOLYLINE");
        expect(parsed[0].closed).toBe(true);
        expect(parsed[0].points).toHaveLength(3);
        expect(parsed[0].points).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: -10 },
        ]);
    });

    it("合并旧式 POLYLINE + VERTEX 序列", () => {
        const dxf = externalDxf([
            "0", "POLYLINE", "8", "WALLS", "70", "1",
            "0", "VERTEX", "8", "WALLS", "10", "0", "20", "0",
            "0", "VERTEX", "8", "WALLS", "10", "10", "20", "0",
            "0", "VERTEX", "8", "WALLS", "10", "10", "20", "10",
            "0", "SEQEND",
        ]);

        const parsed = parseDXF(dxf);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].type).toBe("LWPOLYLINE");
        expect(parsed[0].closed).toBe(true);
        expect(parsed[0].points).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: -10 },
        ]);
    });

    it("把多段线 bulge 采样成圆弧折线", () => {
        const dxf = externalDxf([
            "0", "LWPOLYLINE", "8", "0", "90", "2", "70", "0",
            "10", "0", "20", "0", "42", "1",
            "10", "10", "20", "0",
        ]);

        const parsed = parseDXF(dxf);
        expect(parsed[0].type).toBe("LWPOLYLINE");
        expect(parsed[0].points.length).toBeGreaterThan(2);
        expect(
            parsed[0].points.some(
                (point) => Math.abs(point.x - 5) < 1e-6 && Math.abs(point.y - 5) < 1e-6,
            ),
        ).toBe(true);
    });

    it("导入 ARC 时将角度映射到屏幕坐标", () => {
        const dxf = externalDxf([
            "0", "ARC", "8", "0", "10", "0", "20", "0", "40", "10", "50", "0", "51", "90",
        ]);

        const parsed = parseDXF(dxf);
        expect(parsed[0].type).toBe("ARC");
        expect(parsed[0].center).toEqual({ x: 0, y: 0 });
        expect(parsed[0].startAngle).toBe(0);
        expect(parsed[0].endAngle).toBe(270);
        expect(parsed[0].clockwise).toBe(false);
    });

    it("导入 ELLIPSE 并生成可渲染采样点", () => {
        const dxf = externalDxf([
            "0", "ELLIPSE", "8", "0",
            "10", "10", "20", "20", "30", "0",
            "11", "20", "21", "0", "31", "0",
            "40", "0.5", "41", "0", "42", "6.283185",
        ]);

        const parsed = parseDXF(dxf);
        expect(parsed[0].type).toBe("ELLIPSE");
        expect(parsed[0].center).toEqual({ x: 10, y: -20 });
        expect(parsed[0].radiusX).toBe(20);
        expect(parsed[0].radiusY).toBe(10);
        expect(parsed[0].points).toHaveLength(65);
    });

    it("实体 true color 优先于图层颜色", () => {
        const tables = [
            "0", "TABLE", "2", "LAYER", "70", "1",
            "0", "LAYER", "2", "WALLS", "70", "0", "62", "3", "6", "CONTINUOUS",
            "0", "ENDTAB",
        ].join("\n");

        const dxf = externalDxf([
            "0", "LINE", "8", "WALLS", "62", "1", "420", "255",
            "10", "0", "20", "0", "11", "10", "21", "0",
        ], tables);

        expect(parseDXF(dxf)[0].color).toBe("#0000ff");
    });

    it("未指定实体颜色时使用图层表颜色", () => {
        const tables = [
            "0", "TABLE", "2", "LAYER", "70", "1",
            "0", "LAYER", "2", "WALLS", "70", "0", "62", "3", "6", "CONTINUOUS",
            "0", "ENDTAB",
        ].join("\n");

        const dxf = externalDxf([
            "0", "LINE", "8", "WALLS", "10", "0", "20", "0", "11", "10", "21", "0",
        ], tables);

        expect(parseDXF(dxf)[0].color).toBe("#00ff00");
    });

    it("忽略不支持或位于 ENTITIES 之外的实体", () => {
        const dxf = externalDxf([
            "0", "SPLINE", "8", "CURVES", "10", "1", "20", "1",
            "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "10", "21", "0",
        ]);

        const parsed = parseDXF(dxf);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].type).toBe("LINE");
    });

    it("展开 INSERT：应用基点、缩放、旋转与图层继承", () => {
        const dxf = [
            "0", "SECTION", "2", "BLOCKS",
            "0", "BLOCK", "8", "0", "2", "BOX", "70", "0", "10", "0", "20", "0", "3", "BOX",
            "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "10", "21", "0",
            "0", "ENDBLK",
            "0", "ENDSEC",
            "0", "SECTION", "2", "ENTITIES",
            "0", "INSERT", "8", "WALLS", "2", "BOX",
            "10", "100", "20", "50", "41", "2", "42", "2", "50", "90",
            "0", "ENDSEC", "0", "EOF",
        ].join("\n");

        const parsed = parseDXF(dxf);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].type).toBe("LINE");
        expect(parsed[0].layer).toBe("WALLS");
        expect(parsed[0].start).toEqual({ x: 100, y: -50 });
        expect(parsed[0].end?.x).toBeCloseTo(100, 5);
        expect(parsed[0].end?.y).toBeCloseTo(-70, 5);
    });

    it("展开嵌套 INSERT 并处理块基点", () => {
        const dxf = [
            "0", "SECTION", "2", "BLOCKS",
            "0", "BLOCK", "2", "INNER", "10", "5", "20", "5",
            "0", "CIRCLE", "8", "0", "10", "5", "20", "5", "40", "2",
            "0", "ENDBLK",
            "0", "BLOCK", "2", "OUTER", "10", "0", "20", "0",
            "0", "INSERT", "8", "0", "2", "INNER", "10", "0", "20", "0",
            "0", "ENDBLK",
            "0", "ENDSEC",
            "0", "SECTION", "2", "ENTITIES",
            "0", "INSERT", "8", "MECH", "2", "OUTER", "10", "10", "20", "20",
            "0", "ENDSEC", "0", "EOF",
        ].join("\n");

        const parsed = parseDXF(dxf);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].type).toBe("CIRCLE");
        expect(parsed[0].layer).toBe("MECH");
        expect(parsed[0].center).toEqual({ x: 10, y: -20 });
        expect(parsed[0].radius).toBe(2);
    });

    it("解码 TEXT 的 Unicode 转义", () => {
        const dxf = externalDxf([
            "0", "TEXT", "8", "0", "10", "0", "20", "0", "40", "5", "1", "\\U+4E2D\\U+6587",
        ]);

        expect(parseDXF(dxf)[0].text).toBe("中文");
    });

    it("把 MTEXT 转成 TEXT 并去掉内联格式码", () => {
        const dxf = externalDxf([
            "0", "MTEXT", "8", "TEXT", "10", "10", "20", "20", "40", "5", "50", "30",
            "1", "{\\fArial|b0|i0|c0;Hello}", "3", "\\PWorld",
        ]);

        const parsed = parseDXF(dxf);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].type).toBe("TEXT");
        expect(parsed[0].text).toBe("Hello World");
        expect(parsed[0].fontSize).toBe(5);
        expect(parsed[0].start).toEqual({ x: 10, y: -20 });
        expect(parsed[0].rotation).toBe(30);
    });

    it("DIMENSION 优先展开匿名块，缺失时退化为标注图元", () => {
        const withBlock = [
            "0", "SECTION", "2", "BLOCKS",
            "0", "BLOCK", "2", "*D1", "10", "0", "20", "0",
            "0", "LINE", "8", "DIM", "10", "0", "20", "0", "11", "10", "21", "0",
            "0", "ENDBLK",
            "0", "ENDSEC",
            "0", "SECTION", "2", "ENTITIES",
            "0", "DIMENSION", "8", "DIM", "2", "*D1",
            "10", "0", "20", "0", "11", "5", "21", "2", "13", "0", "23", "0", "14", "10", "24", "0",
            "0", "ENDSEC", "0", "EOF",
        ].join("\n");

        const expanded = parseDXF(withBlock);
        expect(expanded).toHaveLength(1);
        expect(expanded[0].type).toBe("LINE");

        const fallback = externalDxf([
            "0", "DIMENSION", "8", "DIM",
            "10", "0", "20", "0", "11", "5", "21", "2", "13", "0", "23", "0", "14", "10", "24", "0",
        ]);
        const parsed = parseDXF(fallback);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].type).toBe("DIMENSION");
        expect(parsed[0].start).toEqual({ x: 0, y: 0 });
        expect(parsed[0].end).toEqual({ x: 10, y: 0 });
        expect(parsed[0].offsetPoint).toEqual({ x: 5, y: -2 });
    });
});

describe("DXF 往返", () => {
    it("导出后再导入保持 LINE、CIRCLE、闭合多段线与椭圆的几何", () => {
        const source: CADElement[] = [
            makeElement({
                type: "LINE",
                layer: "WALLS",
                start: { x: 0, y: 0 },
                end: { x: 100, y: 50 },
            }),
            makeElement({ type: "CIRCLE", layer: "C", center: { x: 50, y: 60 }, radius: 25 }),
            makeElement({
                type: "LWPOLYLINE",
                layer: "P",
                closed: true,
                points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                ],
            }),
            makeElement({
                type: "ELLIPSE",
                center: { x: 10, y: 20 },
                radiusX: 20,
                radiusY: 10,
                rotation: 30,
                points: [],
            }),
        ];

        const parsed = parseDXF(exportToDXF(source));
        expect(parsed).toHaveLength(4);

        const line = parsed.find(el => el.type === "LINE")!;
        expect(line.start).toEqual({ x: 0, y: 0 });
        expect(line.end).toEqual({ x: 100, y: 50 });

        const circle = parsed.find(el => el.type === "CIRCLE")!;
        expect(circle.center).toEqual({ x: 50, y: 60 });
        expect(circle.radius).toBe(25);

        const polyline = parsed.find(el => el.type === "LWPOLYLINE")!;
        expect(polyline.closed).toBe(true);
        expect(polyline.points).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
        ]);

        const ellipse = parsed.find(el => el.type === "ELLIPSE")!;
        expect(ellipse.center).toEqual({ x: 10, y: 20 });
        expect(ellipse.radiusX).toBeCloseTo(20, 5);
        expect(ellipse.radiusY).toBeCloseTo(10, 5);
        expect(ellipse.rotation).toBeCloseTo(30, 5);
    });

    it("导出后再导入保持文字旋转", () => {
        const source = makeElement({
            type: "TEXT",
            start: { x: 10, y: 20 },
            text: "TILT",
            fontSize: 8,
            rotation: 30,
        });

        const parsed = parseDXF(exportToDXF([source]));
        expect(parsed[0].type).toBe("TEXT");
        expect(parsed[0].text).toBe("TILT");
        expect(parsed[0].rotation).toBeCloseTo(30, 5);
    });

    it("导出后再导入保持圆弧的起止角度与方向", () => {
        const source = makeElement({
            type: "ARC",
            center: { x: 5, y: 5 },
            radius: 10,
            startAngle: 30,
            endAngle: 120,
        });

        const parsed = parseDXF(exportToDXF([source]));
        expect(parsed[0].type).toBe("ARC");
        expect(parsed[0].center).toEqual({ x: 5, y: 5 });
        expect(parsed[0].startAngle).toBeCloseTo(30, 5);
        expect(parsed[0].endAngle).toBeCloseTo(120, 5);
        expect(parsed[0].clockwise).toBe(false);
    });
});
