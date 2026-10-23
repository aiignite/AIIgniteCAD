/**
 * telemetry.ts — 前端遥测入口
 *
 * 接收浏览器批量上报的运行时错误与同步状态快照：
 * - 错误事件写入结构化日志并计入 client.errors
 * - sync-status 更新 pending / failed 仪表盘，用于观察离线积压
 */

import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";

const router = Router();

const ERROR_EVENT_TYPES = new Set([
  "error",
  "unhandled-rejection",
  "sync-error",
  "ai-error",
]);

const ALLOWED_EVENT_TYPES = new Set([
  ...ERROR_EVENT_TYPES,
  "sync-status",
  "client-info",
]);

const MAX_EVENTS_PER_BATCH = 50;
const MAX_CONTEXT_KEYS = 30;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const sanitizeContext = (
  context: unknown,
): Record<string, unknown> | undefined => {
  const record = asRecord(context);
  if (!record) return undefined;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record).slice(0, MAX_CONTEXT_KEYS)) {
    output[key.slice(0, 64)] = value;
  }
  return output;
};

router.post("/events", (req: Request, res: Response) => {
  const body = asRecord(req.body);
  const rawEvents = body?.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    return res.status(400).json({ error: "events array is required" });
  }

  let accepted = 0;
  for (const rawEvent of rawEvents.slice(0, MAX_EVENTS_PER_BATCH)) {
    const event = asRecord(rawEvent);
    if (!event) continue;

    const type =
      typeof event.type === "string" && ALLOWED_EVENT_TYPES.has(event.type)
        ? event.type
        : "client-info";
    const message =
      typeof event.message === "string" ? event.message.slice(0, 500) : undefined;
    const context = sanitizeContext(event.context);

    metrics.increment("client.events");
    if (ERROR_EVENT_TYPES.has(type)) {
      metrics.increment("client.errors");
      logger.error("Client telemetry", {
        requestId: req.requestId,
        type,
        message,
        context,
        userAgent: req.header("user-agent")?.slice(0, 200),
        reportedAt: typeof event.timestamp === "string" ? event.timestamp : undefined,
      });
    } else {
      if (type === "sync-status" && context) {
        const pending = asFiniteNumber(context.pendingCount);
        const failed = asFiniteNumber(context.failedCount);
        if (pending !== undefined) metrics.gauge("sync.pending", pending);
        if (failed !== undefined) metrics.gauge("sync.failed", failed);
      }
      logger.info("Client telemetry", {
        requestId: req.requestId,
        type,
        context,
        reportedAt: typeof event.timestamp === "string" ? event.timestamp : undefined,
      });
    }
    accepted += 1;
  }

  return res.status(202).json({ accepted });
});

export default router;
