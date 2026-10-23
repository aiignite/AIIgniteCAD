import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lLMModel: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import {
  ModelResolutionError,
  getFailoverCandidates,
  resolveChatModel,
} from "../src/services/aiEngine/modelResolver";

interface FakeModel {
  id: string;
  userId: string | null;
  name: string;
  provider: string;
  modelId: string;
  isActive: boolean;
  isDefault: boolean;
  supportsTools: boolean;
  updatedAt: Date;
}

const model = (overrides: Partial<FakeModel>): FakeModel => ({
  id: "m-1",
  userId: "user-1",
  name: "模型",
  provider: "OpenAI",
  modelId: "gpt-test",
  isActive: true,
  isDefault: false,
  supportsTools: true,
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

let registry: FakeModel[] = [];

/** 只实现解析链用到的 where 组合，避免把测试变成 Prisma 语义模拟器 */
const matches = (row: FakeModel, where: Record<string, unknown>): boolean => {
  for (const [key, expected] of Object.entries(where)) {
    if (key === "OR") {
      const branches = expected as Array<Record<string, unknown>>;
      const hit = branches.some((branch) =>
        Object.entries(branch).every(([field, value]) => row[field as keyof FakeModel] === value),
      );
      if (!hit) return false;
      continue;
    }
    if (expected !== null && typeof expected === "object") {
      const filter = expected as { notIn?: unknown[]; in?: unknown[] };
      const value = row[key as keyof FakeModel];
      if (filter.notIn && filter.notIn.includes(value)) return false;
      if (filter.in && !filter.in.includes(value)) return false;
      continue;
    }
    if (row[key as keyof FakeModel] !== expected) return false;
  }
  return true;
};

beforeEach(() => {
  vi.clearAllMocks();
  registry = [];
  prismaMock.lLMModel.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const found = registry.filter((row) => matches(row, args?.where ?? {}));
    return (found[0] as FakeModel) ?? null;
  });
  prismaMock.lLMModel.findMany.mockImplementation(
    async (args: { where?: Record<string, unknown> }) =>
      registry.filter((row) => matches(row, args?.where ?? {})),
  );
});

const expectError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(ModelResolutionError);
  try {
    await promise;
  } catch (error) {
    expect((error as ModelResolutionError).code).toBe(code);
  }
};

describe("resolveChatModel 解析链", () => {
  it("显式 modelId 优先且带 reason=explicit", async () => {
    registry = [
      model({ id: "m-explicit" }),
      model({ id: "m-default", isDefault: true }),
    ];
    const resolved = await resolveChatModel({ userId: "user-1", modelId: "m-explicit" });
    expect(resolved.model.id).toBe("m-explicit");
    expect(resolved.reason).toBe("explicit");
  });

  it("显式选择停用模型直接拒绝，不静默降级", async () => {
    registry = [model({ id: "m-off", isActive: false }), model({ id: "m-on" })];
    await expectError(
      resolveChatModel({ userId: "user-1", modelId: "m-off" }),
      "MODEL_DISABLED",
    );
  });

  it("拒绝访问其他用户的模型", async () => {
    registry = [model({ id: "m-other", userId: "user-2" })];
    await expectError(
      resolveChatModel({ userId: "user-1", modelId: "m-other" }),
      "MODEL_FORBIDDEN",
    );
  });

  it("会话级模型优先于助手模型", async () => {
    registry = [model({ id: "m-session" }), model({ id: "m-assistant" })];
    const resolved = await resolveChatModel({
      userId: "user-1",
      sessionModelId: "m-session",
      assistantModelId: "m-assistant",
    });
    expect(resolved).toMatchObject({ model: { id: "m-session" }, reason: "session" });
  });

  it("助手模型引用不存在时回落到默认链", async () => {
    registry = [model({ id: "m-default", isDefault: true })];
    const resolved = await resolveChatModel({
      userId: "user-1",
      assistantModelId: "m-missing",
    });
    expect(resolved.model.id).toBe("m-default");
    expect(resolved.reason).toBe("user_default");
  });

  it("助手模型不属于当前用户时仍然拒绝（防止借用他人密钥）", async () => {
    registry = [model({ id: "m-victim", userId: "user-2" }), model({ id: "m-default", isDefault: true })];
    await expectError(
      resolveChatModel({ userId: "user-1", assistantModelId: "m-victim" }),
      "MODEL_FORBIDDEN",
    );
  });

  it("需要工具时跳过 supportsTools=false 的助手模型", async () => {
    registry = [
      model({ id: "m-notools", supportsTools: false }),
      model({ id: "m-default", isDefault: true }),
    ];
    const resolved = await resolveChatModel({
      userId: "user-1",
      assistantModelId: "m-notools",
      requiresTools: true,
    });
    expect(resolved.model.id).toBe("m-default");
  });

  it("系统默认（userId=null）在用户无默认时命中", async () => {
    registry = [model({ id: "m-system", userId: null, isDefault: true })];
    const resolved = await resolveChatModel({ userId: "user-1" });
    expect(resolved.model.id).toBe("m-system");
    expect(resolved.reason).toBe("system_default");
  });

  it("没有任何可用模型时报 NO_MODEL_CONFIGURED", async () => {
    await expectError(resolveChatModel({ userId: "user-1" }), "NO_MODEL_CONFIGURED");
  });

  it("需要工具但没有支持工具的模型时给出可操作提示", async () => {
    registry = [model({ id: "m-notools", supportsTools: false })];
    try {
      await resolveChatModel({ userId: "user-1", requiresTools: true });
      throw new Error("should not resolve");
    } catch (error) {
      expect((error as ModelResolutionError).code).toBe("NO_MODEL_CONFIGURED");
      expect((error as ModelResolutionError).message).toContain("工具");
    }
  });
});

describe("getFailoverCandidates", () => {
  it("排除已尝试模型并优先同 provider", async () => {
    registry = [
      model({ id: "m-tried", provider: "OpenAI" }),
      model({ id: "m-openai-2", provider: "OpenAI" }),
      model({ id: "m-google", provider: "Google" }),
    ];
    const candidates = await getFailoverCandidates({
      userId: "user-1",
      excludeIds: ["m-tried"],
      preferredProvider: "OpenAI",
    });
    expect(candidates.map((row) => row.id)).toEqual(["m-openai-2", "m-google"]);
  });

  it("需要工具时只保留 supportsTools 的候选", async () => {
    registry = [
      model({ id: "m-notools", supportsTools: false }),
      model({ id: "m-tools", supportsTools: true }),
    ];
    const candidates = await getFailoverCandidates({
      userId: "user-1",
      excludeIds: [],
      requiresTools: true,
    });
    expect(candidates.map((row) => row.id)).toEqual(["m-tools"]);
  });

  it("停用的模型不会成为候选", async () => {
    registry = [model({ id: "m-off", isActive: false })];
    expect(
      await getFailoverCandidates({ userId: "user-1", excludeIds: [] }),
    ).toEqual([]);
  });

  it("候选数量受 limit 限制", async () => {
    registry = Array.from({ length: 5 }, (_, index) => model({ id: `m-${index}` }));
    const candidates = await getFailoverCandidates({
      userId: "user-1",
      excludeIds: [],
      limit: 2,
    });
    expect(candidates).toHaveLength(2);
  });
});
