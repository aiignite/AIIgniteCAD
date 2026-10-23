/**
 * observability.test.ts — 请求 ID、结构化日志指标与遥测入口
 *
 * 覆盖：X-Request-Id 透传/生成、指标端点字段、遥测批量接收、
 * 指标端点鉴权、SSE 中断计数与日志脱敏。
 */

import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Response } from "express";

import app from "../src/app";
import { metrics } from "../src/lib/metrics";
import { redact } from "../src/lib/logger";
import { trackSseStream } from "../src/middleware/observability";

describe("可观测性", () => {
  beforeEach(() => {
    metrics.reset();
    process.env.LOG_LEVEL = "error";
    delete process.env.METRICS_TOKEN;
  });

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("为每个请求生成或沿用 X-Request-Id", async () => {
    const generated = await request(app).get("/health");
    expect(generated.status).toBe(200);
    expect(generated.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const propagated = await request(app)
      .get("/health")
      .set("X-Request-Id", "trace-from-upstream");
    expect(propagated.headers["x-request-id"]).toBe("trace-from-upstream");

    const notFound = await request(app).get("/api/does-not-exist");
    expect(notFound.status).toBe(404);
    expect(notFound.body.requestId).toBe(notFound.headers["x-request-id"]);
  });

  it("指标端点暴露请求耗时直方图、错误计数与派生比率", async () => {
    await request(app).get("/health");
    await request(app).get("/api/does-not-exist");

    const response = await request(app).get("/api/metrics");
    expect(response.status).toBe(200);

    expect(response.body.counters["http.requests"]).toBeGreaterThanOrEqual(2);
    expect(response.body.counters["http.responses.status_200"]).toBeGreaterThanOrEqual(1);
    expect(response.body.counters["http.responses.status_404"]).toBeGreaterThanOrEqual(1);
    expect(response.body.counters["http.errors.client"]).toBeGreaterThanOrEqual(1);

    const duration = response.body.histograms["http.duration_ms"];
    expect(duration.count).toBeGreaterThanOrEqual(2);
    expect(duration.p95).toBeGreaterThanOrEqual(0);
    expect(response.body.rates).toHaveProperty("aiFailureRate");
    expect(response.body.rates).toHaveProperty("sseAbortRate");
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("接收遥测事件并更新同步积压仪表盘", async () => {
    const response = await request(app)
      .post("/api/telemetry/events")
      .send({
        events: [
          {
            type: "error",
            message: "boom",
            timestamp: new Date().toISOString(),
            context: { component: "Canvas" },
          },
          {
            type: "sync-status",
            timestamp: new Date().toISOString(),
            context: { pendingCount: 3, failedCount: 1, online: false },
          },
        ],
      });

    expect(response.status).toBe(202);
    expect(response.body.accepted).toBe(2);

    const snapshot = metrics.snapshot();
    expect(snapshot.counters["client.events"]).toBe(2);
    expect(snapshot.counters["client.errors"]).toBe(1);
    expect(snapshot.gauges["sync.pending"]).toBe(3);
    expect(snapshot.gauges["sync.failed"]).toBe(1);
  });

  it("拒绝空的遥测批次", async () => {
    const response = await request(app)
      .post("/api/telemetry/events")
      .send({ events: [] });
    expect(response.status).toBe(400);
  });

  it("配置 METRICS_TOKEN 后指标端点要求 Bearer Token", async () => {
    process.env.METRICS_TOKEN = "metrics-secret";

    const unauthorized = await request(app).get("/api/metrics");
    expect(unauthorized.status).toBe(401);

    const authorized = await request(app)
      .get("/api/metrics")
      .set("Authorization", "Bearer metrics-secret");
    expect(authorized.status).toBe(200);
  });

  it("SSE 客户端断开计入中断率，complete 后不重复计数", () => {
    const res = new EventEmitter();
    const tracker = trackSseStream(res as unknown as Response);

    res.emit("close");
    tracker.complete();

    const snapshot = metrics.snapshot();
    expect(snapshot.counters["sse.started"]).toBe(1);
    expect(snapshot.counters["sse.aborted"]).toBe(1);
    expect(snapshot.counters["sse.completed"]).toBeUndefined();
    expect(snapshot.counters["sse.active"]).toBe(0);
  });

  it("日志脱敏敏感字段并限制嵌套深度", () => {
    const redacted = redact({
      password: "p@ss",
      nested: { apiKey: "key", authorization: "Bearer x" },
      token: "abc",
      safe: "ok",
      deep: { a: { b: { c: { d: { e: { f: "too-deep" } } } } } },
    }) as Record<string, unknown>;

    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.token).toBe("[REDACTED]");
    expect(redacted.safe).toBe("ok");

    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.apiKey).toBe("[REDACTED]");
    expect(nested.authorization).toBe("[REDACTED]");
    expect(redacted.deep).toBeDefined();
  });
});
