/**
 * index.ts — 后端服务入口
 *
 * 负责创建 HTTP Server、挂载 WebSocket、执行数据库迁移并监听端口。
 * Express 应用的装配位于 app.ts，数据库客户端位于 lib/prisma.ts，
 * 这样测试可以直接引入 app 而不触发端口监听。
 */

import "dotenv/config";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { execSync } from "child_process";

import app from "./app";
import { prisma } from "./lib/prisma";
import { logger } from "./lib/logger";
import { verifyToken } from "./middleware/auth";
import { parseAllowedOrigins } from "./lib/cors";
import {
  canJoinProject,
  isUuid,
  pickPeerSocket,
  sanitizeCursor,
  sanitizePatch,
  sanitizeStateSnapshot,
} from "./lib/collaborationProtocol";

const PORT = process.env.PORT || 3225;

// 创建 HTTP 服务
const server = http.createServer(app);

/**
 * Socket.IO 服务实例，用于项目房间内的实时协作广播。
 */
const io = new SocketIOServer(server, {
  cors: {
    origin: parseAllowedOrigins(process.env.FRONTEND_URL),
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ============================================================================
// WEBSOCKET HANDLERS
// ============================================================================

/** 项目房间名，所有广播都限定在已鉴权的房间内 */
const roomOf = (projectId: string) => `project:${projectId}`;

/** 握手阶段校验 JWT；未通过连接直接拒绝，避免匿名客户端进入任何房间 */
io.use((socket, next) => {
  const token =
    typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token
      : "";
  const decoded = token ? verifyToken(token) : null;
  if (!decoded?.id) {
    next(new Error("Unauthorized"));
    return;
  }
  socket.data.userId = decoded.id;
  socket.data.username =
    typeof decoded.username === "string" ? decoded.username : "协作者";
  socket.data.projectId = null;
  next();
});

io.on("connection", (socket) => {
  logger.debug("Socket client connected", {
    socketId: socket.id,
    userId: socket.data.userId,
  });

  // 加入项目房间：先校验项目归属，再加入并回传当前在线成员
  socket.on("join-project", async (payload: { projectId?: unknown }) => {
    const projectId = payload?.projectId;
    if (!isUuid(projectId)) {
      socket.emit("collaboration-error", { message: "项目未同步或不存在" });
      return;
    }

    try {
      const allowed = await canJoinProject(socket.data.userId, projectId);
      if (!allowed) {
        socket.emit("collaboration-error", { message: "无权加入该项目" });
        return;
      }
    } catch (error) {
      logger.error("Socket project ownership check failed", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : String(error),
      });
      socket.emit("collaboration-error", { message: "协作服务暂不可用" });
      return;
    }

    if (socket.data.projectId) {
      // 切换项目时先通知旧房间，避免对方一直显示已离线成员
      socket.to(roomOf(socket.data.projectId)).emit("user-left", {
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
      socket.leave(roomOf(socket.data.projectId));
    }
    socket.data.projectId = projectId;
    socket.join(roomOf(projectId));

    const peers: { socketId: string; username: string }[] = [];
    const members = io.sockets.adapter.rooms.get(roomOf(projectId));
    for (const socketId of members ?? []) {
      if (socketId === socket.id) continue;
      const peer = io.sockets.sockets.get(socketId);
      peers.push({
        socketId,
        username: peer?.data.username || "协作者",
      });
    }

    socket.emit("project-joined", { projectId, selfId: socket.id, peers });
    socket.to(roomOf(projectId)).emit("user-joined", {
      socketId: socket.id,
      username: socket.data.username,
      timestamp: new Date().toISOString(),
    });
    logger.debug("Socket joined project", { socketId: socket.id, projectId });
  });

  // 离开项目房间
  socket.on("leave-project", () => {
    const projectId = socket.data.projectId;
    if (!projectId) return;
    socket.leave(roomOf(projectId));
    socket.data.projectId = null;
    socket.to(roomOf(projectId)).emit("user-left", {
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // 批量图元差集：协作主通道，全员可写、最后写入胜
  socket.on("element-patch", (data: { projectId?: unknown; patch?: unknown }) => {
    const projectId = socket.data.projectId;
    if (!projectId || data?.projectId !== projectId) return;
    const patch = sanitizePatch(data.patch);
    if (!patch) return;
    socket.to(roomOf(projectId)).emit("element-patch", {
      patch,
      updatedBy: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // 初始图纸对账：新加入者请求状态，转发给房间内一个现有成员应答
  socket.on("state-request", (data: { projectId?: unknown }) => {
    const projectId = socket.data.projectId;
    if (!projectId || data?.projectId !== projectId) return;
    const peerId = pickPeerSocket(
      io.sockets.adapter.rooms.get(roomOf(projectId)),
      socket.id,
    );
    if (!peerId) return;
    io.to(peerId).emit("state-request", { requesterId: socket.id });
  });

  // 初始图纸快照：只定向转发给请求方，不在房间内广播整张图纸
  socket.on(
    "state-snapshot",
    (data: {
      projectId?: unknown;
      targetId?: unknown;
      elements?: unknown;
      truncated?: unknown;
    }) => {
      const projectId = socket.data.projectId;
      if (!projectId || data?.projectId !== projectId) return;
      const snapshot = sanitizeStateSnapshot(data);
      if (!snapshot) return;
      const room = io.sockets.adapter.rooms.get(roomOf(projectId));
      if (!room || !room.has(snapshot.targetId)) return;
      io.to(snapshot.targetId).emit("state-snapshot", {
        elements: snapshot.elements,
        truncated: snapshot.truncated,
      });
    },
  );

  // 单元素广播（保留给旧客户端），同样要求已加入对应房间
  const relayElement = (
    event: string,
    data: { projectId?: unknown; element?: unknown },
    key: "element",
  ) => {
    const projectId = socket.data.projectId;
    if (!projectId || data?.projectId !== projectId) return;
    const sanitized = sanitizePatch({ upserts: [data.element], deletes: [] });
    if (!sanitized) return;
    socket.to(roomOf(projectId)).emit(event, {
      [key]: sanitized.upserts[0],
      updatedBy: socket.id,
      timestamp: new Date().toISOString(),
    });
  };

  socket.on("element-updated", (data) => relayElement("element-updated", data, "element"));
  socket.on("element-created", (data) => relayElement("element-created", data, "element"));

  socket.on("element-deleted", (data: { projectId?: unknown; elementId?: unknown }) => {
    const projectId = socket.data.projectId;
    if (!projectId || data?.projectId !== projectId) return;
    if (typeof data.elementId !== "string") return;
    socket.to(roomOf(projectId)).emit("element-deleted", {
      elementId: data.elementId,
      deletedBy: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("block-inserted", (data: { projectId?: unknown; blockReference?: unknown }) => {
    const projectId = socket.data.projectId;
    if (!projectId || data?.projectId !== projectId) return;
    const sanitized = sanitizePatch({
      upserts: [data.blockReference],
      deletes: [],
    });
    if (!sanitized) return;
    socket.to(roomOf(projectId)).emit("block-inserted", {
      blockReference: sanitized.upserts[0],
      insertedBy: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // 光标位置：只透出房间内的有限坐标
  socket.on("cursor-move", (data: { projectId?: unknown; x?: unknown; y?: unknown }) => {
    const projectId = socket.data.projectId;
    if (!projectId || data?.projectId !== projectId) return;
    const cursor = sanitizeCursor({ x: data.x, y: data.y });
    if (!cursor) return;
    socket.to(roomOf(projectId)).emit("cursor-move", {
      socketId: socket.id,
      username: socket.data.username,
      x: cursor.x,
      y: cursor.y,
      timestamp: new Date().toISOString(),
    });
  });

  // 断开连接：通知仍在房间内的客户端移除在线标记与光标
  socket.on("disconnect", () => {
    const projectId = socket.data.projectId;
    if (projectId) {
      socket.to(roomOf(projectId)).emit("user-left", {
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    }
    logger.debug("Socket client disconnected", { socketId: socket.id });
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * 启动服务：等待数据库就绪、执行迁移、监听端口。
 */
async function startServer() {
  try {
    // 数据库就绪重试：最多 30 次，每次间隔 1 秒
    let retries = 30;
    while (retries > 0) {
      try {
        await prisma.$connect();
        logger.info("Connected to PostgreSQL database");
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          throw error;
        }
        logger.warn("Database not ready; retrying", { attemptsLeft: retries });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 生产模式执行迁移（deploy 不会生成新迁移文件）
    try {
      execSync("npx prisma migrate deploy", { stdio: "inherit" });
      logger.info("Database migrations applied");
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        logger.error("Database migration failed; refusing to start with a stale schema", {
          error,
        });
        throw error;
      }
      logger.warn("Failed to apply migrations; continuing with current schema", {
        error,
      });
    }

    // 库里还没有 admin 时把最早注册的用户提为管理员（幂等）
    const { ensureFirstAdmin } = await import("./lib/bootstrapAdmin");
    await ensureFirstAdmin();

    server.listen(PORT, () => {
      logger.info("Backend server started", {
        environment: process.env.NODE_ENV || "development",
        port: Number(PORT),
        healthCheck: `http://localhost:${PORT}/health`,
        apiEndpoint: `http://localhost:${PORT}/api`,
        metricsEndpoint: `http://localhost:${PORT}/api/metrics`,
      });
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

// 优雅退出：SIGINT
process.on("SIGINT", async () => {
  logger.info("Graceful shutdown started", { signal: "SIGINT" });

  io.close();
  await prisma.$disconnect();

  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

// 优雅退出：SIGTERM
process.on("SIGTERM", async () => {
  logger.info("Graceful shutdown started", { signal: "SIGTERM" });
  await prisma.$disconnect();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

startServer();

export { app, io, prisma };
