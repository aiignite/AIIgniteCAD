/**
 * projectDocument.test.ts — 统一文档模型测试
 *
 * 覆盖 normalizeProjectDocument 对旧存档与服务端载荷的迁移、
 * 图层 / 设置 / 图元的非法输入收敛，以及 ProjectFile 适配器往返。
 */

import { describe, expect, it } from "vitest";
import {
    PROJECT_DOCUMENT_VERSION,
    createDefaultDrawingSettings,
    createDefaultLayers,
    documentFromProjectFile,
    layerSnapshotFromLayers,
    layersFromLayerSnapshot,
    normalizeBlockReferences,
    normalizeDrawingSettings,
    normalizeElements,
    normalizeLayers,
    normalizeProjectDocument,
    projectFileFromDocument,
} from "../lib/projectDocument";
import { CADElement, Layer, ProjectFile } from "../types";

const line = (id: string, layer = "0"): CADElement => ({
    id,
    type: "LINE",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    layer,
    color: "#000000",
});

describe("normalizeProjectDocument", () => {
    it("旧存档（无 schemaVersion / layers / drawingSettings）迁移为完整文档", () => {
        const doc = normalizeProjectDocument({
            id: "p1",
            name: "Old Drawing",
            lastModified: "2026-01-01T00:00:00.000Z",
            elements: [line("a")],
        });

        expect(doc).not.toBeNull();
        expect(doc!.schemaVersion).toBe(PROJECT_DOCUMENT_VERSION);
        expect(doc!.elements.map((el) => el.id)).toEqual(["a"]);
        expect(doc!.layers.map((l) => l.name)).toEqual(["0", "AI_GENERATED", "DIM"]);
        expect(doc!.drawingSettings).toEqual(createDefaultDrawingSettings());
        expect(doc!.designConventions).toBeNull();
        expect(doc!.blockReferences).toEqual([]);
    });

    it("无法识别 id 的输入返回 null", () => {
        expect(normalizeProjectDocument(null)).toBeNull();
        expect(normalizeProjectDocument("doc")).toBeNull();
        expect(normalizeProjectDocument({ name: "no id" })).toBeNull();
        expect(normalizeProjectDocument({ id: "" })).toBeNull();
    });

    it("服务端 Decimal 字符串与部分字段被收敛为合法设置", () => {
        const settings = normalizeDrawingSettings({
            units: "cm",
            gridSpacing: "25.00", // Prisma Decimal 序列化为字符串
            snapDistance: 5,
            dimScale: 2,
            dimPrecision: 99, // 越界截断
            enabledSnapTypes: ["ENDPOINT", "NOT_A_SNAP"],
        });

        expect(settings).toEqual({
            units: "cm",
            gridSpacing: 25,
            snapDistance: 5,
            dimScale: 2,
            dimPrecision: 8,
            enabledSnapTypes: ["ENDPOINT"],
        });
    });

    it("设置缺省或全非法时回落默认值与默认捕捉集", () => {
        expect(normalizeDrawingSettings(undefined)).toEqual(createDefaultDrawingSettings());
        expect(normalizeDrawingSettings({ units: "mile" }).units).toBe("mm");
        expect(normalizeDrawingSettings({ enabledSnapTypes: [] }).enabledSnapTypes).toEqual([
            "ENDPOINT",
            "MIDPOINT",
            "CENTER",
            "QUADRANT",
            "INTERSECTION",
            "PERPENDICULAR",
            "TANGENT",
        ]);
        // 缺省同样显式落地：避免合并语义继承上一张图纸的捕捉配置
        expect(normalizeDrawingSettings({}).enabledSnapTypes).toHaveLength(7);
    });

    it("图元规范化丢弃缺 id/type 与重复 id", () => {
        const elements = normalizeElements([
            line("a"),
            line("a"), // 重复
            { type: "LINE" }, // 缺 id
            { id: "b" }, // 缺 type
            null,
            line("c"),
        ]);
        expect(elements.map((el) => el.id)).toEqual(["a", "c"]);
    });

    it("图层规范化去重、补默认值并拒绝空名", () => {
        const layers = normalizeLayers([
            { name: "0", color: "#fff", isVisible: false, isLocked: true },
            { name: "0", color: "#000" }, // 重复名
            { name: "  " }, // 空名
            { name: "DIM", lineType: "WAVE" }, // 非法线型回落
            { id: "layer-x", name: "TEXT", lineWeight: 0.35 },
        ]);

        expect(layers).toEqual([
            {
                id: "layer-0",
                name: "0",
                color: "#fff",
                isVisible: false,
                isLocked: true,
                lineType: "CONTINUOUS",
            },
            {
                id: "layer-DIM",
                name: "DIM",
                color: "#e6edf3",
                isVisible: true,
                isLocked: false,
                lineType: "CONTINUOUS",
            },
            {
                id: "layer-x",
                name: "TEXT",
                color: "#e6edf3",
                isVisible: true,
                isLocked: false,
                lineType: "CONTINUOUS",
                lineWeight: 0.35,
            },
        ]);
    });

    it("空图层数组按默认图层集处理", () => {
        expect(normalizeLayers([])).toEqual(createDefaultLayers());
        expect(normalizeLayers("nope")).toEqual(createDefaultLayers());
    });

    it("块引用规范化要求 id、定义 id 与插入点齐全", () => {
        expect(
            normalizeBlockReferences([
                { id: "r1", blockDefinitionId: "b1", insertionPoint: { x: 1, y: 2 } },
                { id: "r2", blockDefinitionId: "b1" }, // 缺插入点
                { id: "r3", insertionPoint: { x: 1, y: 2 } }, // 缺定义 id
                { blockDefinitionId: "b1", insertionPoint: { x: 1, y: 2 } }, // 缺 id
                { id: "r4", blockDefinitionId: "b1", insertionPoint: { x: "a", y: 2 } }, // 坐标非法
            ]),
        ).toEqual([
            {
                id: "r1",
                blockDefinitionId: "b1",
                layer: "0",
                insertionPoint: { x: 1, y: 2 },
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
            },
        ]);
    });
});

describe("ProjectFile 适配器", () => {
    it("documentFromProjectFile → projectFileFromDocument 往返保持数据并计算 elementCount", () => {
        const file: ProjectFile = {
            id: "p1",
            name: "Drawing",
            lastModified: "2026-01-01T00:00:00.000Z",
            elements: [line("a"), line("b", "DIM")],
            layers: [
                { id: "layer-0", name: "0", color: "#fff", isVisible: true, isLocked: false, lineType: "CONTINUOUS" },
                { id: "layer-DIM", name: "DIM", color: "#0f0", isVisible: false, isLocked: true, lineType: "DASHED" },
            ],
            drawingSettings: { units: "cm", gridSpacing: 20, snapDistance: 4, dimScale: 1, dimPrecision: 1 },
        };

        const doc = documentFromProjectFile(file);
        const round = projectFileFromDocument(doc);

        expect(round.id).toBe("p1");
        expect(round.elementCount).toBe(2);
        expect(round.elements).toHaveLength(2);
        expect(round.layers).toEqual(file.layers);
        // normalize 会显式补上默认捕捉集，其余字段原样往返
        expect(round.drawingSettings).toMatchObject(file.drawingSettings!);
        expect(round.drawingSettings!.enabledSnapTypes).toHaveLength(7);
    });

    it("缺省字段的 ProjectFile 迁出的文档带默认图层与设置", () => {
        const doc = documentFromProjectFile({
            id: "p2",
            name: "Bare",
            lastModified: "2026-01-01T00:00:00.000Z",
        });
        expect(doc.layers).toEqual(createDefaultLayers());
        expect(doc.drawingSettings).toEqual(createDefaultDrawingSettings());
        expect(doc.elements).toEqual([]);
    });
});

describe("图层状态与文档图层互转", () => {
    const layers: Layer[] = [
        { id: "layer-0", name: "0", color: "#fff", isVisible: true, isLocked: false, lineType: "CONTINUOUS" },
        { id: "layer-DIM", name: "DIM", color: "#0f0", isVisible: false, isLocked: true, lineType: "DASHED" },
    ];

    it("layerSnapshotFromLayers 还原画布状态", () => {
        expect(layerSnapshotFromLayers(layers)).toEqual({
            layerOrder: ["0", "DIM"],
            layerColors: { "0": "#fff", DIM: "#0f0" },
            hiddenLayers: ["DIM"],
            lockedLayers: ["DIM"],
        });
    });

    it("layersFromLayerSnapshot 汇总显式图层与图元中的历史图层", () => {
        const snapshot = {
            layerOrder: ["0"],
            layerColors: { "0": "#fff" },
            hiddenLayers: [],
            lockedLayers: [],
        };
        const collected = layersFromLayerSnapshot([line("a", "0"), line("b", "LEGACY")], snapshot);
        expect(collected.map((l) => l.name)).toEqual(["0", "LEGACY"]);
        expect(collected[1]).toMatchObject({ color: "#e6edf3", isVisible: true });
    });

    it("往返保持隐藏、锁定与颜色", () => {
        const restored = layerSnapshotFromLayers(
            layersFromLayerSnapshot([], layerSnapshotFromLayers(layers)),
        );
        expect(restored).toEqual(layerSnapshotFromLayers(layers));
    });
});
