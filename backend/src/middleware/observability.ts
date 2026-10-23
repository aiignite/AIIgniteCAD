/**
 * observability.ts — 请求 ID、访问日志与 SSE 生命周期指标
 *
 * 每个请求都会获得 X-Request-Id（优先沿用上游传入值），
 * 访问完成时输出一条 JSON 日志并记录耗时、状态码和活跃请求数。
 */

import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import type { AuthRequest } from "./auth";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header("x-request-id")?.trim();
  req.requestId =
    incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();
  metrics.increment("http.active_requests");

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    metrics.decrement("http.active_requests");

    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const routePath =
      typeof req.route?.path === "string"
        ? `${req.baseUrl}${req.route.path}`
        : req.path;

    metrics.increment("http.requests");
    metrics.increment(`http.responses.status_${res.statusCode}`);
    metrics.observe("http.duration_ms", durationMs);
    if (res.statusCode >= 500) metrics.increment("http.errors.server");
    if (res.statusCode >= 400 && res.statusCode < 500) {
      metrics.increment("http.errors.client");
    }

    if (req.path === "/health" && res.statusCode < 400) return;

    const entry = {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      route: routePath,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: (req as AuthRequest).user?.id,
    };

    if (res.statusCode >= 500) {
      logger.error("HTTP request failed", entry);
    } else if (res.statusCode >= 400) {
      logger.warn("HTTP request rejected", entry);
    } else {
      logger.info("HTTP request completed", entry);
    }
  };

  res.once("finish", settle);
  res.once("close", settle);
  next();
}

export interface SseStreamTracker {
  complete(): void;
  fail(reason?: string): void;
}

/**
 * 跟踪 SSE 流：客户端在发送 done 之前断开计为 aborted，
 * 供应商/服务端错误计为 failed，正常结束计为 completed。
 */
export function trackSseStream(
  res: Response,
  meta: { requestId?: string; provider?: string } = {},
): SseStreamTracker {
  metrics.increment("sse.started");
  metrics.increment("sse.active");

  let settled = false;
  const settle = (outcome: "completed" | "failed" | "aborted") => {
    if (settled) return;
    settled = true;
    metrics.decrement("sse.active");
    metrics.increment(`sse.${outcome}`);
  };

  res.once("close", () => settle("aborted"));

  return {
    complete: () => settle("completed"),
    fail: (reason?: string) => {
      settle("failed");
      if (reason) {
        logger.warn("SSE stream failed", { ...meta, reason });
      }
    },
  };
}
