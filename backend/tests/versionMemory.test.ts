import { describe, expect, it } from "vitest";
import { formatVersionMemory, summarizeVersionChange } from "../src/lib/versionMemory";

describe("summarizeVersionChange", () => {
  it("按 id 计算新增、删除、类型与图层", () => {
    const summary = summarizeVersionChange(
      {
        elements: [
          { id: "l1", type: "LINE", layer: "WALLS" },
          { id: "c1", type: "CIRCLE", layer: "0" },
        ],
      },
      {
        elements: [
          { id: "l1", type: "LINE", layer: "WALLS" },
          { id: "d1", type: "DIMENSION", layer: "DIM" },
          { id: "d2", type: "DIMENSION", layer: "DIM" },
        ],
      },
    );
    expect(summary).toEqual({
      added: 2,
      removed: 1,
      modified: 0,
      addedByType: { DIMENSION: 2 },
      removedByType: { CIRCLE: 1 },
      modifiedByType: {},
      layersTouched: ["DIM", "0"],
    });
  });

  it("同一图元几何被改动时计入修改数", () => {
    const summary = summarizeVersionChange(
      {
        elements: [
          { id: "l1", type: "LINE", layer: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
          { id: "c1", type: "CIRCLE", layer: "0", center: { x: 5, y: 5 }, radius: 2 },
        ],
      },
      {
        elements: [
          { id: "l1", type: "LINE", layer: "0", start: { x: 0, y: 0 }, end: { x: 20, y: 0 } },
          { id: "c1", type: "CIRCLE", layer: "0", center: { x: 5, y: 5 }, radius: 2 },
        ],
      },
    );
    expect(summary.modified).toBe(1);
    expect(summary.modifiedByType).toEqual({ LINE: 1 });
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.layersTouched).toContain("0");
  });

  it("首个版本全是新增，非法图元被忽略", () => {
    const summary = summarizeVersionChange(null, [
      { id: "a", type: "LINE", layer: "0" },
      { id: "b" },
      "bad",
      { type: "CIRCLE" },
    ]);
    expect(summary.added).toBe(2);
    expect(summary.removed).toBe(0);
    expect(summary.addedByType).toEqual({ LINE: 1, UNKNOWN: 1 });
  });
});

describe("formatVersionMemory", () => {
  it("输出最新在前的可读记忆并限制条数", () => {
    const text = formatVersionMemory([
      {
        versionNumber: 4,
        elementCount: 10,
        commitMessage: "调整布局",
        changeSummary: {
          added: 3,
          removed: 2,
          modified: 4,
          addedByType: { LINE: 3 },
          removedByType: { RECTANGLE: 2 },
          modifiedByType: { LINE: 4 },
          layersTouched: ["WALLS"],
        },
        createdAt: "2026-10-22T08:00:00.000Z",
      },
      { versionNumber: 3, elementCount: 9, changeSummary: null, createdAt: null },
    ]);
    expect(text).toContain("v4（2026-10-22）");
    expect(text).toContain("+3 / -2 / ~4");
    expect(text).toContain("新增 LINE×3");
    expect(text).toContain("修改 LINE×4");
    expect(text).toContain("涉及图层 WALLS");
    expect(text).toContain("备注：调整布局");
    expect(text).toContain("v3：9 个图元");
    expect(formatVersionMemory([])).toBeNull();
  });

  it("旧版本摘要没有 modified 字段时按 0 处理", () => {
    const text = formatVersionMemory([
      {
        versionNumber: 1,
        elementCount: 4,
        changeSummary: { added: 1, removed: 0, addedByType: {}, removedByType: {}, layersTouched: [] },
        createdAt: null,
      },
    ]);
    expect(text).toContain("+1 / -0 / ~0");
  });
});
