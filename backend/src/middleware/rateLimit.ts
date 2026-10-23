/**
 * rateLimit.ts — 进程内固定窗口限流
 *
 * 保护认证与 AI 接口：同一调用方在一个窗口内超过配额后返回 429，
 * 并附带 RateLimit-* 与 Retry-After 响应头。
 * 计数保存在单进程内存中；多实例部署时应替换为 Redis 等共享存储。
 */

import { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";

export interface RateLimitOptions {
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的请求数 */
  max: number;
  /** 日志与指标中使用的限流域名称 */
  scope: string;
  /** 自定义调用方标识；默认优先使用已认证用户 id，其次使用 IP */
  keyGenerator?: (req: Request) => string;
  /** 命中时跳过限流（例如只读的会话查询） */
  skip?: (req: Request) => boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** 超过该数量时触发一次过期桶清理，避免伪造标识撑爆内存 */
const MAX_BUCKETS = 10_000;

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const defaultKey = (req: Request): string => {
  const userId = (req as Request & { user?: { id?: string } }).user?.id;
  return userId ? `user:${userId}` : `ip:${req.ip ?? "unknown"}`;
};

export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const keyFor = options.keyGenerator ?? defaultKey;

  return function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (
      process.env.RATE_LIMIT_DISABLED === "true" ||
      options.skip?.(req)
    ) {
      next();
      return;
    }

    const now = Date.now();
    const key = keyFor(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (buckets.size > MAX_BUCKETS) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    const remaining = Math.max(0, options.max - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (bucket.count > options.max) {
      metrics.increment("http.rate_limited");
      logger.warn("Rate limit exceeded", {
        requestId: req.requestId,
        scope: options.scope,
        path: req.path,
      });
      res.setHeader("Retry-After", String(resetSeconds));
      res.status(429).json({
        error: "Too Many Requests",
        message: "请求过于频繁，请稍后重试",
        code: "RATE_LIMITED",
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}

/** 认证写操作：默认每 15 分钟 20 次；GET /me 等只读查询不计数 */
export function authRateLimit() {
  return createRateLimiter({
    scope: "auth",
    max: positiveInt(process.env.AUTH_RATE_LIMIT_MAX, 20),
    windowMs: positiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60_000),
    skip: (req) => req.method === "GET",
  });
}

/** AI 对话：默认每分钟 30 次 */
export function aiRateLimit() {
  return createRateLimiter({
    scope: "ai",
    max: positiveInt(process.env.AI_RATE_LIMIT_MAX, 30),
    windowMs: positiveInt(process.env.AI_RATE_LIMIT_WINDOW_MS, 60_000),
  });
}

/** 会话读写：默认每 5 分钟 120 次；只读查询不计数 */
export function chatRateLimit() {
  return createRateLimiter({
    scope: "chat",
    max: positiveInt(process.env.CHAT_RATE_LIMIT_MAX, 120),
    windowMs: positiveInt(process.env.CHAT_RATE_LIMIT_WINDOW_MS, 5 * 60_000),
    skip: (req) => req.method === "GET",
  });
}

/** 技能管理：默认每 5 分钟 600 次；统计接口会扫描消息表，因此读写同限 */
export function skillRateLimit() {
  return createRateLimiter({
    scope: "skill",
    max: positiveInt(process.env.SKILL_RATE_LIMIT_MAX, 600),
    windowMs: positiveInt(process.env.SKILL_RATE_LIMIT_WINDOW_MS, 5 * 60_000),
  });
}

/** 块库读写：默认每 5 分钟 300 次 */
export function blockRateLimit() {
  return createRateLimiter({
    scope: "block",
    max: positiveInt(process.env.BLOCK_RATE_LIMIT_MAX, 300),
    windowMs: positiveInt(process.env.BLOCK_RATE_LIMIT_WINDOW_MS, 5 * 60_000),
  });
}
