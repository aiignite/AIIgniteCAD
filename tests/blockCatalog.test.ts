import { describe, expect, it } from "vitest";
import type { BlockCategory, BlockDefinition } from "../types";
import {
    buildBlockCatalog,
    expandBlockAt,
    findBlockEntry,
    searchBlockCatalog,
} from "../lib/blockCatalog";

const block = (overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({
    id: "block-1",
    name: "门洞",
    description: "标准门洞符号",
    basePoint: { x: 0, y: 0 },
    elements: [
        {
            id: "rect-1",
            type: "RECTANGLE",
            start: { x: 0, y: 0 },
            width: 200,
            height: 100,
            layer: "DOOR",
            color: "#e6edf3",
        },
        {
            id: "line-1",
            type: "LINE",
            start: { x: 0, y: 50 },
            end: { x: 200, y: 50 },
            layer: "DOOR",
            color: "#e6edf3",
        },
    ],
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...overrides,
});

const category = (overrides: Partial<BlockCategory> = {}): BlockCategory => ({
    id: "cat-1",
    name: "建筑符号",
    userId: "user-1",
    blocks: [],
    children: [],
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...overrides,
});

describe("buildBlockCatalog", () => {
    it("拍平根块与多层分类，并计算尺寸", () => {
        const catalog = buildBlockCatalog(
            [block({ id: "root-block", name: "全局块" })],
            [
                category({
                    blocks: [block()],
                    children: [
                        category({
                            id: "cat-2",
                            name: "门窗",
                            blocks: [block({ id: "block-2", name: "窗" })],
                        }),
                    ],
                }),
            ],
        );

        expect(catalog.map((entry) => entry.id)).toEqual(["root-block", "block-1", "block-2"]);
        expect(catalog[1]).toMatchObject({
            name: "门洞",
            category: "建筑符号",
            elementCount: 2,
            width: 200,
            height: 100,
        });
        expect(catalog[2].category).toBe("门窗");
    });

    it("跳过重复块与无效定义", () => {
        const catalog = buildBlockCatalog(
            [block(), block()],
            [category({ blocks: [block()] })],
        );
        expect(catalog).toHaveLength(1);
    });
});

describe("searchBlockCatalog", () => {
    const catalog = buildBlockCatalog([], [
        category({
            blocks: [
                block(),
                block({ id: "block-2", name: "推拉窗", description: "双扇推拉" }),
                block({ id: "block-3", name: "标高符号", description: "三角形标高标记" }),
            ],
        }),
    ]);

    it("按名称 / 分类 / 描述过滤", () => {
        expect(searchBlockCatalog(catalog, { keyword: "门" }).blocks.map((b) => b.name)).toEqual([
            "门洞",
        ]);
        expect(
            searchBlockCatalog(catalog, { keyword: "建筑" }).blocks.map((b) => b.id),
        ).toEqual(["block-1", "block-2", "block-3"]);
        expect(searchBlockCatalog(catalog, { keyword: "推拉" }).total).toBe(1);
    });

    it("限制返回数量但保留总数", () => {
        const result = searchBlockCatalog(catalog, { limit: 2 });
        expect(result.total).toBe(3);
        expect(result.blocks).toHaveLength(2);
        expect(searchBlockCatalog(catalog, { limit: 999 }).blocks).toHaveLength(3);
        expect(searchBlockCatalog(catalog, { limit: -5 }).blocks).toHaveLength(1);
    });

    it("findBlockEntry 按 id 命中", () => {
        expect(findBlockEntry(catalog, "block-2")?.name).toBe("推拉窗");
        expect(findBlockEntry(catalog, "missing")).toBeUndefined();
    });
});

describe("expandBlockAt", () => {
    const entry = buildBlockCatalog([block()], [])[0];

    it("把基准点平移到插入点并生成新 id", () => {
        const elements = expandBlockAt(entry, { x: 500, y: 400 });
        expect(elements).toHaveLength(2);
        expect(elements[0].start).toEqual({ x: 500, y: 400 });
        expect(elements[0].id).not.toBe("rect-1");
        expect(elements[1].start).toEqual({ x: 500, y: 450 });
        // 块内图层与颜色保留
        expect(elements[0].layer).toBe("DOOR");
    });

    it("按基准点计算平移：基准点不在原点时仍落在插入点", () => {
        const offsetBlock = buildBlockCatalog(
            [block({ basePoint: { x: 100, y: 50 } })],
            [],
        )[0];
        const elements = expandBlockAt(offsetBlock, { x: 0, y: 0 });
        expect(elements[0].start).toEqual({ x: -100, y: -50 });
    });

    it("绕插入点旋转 90 度时矩形转为闭合多段线", () => {
        const elements = expandBlockAt(entry, { x: 0, y: 0, rotation: 90 });
        const rect = elements[0];
        expect(rect.type).toBe("LWPOLYLINE");
        expect(rect.closed).toBe(true);
        const points = rect.points ?? [];
        expect(points).toHaveLength(4);
        const expected = [
            { x: 0, y: 0 },
            { x: 0, y: 200 },
            { x: -100, y: 200 },
            { x: -100, y: 0 },
        ];
        expected.forEach((point, index) => {
            expect(points[index].x).toBeCloseTo(point.x);
            expect(points[index].y).toBeCloseTo(point.y);
        });
        const line = elements[1];
        expect(line.start?.x).toBeCloseTo(-50);
        expect(line.start?.y).toBeCloseTo(0);
        expect(line.end?.x).toBeCloseTo(-50);
        expect(line.end?.y).toBeCloseTo(200);
    });

    it("等比缩放", () => {
        const elements = expandBlockAt(entry, { x: 0, y: 0, scale: 2 });
        expect(elements[0].width).toBe(400);
        expect(elements[0].height).toBe(200);
        expect(elements[1].end).toEqual({ x: 400, y: 100 });
    });

    it("空块返回空数组", () => {
        const empty = buildBlockCatalog([block({ id: "empty", elements: [] })], [])[0];
        expect(expandBlockAt(empty, { x: 10, y: 10 })).toEqual([]);
    });
});
