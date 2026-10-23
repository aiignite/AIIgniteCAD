/**
 * imports.test.ts — DWG 导入接口
 *
 * 转换器本身单独测试；这里覆盖鉴权、字节流解析、文件头校验与错误状态映射。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import app from "../src/app";
import { generateToken } from "../src/middleware/auth";

const token = generateToken({ id: "user-1", email: "alice@example.com", username: "alice" });
const DWG = Buffer.from("AC1027\x00\x00\x00\x00binary", "binary");

const postDwg = (body: Buffer, authenticated = true) => {
  const req = request(app)
    .post("/api/import/dwg")
    .set("Content-Type", "application/octet-stream");
  if (authenticated) req.set("Authorization", `Bearer ${token}`);
  return req.send(body);
};

describe("DWG 导入接口", () => {
  const originalUrl = process.env.DWG_CONVERTER_URL;

  beforeEach(() => {
    process.env.DWG_CONVERTER_URL = "http://dwg-converter:3310";
    process.env.RATE_LIMIT_DISABLED = "true";
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
      passwordHash: "hash",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF")),
    );
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DWG_CONVERTER_URL;
    else process.env.DWG_CONVERTER_URL = originalUrl;
    delete process.env.RATE_LIMIT_DISABLED;
    vi.unstubAllGlobals();
  });

  it("鉴权后把 DWG 转成 DXF 文本返回", async () => {
    const response = await postDwg(DWG);

    expect(response.status).toBe(200);
    expect(response.body.dxf).toContain("ENTITIES");
    expect(response.body.bytes).toBe(DWG.length);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("未登录返回 401", async () => {
    const response = await postDwg(DWG, false);
    expect(response.status).toBe(401);
  });

  it("非法 DWG 文件头返回 400 且不调用转换器", async () => {
    const response = await postDwg(Buffer.from("not a dwg"));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_DWG");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("转换器未配置时返回 503", async () => {
    delete process.env.DWG_CONVERTER_URL;
    const response = await postDwg(DWG);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("DWG_CONVERTER_UNAVAILABLE");
  });

  it("转换失败映射为 422", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 422 })));
    const response = await postDwg(DWG);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("DWG_CONVERSION_FAILED");
  });
});
