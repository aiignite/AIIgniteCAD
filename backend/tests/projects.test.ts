/**
 * projects.test.ts — 项目接口集成测试
 *
 * 覆盖鉴权失败、项目列表、创建、查询不存在、软删除等主路径。
 * 通过 mock Prisma 与签发真实 JWT，验证路由与中间件的协作。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Prisma 模型 mock，按路由实际调用的方法提供。
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
      element: createModelMock(),
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

/** 生成有效的登录 token */
const token = generateToken({
  id: "user-1",
  email: "alice@example.com",
  username: "alice",
});

/** 带鉴权头的请求辅助函数 */
function authedRequest(method: "get" | "post" | "put" | "delete", url: string) {
  return request(app)[method](url).set("Authorization", `Bearer ${token}`);
}

describe("项目接口鉴权", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未携带 token 时返回 401", async () => {
    const res = await request(app).get("/api/projects");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("No token provided");
  });

  it("用户不存在时返回 401", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await authedRequest("get", "/api/projects");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("User not found");
  });
});

describe("项目 CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
  });

  it("GET /api/projects 返回格式化后的项目列表", async () => {
    prismaMock.project.findMany.mockResolvedValue([
      {
        id: "project-1",
        name: "Drawing A",
        description: "demo",
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        lastOpenedAt: new Date("2026-01-03T00:00:00.000Z"),
        thumbnail: null,
        _count: { elements: 2 },
      },
    ]);

    const res = await authedRequest("get", "/api/projects");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.projects[0]).toMatchObject({
      id: "project-1",
      name: "Drawing A",
      lastModified: "2026-01-02T00:00:00.000Z",
      elementCount: 2,
    });
  });

  it("POST /api/projects 创建项目返回 201", async () => {
    prismaMock.project.create.mockResolvedValue({
      id: "project-2",
      name: "Untitled Drawing",
      drawingSettings: { id: "settings-1" },
    });

    const res = await authedRequest("post", "/api/projects").send({});

    expect(res.status).toBe(201);
    expect(res.body.project.id).toBe("project-2");
  });

  it("POST /api/projects 保存设计约定，非法约定返回 400", async () => {
    prismaMock.project.create.mockResolvedValue({
      id: "project-3",
      name: "Factory",
      drawingSettings: { id: "settings-1" },
    });

    const res = await authedRequest("post", "/api/projects").send({
      name: "Factory",
      designConventions: {
        standard: "GB/T 14689",
        units: "mm",
        textHeight: 3.5,
        dimensionPrecision: 2,
        layerRules: [{ name: "WALLS", purpose: "墙体" }],
        notes: ["门洞现场复核"],
      },
    });

    expect(res.status).toBe(201);
    expect(prismaMock.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          designConventions: expect.objectContaining({
            standard: "GB/T 14689",
            layerRules: [{ name: "WALLS", purpose: "墙体" }],
          }),
        }),
      }),
    );

    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    const invalid = await authedRequest("post", "/api/projects").send({
      name: "Bad",
      designConventions: { units: "mile" },
    });
    expect(invalid.status).toBe(400);
    expect(prismaMock.project.create).not.toHaveBeenCalled();
  });

  it("PUT /api/projects/:id 可更新或清空设计约定", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.project.findUnique.mockResolvedValue({ id: "project-1" });

    const res = await authedRequest("put", "/api/projects/project-1").send({
      designConventions: {
        standard: "ISO 128",
        units: "mm",
        textHeight: 5,
        dimensionPrecision: 1,
        layerRules: [],
        notes: [],
      },
    });
    expect(res.status).toBe(200);
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          designConventions: expect.objectContaining({ standard: "ISO 128", textHeight: 5 }),
        }),
      }),
    );

    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    prismaMock.project.findFirst.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.project.findUnique.mockResolvedValue({ id: "project-1" });
    const invalid = await authedRequest("put", "/api/projects/project-1").send({
      designConventions: { textHeight: -1 },
    });
    expect(invalid.status).toBe(400);
    expect(prismaMock.project.updateMany).not.toHaveBeenCalled();
  });

  it("GET /api/projects/:id 项目不存在时返回 404", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);

    const res = await authedRequest("get", "/api/projects/missing");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Project not found");
  });

  it("PUT /api/projects/:id 项目不属于当前用户时返回 404", async () => {
    prismaMock.project.updateMany.mockResolvedValue({ count: 0 });

    const res = await authedRequest("put", "/api/projects/project-1").send({
      name: "Renamed",
    });

    expect(res.status).toBe(404);
  });

  it("DELETE /api/projects/:id 执行软删除并返回成功", async () => {
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 });

    const res = await authedRequest("delete", "/api/projects/project-1");

    expect(res.status).toBe(200);
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { id: "project-1", userId: "user-1", isDeleted: false },
      data: { isDeleted: true },
    });
  });

  it("POST /api/projects/:id/elements 参数非数组时返回 400", async () => {
    const res = await authedRequest(
      "post",
      "/api/projects/project-1/elements",
    ).send({ elements: "not-an-array" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Elements must be an array");
  });
});
