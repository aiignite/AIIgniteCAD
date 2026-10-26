import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import type { VersionDiff } from "../lib/versionDiff";
import { describeGeometry, explainChanges } from "../lib/changeExplanation";

const line = (id: string, x1: number, y1: number, x2: number, y2: number): CADElement => ({
    id,
    type: "LINE",
    layer: "OUTLINE",
    color: "#fff",
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
});

const circle = (id: string, r: number, layer = "DIM"): CADElement => ({
    id,
    type: "CIRCLE",
    layer,
    color: "#fff",
    center: { x: 0, y: 0 },
    radius: r,
});

const empty = (): VersionDiff => ({ added: [], removed: [], modified: [], unchanged: 0 });

describe("describeGeometry", () => {
    it("按类型给出一行摘要", () => {
        expect(describeGeometry(line("a", 0, 0, 100, 0))).toBe("(0,0)→(100,0)");
        expect(describeGeometry(circle("c", 25))).toBe("c(0,0) r=25");
        expect(
            describeGeometry({
                id: "t",
                type: "TEXT",
                layer: "0",
                color: "#fff",
                text: "标高",
                start: { x: 5, y: 6 },
            }),
        ).toBe('"标高" @(5,6)');
        expect(
            describeGeometry({
                id: "p",
                type: "LWPOLYLINE",
                layer: "0",
                color: "#fff",
                points: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 1 },
                ],
                closed: true,
            }),
        ).toBe("3 pts closed");
    });
});

describe("explainChanges", () => {
    it("按新增 → 修改 → 删除展开并给出计数", () => {
        const explanation = explainChanges({
            added: [line("new", 0, 0, 50, 0)],
            removed: [circle("gone", 10)],
            modified: [{ before: circle("m", 10), after: circle("m", 20) }],
            unchanged: 3,
        });

        expect(explanation.entries.map((entry) => entry.kind)).toEqual([
            "added",
            "modified",
            "removed",
        ]);
        expect(explanation.counts).toEqual({ added: 1, modified: 1, removed: 1 });
        expect(explanation.entries[1].detail).toBe("c(0,0) r=10 → c(0,0) r=20");
    });

    it("按图层聚合增删改", () => {
        const explanation = explainChanges({
            added: [line("a", 0, 0, 1, 0), line("b", 0, 1, 1, 1)],
            removed: [],
            modified: [{ before: circle("m", 1), after: circle("m", 2) }],
            unchanged: 0,
        });

        const outline = explanation.byLayer.find((item) => item.layer === "OUTLINE");
        const dim = explanation.byLayer.find((item) => item.layer === "DIM");
        expect(outline).toMatchObject({ added: 2, modified: 0, removed: 0 });
        expect(dim).toMatchObject({ added: 0, modified: 1, removed: 0 });
    });

    it("没有变更时说明文本仍然可读", () => {
        const explanation = explainChanges(empty());
        expect(explanation.entries).toHaveLength(0);
        expect(explanation.text).toContain("新增 0 · 修改 0 · 删除 0");
        expect(explanation.truncated).toBe(false);
    });

    it("明细超过上限时截断并注明剩余条数", () => {
        const added = Array.from({ length: 10 }, (_, index) => line(`e-${index}`, index, 0, index, 1));
        const explanation = explainChanges(
            { added, removed: [], modified: [], unchanged: 0 },
            { maxEntries: 4 },
        );
        expect(explanation.entries).toHaveLength(4);
        expect(explanation.truncated).toBe(true);
        expect(explanation.counts.added).toBe(10);
        expect(explanation.text).toContain("其余 6 条");
    });

    it("说明文本包含操作序列与逐条明细", () => {
        const explanation = explainChanges(
            {
                added: [line("a", 0, 0, 10, 0)],
                removed: [],
                modified: [],
                unchanged: 0,
            },
            { operations: ["ADD", "ADD", "MOVE"] },
        );
        expect(explanation.text).toContain("操作：ADD、MOVE");
        expect(explanation.text).toContain("+ LINE [OUTLINE] (0,0)→(10,0)");
    });
});
