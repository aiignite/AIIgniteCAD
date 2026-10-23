import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONVENTIONS,
  formatDesignConventions,
  normalizeDesignConventions,
} from "../src/lib/designConventions";

const valid = {
  standard: " GB/T 14689 ",
  units: "mm",
  textHeight: 3.5,
  dimensionPrecision: 2,
  layerRules: [
    { name: "WALLS", purpose: "墙体" },
    { name: "DIM" },
  ],
  notes: [" 门洞按现场复核 ", "图层颜色统一"],
};

describe("normalizeDesignConventions", () => {
  it("归一化合法约定并 trim 文本", () => {
    const result = normalizeDesignConventions(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      standard: "GB/T 14689",
      units: "mm",
      textHeight: 3.5,
      dimensionPrecision: 2,
    });
    expect(result.value?.layerRules).toEqual([
      { name: "WALLS", purpose: "墙体" },
      { name: "DIM" },
    ]);
    expect(result.value?.notes).toEqual(["门洞按现场复核", "图层颜色统一"]);
  });

  it("空 / 全默认约定折叠为 null", () => {
    expect(normalizeDesignConventions(null)).toEqual({ ok: true, value: null });
    expect(normalizeDesignConventions(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeDesignConventions({ ...DEFAULT_CONVENTIONS })).toEqual({
      ok: true,
      value: null,
    });
  });

  it("拒绝非法单位、数值范围、重复图层与超长内容", () => {
    expect(normalizeDesignConventions({ ...valid, units: "mile" }).ok).toBe(false);
    expect(normalizeDesignConventions({ ...valid, textHeight: 0 }).ok).toBe(false);
    expect(normalizeDesignConventions({ ...valid, dimensionPrecision: 9 }).ok).toBe(false);
    expect(
      normalizeDesignConventions({
        ...valid,
        layerRules: [
          { name: "WALLS" },
          { name: "WALLS" },
        ],
      }).ok,
    ).toBe(false);
    expect(
      normalizeDesignConventions({ ...valid, notes: ["x".repeat(201)] }).ok,
    ).toBe(false);
    expect(normalizeDesignConventions("gb").ok).toBe(false);
  });

  it("格式化为提示词段落，非法存量数据返回 null", () => {
    const text = formatDesignConventions(valid);
    expect(text).toContain("# 项目设计约定");
    expect(text).toContain("GB/T 14689");
    expect(text).toContain("WALLS（墙体）");
    expect(text).toContain("门洞按现场复核");
    expect(formatDesignConventions({ units: "mile" })).toBeNull();
    expect(formatDesignConventions(null)).toBeNull();
  });
});
