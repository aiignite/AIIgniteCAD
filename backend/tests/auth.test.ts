/**
 * auth.test.ts — 认证接口集成测试
 *
 * 覆盖注册、登录、当前用户查询的主路径与鉴权失败分支。
 * Prisma 客户端被整体替换为 vi.fn 组成的 mock，测试不连接真实数据库。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";

/**
 * 构造一组 Prisma 模型 mock。
 * 每个模型都提供路由中会用到的方法，未使用的方法返回 undefined 即可。
 */
const { prismaMock } = vi.hoisted(() => {
  const createModelMock = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  });

  return {
    prismaMock: {
      user: createModelMock(),
      project: createModelMock(),
      drawingSettings: createModelMock(),
      layer: createModelMock(),
      assistant: createModelMock(),
      lLMModel: createModelMock(),
      chatSession: createModelMock(),
      $transaction: vi.fn(),
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    },
  };
});

vi.mock("../src/lib/prisma", () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import app from "../src/app";
import { generateToken } from "../src/middleware/auth";

/** 让新用户初始化工作区的数据库调用全部成功 */
function stubDefaultWorkspace() {
  prismaMock.project.count.mockResolvedValue(0);
  prismaMock.project.create.mockResolvedValue({ id: "project-1" });
  prismaMock.drawingSettings.create.mockResolvedValue({ id: "settings-1" });
  prismaMock.layer.create.mockResolvedValue({ id: "layer-1" });
  prismaMock.assistant.count.mockResolvedValue(0);
  prismaMock.lLMModel.findFirst.mockResolvedValue(null);
  prismaMock.lLMModel.create.mockResolvedValue({ id: "model-1" });
  prismaMock.assistant.create.mockResolvedValue({ id: "assistant-1" });
  prismaMock.chatSession.create.mockResolvedValue({ id: "session-1" });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("邮箱格式非法时返回 400", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ username: "alice", email: "not-an-email", password: "123456" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation Error");
  });

  it("邮箱已注册时返回 400", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        username: "alice2",
        email: "alice@example.com",
        password: "123456",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email already registered");
  });

  it("注册成功返回 201、token 与用户信息", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    stubDefaultWorkspace();

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        username: "alice",
        email: "alice@example.com",
        password: "123456",
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("alice@example.com");
    expect(prismaMock.project.create).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("用户不存在时返回 401", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "missing@example.com", password: "123456" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("密码错误时返回 401", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
      passwordHash: await bcrypt.hash("correct-password", 4),
      createdAt: new Date(),
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("登录成功返回 token", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
      passwordHash: await bcrypt.hash("123456", 4),
      createdAt: new Date(),
    });
    // 已有项目时跳过默认工作区初始化
    prismaMock.project.count.mockResolvedValue(1);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe("alice");
  });
});

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("缺少 token 时返回 401", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("No token provided");
  });

  it("token 非法时返回 401", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid or expired token");
  });

  it("token 有效但用户已删除时返回 404", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const token = generateToken({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("token 有效时返回当前用户", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = generateToken({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("user-1");
  });
});
