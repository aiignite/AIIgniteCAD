import { describe, expect, it } from "vitest";
import { diffElementSets, summarizeElementTypes } from "../lib/versionDiff";
import { buildVersionSnapshot } from "../lib/versionSnapshot";
import type { CADElement, DrawingSettings } from "../types";

const line = (id: string, x2 = 100): CADElement => ({
    id,
    type: "LINE",
    start: { x: 0, y: 0 },
    end: { x: x2, y: 0 },
    layer: "0",
    color: "#fff",
});

const circle = (id: string): CADElement => ({
    id,
    type: "CIRCLE",
    center: { x: 10, y: 10 },
    radius: 5,
    layer: "WALLS",
    color: "#fff",
});

const settings: DrawingSettings = {
    units: "mm",
    gridSpacing: 50,
    snapDistance: 10,
    dimScale: 1,
    dimPrecision: 2,
};

describe("版本对比", () => {
    it("按 ID 识别新增、删除、修改与未变化图元", () => {
        const base = [line("a"), line("b", 50), line("c")];
        const target = [line("a"), line("b", 80), circle("d")];

        const diff = diffElementSets(base, target);

        expect(diff.added.map((element) => element.id)).toEqual(["d"]);
        expect(diff.removed.map((element) => element.id)).toEqual(["c"]);
        expect(diff.modified.map((item) => item.after.id)).toEqual(["b"]);
        expect(diff.unchanged).toBe(1);
    });

    it("相同快照没有变更", () => {
        const elements = [line("a"), circle("b")];
        const diff = diffElementSets(elements, elements.map((element) => ({ ...element })));

        expect(diff.added).toHaveLength(0);
        expect(diff.removed).toHaveLength(0);
        expect(diff.modified).toHaveLength(0);
        expect(diff.unchanged).toBe(2);
    });

    it("汇总变更图元类型", () => {
        expect(summarizeElementTypes([line("a"), line("b"), circle("c")])).toBe(
            "LINE ×2, CIRCLE ×1",
        );
        expect(summarizeElementTypes([])).toBe("—");
    });
});

describe("版本快照", () => {
    it("合并显式图层与图元中出现的图层，并保留可见/锁定状态", () => {
        const snapshot = buildVersionSnapshot(
            [line("a"), circle("b")],
            {
                layerOrder: ["0", "DIM"],
                layerColors: { "0": "#111111", DIM: "#22ff22" },
                hiddenLayers: ["DIM"],
                lockedLayers: ["WALLS"],
            },
            settings,
        );

        expect(snapshot.settings).toBe(settings);
        expect(snapshot.layers?.map((layer) => layer.name)).toEqual(["0", "DIM", "WALLS"]);
        expect(snapshot.layers?.find((layer) => layer.name === "DIM")).toMatchObject({
            color: "#22ff22",
            isVisible: false,
            isLocked: false,
        });
        expect(snapshot.layers?.find((layer) => layer.name === "WALLS")).toMatchObject({
            color: "#e6edf3",
            isVisible: true,
            isLocked: true,
        });
    });
});
