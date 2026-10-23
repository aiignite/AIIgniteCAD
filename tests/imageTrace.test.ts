import { describe, expect, it } from "vitest";
import { simplifyPath, traceImage, type TraceImageData } from "../lib/imageTrace";

const imageFromGrid = (grid: string[]): TraceImageData => {
    const height = grid.length;
    const width = grid[0]?.length ?? 0;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const dark = grid[y][x] === "#";
            const value = dark ? 0 : 255;
            data[index] = value;
            data[index + 1] = value;
            data[index + 2] = value;
            data[index + 3] = 255;
        }
    }
    return { width, height, data };
};

const square = imageFromGrid([
    "..........",
    "..........",
    "..######..",
    "..######..",
    "..######..",
    "..######..",
    "..######..",
    "..........",
    "..........",
    "..........",
]);

const baseOptions = {
    threshold: 128,
    invert: false,
    simplifyTolerance: 0,
    targetWidth: 100,
    minLength: 1,
};

describe("traceImage", () => {
    it("把实心方块追踪为闭合多段线并换算到目标宽度", () => {
        const result = traceImage(square, baseOptions);
        expect(result.contourCount).toBe(1);
        expect(result.elements).toHaveLength(1);
        const element = result.elements[0];
        expect(element.type).toBe("LWPOLYLINE");
        expect(element.closed).toBe(true);
        expect(element.layer).toBe("TRACE");
        expect(result.scale).toBe(10);
        for (const point of element.points ?? []) {
            expect(point.x).toBeGreaterThanOrEqual(10);
            expect(point.x).toBeLessThanOrEqual(90);
            expect(point.y).toBeGreaterThanOrEqual(10);
            expect(point.y).toBeLessThanOrEqual(90);
        }
    });

    it("支持偏移与反色识别", () => {
        const inverted = imageFromGrid([
            "#########",
            "#########",
            "##.....##",
            "##.....##",
            "##.....##",
            "#########",
        ]);
        const result = traceImage(inverted, {
            ...baseOptions,
            invert: true,
            offset: { x: 50, y: 20 },
        });
        expect(result.elements).toHaveLength(1);
        const xs = (result.elements[0].points ?? []).map((point) => point.x);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(50);
    });

    it("空白图返回空结果", () => {
        const blank = imageFromGrid([".....", ".....", "....."]);
        expect(traceImage(blank, baseOptions)).toMatchObject({
            elements: [],
            contourCount: 0,
        });
    });

    it("多个分离图形产生多条轮廓，短轮廓可被过滤", () => {
        const two = imageFromGrid(["............", ".##......##.", ".##......##.", "............"]);
        expect(traceImage(two, baseOptions).elements).toHaveLength(2);
        expect(traceImage(two, { ...baseOptions, minLength: 100 }).elements).toHaveLength(0);
    });

    it("简化容差减少节点但保留闭合轮廓", () => {
        const raw = traceImage(square, { ...baseOptions, simplifyTolerance: 0 });
        const simplified = traceImage(square, { ...baseOptions, simplifyTolerance: 1.2 });
        expect(simplified.elements[0].closed).toBe(true);
        expect((simplified.elements[0].points ?? []).length).toBeLessThan(
            (raw.elements[0].points ?? []).length,
        );
    });
});

describe("simplifyPath", () => {
    it("保留首尾并移除共线中间点", () => {
        const points = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
        ];
        expect(simplifyPath(points, 0.5)).toEqual([
            { x: 0, y: 0 },
            { x: 3, y: 0 },
        ]);
        expect(simplifyPath(points, 0)).toBe(points);
    });
});
