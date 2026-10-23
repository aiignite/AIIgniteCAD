/**
 * llmChatValidation.test.ts — AI 对话请求体校验
 *
 * 非法参数必须在触达数据库与 Provider 之前返回 400，
 * 避免畸形请求消耗模型额度或引发下游异常。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
    },
    assistant: {
      findFirst: vi.fn(),
    },
    lLMModel: {
      findFirst: vi.fn(),
    },
  },
}));

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

const postChat = (body: Record<string, unknown>) =>
  request(app)
    .post("/api/llm/chat")
    .set("Authorization", `Bearer ${token}`)
    .send(body);

describe("POST /api/llm/chat validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
  });

  it.each([
    [{ modelId: "m" }, "message is required"],
    [{ message: "   " }, "message is required"],
    [{ message: 42 }, "message must be a string"],
    [{ message: "x".repeat(32001) }, "message must be at most 32000 characters"],
    [{ message: "hi", enableTools: "yes" }, "enableTools must be a boolean"],
    [{ message: "hi", assistantId: 7 }, "assistantId must be a string"],
    [{ message: "hi", modelId: 7 }, "modelId must be a string"],
  ])("拒绝非法请求体 %j", async (payload, expectedMessage) => {
    const res = await postChat(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation Error");
    expect(res.body.message).toBe(expectedMessage);
    expect(prismaMock.lLMModel.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.assistant.findFirst).not.toHaveBeenCalled();
  });

  it("接受 null 形式的可选标识字段", async () => {
    prismaMock.lLMModel.findFirst.mockResolvedValue(null);

    const res = await postChat({
      message: "hi",
      sessionId: null,
      projectId: null,
      assistantId: null,
      modelId: null,
    });

    // 校验通过后会继续解析模型；没有可用模型应返回业务错误而不是 VALIDATION
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_MODEL_CONFIGURED");
    expect(prismaMock.lLMModel.findFirst).toHaveBeenCalled();
  });
});
