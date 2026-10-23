/**
 * spatialIndex.ts — 元素包围盒网格索引
 *
 * 将图纸元素按包围盒放入均匀网格，命中测试、框选与视口裁剪先取候选集，
 * 避免每次交互都遍历全部元素。退化包围盒（无法计算范围的高级图元）
 * 会进入"未索引"列表并始终作为候选返回，保证不会漏渲染。
 */

import { CADElement, Point } from "../types";
import { BoundingBox, getElementBoundingBox } from "./geometry";

/** 默认网格单元尺寸（画布坐标） */
const DEFAULT_CELL_SIZE = 128;

/** 归一化包围盒：兼容矩形负宽高导致的 min/max 颠倒 */
function normalizeBox(box: BoundingBox): BoundingBox {
    return {
        minX: Math.min(box.minX, box.maxX),
        minY: Math.min(box.minY, box.maxY),
        maxX: Math.max(box.minX, box.maxX),
        maxY: Math.max(box.minY, box.maxY),
    };
}

/**
 * 均匀网格空间索引。
 * 每个元素会写入其包围盒覆盖的所有单元格；查询时对候选去重。
 */
export class SpatialGrid {
    /** 单元格键（`cx,cy`）到元素列表的映射 */
    private cells = new Map<string, CADElement[]>();
    /** 无法计算有效包围盒的元素，查询时始终返回 */
    private unindexed: CADElement[] = [];
    /** 网格单元尺寸 */
    private cellSize: number;
    /** 当前索引中的元素数量 */
    private size = 0;

    /**
     * @param elements 需要建立索引的元素
     * @param cellSize 网格单元尺寸，过小会增加内存，过大会降低筛选效果
     */
    constructor(elements: CADElement[] = [], cellSize = DEFAULT_CELL_SIZE) {
        this.cellSize = Math.max(1, cellSize);
        this.rebuild(elements);
    }

    /** 重建索引，元素增删改后调用 */
    rebuild(elements: CADElement[]): void {
        this.cells.clear();
        this.unindexed = [];
        this.size = elements.length;

        for (const el of elements) {
            const box = normalizeBox(getElementBoundingBox(el));
            // 零面积包围盒无法定位（如未覆盖的 BLOCK_REFERENCE），放入未索引列表
            if (box.minX === box.maxX && box.minY === box.maxY) {
                this.unindexed.push(el);
                continue;
            }

            const startX = Math.floor(box.minX / this.cellSize);
            const endX = Math.floor(box.maxX / this.cellSize);
            const startY = Math.floor(box.minY / this.cellSize);
            const endY = Math.floor(box.maxY / this.cellSize);

            for (let cx = startX; cx <= endX; cx++) {
                for (let cy = startY; cy <= endY; cy++) {
                    const key = `${cx},${cy}`;
                    const bucket = this.cells.get(key);
                    if (bucket) bucket.push(el);
                    else this.cells.set(key, [el]);
                }
            }
        }
    }

    /** 索引中的元素数量 */
    get length(): number {
        return this.size;
    }

    /**
     * 查询与矩形区域相交的候选元素。
     * 返回值可能包含仅单元格相交的元素，调用方仍需做精确包围盒/几何判断。
     */
    queryRect(minX: number, minY: number, maxX: number, maxY: number): CADElement[] {
        const left = Math.min(minX, maxX);
        const right = Math.max(minX, maxX);
        const top = Math.min(minY, maxY);
        const bottom = Math.max(minY, maxY);

        const seen = new Set<string>();
        const result: CADElement[] = [];

        // 未索引元素保守返回
        for (const el of this.unindexed) {
            seen.add(el.id);
            result.push(el);
        }

        const startX = Math.floor(left / this.cellSize);
        const endX = Math.floor(right / this.cellSize);
        const startY = Math.floor(top / this.cellSize);
        const endY = Math.floor(bottom / this.cellSize);

        for (let cx = startX; cx <= endX; cx++) {
            for (let cy = startY; cy <= endY; cy++) {
                const bucket = this.cells.get(`${cx},${cy}`);
                if (!bucket) continue;
                for (const el of bucket) {
                    if (seen.has(el.id)) continue;
                    seen.add(el.id);
                    result.push(el);
                }
            }
        }

        return result;
    }

    /**
     * 查询点附近（给定半径）的候选元素，用于命中测试与捕捉。
     * @param point 查询点
     * @param radius 容差半径
     */
    queryPoint(point: Point, radius = 0): CADElement[] {
        return this.queryRect(
            point.x - radius,
            point.y - radius,
            point.x + radius,
            point.y + radius,
        );
    }
}

export default SpatialGrid;
