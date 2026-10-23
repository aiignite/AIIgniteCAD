/**
 * app.ts — Express 应用装配
 *
 * 只负责注册中间件、路由与错误处理，不监听端口、不启动 WebSocket，
 * 便于通过 Supertest 在测试中直接对 app 发起请求。
 */

import "dotenv/config";
import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";

import authRoutes from "./routes/auth";
import projectRoutes from "./routes/projects";
import versionRoutes from "./routes/versions";
import llmRoutes from "./routes/llm";
import chatRoutes from "./routes/chat";
import { createLlmChatRouter } from "./routes/llmChat";
import blockRoutes from "./routes/blocks";
import assistantRoutes from "./routes/assistants";
import skillRoutes from "./routes/skills";
import importRoutes from "./routes/imports";
import metricsRoutes from "./routes/metrics";
import telemetryRoutes from "./routes/telemetry";
import { requestId, requestLogger } from "./middleware/observability";
import { aiRateLimit, authRateLimit } from "./middleware/rateLimit";
import { logger } from "./lib/logger";
import { metrics } from "./lib/metrics";
import { prisma } from "./lib/prisma";
import { isOriginAllowed, parseAllowedOrigins } from "./lib/cors";

const allowedOrigins = parseAllowedOrigins(process.env.FRONTEND_URL);

/**
 * 创建并装配 Express 应用实例。
 * 每次调用返回独立 app，测试之间不会互相污染中间件栈。
 */
export function createApp(): Express {
  const app: Express = express();

  // 请求 ID 与结构化访问日志（最先注册，确保所有响应都带 X-Request-Id）
  app.use(requestId);
  app.use(requestLogger);

  // 隐藏框架指纹
  app.disable("x-powered-by");

  // 站点挂在两级 nginx 之后（共享网关 + 前端容器），限流按 req.ip 计数，
  // 不认代理头会让所有访客挤进同一个桶，auth 配额几分钟内就被打满。
  app.set("trust proxy", 2);

  // 安全响应头：API 不承载文档，CSP 取最严格的 default-src 'none'
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'none'"],
          "form-action": ["'none'"],
          "object-src": ["'none'"],
        },
      },
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: false,
      },
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );

  // 跨域配置：默认只允许前端开发端口
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, isOriginAllowed(origin, allowedOrigins));
      },
      credentials: true,
      exposedHeaders: ["X-Request-Id"],
    }),
  );

  // 请求体解析
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // 响应压缩
  app.use(compression());

  // 健康检查：存活探针
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
    });
  });

  // 就绪探针：数据库不可达时返回 503，供容器编排摘除流量
  app.get("/ready", async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "READY", timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error("Readiness check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(503).json({ status: "NOT_READY", timestamp: new Date().toISOString() });
    }
  });

  // API 根路径说明
  app.get("/api", (_req: Request, res: Response) => {
    res.json({
      message: "AIIgniteCAD API Server",
      version: "1.0.0",
      endpoints: {
        auth: "/api/auth",
        projects: "/api/projects",
        elements: "/api/elements",
        blocks: "/api/blocks",
        blockReferences: "/api/block-references",
        layers: "/api/layers",
        versions: "/api/projects/:id/versions",
        chat: "/api/chat",
        assistants: "/api/assistants",
        skills: "/api/skills",
        import: "/api/import/dwg",
        metrics: "/api/metrics",
        telemetry: "/api/telemetry/events",
      },
    });
  });

  // 业务路由
  app.use("/api/auth", authRateLimit(), authRoutes);
  // 版本路由先于通用项目路由挂载，避免进入项目 router 后再鉴权一次
  app.use("/api/projects/:id/versions", versionRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/llm", llmRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/llm", createLlmChatRouter(aiRateLimit()));
  app.use("/api/blocks", blockRoutes);
  app.use("/api/assistants", assistantRoutes);
  app.use("/api/skills", skillRoutes);
  app.use("/api/import", importRoutes);
  app.use("/api/metrics", metricsRoutes);
  app.use("/api/telemetry", telemetryRoutes);

  // 404 处理
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: "Not Found",
      message: `Route ${req.method} ${req.path} not found`,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    });
  });

  // 全局错误处理
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    metrics.increment("http.errors.unhandled");
    logger.error("Unhandled request error", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      error: err,
    });

    res.status(500).json({
      error: "Internal Server Error",
      message:
        process.env.NODE_ENV === "production"
          ? "An error occurred"
          : err.message,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

/** 默认应用实例，供 index.ts 挂载 WebSocket 与 HTTP Server */
export const app = createApp();

export default app;
