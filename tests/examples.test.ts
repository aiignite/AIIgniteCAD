import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDXF } from "../services/dxfService";
import type { CADElement } from "../types";

describe("examples/sample.dxf", () => {
  it("可被导入并覆盖基础图元类型", () => {
    const content = readFileSync(
      new URL("../examples/sample.dxf", import.meta.url),
      "utf8",
    );
    const elements = parseDXF(content);
    const types = new Set(elements.map((element) => element.type));

    expect(types).toEqual(
      new Set(["LWPOLYLINE", "LINE", "CIRCLE", "ARC", "TEXT"]),
    );
    expect(elements.every((element) => element.id.length > 0)).toBe(true);
  });
});

describe("内置示例图纸", () => {
  const expected: Record<string, { min: number; types: CADElement["type"][] }> = {
    "gear.dxf": { min: 8, types: ["LWPOLYLINE", "CIRCLE", "TEXT"] },
    "spring.dxf": { min: 4, types: ["LWPOLYLINE", "LINE", "TEXT"] },
    "floor-plan.dxf": { min: 15, types: ["LINE", "ARC", "CIRCLE", "TEXT"] },
  };

  for (const [file, spec] of Object.entries(expected)) {
    it(`${file} 可导入并包含预期图元`, () => {
      const content = readFileSync(
        new URL(`../examples/${file}`, import.meta.url),
        "utf8",
      );
      const elements = parseDXF(content);
      const types = new Set(elements.map((element) => element.type));

      expect(elements.length).toBeGreaterThanOrEqual(spec.min);
      for (const type of spec.types) expect(types.has(type)).toBe(true);
      expect(elements.every((element) => element.id.length > 0)).toBe(true);
    });
  }

  it("齿轮与弹簧的多段线保留足够顶点", () => {
    const gear = parseDXF(
      readFileSync(new URL("../examples/gear.dxf", import.meta.url), "utf8"),
    ).find((element) => element.type === "LWPOLYLINE");
    const spring = parseDXF(
      readFileSync(new URL("../examples/spring.dxf", import.meta.url), "utf8"),
    ).find((element) => element.type === "LWPOLYLINE");

    expect(gear?.points?.length).toBe(80);
    expect(spring?.points?.length).toBeGreaterThan(200);
  });
});
