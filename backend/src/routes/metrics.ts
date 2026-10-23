/**
 * metrics.ts — 运行指标 HTTP 端点
 *
 * GET /api/metrics 返回计数器、仪表盘、直方图（含 P95）以及
 * AI 失败率 / SSE 中断率等派生指标。
 * 配置 METRICS_TOKEN 后需携带 Bearer Token 访问，避免公开暴露。
 */

import { Router, Request, Response } from "express";
import { metrics, ratio } from "../lib/metrics";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  const expectedToken = process.env.METRICS_TOKEN;
  if (
    expectedToken &&
    req.header("authorization") !== `Bearer ${expectedToken}`
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const snapshot = metrics.snapshot();
  const memory = process.memoryUsage();

  return res.json({
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
    ...snapshot,
    rates: {
      aiFailureRate: ratio(
        snapshot.counters["ai.failures"] ?? 0,
        snapshot.counters["ai.requests"] ?? 0,
      ),
      sseAbortRate: ratio(
        snapshot.counters["sse.aborted"] ?? 0,
        snapshot.counters["sse.started"] ?? 0,
      ),
    },
  });
});

export default router;
