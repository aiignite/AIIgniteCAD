/**
 * block.test.ts — lib/block.ts 单元测试
 * 覆盖块定义的创建/校验/检索、块引用变换、嵌套与循环引用检测、炸开与缩略图。
 */

import { describe, it, expect } from "vitest";
import {
    createBlockDefinition,
    updateBlockDefinition,
    addElementsToBlock,
    removeElementsFromBlock,
    getBlockBoundingBox,
    generateBlockThumbnail,
    createBlockReference,
    moveBlockReference,
    rotateBlockReference,
    scaleBlockReference,
    mirrorBlockReference,
    getBlockTransform,
    transformPointByBlock,
    transformElement,
    getBlockReferenceElements,
    explodeBlockReference,
    searchBlocks,
    getPublicBlocks,
    getUserBlocks,
    getProjectBlocks,
    sortBlocksByName,
    sortBlocksByDate,
    validateBlockDefinition,
    isBlockNameUnique,
    hasNestedBlocks,
    getNestedBlockIds,
    hasCircularReference,
    cloneBlockDefinition,
} from "../lib/block";
import { BlockDefinition, CADElement, Point } from "../types";

let seq = 0;

/** 断言点坐标（浮点容差 1e-6） */
const expectPoint = (actual: Point, x: number, y: number) => {
    expect(actual.x).toBeCloseTo(x, 6);
    expect(actual.y).toBeCloseTo(y, 6);
};

/** 构造测试用 CAD 元素 */
const makeElement = (partial: Partial<CADElement> & Pick<CADElement, "type">): CADElement => ({
    id: `block-el-${++seq}`,
    layer: "0",
    color: "#ffffff",
    ...partial,
});

/** 构造线段元素 */
const lineElement = (sx: number, sy: number, ex: number, ey: number): CADElement =>
    makeElement({ type: "LINE", start: { x: sx, y: sy }, end: { x: ex, y: ey } });

/** 构造块定义字面量，便于测试嵌套关系 */
const makeBlockDefinition = (partial: Partial<BlockDefinition> & Pick<BlockDefinition, "name">): BlockDefinition => ({
    id: `block-${++seq}`,
    basePoint: { x: 0, y: 0 },
    elements: [lineElement(0, 0, 1, 0)],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
});

describe("块定义管理", () => {
    it("创建块定义时把图元归一化到基准点", () => {
        const block = createBlockDefinition(
            "标准窗户",
            [lineElement(10, 10, 20, 10)],
            { x: 10, y: 10 },
            "1200x1500"
        );

        expect(block.name).toBe("标准窗户");
        expect(block.description).toBe("1200x1500");
        expect(block.basePoint).toEqual({ x: 0, y: 0 });
        expect(block.isPublic).toBe(false);
        expect(block.elements).toHaveLength(1);
        expect(block.elements[0].start).toEqual({ x: 0, y: 0 });
        expect(block.elements[0].end).toEqual({ x: 10, y: 0 });
    });

    it("更新、追加与移除块内图元", () => {
        const block = createBlockDefinition("B1", [lineElement(0, 0, 10, 0)], { x: 0, y: 0 });

        const renamed = updateBlockDefinition(block, { name: "B2" });
        expect(renamed.name).toBe("B2");

        const added = addElementsToBlock(block, [lineElement(5, 5, 15, 5)], { x: 5, y: 5 });
        expect(added.elements).toHaveLength(2);
        expect(added.elements[1].start).toEqual({ x: 0, y: 0 });

        const removed = removeElementsFromBlock(added, [added.elements[0].id]);
        expect(removed.elements).toHaveLength(1);
        expect(removed.elements[0].id).toBe(added.elements[1].id);
    });

    it("计算块包围盒并生成 SVG 缩略图", () => {
        const block = makeBlockDefinition({
            name: "Bound",
            elements: [
                lineElement(0, 0, 10, 0),
                makeElement({ type: "CIRCLE", center: { x: 20, y: 20 }, radius: 5 }),
                makeElement({ type: "RECTANGLE", start: { x: 0, y: 0 }, width: 4, height: 3 }),
                makeElement({
                    type: "LWPOLYLINE",
                    points: [
                        { x: 0, y: 0 },
                        { x: 2, y: 2 },
                    ],
                }),
            ],
        });

        expect(getBlockBoundingBox(block)).toEqual({ minX: 0, minY: 0, maxX: 25, maxY: 25 });
        const svg = generateBlockThumbnail(block);
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).toContain("<line");
        expect(svg).toContain("<circle");
        expect(svg).toContain("<rect");
        expect(svg).toContain("<path");
    });
});

describe("块校验与库检索", () => {
    it("校验必填项", () => {
        expect(validateBlockDefinition(makeBlockDefinition({ name: "OK" })).valid).toBe(true);

        expect(validateBlockDefinition(makeBlockDefinition({ name: "" })).errors).toContain(
            "Block name is required"
        );
        expect(
            validateBlockDefinition(makeBlockDefinition({ name: "x".repeat(256) })).errors
        ).toContain("Block name is too long (max 255 characters)");
        expect(
            validateBlockDefinition(makeBlockDefinition({ name: "Empty", elements: [] })).errors
        ).toContain("Block must contain at least one element");
    });

    it("块名唯一性判断不区分大小写并支持排除自身", () => {
        const blocks = [makeBlockDefinition({ name: "Window" })];
        expect(isBlockNameUnique("window", blocks)).toBe(false);
        expect(isBlockNameUnique("Door", blocks)).toBe(true);
        expect(isBlockNameUnique("window", blocks, blocks[0].id)).toBe(true);
    });

    it("按名称/描述搜索并按公共、用户、项目过滤", () => {
        const blocks = [
            makeBlockDefinition({ name: "Window-A", description: "glass panel", isPublic: true }),
            makeBlockDefinition({ name: "Door-B", userId: "u1" }),
            makeBlockDefinition({ name: "Chair-C", projectId: "p1" }),
        ];

        expect(searchBlocks(blocks, "glass").map(b => b.name)).toEqual(["Window-A"]);
        expect(searchBlocks(blocks, "dOoR").map(b => b.name)).toEqual(["Door-B"]);
        expect(getPublicBlocks(blocks)).toHaveLength(1);
        expect(getUserBlocks(blocks, "u1")).toHaveLength(1);
        expect(getProjectBlocks(blocks, "p1")).toHaveLength(1);
    });

    it("按名称与更新时间排序且不修改原数组", () => {
        const older = makeBlockDefinition({ name: "C", updatedAt: "2026-01-01T00:00:00.000Z" });
        const newer = makeBlockDefinition({ name: "A", updatedAt: "2026-03-01T00:00:00.000Z" });
        const blocks = [older, newer];

        expect(sortBlocksByName(blocks).map(b => b.name)).toEqual(["A", "C"]);
        expect(sortBlocksByDate(blocks).map(b => b.name)).toEqual(["A", "C"]);
        expect(blocks[0].name).toBe("C");
    });

    it("克隆块定义生成新的块与图元 id", () => {
        const block = makeBlockDefinition({ name: "Original" });
        const clone = cloneBlockDefinition(block, "Copy");

        expect(clone.id).not.toBe(block.id);
        expect(clone.name).toBe("Copy");
        expect(clone.elements[0].id).not.toBe(block.elements[0].id);
    });
});

describe("块引用与炸开", () => {
    it("创建块引用并使用默认图层与变换参数", () => {
        const ref = createBlockReference("def-1", { x: 100, y: 200 }, "WALL", 45, 2, 3);
        expect(ref.layer).toBe("WALL");
        expect(ref.insertionPoint).toEqual({ x: 100, y: 200 });
        expect(ref.rotation).toBe(45);
        expect(ref.scaleX).toBe(2);
        expect(ref.scaleY).toBe(3);

        const moved = moveBlockReference(ref, { x: 10, y: -10 });
        expect(moved.insertionPoint).toEqual({ x: 110, y: 190 });
        expect(ref.insertionPoint).toEqual({ x: 100, y: 200 });
    });

    it("生成块变换并按变换映射点", () => {
        const ref = createBlockReference("def-1", { x: 10, y: 20 }, "0", 90, 2, 2);
        expect(getBlockTransform(ref)).toEqual({
            translation: { x: 10, y: 20 },
            rotation: Math.PI / 2,
            scale: { x: 2, y: 2 },
        });

        // 局部点 (1,0) 先缩放 2 倍，再旋转 90°，最后平移
        const point = transformPointByBlock({ x: 1, y: 0 }, ref);
        expect(point.x).toBeCloseTo(10, 6);
        expect(point.y).toBeCloseTo(22, 6);
    });

    it("炸开块引用后图元应用引用变换", () => {
        const block = makeBlockDefinition({ name: "Unit", elements: [lineElement(0, 0, 10, 0)] });
        const ref = createBlockReference(block.id, { x: 100, y: 100 }, "0", 90, 2, 2);

        const exploded = explodeBlockReference(ref, block);
        expect(exploded).toHaveLength(1);
        expect(exploded[0].start!.x).toBeCloseTo(100, 6);
        expect(exploded[0].start!.y).toBeCloseTo(100, 6);
        expect(exploded[0].end!.x).toBeCloseTo(100, 6);
        expect(exploded[0].end!.y).toBeCloseTo(120, 6);
    });

    it("旋转、缩放与镜像块引用", () => {
        const ref = createBlockReference("def-1", { x: 10, y: 0 }, "0", 30, 2, 2);

        // 未指定中心时仅累加旋转角
        expect(rotateBlockReference(ref, 45).rotation).toBe(75);
        // 中心与插入点重合时同样只改变旋转角
        expect(rotateBlockReference(ref, 15, { x: 10, y: 0 }).rotation).toBe(45);
        // 绕原点旋转 90°：插入点 (10,0) → (0,10)
        const rotated = rotateBlockReference(ref, 90, { x: 0, y: 0 });
        expect(rotated.insertionPoint.x).toBeCloseTo(0, 6);
        expect(rotated.insertionPoint.y).toBeCloseTo(10, 6);
        expect(rotated.rotation).toBe(120);

        // 未指定中心时仅累乘缩放比例
        const scaled = scaleBlockReference(ref, 2, 3);
        expect(scaled.scaleX).toBe(4);
        expect(scaled.scaleY).toBe(6);
        // 绕原点缩放：插入点 (10,0) → (20,0)
        const scaledAroundCenter = scaleBlockReference(ref, 2, 2, { x: 0, y: 0 });
        expect(scaledAroundCenter.insertionPoint.x).toBeCloseTo(20, 6);
        expect(scaledAroundCenter.insertionPoint.y).toBeCloseTo(0, 6);

        // 以 Y 轴镜像：插入点 X 取反，缩放与旋转同时取反
        const mirrored = mirrorBlockReference(ref, {
            start: { x: 0, y: -1000 },
            end: { x: 0, y: 1000 },
        });
        expect(mirrored.insertionPoint.x).toBeCloseTo(-10, 6);
        expect(mirrored.insertionPoint.y).toBeCloseTo(0, 6);
        expect(mirrored.scaleX).toBe(-2);
        expect(mirrored.rotation).toBe(-30);
    });

    it("按块引用变换返回图元并标记来源", () => {
        const block = makeBlockDefinition({ name: "Unit", elements: [lineElement(0, 0, 10, 0)] });
        const ref = createBlockReference(block.id, { x: 100, y: 100 });

        const elements = getBlockReferenceElements(ref, block);
        expect(elements).toHaveLength(1);
        expect(elements[0].blockReferenceId).toBe(ref.id);
        expectPoint(elements[0].end!, 110, 100);
    });

    it("transformElement 按类型应用矩阵", () => {
        // 圆：中心变换，半径按 X 缩放比例放大
        const circle = transformElement(
            makeElement({ type: "CIRCLE", center: { x: 1, y: 1 }, radius: 5 }),
            { a: 2, b: 0, c: 0, d: 2, e: 10, f: 0 }
        );
        expectPoint(circle.center!, 12, 2);
        expect(circle.radius).toBe(10);

        // 矩形：转换为 LWPOLYLINE，并移除宽高字段
        const rect = transformElement(
            makeElement({ type: "RECTANGLE", start: { x: 0, y: 0 }, width: 10, height: 5 }),
            { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
        );
        expect(rect.type).toBe("LWPOLYLINE");
        expect(rect.points).toHaveLength(4);
        expect(rect.start).toBeUndefined();
        expect(rect.width).toBeUndefined();

        // 文字：位置与字号缩放
        const text = transformElement(
            makeElement({ type: "TEXT", start: { x: 1, y: 1 }, text: "A", fontSize: 12 }),
            { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
        );
        expectPoint(text.start, 2, 2);
        expect(text.fontSize).toBe(24);

        // 圆弧：按矩阵旋转量同步起止角
        const arc = transformElement(
            makeElement({
                type: "ARC",
                center: { x: 0, y: 0 },
                radius: 5,
                startAngle: 0,
                endAngle: 90,
            }),
            { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }
        );
        expect(arc.startAngle).toBeCloseTo(90, 6);
        expect(arc.endAngle).toBeCloseTo(180, 6);
    });
});

describe("块嵌套与循环引用", () => {
    it("识别嵌套块并递归收集块 id", () => {
        const c = makeBlockDefinition({ name: "C" });
        const b = makeBlockDefinition({
            name: "B",
            elements: [makeElement({ type: "BLOCK_REFERENCE", blockReferenceId: c.id })],
        });
        const a = makeBlockDefinition({
            name: "A",
            elements: [makeElement({ type: "BLOCK_REFERENCE", blockReferenceId: b.id })],
        });

        expect(hasNestedBlocks(a)).toBe(true);
        expect(hasNestedBlocks(c)).toBe(false);
        expect(getNestedBlockIds(a, [a, b, c])).toEqual([b.id, c.id]);
    });

    it("检测直接与间接循环引用", () => {
        const self = makeBlockDefinition({ name: "Self" });
        self.elements = [makeElement({ type: "BLOCK_REFERENCE", blockReferenceId: self.id })];

        const a = makeBlockDefinition({ name: "A" });
        const b = makeBlockDefinition({
            name: "B",
            elements: [makeElement({ type: "BLOCK_REFERENCE", blockReferenceId: a.id })],
        });
        a.elements = [makeElement({ type: "BLOCK_REFERENCE", blockReferenceId: b.id })];

        const normal = makeBlockDefinition({ name: "Normal" });

        expect(hasCircularReference(self, [self])).toBe(true);
        expect(hasCircularReference(a, [a, b])).toBe(true);
        expect(hasCircularReference(normal, [normal])).toBe(false);
    });
});
