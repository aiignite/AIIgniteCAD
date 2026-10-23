/**
 * versions.test.ts — 项目版本接口
 *
 * 覆盖鉴权、列表分页、快照校验、递增编号与详情读取。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

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
      projectVersion: createModelMock(),
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

const token = generateToken({
  id: "user-1",
  email: "alice@example.com",
  username: "alice",
});

const authed = (method: "get" | "post", url: string) =>
  request(app)[method](url).set("Authorization", `Bearer ${token}`);

const snapshot = {
  elements: [
    { id: "line-1", type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { id: "circle-1", type: "CIRCLE", center: { x: 5, y: 5 }, radius: 2 },
  ],
  layers: [],
  settings: { units: "mm" },
};

describe("项目版本接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(prismaMock),
    );
  });

  it("未携带 token 时返回 401", async () => {
    const res = await request(app).get("/api/projects/project-1/versions");

    expect(res.status).toBe(401);
  });

  it("项目不存在时返回 404", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);

    const res = await authed("get", "/api/projects/missing/versions");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Project not found");
  });

  it("列表只返回元数据并标记是否还有更多", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "project-1" });
    prismaMock.projectVersion.findMany.mockResolvedValue([
      {
        id: "v3",
        projectId: "project-1",
        versionNumber: 3,
        elementCount: 2,
        commitMessage: "latest",
        createdBy: "user-1",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
      {
        id: "v2",
        projectId: "project-1",
        versionNumber: 2,
        elementCount: 1,
        commitMessage: "older",
        createdBy: "user-1",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        id: "v1",
        projectId: "project-1",
        versionNumber: 1,
        elementCount: 0,
        commitMessage: null,
        createdBy: "user-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await authed("get", "/api/projects/project-1/versions?limit=2");

    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.versions[0]).not.toHaveProperty("snapshotData");
    expect(prismaMock.projectVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: { versionNumber: "desc" } }),
    );
  });

  it("创建版本时拒绝非数组快照", async () => {
    const res = await authed("post", "/api/projects/project-1/versions").send({
      snapshotData: { elements: "nope" },
    });

    expect(res.status).toBe(400);
  });

  it("创建版本时基于最新编号递增并记录图元数量", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "project-1" });
    prismaMock.projectVersion.findFirst.mockResolvedValue({
      versionNumber: 4,
      snapshotData: {
        elements: [{ id: "line-0", type: "LINE", layer: "0" }],
      },
    });
    prismaMock.projectVersion.create.mockResolvedValue({
      id: "version-5",
      projectId: "project-1",
      versionNumber: 5,
      elementCount: 2,
      commitMessage: "Before cleanup",
      changeSummary: {
        added: 2,
        removed: 1,
        addedByType: { LINE: 1, CIRCLE: 1 },
        removedByType: { LINE: 1 },
        layersTouched: ["0"],
      },
      createdBy: "user-1",
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
    });

    const res = await authed("post", "/api/projects/project-1/versions").send({
      snapshotData: snapshot,
      commitMessage: "  Before cleanup  ",
    });

    expect(res.status).toBe(201);
    expect(res.body.version.versionNumber).toBe(5);
    expect(prismaMock.projectVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          versionNumber: 5,
          elementCount: 2,
          commitMessage: "Before cleanup",
          createdBy: "user-1",
          changeSummary: {
            added: 2,
            removed: 1,
            modified: 0,
            addedByType: { LINE: 1, CIRCLE: 1 },
            removedByType: { LINE: 1 },
            modifiedByType: {},
            layersTouched: ["0"],
          },
        }),
      }),
    );
  });

  it("读取不存在的版本返回 404", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "project-1" });
    prismaMock.projectVersion.findFirst.mockResolvedValue(null);

    const res = await authed("get", "/api/projects/project-1/versions/missing");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Version not found");
  });

  it("读取版本详情返回完整快照", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "project-1" });
    prismaMock.projectVersion.findFirst.mockResolvedValue({
      id: "version-1",
      projectId: "project-1",
      versionNumber: 1,
      snapshotData: snapshot,
      elementCount: 2,
      commitMessage: "First",
      createdBy: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await authed("get", "/api/projects/project-1/versions/version-1");

    expect(res.status).toBe(200);
    expect(res.body.version.snapshotData.elements).toHaveLength(2);
    expect(prismaMock.projectVersion.findFirst).toHaveBeenCalledWith({
      where: { id: "version-1", projectId: "project-1" },
    });
  });
});
