/**
 * securityHeaders.test.ts — 安全响应头回归测试
 *
 * 锁定 CSP、HSTS、frame-ancestors 等关键头，避免后续调整中间件时被意外移除。
 */

import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";

describe("security headers", () => {
  it("健康检查返回严格的 CSP、HSTS 与防嵌套头", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);

    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");

    const hsts = res.headers["strict-transport-security"];
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
