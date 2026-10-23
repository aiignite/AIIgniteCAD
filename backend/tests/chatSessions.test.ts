/**
 * chatSessions.test.ts — 会话与消息接口
 *
 * 覆盖项目归属、分页游标、摘要只回长度、消息幂等写入、手动 compact 与
 * 轮次结果回执（applied / discarded）。
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
      assistant: createModelMock(),
      lLMModel: createModelMock(),
      chatSession: createModelMock(),
      chatMessage: createModelMock(),
    },
  };
});

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import app from "../src/app";
import { generateToken } from "../src/middleware/auth";
import { metrics } from "../src/lib/metrics";

const token = generateToken({ id: "user-1", email: "alice@example.com", username: "alice" });

const authed = (method: "get" | "post" | "patch" | "delete", url: string) =>
  request(app)[method](url).set("Authorization", `Bearer ${token}`);

const sessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: "sess-1",
  projectId: "proj-1",
  userId: "user-1",
  title: "齿轮绘制",
  assistantId: "asst-1",
  modelId: "model-1",
  contextSummaryUpToId: null,
  contextUpdatedAt: null,
  lastMessageAt: new Date("2026-01-05T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-05T00:00:00.000Z"),
  contextSummary: null,
  _count: { messages: 2 },
  ...overrides,
});

const messageRow = (overrides: Record<string, unknown> = {}) => ({
  id: "msg-1",
  sessionId: "sess-1",
  senderType: "user",
  messageType: "text",
  content: "画一个直径 20 的圆",
  metadata: null,
  role: "user",
  clientMessageId: "turn-1",
  toolCallId: null,
  toolName: null,
  toolCalls: null,
  promptTokens: null,
  completionTokens: null,
  status: "complete",
  createdAt: new Date("2026-01-05T00:00:00.000Z"),
  ...overrides,
});

describe("会话与消息接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metrics.reset();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    prismaMock.project.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.id === "proj-1" && where?.userId === "user-1" ? { id: "proj-1" } : null),
    );
    prismaMock.chatSession.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.id === "sess-1" && where?.userId === "user-1" ? sessionRow() : null),
    );
    prismaMock.chatSession.deleteMany.mockImplementation(({ where }: any) =>
      Promise.resolve({
        count: where?.id === "sess-1" && where?.userId === "user-1" ? 1 : 0,
      }),
    );
  });

  it("列表校验项目归属且只回摘要长度", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const forbidden = await authed("get", "/api/chat/sessions/proj-x");
    expect(forbidden.status).toBe(404);

    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" });
    prismaMock.chatSession.findMany.mockResolvedValue([
      sessionRow({ contextSummary: "早期请求：\n- 画一个圆" }),
    ]);

    const res = await authed("get", "/api/chat/sessions/proj-1?limit=10");

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.sessions[0]).toMatchObject({
      id: "sess-1",
      hasSummary: true,
      summaryChars: 12,
    });
    expect(res.body.sessions[0].contextSummary).toBeUndefined();
    expect(res.body.sessions[0]._count).toEqual({ messages: 2 });
  });

  it("列表多取一条用于判断是否有下一页", async () => {
    prismaMock.chatSession.findMany.mockResolvedValue([
      sessionRow({ id: "sess-a", updatedAt: new Date("2026-01-05T00:00:00.000Z") }),
      sessionRow({ id: "sess-b", updatedAt: new Date("2026-01-04T00:00:00.000Z") }),
      sessionRow({ id: "sess-c", updatedAt: new Date("2026-01-03T00:00:00.000Z") }),
    ]);

    const res = await authed("get", "/api/chat/sessions/proj-1?limit=2");

    expect(res.status).toBe(200);
    expect(res.body.sessions.map((row: any) => row.id)).toEqual(["sess-a", "sess-b"]);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBe(new Date("2026-01-04T00:00:00.000Z").toISOString());
    expect(prismaMock.chatSession.findMany.mock.calls[0][0].take).toBe(3);
  });

  it("非法分页参数返回 400", async () => {
    const res = await authed("get", "/api/chat/sessions/proj-1?limit=999");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("创建会话要求项目归属并校验模型可用性", async () => {
    const missingProject = await authed("post", "/api/chat/sessions").send({ projectId: "proj-x" });
    expect(missingProject.status).toBe(404);

    prismaMock.lLMModel.findFirst.mockResolvedValue(null);
    const badModel = await authed("post", "/api/chat/sessions").send({
      projectId: "proj-1",
      modelId: "model-foreign",
    });
    expect(badModel.status).toBe(400);
    expect(badModel.body.code).toBe("MODEL_NOT_FOUND");

    prismaMock.lLMModel.findFirst.mockResolvedValue({
      id: "model-1",
      userId: "user-1",
      isActive: true,
      name: "GPT-4o",
    });
    prismaMock.chatSession.create.mockImplementation(async ({ data }: any) => ({
      ...sessionRow(),
      ...data,
      contextSummaryUpToId: null,
      contextUpdatedAt: null,
      lastMessageAt: null,
      createdAt: new Date("2026-01-05T00:00:00.000Z"),
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    }));

    const created = await authed("post", "/api/chat/sessions").send({
      projectId: "proj-1",
      title: "新会话",
      modelId: "model-1",
    });
    expect(created.status).toBe(201);
    expect(created.body.session.title).toBe("新会话");
    expect(prismaMock.chatSession.create.mock.calls[0][0].data.userId).toBe("user-1");
  });

  it("助手不属于当前用户时拒绝绑定", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(null);

    const res = await authed("post", "/api/chat/sessions").send({
      projectId: "proj-1",
      assistantId: "asst-foreign",
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ASSISTANT_NOT_FOUND");
  });

  it("活跃会话接口无会话时返回 null，有会话时带摘要正文", async () => {
    prismaMock.chatSession.findFirst.mockResolvedValue(null);
    const empty = await authed("get", "/api/chat/sessions/proj-1/active");
    expect(empty.status).toBe(200);
    expect(empty.body.session).toBeNull();

    prismaMock.chatSession.findFirst.mockResolvedValue(
      sessionRow({ contextSummary: "助手结论：\n- 已绘制 3 个圆" }),
    );
    const res = await authed("get", "/api/chat/sessions/proj-1/active");
    expect(res.body.session.contextSummary).toContain("已绘制 3 个圆");
    expect(res.body.session.hasSummary).toBe(true);
  });

  it("重命名与换模型走本人会话，显式 null 表示清空", async () => {
    prismaMock.chatSession.findFirst.mockResolvedValue(null);
    const missing = await authed("patch", "/api/chat/sessions/sess-x").send({ title: "改名" });
    expect(missing.status).toBe(404);

    prismaMock.chatSession.findFirst.mockResolvedValue(sessionRow());
    prismaMock.chatSession.update.mockResolvedValue(sessionRow({ title: null, modelId: null }));

    const res = await authed("patch", "/api/chat/sessions/sess-1").send({
      title: null,
      modelId: null,
    });

    expect(res.status).toBe(200);
    expect(prismaMock.chatSession.update.mock.calls[0][0].data).toEqual({
      title: null,
      modelId: null,
    });
  });

  it("消息列表按倒序取、正序回，并给出游标", async () => {
    prismaMock.chatMessage.findMany.mockResolvedValue([
      messageRow({ id: "msg-3", createdAt: new Date("2026-01-05T03:00:00.000Z") }),
      messageRow({ id: "msg-2", createdAt: new Date("2026-01-05T02:00:00.000Z") }),
      messageRow({ id: "msg-1", createdAt: new Date("2026-01-05T01:00:00.000Z") }),
    ]);

    const res = await authed("get", "/api/chat/sessions/sess-1/messages?limit=2");

    expect(res.status).toBe(200);
    expect(res.body.messages.map((row: any) => row.id)).toEqual(["msg-2", "msg-3"]);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBe(new Date("2026-01-05T02:00:00.000Z").toISOString());
    expect(res.body.projectId).toBe("proj-1");
  });

  it("手工消息接口校验类型并映射 provider 角色", async () => {
    const badSender = await authed("post", "/api/chat/sessions/sess-1/messages").send({
      senderType: "system",
      content: "x",
    });
    expect(badSender.status).toBe(400);

    const emptyContent = await authed("post", "/api/chat/sessions/sess-1/messages").send({
      senderType: "user",
      content: "   ",
    });
    expect(emptyContent.status).toBe(400);
    expect(emptyContent.body.message).toBe("content is required");

    prismaMock.chatMessage.create.mockImplementation(async ({ data }: any) => ({
      id: "msg-9",
      ...data,
      clientMessageId: null,
    }));
    prismaMock.chatSession.update.mockResolvedValue(sessionRow());

    const res = await authed("post", "/api/chat/sessions/sess-1/messages").send({
      senderType: "ai",
      messageType: "action",
      content: "已绘制 1 个圆",
      metadata: { action: "DRAW" },
    });

    expect(res.status).toBe(201);
    const data = prismaMock.chatMessage.create.mock.calls[0][0].data;
    expect(data.role).toBe("assistant");
    expect(data.messageType).toBe("action");
    expect(data.metadata).toEqual({ action: "DRAW" });
    expect(res.body.chatMessage).not.toHaveProperty("toolCalls");
    expect(prismaMock.chatSession.update).toHaveBeenCalled();
  });

  it("带 clientMessageId 的消息以幂等 upsert 写入", async () => {
    prismaMock.chatMessage.upsert.mockImplementation(async ({ create }: any) => ({
      id: "msg-1",
      ...create,
    }));
    prismaMock.chatSession.update.mockResolvedValue(sessionRow());

    const res = await authed("post", "/api/chat/sessions/sess-1/messages").send({
      senderType: "user",
      content: "画一个圆",
      clientMessageId: "turn-1",
    });

    expect(res.status).toBe(201);
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
    expect(prismaMock.chatMessage.upsert.mock.calls[0][0].where).toEqual({
      sessionId_clientMessageId: { sessionId: "sess-1", clientMessageId: "turn-1" },
    });
  });

  it("compact 把全部历史折叠成摘要并推进水位线", async () => {
    prismaMock.chatMessage.findMany.mockResolvedValue([
      messageRow({ id: "msg-1", role: "user", content: "画一个圆" }),
      messageRow({
        id: "msg-2",
        role: "assistant",
        content: "好的",
        toolCalls: [{ name: "draw_circle", arguments: {} }],
      }),
    ]);
    prismaMock.chatSession.update.mockResolvedValue(sessionRow());

    const res = await authed("post", "/api/chat/sessions/sess-1/compact");

    expect(res.status).toBe(200);
    expect(res.body.droppedCount).toBe(2);
    expect(res.body.summary).toContain("draw_circle×1");
    const data = prismaMock.chatSession.update.mock.calls[0][0].data;
    expect(data.contextSummaryUpToId).toBe("msg-2");
    expect(metrics.snapshot().counters["ai.context_compacted"]).toBe(1);
  });

  it("轮次回执合并写入 metadata，未持久化的轮次跳过", async () => {
    prismaMock.chatMessage.findUnique.mockResolvedValue({
      id: "msg-1",
      metadata: { canvasContext: { elementCount: 3 } },
    });
    prismaMock.chatMessage.update.mockResolvedValue(messageRow());

    const res = await authed("post", "/api/chat/turns/turn-1/outcome").send({
      sessionId: "sess-1",
      outcome: "discarded",
      reason: "半径超出边界",
      changedIds: ["circle-1"],
    });

    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(true);
    const data = prismaMock.chatMessage.update.mock.calls[0][0].data.metadata;
    expect(data.canvasContext).toEqual({ elementCount: 3 });
    expect(data.outcome).toBe("discarded");
    expect(data.outcomeReason).toBe("半径超出边界");
    expect(data.changedIds).toEqual(["circle-1"]);
    expect(metrics.snapshot().counters["ai.turns_discarded"]).toBe(1);

    prismaMock.chatMessage.findUnique.mockResolvedValue(null);
    const skipped = await authed("post", "/api/chat/turns/turn-2/outcome").send({
      sessionId: "sess-1",
      outcome: "applied",
    });
    expect(skipped.status).toBe(200);
    expect(skipped.body.recorded).toBe(false);

    const badOutcome = await authed("post", "/api/chat/turns/turn-1/outcome").send({
      sessionId: "sess-1",
      outcome: "maybe",
    });
    expect(badOutcome.status).toBe(400);
  });

  it("轮次回执写入激活技能归属，供采纳率统计使用", async () => {
    prismaMock.chatMessage.findUnique.mockResolvedValue({
      id: "msg-1",
      metadata: { canvasContext: { elementCount: 3 } },
    });
    prismaMock.chatMessage.update.mockResolvedValue(messageRow());

    const res = await authed("post", "/api/chat/turns/turn-1/outcome").send({
      sessionId: "sess-1",
      outcome: "applied",
      skillCodes: ["mech-draft", "mech-draft", "layout-plan"],
    });

    expect(res.status).toBe(200);
    const metadata = prismaMock.chatMessage.update.mock.calls[0][0].data.metadata;
    expect(metadata.skillCodes).toEqual(["mech-draft", "layout-plan"]);
    expect(metadata.outcome).toBe("applied");
  });

  it("轮次回执校验技能代码为字符串数组", async () => {
    const bad = await authed("post", "/api/chat/turns/turn-1/outcome").send({
      sessionId: "sess-1",
      outcome: "applied",
      skillCodes: [123],
    });
    expect(bad.status).toBe(400);
  });

  it("轮次回执只接受本人会话", async () => {
    prismaMock.chatSession.findFirst.mockResolvedValue(null);
    const res = await authed("post", "/api/chat/turns/turn-1/outcome").send({
      sessionId: "sess-x",
      outcome: "applied",
    });
    expect(res.status).toBe(404);
    expect(prismaMock.chatMessage.findUnique).not.toHaveBeenCalled();
  });

  it("回答反馈合并写入助手消息 metadata 并计入指标", async () => {
    prismaMock.chatMessage.findFirst.mockResolvedValue({
      id: "msg-2",
      metadata: { canvasContext: { elementCount: 3 } },
    });
    prismaMock.chatMessage.update.mockResolvedValue(messageRow());

    const res = await authed("post", "/api/chat/turns/turn-1/feedback").send({
      sessionId: "sess-1",
      rating: "down",
      reason: "不准确",
      skillCodes: ["mech-draft", "mech-draft"],
    });

    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(true);
    expect(res.body.messageId).toBe("msg-2");
    const where = prismaMock.chatMessage.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      sessionId: "sess-1",
      senderType: "ai",
      clientMessageId: { startsWith: "turn-1:" },
    });
    const metadata = prismaMock.chatMessage.update.mock.calls[0][0].data.metadata;
    expect(metadata.canvasContext).toEqual({ elementCount: 3 });
    expect(metadata.feedback).toMatchObject({ rating: "down", reason: "不准确" });
    expect(typeof metadata.feedback.at).toBe("string");
    expect(metadata.feedbackSkillCodes).toEqual(["mech-draft"]);
    expect(metrics.snapshot().counters["ai.feedback_down"]).toBe(1);
  });

  it("回答反馈校验评分与原因长度", async () => {
    const badRating = await authed("post", "/api/chat/turns/turn-1/feedback").send({
      sessionId: "sess-1",
      rating: "maybe",
    });
    expect(badRating.status).toBe(400);

    const longReason = await authed("post", "/api/chat/turns/turn-1/feedback").send({
      sessionId: "sess-1",
      rating: "up",
      reason: "x".repeat(201),
    });
    expect(longReason.status).toBe(400);

    const tooManySkills = await authed("post", "/api/chat/turns/turn-1/feedback").send({
      sessionId: "sess-1",
      rating: "up",
      skillCodes: Array.from({ length: 9 }, (_, i) => `skill-${i}`),
    });
    expect(tooManySkills.status).toBe(400);
    expect(prismaMock.chatMessage.update).not.toHaveBeenCalled();
  });

  it("回答反馈只接受本人会话，未落库的轮次跳过记录", async () => {
    prismaMock.chatSession.findFirst.mockResolvedValue(null);
    const forbidden = await authed("post", "/api/chat/turns/turn-1/feedback").send({
      sessionId: "sess-x",
      rating: "up",
    });
    expect(forbidden.status).toBe(404);
    expect(prismaMock.chatMessage.findFirst).not.toHaveBeenCalled();

    prismaMock.chatSession.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.id === "sess-1" && where?.userId === "user-1" ? sessionRow() : null),
    );
    prismaMock.chatMessage.findFirst.mockResolvedValue(null);
    const skipped = await authed("post", "/api/chat/turns/turn-9/feedback").send({
      sessionId: "sess-1",
      rating: "up",
    });
    expect(skipped.status).toBe(200);
    expect(skipped.body.recorded).toBe(false);
    expect(prismaMock.chatMessage.update).not.toHaveBeenCalled();
  });

  it("删除会话限定本人", async () => {
    prismaMock.chatSession.deleteMany.mockResolvedValue({ count: 0 });
    const missing = await authed("delete", "/api/chat/sessions/sess-x");
    expect(missing.status).toBe(404);

    prismaMock.chatSession.deleteMany.mockResolvedValue({ count: 1 });
    const deleted = await authed("delete", "/api/chat/sessions/sess-1");
    expect(deleted.status).toBe(200);
    expect(prismaMock.chatSession.deleteMany.mock.calls.at(-1)![0].where).toEqual({
      id: "sess-1",
      userId: "user-1",
    });
  });

  it("未鉴权请求无法访问会话", async () => {
    const res = await request(app).get("/api/chat/sessions/proj-1");
    expect(res.status).toBe(401);
  });
});
