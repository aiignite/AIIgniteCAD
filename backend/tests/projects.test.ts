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
    createMany: vi.fn(),
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
      layer: createModelMock(),
      drawingSettings: {
        ...createModelMock(),
        upsert: vi.fn(),
      },
      idempotencyKey: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn(),
      },
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
    // 事务 mock 直接把回调交给 prismaMock 自身执行
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
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

  it("PUT /api/projects/:id 在同一事务内替换图层并 upsert 绘图设置", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.project.findUnique.mockResolvedValue({
      id: "project-1",
      layers: [],
      drawingSettings: { units: "cm" },
    });

    const res = await authedRequest("put", "/api/projects/project-1").send({
      name: "Drawing A",
      layers: [
        { name: "0", color: "#ffffff", isVisible: true },
        { name: "DIM", color: "#4ade80", isLocked: true, lineType: "DASHED" },
      ],
      drawingSettings: {
        units: "cm",
        gridSpacing: 25,
        snapDistance: 5,
        dimScale: 2,
        dimPrecision: 3,
      },
    });

    expect(res.status).toBe(200);
    // 图层整份替换：先删后建，displayOrder 按载荷顺序生成
    expect(prismaMock.layer.deleteMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
    });
    expect(prismaMock.layer.createMany).toHaveBeenCalledWith({
      data: [
        {
          name: "0",
          color: "#ffffff",
          isVisible: true,
          isLocked: false,
          lineType: "CONTINUOUS",
          projectId: "project-1",
          displayOrder: 0,
        },
        {
          name: "DIM",
          color: "#4ade80",
          isVisible: true,
          isLocked: true,
          lineType: "DASHED",
          projectId: "project-1",
          displayOrder: 1,
        },
      ],
    });
    expect(prismaMock.drawingSettings.upsert).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      create: {
        projectId: "project-1",
        units: "cm",
        gridSpacing: 25,
        snapDistance: 5,
        dimScale: 2,
        dimPrecision: 3,
      },
      update: {
        units: "cm",
        gridSpacing: 25,
        snapDistance: 5,
        dimScale: 2,
        dimPrecision: 3,
      },
    });
    expect(res.body.project.drawingSettings).toEqual({ units: "cm" });
  });

  it("PUT /api/projects/:id 拒绝非法图层与绘图设置载荷", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const duplicateName = await authedRequest("put", "/api/projects/project-1").send({
      layers: [
        { name: "0", color: "#fff" },
        { name: "0", color: "#000" },
      ],
    });
    expect(duplicateName.status).toBe(400);
    expect(duplicateName.body.message).toBe("Duplicate layer name: 0");

    const emptyName = await authedRequest("put", "/api/projects/project-1").send({
      layers: [{ name: "  ", color: "#fff" }],
    });
    expect(emptyName.status).toBe(400);

    const badSettings = await authedRequest("put", "/api/projects/project-1").send({
      drawingSettings: { gridSpacing: -1 },
    });
    expect(badSettings.status).toBe(400);
    expect(badSettings.body.message).toBe(
      "drawingSettings.gridSpacing must be a positive number",
    );

    const badPrecision = await authedRequest("put", "/api/projects/project-1").send({
      drawingSettings: { dimPrecision: 9 },
    });
    expect(badPrecision.status).toBe(400);

    const badUnits = await authedRequest("put", "/api/projects/project-1").send({
      drawingSettings: { units: "mile" },
    });
    expect(badUnits.status).toBe(400);

    expect(prismaMock.layer.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.drawingSettings.upsert).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
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

  it("POST /api/projects/:id/elements 缺少稳定图元 id 时返回 400", async () => {
    const res = await authedRequest(
      "post",
      "/api/projects/project-1/elements",
    ).send({ elements: [{ type: "LINE" }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("elements[0].id must be a non-empty string");
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
  });

  it("POST /api/projects/:id/elements 重复图元 id 时返回 400", async () => {
    const res = await authedRequest(
      "post",
      "/api/projects/project-1/elements",
    ).send({
      elements: [
        { id: "a", type: "LINE" },
        { id: "a", type: "LINE" },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Duplicate element id: a");
  });

  it("POST /api/projects/:id/elements 按稳定 id 增量更新、创建与软删除", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    prismaMock.element.findMany.mockResolvedValue([
      { id: "row-a", elementId: "a" },
    ]);
    prismaMock.element.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));

    const res = await authedRequest(
      "post",
      "/api/projects/project-1/elements",
    ).send({
      elements: [
        { id: "a", type: "LINE", color: "#111111", layer: "0" },
        { id: "b", type: "LINE", color: "#222222", layer: "0" },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      count: 2,
      created: 1,
      updated: 1,
      deleted: 1,
      conflict: false,
    });

    expect(prismaMock.element.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          isDeleted: false,
          elementId: { in: ["a", "b"] },
        },
      }),
    );
    expect(prismaMock.element.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "row-a" },
        data: expect.objectContaining({ elementId: "a" }),
      }),
    );
    expect(prismaMock.element.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          elementId: "b",
        }),
      }),
    );
    expect(prismaMock.element.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          isDeleted: false,
          elementId: { notIn: ["a", "b"] },
        },
        data: { isDeleted: true },
      }),
    );
    expect(prismaMock.element.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.element.update).toHaveBeenCalledTimes(1);
  });
});
