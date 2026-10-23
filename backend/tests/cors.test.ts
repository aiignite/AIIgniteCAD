/**
 * cors.test.ts — 来源白名单解析
 */

import { describe, expect, it } from "vitest";
import { isOriginAllowed, parseAllowedOrigins } from "../src/lib/cors";

describe("parseAllowedOrigins", () => {
  it("默认只放行本地前端", () => {
    expect(parseAllowedOrigins(undefined)).toEqual(["http://localhost:3220"]);
    expect(parseAllowedOrigins("   ")).toEqual(["http://localhost:3220"]);
  });

  it("支持逗号分隔的多个来源", () => {
    expect(
      parseAllowedOrigins("https://cad.example.com, http://localhost:3220"),
    ).toEqual(["https://cad.example.com", "http://localhost:3220"]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["https://cad.example.com", "http://localhost:3220"];

  it("放行白名单来源与无 Origin 请求", () => {
    expect(isOriginAllowed("https://cad.example.com", allowed)).toBe(true);
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it("拒绝未知来源", () => {
    expect(isOriginAllowed("https://evil.example.com", allowed)).toBe(false);
  });
});
