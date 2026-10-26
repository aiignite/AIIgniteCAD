/**
 * collaborationProtocol.test.ts — 协作消息边界校验与项目归属
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    project: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock }));

import {
  MAX_PATCH_ELEMENTS,
  canJoinProject,
  isUuid,
  pickPeerSocket,
  sanitizeCursor,
  sanitizePatch,
  sanitizeStateSnapshot,
} from "../src/lib/collaborationProtocol";

const PROJECT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("sanitizePatch", () => {
  it("保留合法图元与删除 id", () => {
    const patch = sanitizePatch({
      upserts: [{ id: "a", type: "LINE", start: { x: 0, y: 0 } }],
      deletes: ["b"],
    });
    expect(patch?.upserts).toHaveLength(1);
    expect(patch?.deletes).toEqual(["b"]);
  });

  it("拒绝非对象、缺字段与超限载荷", () => {
    expect(sanitizePatch(null)).toBeNull();
    expect(sanitizePatch({ upserts: [{ type: "LINE" }], deletes: [] })).toBeNull();
    expect(sanitizePatch({ upserts: [], deletes: [42] })).toBeNull();
    expect(
      sanitizePatch({
        upserts: Array.from({ length: MAX_PATCH_ELEMENTS + 1 }, (_, i) => ({
          id: String(i),
          type: "LINE",
        })),
        deletes: [],
      }),
    ).toBeNull();
  });
});

describe("sanitizeCursor", () => {
  it("接受有限坐标并拒绝异常值", () => {
    expect(sanitizeCursor({ x: 10, y: -20 })).toEqual({ x: 10, y: -20 });
    expect(sanitizeCursor({ x: Number.NaN, y: 0 })).toBeNull();
    expect(sanitizeCursor({ x: 1e9, y: 0 })).toBeNull();
  });
});

describe("isUuid", () => {
  it("区分服务端项目 id 与本地短 id", () => {
    expect(isUuid(PROJECT_ID)).toBe(true);
    expect(isUuid("abc123xyz")).toBe(false);
  });
});

describe("sanitizeStateSnapshot", () => {
  it("保留目标 socket 与合法图元，未截断时 truncated 为 false", () => {
    const snapshot = sanitizeStateSnapshot({
      targetId: "socket-1",
      elements: [{ id: "a", type: "LINE" }],
    });
    expect(snapshot).toEqual({
      targetId: "socket-1",
      elements: [{ id: "a", type: "LINE" }],
      truncated: false,
    });
  });

  it("拒绝缺目标、超长目标与非法图元", () => {
    expect(sanitizeStateSnapshot(null)).toBeNull();
    expect(sanitizeStateSnapshot({ elements: [] })).toBeNull();
    expect(sanitizeStateSnapshot({ targetId: "", elements: [] })).toBeNull();
    expect(
      sanitizeStateSnapshot({ targetId: "x".repeat(129), elements: [] }),
    ).toBeNull();
    expect(
      sanitizeStateSnapshot({ targetId: "socket-1", elements: [{ type: "LINE" }] }),
    ).toBeNull();
    expect(
      sanitizeStateSnapshot({ targetId: "socket-1", elements: "not-array" }),
    ).toBeNull();
  });

  it("超限图元整包拒绝，与补丁上限一致", () => {
    expect(
      sanitizeStateSnapshot({
        targetId: "socket-1",
        elements: Array.from({ length: MAX_PATCH_ELEMENTS + 1 }, (_, i) => ({
          id: String(i),
          type: "LINE",
        })),
      }),
    ).toBeNull();
  });
});

describe("pickPeerSocket", () => {
  it("跳过请求者，返回房间内其他成员", () => {
    expect(pickPeerSocket(["self", "peer-1"], "self")).toBe("peer-1");
    expect(pickPeerSocket(["self", "peer-1", "peer-2"], "self")).toBe("peer-1");
  });

  it("没有其他成员或房间为空时返回 null", () => {
    expect(pickPeerSocket(["self"], "self")).toBeNull();
    expect(pickPeerSocket(undefined, "self")).toBeNull();
  });
});

describe("canJoinProject", () => {
  beforeEach(() => {
    prismaMock.project.findFirst.mockReset();
  });

  it("按项目所有者与未删除条件查询", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
    await expect(canJoinProject("user-1", PROJECT_ID)).resolves.toBe(true);
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, userId: "user-1", isDeleted: false },
      select: { id: true },
    });
  });

  it("项目不存在或不属于该用户时拒绝", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    await expect(canJoinProject("user-2", PROJECT_ID)).resolves.toBe(false);
  });

  it("非法 id 不触达数据库", async () => {
    await expect(canJoinProject("user-1", "local-1")).resolves.toBe(false);
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
  });
});
