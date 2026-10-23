/**
 * rateLimit.test.ts — 认证 / AI 接口限流集成测试
 *
 * 通过环境变量调小配额，验证 429、Retry-After 与 RateLimit-* 响应头，
 * 并覆盖 RATE_LIMIT_DISABLED 的紧急关闭开关。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
    },
    lLMModel: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import { createApp } from "../src/app";
import { generateToken } from "../src/middleware/auth";
import { metrics } from "../src/lib/metrics";

const token = generateToken({
  id: "user-1",
  email: "alice@example.com",
  username: "alice",
});

describe("rate limiting", () => {
  beforeEach(() => {
    metrics.reset();
    vi.stubEnv("AUTH_RATE_LIMIT_MAX", "2");
    vi.stubEnv("AUTH_RATE_LIMIT_WINDOW_MS", "60000");
    vi.stubEnv("AI_RATE_LIMIT_MAX", "2");
    vi.stubEnv("AI_RATE_LIMIT_WINDOW_MS", "60000");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("认证接口超过配额后返回 429 与重试提示", async () => {
    const app = createApp();

    const first = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "" });
    expect(first.status).toBe(400);
    expect(first.headers["ratelimit-limit"]).toBe("2");
    expect(first.headers["ratelimit-remaining"]).toBe("1");

    const second = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "" });
    expect(second.status).toBe(400);
    expect(second.headers["ratelimit-remaining"]).toBe("0");

    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.body.error).toBe("Too Many Requests");
    expect(blocked.body.requestId).toBeDefined();
    expect(metrics.snapshot().counters["http.rate_limited"]).toBe(1);
  });

  it("AI 对话超过配额后返回 429", async () => {
    const app = createApp();

    for (let i = 0; i < 2; i += 1) {
      const res = await request(app)
        .post("/api/llm/chat")
        .set("Authorization", `Bearer ${token}`)
        .send({ modelId: "model-1" });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("message is required");
    }

    const blocked = await request(app)
      .post("/api/llm/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ modelId: "model-1" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["ratelimit-limit"]).toBe("2");
    expect(metrics.snapshot().counters["http.rate_limited"]).toBe(1);
  });

  it("只读的 GET /api/auth/me 不占用认证配额", async () => {
    const app = createApp();

    for (let i = 0; i < 4; i += 1) {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.headers["ratelimit-limit"]).toBeUndefined();
    }
  });

  it("RATE_LIMIT_DISABLED=true 时跳过计数", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "true");
    const app = createApp();

    for (let i = 0; i < 4; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "not-an-email", password: "" });
      expect(res.status).toBe(400);
      expect(res.headers["ratelimit-limit"]).toBeUndefined();
    }
  });
});
