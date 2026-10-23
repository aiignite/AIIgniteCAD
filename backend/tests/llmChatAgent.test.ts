/**
 * llmChatAgent.test.ts — Agent 编排（会话落库、幂等、技能路由、工具校验、故障转移）
 *
 * Provider 用 mock fetch 固定 SSE 序列，Prisma 用带内存消息表的 mock，
 * 断言集中在"落库键是否幂等、事件契约是否稳定、非法工具是否被挡住"。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { prismaMock, messages } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    projectVersion: { findMany: vi.fn() },
    assistant: { findFirst: vi.fn() },
    lLMModel: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    chatSession: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { upsert: vi.fn(), findMany: vi.fn() },
    aiSkill: { upsert: vi.fn(), findMany: vi.fn() },
    aiCallLog: { create: vi.fn(), findMany: vi.fn() },
  },
  messages: [] as Array<Record<string, unknown>>,
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: prismaMock,
  default: prismaMock,
}));
vi.mock("../src/services/aiEngine/skills/skillService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/aiEngine/skills/skillService")>();
  return { ...actual, ensureSystemSkills: vi.fn().mockResolvedValue(undefined) };
});

import app from "../src/app";
import { metrics } from "../src/lib/metrics";
import { generateToken } from "../src/middleware/auth";

const token = generateToken({ id: "user-1", email: "alice@example.com", username: "alice" });

const modelRow = (overrides: Record<string, unknown> = {}) => ({
  id: "model-1",
  userId: "user-1",
  provider: "OpenAI",
  modelId: "gpt-test",
  name: "GPT Test",
  isActive: true,
  isDefault: true,
  supportsTools: true,
  contextWindow: 32_000,
  maxOutputTokens: 2_000,
  temperature: null,
  topP: null,
  timeoutSeconds: 30,
  promptPricePer1k: 0.001,
  completionPricePer1k: 0.002,
  apiKeyEncrypted: null,
  configuration: {},
  ...overrides,
});

const sessionRow = {
  id: "sess-1",
  projectId: "proj-1",
  title: "画一条线",
  modelId: "model-1",
  contextSummary: null,
  contextSummaryUpToId: null,
};

const assistantRow = (overrides: Record<string, unknown> = {}) => ({
  id: "asst-1",
  name: "绘图助手",
  prompt: null,
  llmModelId: null,
  toolNames: null,
  maxToolRounds: 4,
  temperature: null,
  maxTokens: null,
  skills: [],
  ...overrides,
});

const skillRow = (overrides: Record<string, unknown> = {}) => ({
  id: "skill-1",
  code: "cad_drafting_basic",
  name: "基础绘图",
  description: "绘制线、圆、矩形",
  category: "Drawing",
  promptTemplate: "优先使用 draw_line / draw_circle 工具。",
  toolNames: ["draw_line", "draw_circle", "get_canvas_info"],
  keywords: ["画", "绘制"],
  selectionTypes: [],
  priority: 10,
  isEnabled: true,
  isSystem: true,
  userId: null,
  ...overrides,
});

const sseResponse = (chunks: unknown[]): Response =>
  new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

const textChunks = (text: string) => [{ choices: [{ delta: { content: text } }] }];

const toolCallChunks = (index: number, call: { id: string; name: string; arguments: string }) => [
  {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            },
          ],
        },
      },
    ],
  },
];

const parseEvents = (text: string): any[] =>
  text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice(6).trim())
    .filter((block) => block !== "[DONE]")
    .map((block) => JSON.parse(block));

const postChat = (body: Record<string, unknown>) =>
  request(app)
    .post("/api/llm/chat")
    .set("Authorization", `Bearer ${token}`)
    .send(body);

const createdMessages = () =>
  prismaMock.chatMessage.upsert.mock.calls.map(([args]: [any]) => args.create);

describe("POST /api/llm/chat agent orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    metrics.reset();
    messages.length = 0;

    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    prismaMock.project.findFirst.mockResolvedValue({ id: "proj-1" });
    prismaMock.projectVersion.findMany.mockResolvedValue([]);
    prismaMock.assistant.findFirst.mockResolvedValue(null);
    prismaMock.lLMModel.findFirst.mockResolvedValue(modelRow());
    prismaMock.lLMModel.findMany.mockResolvedValue([]);
    prismaMock.lLMModel.findUnique.mockResolvedValue(modelRow());
    prismaMock.chatSession.findFirst.mockResolvedValue(sessionRow);
    prismaMock.chatSession.findUnique.mockResolvedValue({
      contextSummary: null,
      contextSummaryUpToId: null,
    });
    prismaMock.chatSession.create.mockResolvedValue(sessionRow);
    prismaMock.chatSession.update.mockResolvedValue(sessionRow);
    prismaMock.chatMessage.findMany.mockImplementation(() => Promise.resolve([...messages]));
    prismaMock.chatMessage.upsert.mockImplementation(({ where, create }: any) => {
      const key = where.sessionId_clientMessageId.clientMessageId;
      const existing = messages.find((row) => row.clientMessageId === key);
      if (existing) {
        Object.assign(existing, create);
        return Promise.resolve(existing);
      }
      const row = { id: `msg-${messages.length + 1}`, ...create };
      messages.push(row);
      return Promise.resolve(row);
    });
    prismaMock.aiSkill.findMany.mockResolvedValue([]);
    prismaMock.aiCallLog.create.mockResolvedValue({ id: "log-1" });
    prismaMock.aiCallLog.findMany.mockResolvedValue([]);
  });

  it("首轮把用户与助手消息按 turnId 落库", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(textChunks("已画一条线"))));

    const res = await postChat({
      message: "画一条线",
      sessionId: "sess-1",
      turnId: "turn-1",
      modelId: "model-1",
      enableTools: true,
    });

    expect(res.status).toBe(200);
    expect(createdMessages().map((row: any) => row.clientMessageId)).toEqual([
      "turn-1",
      "turn-1:r0:assistant",
    ]);
    expect(createdMessages()[0]).toMatchObject({
      sessionId: "sess-1",
      role: "user",
      content: "画一条线",
    });
    expect(createdMessages()[1]).toMatchObject({ role: "assistant", content: "已画一条线" });

    const done = parseEvents(res.text).find((event) => event.event === "done");
    expect(done).toMatchObject({
      sessionId: "sess-1",
      messageId: "msg-2",
      turnId: "turn-1",
      round: 0,
      nextPhase: null,
    });
  });

  it("项目设计约定注入系统提示词", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: "proj-1",
      designConventions: {
        standard: "GB/T 14689",
        units: "mm",
        textHeight: 3.5,
        dimensionPrecision: 2,
        layerRules: [{ name: "WALLS", purpose: "墙体" }],
        notes: ["门洞现场复核"],
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("好的")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "按项目约定画一条线",
      sessionId: "sess-1",
      turnId: "turn-conventions",
      modelId: "model-1",
      enableTools: true,
    });
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain("# 项目设计约定");
    expect(body.messages[0].content).toContain("GB/T 14689");
    expect(body.messages[0].content).toContain("WALLS（墙体）");
    expect(parseEvents(res.text).find((event) => event.event === "context")).toMatchObject({
      hasDesignConventions: true,
    });
  });

  it("最近版本变更注入版本记忆", async () => {
    prismaMock.projectVersion.findMany.mockResolvedValue([
      {
        versionNumber: 3,
        elementCount: 12,
        commitMessage: "补充标注",
        changeSummary: {
          added: 2,
          removed: 1,
          addedByType: { DIMENSION: 2 },
          removedByType: { LINE: 1 },
          layersTouched: ["DIM"],
        },
        createdAt: new Date("2026-10-22T00:00:00.000Z"),
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("好的")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "继续补标注",
      sessionId: "sess-1",
      turnId: "turn-memory",
      modelId: "model-1",
      enableTools: true,
    });
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain("# 版本记忆");
    expect(body.messages[0].content).toContain("v3");
    expect(body.messages[0].content).toContain("+2 / -1");
    expect(body.messages[0].content).toContain("补充标注");
    expect(parseEvents(res.text).find((event) => event.event === "context")).toMatchObject({
      versionMemoryCount: 1,
    });
  });

  it("重放同一个 turnId 复用同一组唯一键，不产生重复消息", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(textChunks("第一次")))
      .mockResolvedValueOnce(sseResponse(textChunks("第二次")));
    vi.stubGlobal("fetch", fetchMock);

    const body = { message: "画一条线", sessionId: "sess-1", turnId: "turn-1", modelId: "model-1" };
    await postChat(body);
    const firstKeys = prismaMock.chatMessage.upsert.mock.calls.map(
      ([args]: [any]) => args.where.sessionId_clientMessageId.clientMessageId,
    );
    const firstRows = messages.length;
    prismaMock.chatMessage.upsert.mockClear();

    await postChat(body);
    const secondKeys = prismaMock.chatMessage.upsert.mock.calls.map(
      ([args]: [any]) => args.where.sessionId_clientMessageId.clientMessageId,
    );

    expect(firstKeys).toEqual(["turn-1", "turn-1:r0:assistant"]);
    expect(secondKeys).toEqual(firstKeys);
    expect(messages).toHaveLength(firstRows);
  });

  it("tool_results 续轮把结果落成工具消息并回传历史", async () => {
    messages.push({
      id: "msg-h",
      sessionId: "sess-1",
      clientMessageId: "turn-1",
      role: "user",
      content: "画一条线",
      toolName: null,
      toolCallId: null,
      toolCalls: null,
      createdAt: new Date("2026-10-21T00:00:00Z"),
    });
    messages.push({
      id: "msg-a",
      sessionId: "sess-1",
      clientMessageId: "turn-1:r0:assistant",
      role: "assistant",
      content: "准备画线",
      toolName: null,
      toolCallId: null,
      toolCalls: [{ id: "call_1", name: "draw_line", arguments: { x1: 0, y1: 0, x2: 10, y2: 10 } }],
      createdAt: new Date("2026-10-21T00:00:01Z"),
    });

    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("标注完成")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      phase: "tool_results",
      turnId: "turn-1",
      round: 1,
      sessionId: "sess-1",
      modelId: "model-1",
      toolResults: [{ toolCallId: "call_1", name: "draw_line", ok: true, changedIds: ["a1"] }],
    });

    expect(res.status).toBe(200);
    expect(createdMessages().map((row: any) => row.clientMessageId)).toEqual([
      "turn-1:r0:tool:call_1",
      "turn-1:r1:assistant",
    ]);

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages;
    expect(sent.map((message: any) => message.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(sent[2].tool_calls[0].id).toBe("call_1");
    expect(sent[3].tool_call_id).toBe("call_1");
    expect(sent[3].content).toContain('"ok":true');

    const done = parseEvents(res.text).find((event) => event.event === "done");
    expect(done).toMatchObject({ round: 1, nextPhase: null });
  });

  it("历史里的孤儿 tool 消息被跳过，不至于打爆 provider", async () => {
    // 旧版本会把被拒调用落在这条位置：role=tool 但没有配对的 assistant.tool_calls
    messages.push({
      id: "msg-ghost",
      sessionId: "sess-1",
      clientMessageId: "turn-old:r0:tool:call_ghost",
      role: "tool",
      content: '{"ok":false,"tool":"draw_circle","error":"半径非法"}',
      toolName: "draw_circle",
      toolCallId: "call_ghost",
      toolCalls: null,
      createdAt: new Date("2026-10-20T00:00:00Z"),
    });
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("好的")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "继续",
      sessionId: "sess-1",
      turnId: "turn-ghost",
      modelId: "model-1",
      enableTools: true,
    });

    expect(res.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages as any[];
    expect(sent.some((message) => message.role === "tool")).toBe(false);
  });

  it("超过助手轮次上限时在任何写入与上游调用之前拒绝", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(assistantRow({ maxToolRounds: 2 }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      phase: "tool_results",
      turnId: "turn-1",
      round: 2,
      sessionId: "sess-1",
      assistantId: "asst-1",
      modelId: "model-1",
      toolResults: [{ toolCallId: "call_1", name: "draw_line", ok: true }],
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOOL_ROUND_LIMIT");
    expect(prismaMock.chatMessage.upsert).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("context 事件下发轮次上限，供前端在下一轮之前收口", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("好的")));
    vi.stubGlobal("fetch", fetchMock);

    const plain = await postChat({
      message: "画一条线",
      sessionId: "sess-1",
      turnId: "turn-round-1",
      modelId: "model-1",
      enableTools: true,
    });
    expect(parseEvents(plain.text).find((event) => event.event === "context")).toMatchObject({
      maxRounds: 4,
    });

    prismaMock.assistant.findFirst.mockResolvedValue(assistantRow({ maxToolRounds: 2 }));
    const capped = await postChat({
      message: "画一条线",
      sessionId: "sess-1",
      turnId: "turn-round-2",
      assistantId: "asst-1",
      modelId: "model-1",
      enableTools: true,
    });
    expect(parseEvents(capped.text).find((event) => event.event === "context")).toMatchObject({
      maxRounds: 2,
    });
  });

  it("助手 prompt 与技能提示进入系统提示词，并下发 skill_activated", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(
      assistantRow({ prompt: "总是先确认单位", skills: [{ skillId: "skill-1", weight: 60 }] }),
    );
    prismaMock.aiSkill.findMany.mockResolvedValue([skillRow()]);
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("好的")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "画一条线",
      sessionId: "sess-1",
      turnId: "turn-2",
      assistantId: "asst-1",
      modelId: "model-1",
      enableTools: true,
    });

    expect(res.status).toBe(200);
    const system = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages[0].content;
    expect(system).toContain("总是先确认单位");
    expect(system).toContain("优先使用 draw_line");
    expect(system).toContain("get_canvas_info");

    const skill = parseEvents(res.text).find((event) => event.event === "skill_activated");
    expect(skill).toMatchObject({ code: "cad_drafting_basic", name: "基础绘图" });
    expect(skill.score).toBeGreaterThanOrEqual(12);
  });

  it("助手工具白名单限制本轮可用工具", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(
      assistantRow({ prompt: "只能画线", toolNames: ["draw_line"] }),
    );
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("好的")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "画一条线",
      sessionId: "sess-1",
      turnId: "turn-3",
      assistantId: "asst-1",
      modelId: "model-1",
      enableTools: true,
    });

    expect(res.status).toBe(200);
    const tools = JSON.parse(fetchMock.mock.calls[0][1].body as string).tools;
    expect(tools.map((tool: any) => tool.function.name)).toEqual(["draw_line"]);
  });

  it("计划模式只下发只读工具，但步骤可引用的写工具进入提示词", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("已提交计划")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "规划一个房间轮廓并标注",
      sessionId: "sess-1",
      turnId: "turn-plan",
      modelId: "model-1",
      planMode: true,
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const toolNames = body.tools.map((tool: any) => tool.function.name);
    expect(toolNames).toContain("propose_plan");
    expect(toolNames).not.toContain("draw_line");

    const system = body.messages[0].content as string;
    expect(system).toContain("# 计划步骤可引用的写工具");
    expect(system).toContain("- draw_line(x1, y1, x2, y2)");
    expect(system).toContain("- array_elements(rows, columns, rowSpacing, columnSpacing, [ids])");
  });

  it("助手白名单也约束计划步骤可引用的写工具", async () => {
    prismaMock.assistant.findFirst.mockResolvedValue(
      assistantRow({ toolNames: ["draw_line", "get_canvas_info"] }),
    );
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("已提交计划")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "规划画线",
      sessionId: "sess-1",
      turnId: "turn-plan-whitelist",
      assistantId: "asst-1",
      modelId: "model-1",
      planMode: true,
    });

    expect(res.status).toBe(200);
    const system = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages[0].content as string;
    expect(system).toContain("- draw_line(x1, y1, x2, y2)");
    expect(system).not.toContain("- draw_circle(");
  });

  it("非法工具参数被拒绝并落库为 rejected 工具消息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          ...toolCallChunks(0, { id: "call_1", name: "draw_circle", arguments: '{"cx":1,"cy":1,"radius":-5}' }),
          ...toolCallChunks(1, { id: "call_2", name: "draw_line", arguments: '{"x1":1,"y1":2,"x2":3,"y2":4}' }),
        ]),
      ),
    );

    const res = await postChat({
      message: "画一个圆和一条线",
      sessionId: "sess-1",
      turnId: "turn-4",
      modelId: "model-1",
      enableTools: true,
    });

    expect(res.status).toBe(200);
    const events = parseEvents(res.text);
    expect(events.find((event) => event.event === "tool_rejected")).toMatchObject({
      toolCallId: "call_1",
      name: "draw_circle",
      reason: "BAD_NUMBER",
    });
    const accepted = events.filter((event) => event.event === "tool_call");
    expect(accepted).toHaveLength(1);
    expect(accepted[0].toolCall).toMatchObject({ id: "call_2", name: "draw_line" });

    const rejectedRow = createdMessages().find(
      (row: any) => row.clientMessageId === "turn-4:r0:tool:call_1",
    );
    expect(rejectedRow).toMatchObject({ role: "tool", status: "rejected", toolName: "draw_circle" });
    const assistantRowSaved = createdMessages().find(
      (row: any) => row.clientMessageId === "turn-4:r0:assistant",
    );
    // 助手行收录模型发起的全部调用，被拒调用保留原始参数，tool 消息才能配对
    expect((assistantRowSaved as any).toolCalls).toEqual([
      { id: "call_2", name: "draw_line", arguments: { x1: 1, y1: 2, x2: 3, y2: 4 } },
      { id: "call_1", name: "draw_circle", arguments: { cx: 1, cy: 1, radius: -5 } },
    ]);
    // 被拒工具消息必须排在助手消息之后：provider 不接受没有 tool_calls 前驱的 tool 消息
    expect(
      createdMessages().map((row: any) => row.clientMessageId),
    ).toEqual(["turn-4", "turn-4:r0:assistant", "turn-4:r0:tool:call_1"]);
    expect(parseEvents(res.text).find((event) => event.event === "done").nextPhase).toBe("tool_results");
  });

  it("被拒调用回传后，下一轮 provider 消息满足 tool_call 配对", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ...toolCallChunks(0, {
          id: "call_1",
          name: "draw_circle",
          arguments: '{"cx":1,"cy":1,"radius":-5}',
        }),
        ...toolCallChunks(1, {
          id: "call_2",
          name: "draw_line",
          arguments: '{"x1":1,"y1":2,"x2":3,"y2":4}',
        }),
      ]),
    );
    fetchMock.mockResolvedValueOnce(sseResponse(textChunks("已修正半径")));
    vi.stubGlobal("fetch", fetchMock);

    const first = await postChat({
      message: "画一个圆和一条线",
      sessionId: "sess-1",
      turnId: "turn-pair",
      modelId: "model-1",
      enableTools: true,
    });
    expect(first.status).toBe(200);

    await postChat({
      phase: "tool_results",
      turnId: "turn-pair",
      round: 1,
      sessionId: "sess-1",
      modelId: "model-1",
      enableTools: true,
      toolResults: [
        { toolCallId: "call_2", name: "draw_line", ok: true, changedIds: ["line-1"] },
        { toolCallId: "call_1", name: "draw_circle", ok: false, error: "draw_circle.radius 超出允许范围" },
      ],
    });

    const sent = JSON.parse(fetchMock.mock.calls[1][1].body as string).messages as any[];
    const declared = new Set<string>();
    for (const message of sent) {
      if (message.role === "assistant") {
        declared.clear();
        for (const call of message.tool_calls ?? []) declared.add(call.id);
        continue;
      }
      if (message.role === "tool") {
        // 每条 tool 消息都必须挂在刚刚那条 assistant 的 tool_calls 之下
        expect(declared.has(message.tool_call_id)).toBe(true);
        continue;
      }
      declared.clear();
    }
    expect(sent.filter((message) => message.role === "tool").map((message) => message.tool_call_id)).toEqual([
      "call_1",
      "call_2",
    ]);
    expect(sent.find((message) => message.tool_call_id === "call_1").content).toContain("radius");
  });

  it("白名单之外的工具与无目标的编辑工具都被拒绝", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse(
          toolCallChunks(0, { id: "call_1", name: "clear_canvas", arguments: "{}" }),
        ),
      ),
    );
    prismaMock.assistant.findFirst.mockResolvedValue(
      assistantRow({ prompt: "只能画线", toolNames: ["draw_line"] }),
    );

    const res = await postChat({
      message: "清空图纸",
      sessionId: "sess-1",
      turnId: "turn-5",
      assistantId: "asst-1",
      modelId: "model-1",
      enableTools: true,
    });
    expect(parseEvents(res.text).find((event) => event.event === "tool_rejected")).toMatchObject({
      name: "clear_canvas",
      reason: "TOOL_NOT_ALLOWED",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse(toolCallChunks(0, { id: "call_2", name: "rotate_elements", arguments: '{"angle":90}' })),
      ),
    );
    const second = await postChat({
      message: "旋转",
      sessionId: "sess-1",
      turnId: "turn-6",
      modelId: "model-1",
      enableTools: true,
      canvasContext: { selectedIds: [] },
    });
    expect(parseEvents(second.text).find((event) => event.event === "tool_rejected")).toMatchObject({
      name: "rotate_elements",
      reason: "NO_TARGET",
    });
    expect(parseEvents(second.text).some((event) => event.event === "tool_call")).toBe(false);
  });

  it("主模型不可用时故障转移并下发 model_fallback", async () => {
    prismaMock.lLMModel.findMany.mockResolvedValue([
      modelRow({ id: "model-2", modelId: "gpt-backup", name: "GPT Backup" }),
    ]);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("socket hang up"))
      .mockRejectedValueOnce(new TypeError("socket hang up"))
      .mockRejectedValueOnce(new TypeError("socket hang up"))
      .mockResolvedValueOnce(sseResponse(textChunks("备用模型回答")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "画一条线",
      sessionId: "sess-1",
      turnId: "turn-7",
      modelId: "model-1",
      enableTools: true,
    });

    expect(res.status).toBe(200);
    expect(parseEvents(res.text).find((event) => event.event === "model_fallback")).toMatchObject({
      from: "model-1",
      to: "model-2",
      reason: "NETWORK",
    });
    expect(res.text).toContain("备用模型回答");
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).model).toBe("gpt-backup");
    expect(metrics.snapshot().counters["ai.failovers"]).toBe(1);
  });

  it("Provider 鉴权失败不重试、不转移，SSE 返回 PROVIDER_AUTH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({
      message: "画一条线",
      sessionId: "sess-1",
      turnId: "turn-8",
      modelId: "model-1",
      enableTools: true,
    });

    expect(res.status).toBe(200);
    expect(parseEvents(res.text).find((event) => event.event === "error")).toMatchObject({
      code: "PROVIDER_AUTH",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.aiCallLog.create.mock.calls[0][0].data).toMatchObject({
      status: "error",
      errorCode: "PROVIDER_AUTH",
    });
  });

  it("没有会话时不落库，仍保持旧版单次调用行为", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(textChunks("无会话回答")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat({ message: "画一条线", modelId: "model-1" });

    expect(res.status).toBe(200);
    expect(prismaMock.chatMessage.upsert).not.toHaveBeenCalled();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
    expect(sent.at(-1)).toEqual({ role: "user", content: "画一条线" });
    expect(parseEvents(res.text).find((event) => event.event === "usage")).toMatchObject({
      reported: false,
    });
  });
});
