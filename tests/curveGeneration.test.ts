/**
 * curveGeneration.test.ts — services/curveGenerationService.ts 单元测试
 * 由原 services/curveGenerationTests.ts 的手工控制台用例迁移而来，
 * 覆写为断言式测试，验证曲线算法的数学正确性与数据校验逻辑。
 */

import { describe, it, expect } from "vitest";
import {
    generateSineWave,
    generateCosineWave,
    generateSpiral,
    generateLogarithmicSpiral,
    generateQuadraticBezier,
    generateCubicBezier,
    generateArc,
    validateCurve,
    createCurveElement,
} from "../services/curveGenerationService";
import { Point } from "../types";

/** 断言点坐标（生成算法保留 1 位小数） */
const expectPoint = (actual: Point, x: number, y: number, digits = 1) => {
    expect(actual.x).toBeCloseTo(x, digits);
    expect(actual.y).toBeCloseTo(y, digits);
};

describe("正弦波与余弦波", () => {
    it("正弦波采样点数、起点与振幅范围正确", () => {
        const points = generateSineWave({
            startX: 50,
            endX: 750,
            centerY: 300,
            amplitude: 100,
            wavelength: 400,
            pointCount: 60,
        });

        expect(points).toHaveLength(61);
        expectPoint(points[0], 50, 300);
        // 结束位置恰好走过 700/400 = 1.75 个周期
        expectPoint(points[60], 750, 300 + 100 * Math.sin(2 * Math.PI * 1.75));

        const ys = points.map(p => p.y);
        expect(Math.max(...ys)).toBeLessThanOrEqual(400);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(200);
    });

    it("余弦波在起点处于峰值，并支持相位偏移", () => {
        const points = generateCosineWave({
            startX: 0,
            endX: 400,
            centerY: 0,
            amplitude: 50,
            wavelength: 400,
            pointCount: 16,
        });

        expectPoint(points[0], 0, 50);
        expectPoint(points[16], 400, 50);

        const shifted = generateCosineWave({
            startX: 0,
            endX: 400,
            centerY: 0,
            amplitude: 50,
            wavelength: 400,
            pointCount: 4,
            phaseShift: Math.PI,
        });
        expectPoint(shifted[0], 0, -50);
    });
});

describe("螺旋与贝塞尔曲线", () => {
    it("阿基米德螺旋从起始半径展开到结束半径", () => {
        const points = generateSpiral({
            centerX: 400,
            centerY: 300,
            startRadius: 20,
            endRadius: 200,
            turns: 3,
            pointCount: 100,
        });

        expect(points).toHaveLength(101);
        expectPoint(points[0], 420, 300);
        // 3 个完整周期后回到 X 轴正向
        expectPoint(points[100], 600, 300);
    });

    it("对数螺旋半径按 e^(bθ) 增长", () => {
        const a = 10;
        const b = 0.2;
        const maxAngle = 4 * Math.PI;
        const points = generateLogarithmicSpiral(0, 0, a, b, maxAngle, 100);

        expect(points).toHaveLength(101);
        expectPoint(points[0], a, 0);
        // 终点角度为 4π，方向回到 X 轴正向
        expectPoint(points[100], a * Math.exp(b * maxAngle), 0);
    });

    it("二次贝塞尔曲线起终点与中点符合公式", () => {
        const p0: Point = { x: 100, y: 300 };
        const p1: Point = { x: 400, y: 100 };
        const p2: Point = { x: 700, y: 300 };
        const points = generateQuadraticBezier(p0, p1, p2, 50);

        expect(points).toHaveLength(51);
        expectPoint(points[0], 100, 300);
        expectPoint(points[50], 700, 300);
        // t = 0.5 时权重为 0.25 / 0.5 / 0.25
        expectPoint(points[25], 0.25 * 100 + 0.5 * 400 + 0.25 * 700, 0.25 * 300 + 0.5 * 100 + 0.25 * 300);
    });

    it("三次贝塞尔曲线起终点与中点符合公式", () => {
        const p0: Point = { x: 100, y: 350 };
        const p1: Point = { x: 200, y: 100 };
        const p2: Point = { x: 600, y: 100 };
        const p3: Point = { x: 700, y: 350 };
        const points = generateCubicBezier(p0, p1, p2, p3, 60);

        expect(points).toHaveLength(61);
        expectPoint(points[0], 100, 350);
        expectPoint(points[60], 700, 350);
        // t = 0.5：权重 1/8, 3/8, 3/8, 1/8
        expectPoint(points[30], (100 + 3 * 200 + 3 * 600 + 700) / 8, (350 + 3 * 100 + 3 * 100 + 350) / 8);
    });

    it("圆弧按角度参数方程采样", () => {
        const quarter = generateArc(400, 300, 100, 0, 90, 10);
        expect(quarter).toHaveLength(11);
        expectPoint(quarter[0], 500, 300);
        expectPoint(quarter[10], 400, 400);

        const full = generateArc(400, 300, 100, 0, 360, 100);
        expectPoint(full[0], 500, 300);
        // 整圆首尾点重合
        expectPoint(full[100], 500, 300);
    });
});

describe("曲线校验与元素创建", () => {
    it("有效曲线返回 valid", () => {
        const result = validateCurve([
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 20, y: 5 },
        ]);
        expect(result).toEqual({ valid: true, issues: [] });
    });

    it("识别点数不足、竖线、横线与非单调 X", () => {
        expect(validateCurve([{ x: 0, y: 0 }]).issues).toContain("曲线点数少于2个");

        expect(
            validateCurve([
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 10, y: 20 },
            ]).issues
        ).toContain("X轴范围为0 - 曲线是竖线");

        expect(
            validateCurve([
                { x: 0, y: 5 },
                { x: 10, y: 5 },
            ]).issues
        ).toContain("Y轴范围为0 - 曲线是横线");

        expect(
            validateCurve([
                { x: 0, y: 0 },
                { x: 20, y: 10 },
                { x: 10, y: 20 },
            ]).issues
        ).toContain("X坐标不是单调递增的");
    });

    it("识别 NaN 或 Infinity 坐标", () => {
        const result = validateCurve([
            { x: 0, y: 0 },
            { x: 10, y: NaN },
            { x: 20, y: 20 },
        ]);
        expect(result.valid).toBe(false);
        expect(result.issues).toContain("曲线包含无效坐标 (NaN 或 Infinity)");
    });

    it("创建 LWPOLYLINE 曲线元素并使用默认样式", () => {
        const points = [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
        ];

        const element = createCurveElement(points);
        expect(element.type).toBe("LWPOLYLINE");
        expect(element.layer).toBe("AI_GENERATED");
        expect(element.color).toBe("#137fec");
        expect(element.points).toEqual(points);
        expect(element.id).toBeTruthy();

        const custom = createCurveElement(points, "curve-1", "TEST", "#0000FF");
        expect(custom.id).toBe("curve-1");
        expect(custom.layer).toBe("TEST");
        expect(custom.color).toBe("#0000FF");
    });
});
