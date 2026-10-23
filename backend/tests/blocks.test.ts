/**
 * blocks.test.ts — 块目录与块定义接口
 *
 * 目录接口必须把块元素一起返回，否则前端拿到的是空壳，
 * insert_block 展开不出图元；因此这里重点校验 elements 的还原与排序。
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
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn(),
  });

  return {
    prismaMock: {
      user: createModelMock(),
      project: createModelMock(),
      blockCategory: createModelMock(),
      blockDefinition: createModelMock(),
    },
  };
});

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import app from "../src/app";
import { generateToken } from "../src/middleware/auth";

const token = generateToken({ id: "user-1", email: "alice@example.com", username: "alice" });

const authed = (method: "get" | "post" | "put" | "delete", url: string) =>
  request(app)[method](url).set("Authorization", `Bearer ${token}`);

const lineData = (id: string) => ({
  id,
  type: "LINE",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  layer: "0",
});

const blockRow = (overrides: Record<string, unknown> = {}) => ({
  id: "block-1",
  userId: "user-1",
  projectId: null,
  name: "标准法兰",
  description: null,
  categoryId: null,
  basePointX: 0,
  basePointY: 0,
  thumbnail: null,
  isPublic: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("块目录接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
  });

  it("目录把 blockElements 还原成按顺序排列的 elements", async () => {
    prismaMock.blockCategory.findMany.mockResolvedValue([
      {
        id: "cat-1",
        userId: "user-1",
        name: "机械件",
        parentId: null,
        blocks: [
          {
            ...blockRow(),
            blockElements: [
              { id: "be-2", elementData: lineData("l2"), displayOrder: 1 },
              { id: "be-1", elementData: lineData("l1"), displayOrder: 0 },
            ],
          },
        ],
      },
    ]);
    prismaMock.blockDefinition.findMany.mockResolvedValue([]);

    const res = await authed("get", "/api/blocks/tree");

    expect(res.status).toBe(200);
    const block = res.body.categories[0].blocks[0];
    expect(block.elements).toHaveLength(2);
    expect(block.elements.map((item: { id: string }) => item.id)).toEqual(["l1", "l2"]);
    expect(block.basePoint).toEqual({ x: 0, y: 0 });
    expect(block.blockElements).toBeUndefined();
  });

  it("根级块同样返回展开后的图元", async () => {
    prismaMock.blockCategory.findMany.mockResolvedValue([]);
    prismaMock.blockDefinition.findMany.mockResolvedValue([
      {
        ...blockRow({ id: "block-root" }),
        blockElements: [{ id: "be-1", elementData: lineData("l1"), displayOrder: 0 }],
      },
    ]);

    const res = await authed("get", "/api/blocks/tree");

    expect(res.status).toBe(200);
    expect(res.body.rootBlocks[0].elements).toHaveLength(1);
    expect(res.body.rootBlocks[0].elements[0].id).toBe("l1");
  });

  it("没有块元素时 elements 为空数组而不是缺字段", async () => {
    prismaMock.blockCategory.findMany.mockResolvedValue([]);
    prismaMock.blockDefinition.findMany.mockResolvedValue([
      { ...blockRow(), blockElements: [] },
    ]);

    const res = await authed("get", "/api/blocks/tree");

    expect(res.status).toBe(200);
    expect(res.body.rootBlocks[0].elements).toEqual([]);
  });

  it("指定项目时校验归属，并同时返回项目块与全局块", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" });
    prismaMock.blockCategory.findMany.mockResolvedValue([]);
    prismaMock.blockDefinition.findMany.mockResolvedValue([]);

    const res = await authed("get", "/api/blocks/tree?projectId=proj-1");

    expect(res.status).toBe(200);
    const where = prismaMock.blockDefinition.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ projectId: "proj-1" }, { projectId: null }]);
  });

  it("项目不属于当前用户时返回 404", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);

    const res = await authed("get", "/api/blocks/tree?projectId=proj-x");

    expect(res.status).toBe(404);
    expect(prismaMock.blockCategory.findMany).not.toHaveBeenCalled();
  });

  it("未鉴权请求无法读取块目录", async () => {
    const res = await request(app).get("/api/blocks/tree");
    expect(res.status).toBe(401);
  });
});

describe("块定义接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
  });

  it("创建块时校验 elements 与 basePoint", async () => {
    const noElements = await authed("post", "/api/blocks/definition").send({
      name: "空块",
      basePoint: { x: 0, y: 0 },
      elements: [],
    });
    expect(noElements.status).toBe(400);

    const noBase = await authed("post", "/api/blocks/definition").send({
      name: "空块",
      basePoint: { x: "0", y: 0 },
      elements: [lineData("l1")],
    });
    expect(noBase.status).toBe(400);
    expect(prismaMock.blockDefinition.create).not.toHaveBeenCalled();
  });

  it("创建成功后按插入顺序写入块元素并回传展开结果", async () => {
    prismaMock.blockDefinition.create.mockImplementation(async ({ data }: any) => ({
      ...blockRow({ id: "block-new", name: data.name }),
      ...data,
      blockElements: (data.blockElements?.create ?? []).map((item: any, index: number) => ({
        id: `be-${index}`,
        elementData: item.elementData,
        displayOrder: item.displayOrder,
      })),
    }));

    const res = await authed("post", "/api/blocks/definition").send({
      name: "双线块",
      basePoint: { x: 1, y: 2 },
      elements: [lineData("l1"), lineData("l2")],
    });

    expect(res.status).toBe(200);
    expect(res.body.elements.map((item: { id: string }) => item.id)).toEqual(["l1", "l2"]);
    expect(res.body.basePoint).toEqual({ x: 1, y: 2 });
  });

  it("按 id 读取块定义时只允许本人块", async () => {
    prismaMock.blockDefinition.findFirst.mockResolvedValue({
      ...blockRow(),
      blockElements: [{ id: "be-1", elementData: lineData("l1"), displayOrder: 0 }],
    });

    const res = await authed("get", "/api/blocks/block-1");

    expect(res.status).toBe(200);
    expect(res.body.elements[0].id).toBe("l1");
    const where = prismaMock.blockDefinition.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "block-1", userId: "user-1" });
  });
});
