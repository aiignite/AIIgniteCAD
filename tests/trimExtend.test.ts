/**
 * trimExtend.test.ts — lib/trimExtend.ts 纯函数测试
 *
 * 覆盖快速修剪（线/弧/圆/多段线）与延伸（线/弧/多段线）的
 * 交点分段、点击侧判定与退化情形。
 */

import { describe, expect, it } from "vitest";
import type { CADElement, Point } from "../types";
import { trimElementAt, extendElementAt } from "../lib/trimExtend";

const line = (id: string, start: Point, end: Point): CADElement => ({
    id,
    type: "LINE",
    layer: "0",
    color: "#fff",
    start,
    end,
});

const circle = (id: string, center: Point, radius: number): CADElement => ({
    id,
    type: "CIRCLE",
    layer: "0",
    color: "#fff",
    center,
    radius,
});

const arc = (
    id: string,
    center: Point,
    radius: number,
    startAngle: number,
    endAngle: number,
): CADElement => ({
    id,
    type: "ARC",
    layer: "0",
    color: "#fff",
    center,
    radius,
    startAngle,
    endAngle,
    // 与 ArcTool 三点弧一致：从 start 角增大扫到 end 角
    clockwise: true,
});

const polyline = (id: string, points: Point[], closed = false): CADElement => ({
    id,
    type: "LWPOLYLINE",
    layer: "0",
    color: "#fff",
    points,
    closed,
});

let seq = 0;
const newId = (): string => `n${++seq}`;

describe("trimElementAt: LINE", () => {
    it("横线被竖线剪断：点击右侧剪掉右段", () => {
        const target = line("t", { x: 0, y: 0 }, { x: 100, y: 0 });
        const cutter = line("c", { x: 50, y: -20 }, { x: 50, y: 20 });

        const outcome = trimElementAt(target, { x: 80, y: 0 }, [cutter], newId);

        expect(outcome).not.toBeNull();
        expect(outcome!.replacements).toHaveLength(1);
        const kept = outcome!.replacements[0];
        expect(kept.id).toBe("t");
        expect(kept.start).toEqual({ x: 0, y: 0 });
        expect(kept.end!.x).toBeCloseTo(50, 6);
    });

    it("两条竖线剪出中间段：点击中间剪出两条", () => {
        const target = line("t", { x: 0, y: 0 }, { x: 100, y: 0 });
        const left = line("c1", { x: 30, y: -20 }, { x: 30, y: 20 });
        const right = line("c2", { x: 70, y: -20 }, { x: 70, y: 20 });

        const outcome = trimElementAt(target, { x: 50, y: 0 }, [left, right], newId);

        expect(outcome!.replacements).toHaveLength(2);
        expect(outcome!.replacements[0].id).toBe("t");
        expect(outcome!.replacements[0].start).toEqual({ x: 0, y: 0 });
        expect(outcome!.replacements[0].end!.x).toBeCloseTo(30, 6);
        expect(outcome!.replacements[1].id).toBe("n1");
        expect(outcome!.replacements[1].start!.x).toBeCloseTo(70, 6);
        expect(outcome!.replacements[1].end).toEqual({ x: 100, y: 0 });
    });

    it("剪掉首段时保留尾部", () => {
        const target = line("t", { x: 0, y: 0 }, { x: 100, y: 0 });
        const cutter = line("c", { x: 30, y: -20 }, { x: 30, y: 20 });

        const outcome = trimElementAt(target, { x: 10, y: 0 }, [cutter], newId);

        expect(outcome!.replacements).toHaveLength(1);
        expect(outcome!.replacements[0].start!.x).toBeCloseTo(30, 6);
        expect(outcome!.replacements[0].end).toEqual({ x: 100, y: 0 });
    });

    it("没有交点时返回 null", () => {
        const target = line("t", { x: 0, y: 0 }, { x: 100, y: 0 });
        const other = line("c", { x: 0, y: 50 }, { x: 100, y: 50 });

        expect(trimElementAt(target, { x: 50, y: 0 }, [other], newId)).toBeNull();
    });

    it("圆作为剪切边界：点击圆外左侧剪掉左段，保留圆内段与右段", () => {
        const target = line("t", { x: 0, y: 0 }, { x: 100, y: 0 });
        const cutter = circle("c", { x: 50, y: 0 }, 10);

        const outcome = trimElementAt(target, { x: 10, y: 0 }, [cutter], newId);

        expect(outcome!.replacements).toHaveLength(2);
        const [inner, outer] = outcome!.replacements;
        expect(inner.start!.x).toBeCloseTo(40, 6);
        expect(inner.end!.x).toBeCloseTo(60, 6);
        expect(outer.start!.x).toBeCloseTo(60, 6);
        expect(outer.end!.x).toBeCloseTo(100, 6);
    });
});

describe("trimElementAt: CIRCLE → ARC", () => {
    it("圆被一条直线剪成弧：剪掉点击侧", () => {
        const target = circle("t", { x: 0, y: 0 }, 50);
        const cutter = line("c", { x: 0, y: -100 }, { x: 0, y: 100 });

        // 点击右侧（x>0 侧），保留左侧半弧
        const outcome = trimElementAt(target, { x: 30, y: 0 }, [cutter], newId);

        expect(outcome!.replacements).toHaveLength(1);
        const kept = outcome!.replacements[0];
        expect(kept.type).toBe("ARC");
        expect(kept.center).toEqual({ x: 0, y: 0 });
        expect(kept.radius).toBe(50);
        // 保留左半：从 90° 扫到 270°
        expect(kept.startAngle).toBeCloseTo(90, 6);
        expect(kept.endAngle).toBeCloseTo(270, 6);
    });

    it("交点不足两个的圆返回 null", () => {
        const target = circle("t", { x: 0, y: 0 }, 50);
        const tangent = line("c", { x: 50, y: -100 }, { x: 50, y: 100 });
        // 相切：交点重合为 1 个
        expect(trimElementAt(target, { x: 30, y: 0 }, [tangent], newId)).toBeNull();
    });
});

describe("trimElementAt: ARC", () => {
    it("弧被径向直线剪成两段", () => {
        // 四分之一弧 0°→90°，半径 100；在 45° 处剪
        const target = arc("t", { x: 0, y: 0 }, 100, 0, 90);
        const ray = line("c", { x: 0, y: 0 }, { x: 100, y: 100 });

        const outcome = trimElementAt(target, { x: 90, y: 10 }, [ray], newId);

        expect(outcome!.replacements).toHaveLength(1);
        const kept = outcome!.replacements[0];
        // 点击靠近 0° 端 → 保留 45°..90°
        expect(kept.startAngle).toBeCloseTo(45, 4);
        expect(kept.endAngle).toBeCloseTo(90, 4);
    });
});

describe("trimElementAt: POLYLINE", () => {
    it("开放多段线的中间段被剪断并拆成两条", () => {
        const target = polyline("t", [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ]);
        // 水平线穿过第二段 (100,0)-(100,100) 的中部
        const cutter = line("c", { x: 150, y: 50 }, { x: -50, y: 50 });

        const outcome = trimElementAt(target, { x: 100, y: 50 }, [cutter], newId);

        expect(outcome!.replacements).toHaveLength(2);
        const front = outcome!.replacements[0];
        const back = outcome!.replacements[1];
        // 剪掉第二段下半 (100,0)-(100,50)：前链止于剪断口，后链从另一半剪断口出发
        expect(front.points).toEqual([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);
        expect(back.points).toEqual([
            { x: 100, y: 50 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ]);
    });

    it("剪掉首段前半时保留其余链", () => {
        const target = polyline("t", [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
        ]);
        const cutter = line("c", { x: 50, y: -20 }, { x: 50, y: 20 });

        const outcome = trimElementAt(target, { x: 50, y: 0 }, [cutter], newId);

        expect(outcome!.replacements).toHaveLength(1);
        expect(outcome!.replacements[0].points).toEqual([
            { x: 50, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
        ]);
    });

    it("闭合多段线剪掉一段后成为开放链", () => {
        const square = polyline(
            "t",
            [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
                { x: 0, y: 100 },
            ],
            true,
        );
        const cutter = line("c", { x: 50, y: -20 }, { x: 50, y: 20 });

        const outcome = trimElementAt(square, { x: 50, y: 0 }, [cutter], newId);

        expect(outcome!.replacements).toHaveLength(1);
        const chain = outcome!.replacements[0];
        expect(chain.closed).toBe(false);
        expect(chain.points).toHaveLength(5);
        // 剪掉首段左半 (0,0)-(50,0)：链从 (50,0) 绕一圈回到段起点 (0,0)
        expect(chain.points![0]).toEqual({ x: 50, y: 0 });
        expect(chain.points![chain.points!.length - 1]).toEqual({ x: 0, y: 0 });
    });
});

describe("extendElementAt", () => {
    it("线段沿点击端延伸到边界线", () => {
        const target = line("t", { x: 0, y: 0 }, { x: 40, y: 0 });
        const boundary = line("b", { x: 100, y: -50 }, { x: 100, y: 50 });

        // 点击靠近 end 端 → end 向 +x 延伸
        const extended = extendElementAt(target, { x: 35, y: 0 }, [boundary]);

        expect(extended).not.toBeNull();
        expect(extended!.start).toEqual({ x: 0, y: 0 });
        expect(extended!.end!.x).toBeCloseTo(100, 6);
    });

    it("点击另一端则延伸另一端", () => {
        const target = line("t", { x: 0, y: 0 }, { x: 40, y: 0 });
        const boundary = line("b", { x: -30, y: -50 }, { x: -30, y: 50 });

        // 点击靠近 start 端 → start 向 -x 延伸
        const extended = extendElementAt(target, { x: 5, y: 0 }, [boundary]);

        expect(extended!.start!.x).toBeCloseTo(-30, 6);
        expect(extended!.end).toEqual({ x: 40, y: 0 });
    });

    it("延伸方向上没有边界时返回 null", () => {
        const target = line("t", { x: 0, y: 0 }, { x: 40, y: 0 });
        const boundary = line("b", { x: 0, y: -50 }, { x: 0, y: 50 });

        expect(extendElementAt(target, { x: 10, y: 0 }, [boundary])).toBeNull();
    });

    it("圆弧沿扫描方向延伸到边界交点角", () => {
        // 四分之一弧 0°..90° 半径 50；延长到水平边界线 y=0 的负侧？不行，改用反向射线
        const target = arc("t", { x: 0, y: 0 }, 50, 0, 90);
        // 边界：竖直线 x=-50，与圆交于 180°
        const boundary = line("b", { x: -50, y: -100 }, { x: -50, y: 100 });

        // 点击靠近 90° 端 → 终端延伸扫过 180°
        const extended = extendElementAt(
            target,
            pointOnArc({ x: 0, y: 0 }, 50, 85),
            [boundary],
        );

        expect(extended).not.toBeNull();
        expect(extended!.endAngle).toBeCloseTo(180, 4);
        expect(extended!.startAngle).toBeCloseTo(0, 4);
    });

    it("开放多段线的端点段延伸到边界", () => {
        const target = polyline("t", [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
        ]);
        const boundary = line("b", { x: 100, y: -50 }, { x: 100, y: 50 });

        const extended = extendElementAt(target, { x: 30, y: 0 }, [boundary]);

        expect(extended).not.toBeNull();
        expect(extended!.points![0]).toEqual({ x: 0, y: 0 });
        expect(extended!.points![1]!.x).toBeCloseTo(100, 6);
    });
});

function pointOnArc(center: Point, radius: number, deg: number): Point {
    const rad = (deg * Math.PI) / 180;
    return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) };
}
