/**
 * health.test.ts — 存活与就绪探针
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock }));

import app from "../src/app";

describe("健康探针", () => {
  beforeEach(() => {
    prismaMock.$queryRaw.mockReset();
  });

  it("/health 不依赖数据库", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OK");
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("/ready 在数据库可用时返回 READY", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("READY");
  });

  it("/ready 在数据库不可达时返回 503", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"));
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("NOT_READY");
  });
});
