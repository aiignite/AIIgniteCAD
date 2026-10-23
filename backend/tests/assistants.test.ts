/**
 * assistants.test.ts — 助手接口
 *
 * 覆盖列表附带 skillIds、模型归属校验、工具白名单校验、可空字段的
 * "显式出现才覆盖" 语义与技能绑定替换。
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
    createMany: vi.fn(),
    count: vi.fn(),
  });

  return {
    prismaMock: {
      user: createModelMock(),
      assistant: createModelMock(),
      assistantSkill: createModelMock(),
      aiSkill: createModelMock(),
      lLMModel: createModelMock(),
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import app from "../src/app";
import { generateToken } from "../src/middleware/auth";

const token = generateToken({ id: "user-1", email: "alice@example.com", username: "alice" });

const authed = (method: "get" | "post" | "put" | "delete", url: string) =>
  request(app)[method](url).set("Authorization", `Bearer ${token}`);

const modelRow = (overrides: Record<string, unknown> = {}) => ({
  id: "model-1",
  userId: "user-1",
  name: "GPT-4o",
  provider: "OpenAI",
  modelId: "gpt-4o",
  apiKeyEncrypted: "enc:v1:opaque",
  isActive: true,
  isDefault: false,
  supportsTools: true,
  contextWindow: 128_000,
  maxOutputTokens: 16_000,
  timeoutSeconds: 120,
  configuration: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

const assistantRow = (overrides: Record<string, unknown> = {}) => ({
  id: "asst-1",
  userId: "user-1",
  llmModelId: "model-1",
  name: "制图助手",
  icon: "psychology",
  description: "",
  color: "text-cad-primary",
  category: "General",
  prompt: "你是 CAD 助手",
  isPublic: false,
  isActive: true,
  temperature: null,
  maxTokens: null,
  maxToolRounds: 4,
  toolNames: ["draw_line", "draw_circle"],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  llmModel: modelRow(),
  skills: [{ assistantId: "asst-1", skillId: "skill-1", weight: 70 }],
  ...overrides,
});

describe("助手接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => ops);
  });

  it("列表返回 skillIds 且内嵌模型不含密文", async () => {
    prismaMock.assistant.findMany.mockResolvedValue([assistantRow()]);

    const res = await authed("get", "/api/assistants");

    expect(res.status).toBe(200);
    expect(res.body.assistants[0].skillIds).toEqual(["skill-1"]);
    expect(res.body.assistants[0].llmModel).not.toHaveProperty("apiKeyEncrypted");
    expect(res.body.assistants[0].llmModel.hasApiKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("enc:v1:opaque");
  });

  it("创建时使用安全默认值并把技能权重落库", async () => {
    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow());
    prismaMock.aiSkill.findMany.mockResolvedValue([{ id: "skill-1" }, { id: "skill-2" }]);
    prismaMock.assistant.create.mockImplementation(async ({ data }: any) => ({
      ...assistantRow(),
      ...data,
      skills: (data.skills?.create ?? []).map((row: any) => ({
        assistantId: "asst-1",
        skillId: row.skillId,
        weight: row.weight,
      })),
    }));

    const res = await authed("post", "/api/assistants").send({
      name: "制图助手",
      prompt: "你是 CAD 助手",
      llmModelId: "model-1",
      toolNames: ["draw_line"],
      skills: [{ skillId: "skill-1" }, { skillId: "skill-2", weight: 20 }],
    });

    expect(res.status).toBe(201);
    const data = prismaMock.assistant.create.mock.calls[0][0].data;
    expect(data.maxToolRounds).toBe(4);
    expect(data.isActive).toBe(true);
    expect(data.isPublic).toBe(false);
    expect(data.toolNames).toEqual(["draw_line"]);
    expect(data.skills.create).toEqual([
      { skillId: "skill-1", weight: 50 },
      { skillId: "skill-2", weight: 20 },
    ]);
    expect(res.body.assistant.skillIds).toEqual(["skill-1", "skill-2"]);
  });

  it("拒绝越权模型、未知工具与不可绑定技能", async () => {
    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow({ userId: "user-2" }));
    const forbidden = await authed("post", "/api/assistants").send({
      name: "x",
      llmModelId: "model-1",
    });
    expect(forbidden.status).toBe(400);
    expect(forbidden.body.code).toBe("MODEL_FORBIDDEN");

    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow({ isActive: false }));
    const disabled = await authed("post", "/api/assistants").send({
      name: "x",
      llmModelId: "model-1",
    });
    expect(disabled.status).toBe(400);
    expect(disabled.body.code).toBe("MODEL_DISABLED");

    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow());
    const badTool = await authed("post", "/api/assistants").send({
      name: "x",
      toolNames: ["drop_database"],
    });
    expect(badTool.status).toBe(400);
    expect(badTool.body.message).toContain("drop_database");

    prismaMock.aiSkill.findMany.mockResolvedValue([{ id: "skill-1" }]);
    const badSkill = await authed("post", "/api/assistants").send({
      name: "x",
      skills: [{ skillId: "skill-1" }, { skillId: "skill-foreign" }],
    });
    expect(badSkill.status).toBe(400);
    expect(badSkill.body.error).toBe("SKILL_NOT_AVAILABLE");
    expect(badSkill.body.message).toContain("skill-foreign");
  });

  it("更新时可空字段只在显式提交时覆盖", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(assistantRow());
    prismaMock.assistant.update.mockResolvedValue(assistantRow());
    prismaMock.assistant.findMany.mockResolvedValue([assistantRow()]);

    const res = await authed("put", "/api/assistants/asst-1").send({
      name: "改名",
      prompt: null,
      temperature: 0.7,
    });

    expect(res.status).toBe(200);
    const data = prismaMock.assistant.update.mock.calls[0][0].data;
    expect(data.name).toBe("改名");
    expect(data.prompt).toBeNull();
    expect(data.temperature).toBe(0.7);
    expect(data).not.toHaveProperty("llmModelId");
    expect(data).not.toHaveProperty("toolNames");
    expect(prismaMock.assistantSkill.deleteMany).not.toHaveBeenCalled();
  });

  it("更新技能绑定先清空再批量写入", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(assistantRow());
    prismaMock.aiSkill.findMany.mockResolvedValue([{ id: "skill-2" }]);
    prismaMock.assistant.update.mockResolvedValue(assistantRow());
    prismaMock.assistantSkill.createMany.mockResolvedValue({ count: 1 });

    const res = await authed("put", "/api/assistants/asst-1").send({
      name: "改名",
      skills: [{ skillId: "skill-2", weight: 90 }],
    });

    expect(res.status).toBe(200);
    expect(prismaMock.assistantSkill.deleteMany).toHaveBeenCalledWith({ where: { assistantId: "asst-1" } });
    expect(prismaMock.assistantSkill.createMany.mock.calls[0][0].data).toEqual([
      { skillId: "skill-2", weight: 90, assistantId: "asst-1" },
    ]);
  });

  it("读取技能绑定返回权重", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(assistantRow());
    prismaMock.aiSkill.findMany.mockResolvedValue([
      { id: "skill-1", name: "阵列与偏移", isSystem: true },
    ]);

    const res = await authed("get", "/api/assistants/asst-1/skills");

    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([
      { id: "skill-1", name: "阵列与偏移", isSystem: true, weight: 70 },
    ]);
  });

  it("替换绑定走事务并校验权重范围", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(assistantRow());
    prismaMock.aiSkill.findMany.mockResolvedValue([{ id: "skill-1" }]);
    prismaMock.assistantSkill.createMany.mockResolvedValue({ count: 1 });

    const bad = await authed("put", "/api/assistants/asst-1/skills").send({
      skills: [{ skillId: "skill-1", weight: 900 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain("weight");

    const ok = await authed("put", "/api/assistants/asst-1/skills").send({
      skills: [{ skillId: "skill-1", weight: 30 }],
    });
    expect(ok.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(ok.body.assistant.skillIds).toEqual(["skill-1"]);
  });

  it("缺少名称返回 400，助手不属于当前用户返回 404", async () => {
    const invalid = await authed("post", "/api/assistants").send({ prompt: "x" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain("name");

    const blank = await authed("post", "/api/assistants").send({ name: "  ", prompt: "x" });
    expect(blank.status).toBe(400);
    expect(blank.body.message).toBe("name is required");

    prismaMock.assistant.findFirst.mockResolvedValue(null);
    const missing = await authed("get", "/api/assistants/asst-1");
    expect(missing.status).toBe(404);
  });

  it("删除仅命中本人助手", async () => {
    prismaMock.assistant.deleteMany.mockResolvedValue({ count: 0 });
    const missing = await authed("delete", "/api/assistants/asst-1");
    expect(missing.status).toBe(404);

    prismaMock.assistant.deleteMany.mockResolvedValue({ count: 1 });
    const deleted = await authed("delete", "/api/assistants/asst-1");
    expect(deleted.status).toBe(200);
    expect(prismaMock.assistant.deleteMany.mock.calls[0][0].where).toEqual({
      id: "asst-1",
      userId: "user-1",
    });
  });

  it("未鉴权请求无法访问助手", async () => {
    const res = await request(app).get("/api/assistants");
    expect(res.status).toBe(401);
  });
});
