/**
 * spatialIndex.test.ts — 空间索引测试
 *
 * 覆盖矩形查询、点查询、退化包围盒兜底与重建逻辑，
 * 并对 2000 元素规模的索引构建与查询做一次基准测量。
 */

import { describe, expect, it } from "vitest";
import { SpatialGrid } from "../lib/spatialIndex";
import { getElementBoundingBox } from "../lib/geometry";
import { CADElement } from "../types";

/** 构造一条线段 */
const line = (id: string, x: number, y: number): CADElement => ({
    id,
    type: "LINE",
    start: { x, y },
    end: { x: x + 10, y },
    layer: "0",
    color: "#fff",
});

describe("SpatialGrid", () => {
    it("矩形查询只返回与区域相交的候选", () => {
        const near = line("near", 10, 10);
        const far = line("far", 2000, 2000);
        const grid = new SpatialGrid([near, far], 128);

        const result = grid.queryRect(0, 0, 100, 100);

        expect(result.map(el => el.id)).toContain("near");
        expect(result.map(el => el.id)).not.toContain("far");
    });

    it("点查询按半径扩展候选范围", () => {
        const target = line("target", 100, 100);
        const grid = new SpatialGrid([target], 128);

        expect(grid.queryPoint({ x: 300, y: 300 }, 5)).toHaveLength(0);
        expect(grid.queryPoint({ x: 300, y: 300 }, 250)).toHaveLength(1);
    });

    it("退化包围盒的元素始终作为候选返回", () => {
        // BLOCK_REFERENCE 缺少可计算的几何范围，包围盒退化为原点
        const blockRef: CADElement = {
            id: "block-1",
            type: "BLOCK_REFERENCE",
            layer: "0",
            color: "#fff",
        };
        expect(getElementBoundingBox(blockRef)).toEqual({
            minX: 0,
            minY: 0,
            maxX: 0,
            maxY: 0,
        });

        const grid = new SpatialGrid([blockRef, line("far", 5000, 5000)], 128);
        const result = grid.queryRect(0, 0, 1, 1);

        expect(result.map(el => el.id)).toEqual(["block-1"]);
    });

    it("rebuild 后旧元素不再出现在查询结果中", () => {
        const grid = new SpatialGrid([line("old", 0, 0)], 128);
        grid.rebuild([line("new", 0, 0)]);

        const ids = grid.queryRect(-10, -10, 20, 20).map(el => el.id);

        expect(ids).toContain("new");
        expect(ids).not.toContain("old");
        expect(grid.length).toBe(1);
    });

    it("负宽高矩形归一化后仍能被查询命中", () => {
        const rect: CADElement = {
            id: "rect",
            type: "RECTANGLE",
            start: { x: 100, y: 100 },
            width: -50,
            height: -50,
            layer: "0",
            color: "#fff",
        };
        const grid = new SpatialGrid([rect], 128);

        expect(grid.queryRect(40, 40, 60, 60).map(el => el.id)).toContain("rect");
    });

    it("2000 元素索引构建与查询基准", () => {
        const elements: CADElement[] = [];
        for (let i = 0; i < 2000; i++) {
            elements.push(line(`el-${i}`, (i % 50) * 40, Math.floor(i / 50) * 40));
        }

        const buildStart = performance.now();
        const grid = new SpatialGrid(elements, 128);
        const buildMs = performance.now() - buildStart;

        const queryStart = performance.now();
        for (let i = 0; i < 1000; i++) {
            grid.queryPoint({ x: (i % 50) * 40, y: (i % 40) * 40 }, 5);
        }
        const queryMs = performance.now() - queryStart;

        // 宽松阈值，主要防止索引退化为全量扫描
        expect(buildMs).toBeLessThan(500);
        expect(queryMs).toBeLessThan(500);
        console.log(
            `[benchmark] 2000 elements: build ${buildMs.toFixed(1)}ms, 1000 queries ${queryMs.toFixed(1)}ms`,
        );
    });
});
