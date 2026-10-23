/**
 * sync.test.ts — 同步接口幂等与冲突检测
 *
 * 覆盖：同一 Idempotency-Key 只执行一次、重复请求返回 duplicate、
 * 旧游标写入仍按“最后写入胜”执行但返回 conflict 提示。
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
      idempotencyKey: createModelMock(),
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

const uniqueViolation = () =>
  Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

const postElements = () =>
  request(app)
    .post("/api/projects/project-1/elements")
    .set("Authorization", `Bearer ${token}`);

describe("同步接口幂等与冲突", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    prismaMock.$transaction.mockImplementation(async (callback: any) =>
      callback({
        element: prismaMock.element,
        project: prismaMock.project,
      }),
    );
    prismaMock.element.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.element.create.mockResolvedValue({ id: "element-1" });
    prismaMock.project.update.mockResolvedValue({ id: "project-1" });
  });

  it("相同幂等键的元素保存只执行一次，重复请求返回 duplicate", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-10-21T00:00:00.000Z"),
    });
    prismaMock.idempotencyKey.create.mockResolvedValueOnce({ key: "idem-1" });
    prismaMock.idempotencyKey.create.mockRejectedValueOnce(uniqueViolation());
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      key: "idem-1",
      projectId: "project-1",
    });
    prismaMock.project.findUnique.mockResolvedValue({
      updatedAt: new Date("2026-10-21T00:02:00.000Z"),
    });

    const first = await postElements()
      .set("Idempotency-Key", "idem-1")
      .send({ elements: [{ type: "LINE" }] });

    expect(first.status).toBe(200);
    expect(first.body.count).toBe(1);
    expect(first.body.updatedAt).toBeTruthy();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    const second = await postElements()
      .set("Idempotency-Key", "idem-1")
      .send({ elements: [{ type: "LINE" }] });

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.updatedAt).toBe("2026-10-21T00:02:00.000Z");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("baseUpdatedAt 落后于服务端时仍覆盖写入，但标记 conflict", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-10-21T00:05:00.000Z"),
    });
    prismaMock.idempotencyKey.create.mockResolvedValue({ key: "idem-2" });

    const res = await postElements()
      .set("Idempotency-Key", "idem-2")
      .send({
        elements: [{ type: "CIRCLE" }],
        baseUpdatedAt: "2026-10-21T00:00:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(res.body.conflict).toBe(true);
    expect(res.body.serverUpdatedAt).toBe("2026-10-21T00:05:00.000Z");
    expect(prismaMock.element.updateMany).toHaveBeenCalled();
    expect(prismaMock.element.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "project-1" },
        data: { updatedAt: expect.any(Date) },
      }),
    );
  });

  it("重命名携带旧游标时返回冲突信息", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      updatedAt: new Date("2026-10-21T00:06:00.000Z"),
    });
    prismaMock.idempotencyKey.create.mockResolvedValue({ key: "idem-3" });
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.project.findUnique.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-10-21T00:07:00.000Z"),
    });

    const res = await request(app)
      .put("/api/projects/project-1")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "idem-3")
      .send({
        name: "Renamed",
        baseUpdatedAt: "2026-10-21T00:00:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(res.body.conflict).toBe(true);
    expect(res.body.serverUpdatedAt).toBe("2026-10-21T00:06:00.000Z");
  });

  it("重复的删除请求直接返回 duplicate", async () => {
    prismaMock.idempotencyKey.create.mockRejectedValue(uniqueViolation());
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      key: "idem-delete",
      projectId: "project-1",
    });

    const res = await request(app)
      .delete("/api/projects/project-1")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "idem-delete");

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(prismaMock.project.updateMany).not.toHaveBeenCalled();
  });

  it("离线创建重放时返回首次创建的 projectId", async () => {
    prismaMock.idempotencyKey.create.mockRejectedValue(uniqueViolation());
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      key: "idem-create",
      projectId: "server-project-9",
    });

    const res = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "idem-create")
      .send({ name: "Offline drawing" });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.project).toEqual({ id: "server-project-9" });
  });

  it("不带幂等键时保持原有行为，不访问幂等表", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: "project-1",
      updatedAt: new Date("2026-10-21T00:00:00.000Z"),
    });

    const res = await postElements().send({ elements: [] });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBeUndefined();
    expect(prismaMock.idempotencyKey.create).not.toHaveBeenCalled();
  });
});
