/**
 * llmModels.test.ts — 模型注册表接口
 *
 * 覆盖列表脱敏、provider/端点校验、apiKey 加密落库、更新时保留已存配置、
 * 默认模型互斥、连接测试与用量摘要。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { prismaMock, probeMock } = vi.hoisted(() => {
  const createModelMock = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  });

  return {
    prismaMock: {
      user: createModelMock(),
      lLMModel: createModelMock(),
      aiCallLog: createModelMock(),
      $transaction: vi.fn(),
    },
    probeMock: { probeProvider: vi.fn() },
  };
});

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock("../src/services/aiEngine/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/aiEngine/providers")>();
  return { ...actual, probeProvider: probeMock.probeProvider };
});

import app from "../src/app";
import { generateToken } from "../src/middleware/auth";
import { decryptSecret } from "../src/lib/crypto";
import { ProviderError } from "../src/services/aiEngine/providers";

const token = generateToken({ id: "user-1", email: "alice@example.com", username: "alice" });

const authed = (method: "get" | "post" | "put" | "delete", url: string) =>
  request(app)[method](url).set("Authorization", `Bearer ${token}`);

const modelRow = (overrides: Record<string, unknown> = {}) => ({
  id: "model-1",
  userId: "user-1",
  name: "GPT-4o",
  provider: "OpenAI",
  modelId: "gpt-4o",
  apiKeyEncrypted: null,
  isActive: true,
  isDefault: false,
  supportsTools: true,
  contextWindow: 128_000,
  maxOutputTokens: 16_000,
  temperature: 0.2,
  topP: null,
  timeoutSeconds: 120,
  promptPricePer1k: 0.0025,
  completionPricePer1k: 0.01,
  configuration: { apiUrl: "https://api.openai.com/v1" },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  ...overrides,
});

describe("模型注册表接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    prismaMock.$transaction.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("列表不返回密文，只返回 hasApiKey 与脱敏预览", async () => {
    prismaMock.lLMModel.findMany.mockResolvedValue([modelRow({ apiKeyEncrypted: "secret-value" })]);

    const res = await authed("get", "/api/llm");

    expect(res.status).toBe(200);
    expect(res.body.models[0]).not.toHaveProperty("apiKeyEncrypted");
    expect(res.body.models[0].hasApiKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("secret-value");
  });

  it("缺少名称或 provider 非法时返回 400", async () => {
    const missingName = await authed("post", "/api/llm").send({ provider: "OpenAI", modelId: "gpt-4o" });
    expect(missingName.status).toBe(400);
    expect(missingName.body.code).toBe("VALIDATION");

    const badProvider = await authed("post", "/api/llm").send({
      name: "x",
      provider: "Skynet",
      modelId: "gpt-4o",
    });
    expect(badProvider.status).toBe(400);
    expect(badProvider.body.message).toContain("provider");
  });

  it("拒绝指向内网或元数据地址的端点", async () => {
    vi.stubEnv("AI_ALLOW_PRIVATE_ENDPOINTS", "");
    const privateIp = await authed("post", "/api/llm").send({
      name: "内网",
      provider: "OpenAI",
      modelId: "gpt-4o",
      configuration: { apiUrl: "http://10.0.0.8:8080/v1" },
    });
    expect(privateIp.status).toBe(400);
    expect(privateIp.body.code).toBe("INVALID_ENDPOINT");

    const metadata = await authed("post", "/api/llm").send({
      name: "元数据",
      provider: "OpenAI",
      modelId: "gpt-4o",
      configuration: { apiUrl: "http://169.254.169.254/latest/meta-data" },
    });
    expect(metadata.status).toBe(400);
    expect(metadata.body.code).toBe("INVALID_ENDPOINT");
  });

  it("Ollama 允许本地端点，密钥加密落库且响应不含明文", async () => {
    prismaMock.lLMModel.create.mockImplementation(async ({ data }: any) => ({
      ...modelRow(data),
      id: "model-9",
      ...data,
    }));

    const res = await authed("post", "/api/llm").send({
      name: "本地 Ollama",
      provider: "Ollama",
      modelId: "llama3",
      apiKey: "super-secret-key",
      configuration: { apiUrl: "http://localhost:11434" },
    });

    expect(res.status).toBe(201);
    const created = prismaMock.lLMModel.create.mock.calls[0][0].data;
    expect(created.userId).toBe("user-1");
    expect(created.apiKeyEncrypted).toContain("enc:v1:");
    expect(created.apiKeyEncrypted).not.toContain("super-secret-key");
    expect(decryptSecret(created.apiKeyEncrypted)).toBe("super-secret-key");
    expect(res.body.model).not.toHaveProperty("apiKeyEncrypted");
    expect(JSON.stringify(res.body)).not.toContain("super-secret-key");
  });

  it("更新时未提交 configuration 会保留已存端点", async () => {
    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow());
    prismaMock.lLMModel.update.mockResolvedValue(modelRow());
    prismaMock.lLMModel.findUnique.mockResolvedValue(modelRow({ name: "改名" }));

    const res = await authed("put", "/api/llm/model-1").send({
      name: "改名",
      provider: "OpenAI",
      modelId: "gpt-4o",
    });

    expect(res.status).toBe(200);
    const data = prismaMock.lLMModel.update.mock.calls[0][0].data;
    expect(data.configuration.apiUrl).toBe("https://api.openai.com/v1");
  });

  it("更新不属于自己的模型返回 404", async () => {
    prismaMock.lLMModel.findFirst.mockResolvedValue(null);

    const res = await authed("put", "/api/llm/model-1").send({
      name: "x",
      provider: "OpenAI",
      modelId: "gpt-4o",
    });

    expect(res.status).toBe(404);
    expect(prismaMock.lLMModel.update).not.toHaveBeenCalled();
  });

  it("设为默认先取消同用户其他默认模型，停用模型拒绝", async () => {
    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow({ isDefault: false }));
    prismaMock.lLMModel.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.lLMModel.update.mockResolvedValue(modelRow({ isDefault: true }));

    const ok = await authed("post", "/api/llm/model-1/default");
    expect(ok.status).toBe(200);
    expect(prismaMock.lLMModel.updateMany.mock.calls[0][0]).toEqual({
      where: { userId: "user-1" },
      data: { isDefault: false },
    });

    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow({ isActive: false }));
    const disabled = await authed("post", "/api/llm/model-1/default");
    expect(disabled.status).toBe(400);
    expect(disabled.body.code).toBe("MODEL_DISABLED");
  });

  it("测试连接成功返回耗时，ProviderError 转成可展示原因", async () => {
    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow());

    probeMock.probeProvider.mockResolvedValue(undefined);
    const ok = await authed("post", "/api/llm/model-1/test");
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.model).not.toHaveProperty("apiKeyEncrypted");

    probeMock.probeProvider.mockRejectedValue(
      new ProviderError("PROVIDER_AUTH", "模型鉴权失败，请检查 API Key", false, false, 401),
    );
    const failed = await authed("post", "/api/llm/model-1/test");
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({
      ok: false,
      code: "PROVIDER_AUTH",
      retryable: false,
      message: "模型鉴权失败，请检查 API Key",
    });
    expect(JSON.stringify(failed.body)).not.toContain("apiKey");
  });

  it("用量摘要按 provider 汇总调用数与失败率", async () => {
    prismaMock.aiCallLog.findMany.mockResolvedValue([
      {
        status: "ok",
        provider: "OpenAI",
        modelId: "gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.01,
        latencyMs: 900,
      },
      {
        status: "error",
        provider: "OpenAI",
        modelId: "gpt-4o",
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        latencyMs: 100,
      },
    ]);

    const res = await authed("get", "/api/llm/usage?days=7");

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    expect(res.body.calls).toBe(2);
    expect(res.body.failures).toBe(1);
    expect(res.body.promptTokens).toBe(100);
    expect(res.body.byProvider).toEqual([{ provider: "OpenAI", calls: 2, failures: 1 }]);
  });

  it("删除仅允许本人模型", async () => {
    prismaMock.lLMModel.deleteMany.mockResolvedValue({ count: 0 });
    const missing = await authed("delete", "/api/llm/model-1");
    expect(missing.status).toBe(404);

    prismaMock.lLMModel.deleteMany.mockResolvedValue({ count: 1 });
    const deleted = await authed("delete", "/api/llm/model-1");
    expect(deleted.status).toBe(200);
    expect(prismaMock.lLMModel.deleteMany.mock.calls[0][0].where).toEqual({
      id: "model-1",
      userId: "user-1",
    });
  });

  it("未鉴权请求不进入模型接口", async () => {
    const res = await request(app).get("/api/llm");
    expect(res.status).toBe(401);
  });
});
