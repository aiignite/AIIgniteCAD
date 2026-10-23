/**
 * llmChatTools.test.ts — Provider 工具调用流式集成测试
 *
 * 通过 mock 全局 fetch 模拟 4 家 Provider 的 SSE 响应，
 * 不访问外网、不需要 API Key，验证请求体携带 tools 且下发 toolCall 事件。
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
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    aiSkill: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    aiCallLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import app from "../src/app";
import { metrics } from "../src/lib/metrics";
import { generateToken } from "../src/middleware/auth";

const token = generateToken({
  id: "user-1",
  email: "alice@example.com",
  username: "alice",
});

const sseResponse = (chunks: unknown[], includeDone = false): Response => {
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    (includeDone ? "data: [DONE]\n\n" : "");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
};

/** Google Gemini 与 Ollama 使用 NDJSON 流，不使用 SSE data: 前缀 */
const ndjsonResponse = (chunks: unknown[]): Response =>
  new Response(chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + "\n", {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });

const parseEvents = (text: string): any[] =>
  text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice(6).trim())
    .filter((block) => block !== "[DONE]")
    .map((block) => JSON.parse(block));

const stubModel = (provider: string) => {
  prismaMock.lLMModel.findFirst.mockResolvedValue({
    id: "model-1",
    userId: "user-1",
    provider,
    modelId: "test-model",
    name: "Test Model",
    isActive: true,
    isDefault: false,
    supportsTools: true,
    contextWindow: 8000,
    maxOutputTokens: 1024,
    temperature: null,
    topP: null,
    timeoutSeconds: 30,
    promptPricePer1k: null,
    completionPricePer1k: null,
    apiKeyEncrypted: null,
    configuration: provider === "Ollama" ? { apiUrl: "http://ollama.test" } : {},
  });
};

const postChat = () =>
  request(app)
    .post("/api/llm/chat")
    .set("Authorization", `Bearer ${token}`)
    .send({ message: "draw something", modelId: "model-1", enableTools: true });

describe("POST /api/llm/chat tool calling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    metrics.reset();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
    });
    prismaMock.lLMModel.findMany.mockResolvedValue([]);
    prismaMock.lLMModel.findUnique.mockResolvedValue(null);
    prismaMock.aiSkill.upsert.mockResolvedValue({ id: "skill-1" });
    prismaMock.aiSkill.findMany.mockResolvedValue([]);
    prismaMock.aiCallLog.create.mockResolvedValue({ id: "log-1" });
    prismaMock.aiCallLog.findMany.mockResolvedValue([]);
  });

  it("OpenAI 请求携带 tools，并拼装分片 tool_calls", async () => {
    stubModel("OpenAI");
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { choices: [{ delta: { content: "Drawing. " } }] },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "draw_line", arguments: '{"x1":1,' },
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '"y1":2,"x2":3,"y2":4}' },
              }],
            },
          }],
        },
      ], true),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat();
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools).toHaveLength(28);
    expect(body.tool_choice).toBe("auto");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("画布世界坐标");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "draw something" });

    const events = parseEvents(res.text);
    expect(events.find((event) => event.content)?.content).toBe("Drawing. ");
    expect(events.find((event) => event.toolCall)?.toolCall).toEqual({
      id: "call_1",
      name: "draw_line",
      arguments: { x1: 1, y1: 2, x2: 3, y2: 4 },
    });
  });

  it("Anthropic 请求携带 input_schema，并拼装 input_json_delta", async () => {
    stubModel("Anthropic");
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "message_start",
          message: { usage: { input_tokens: 42, output_tokens: 1 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "draw_circle" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"cx":10,' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"cy":20,"radius":5}' },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", usage: { output_tokens: 17 } },
        { type: "message_stop" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat();
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools).toHaveLength(28);
    expect(body.tools[0].input_schema.type).toBe("object");
    expect(body.system).toContain("本轮可用工具");

    const toolCall = parseEvents(res.text).find((event) => event.toolCall)?.toolCall;
    expect(toolCall).toEqual({
      id: "toolu_1",
      name: "draw_circle",
      arguments: { cx: 10, cy: 20, radius: 5 },
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.histograms["ai.tokens.prompt"].p50).toBe(42);
    expect(snapshot.histograms["ai.tokens.completion"].p50).toBe(17);
    expect(snapshot.histograms["ai.context_chars"].count).toBe(1);
  });

  it("Google 请求携带 functionDeclarations，并解析 functionCall", async () => {
    stubModel("Google");
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([
        {
          candidates: [{
            content: {
              parts: [{
                functionCall: {
                  name: "draw_rectangle",
                  args: { x: 0, y: 0, width: 10, height: 10 },
                },
              }],
            },
          }],
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat();
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools[0].functionDeclarations).toHaveLength(28);
    expect(body.tools[0].functionDeclarations[0].parameters.type).toBe("OBJECT");
    expect(body.systemInstruction.parts[0].text).toContain("画布世界坐标");

    const toolCall = parseEvents(res.text).find((event) => event.toolCall)?.toolCall;
    expect(toolCall).toMatchObject({
      name: "draw_rectangle",
      arguments: { x: 0, y: 0, width: 10, height: 10 },
    });
  });

  it("Ollama 请求携带 tools，并转发完整 tool_calls", async () => {
    stubModel("Ollama");
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([
        {
          message: {
            content: "",
            tool_calls: [{
              function: { name: "draw_text", arguments: { x: 5, y: 6, text: "Hi" } },
            }],
          },
          prompt_eval_count: 31,
          eval_count: 9,
          done: true,
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat();
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools).toHaveLength(28);
    expect(body.messages[0].role).toBe("system");

    const toolCall = parseEvents(res.text).find((event) => event.toolCall)?.toolCall;
    expect(toolCall).toMatchObject({
      name: "draw_text",
      arguments: { x: 5, y: 6, text: "Hi" },
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.histograms["ai.tokens.prompt"].p50).toBe(31);
    expect(snapshot.histograms["ai.tokens.completion"].p50).toBe(9);
  });

  it("计划模式只下发只读工具与 propose_plan，并注入计划规则", async () => {
    stubModel("OpenAI");
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([{ choices: [{ delta: { content: "先确认现状" } }] }], true),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/llm/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "帮我规划车间布局", modelId: "model-1", planMode: true });
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
      "get_canvas_info",
      "query_elements",
      "measure_geometry",
      "check_drawing",
      "list_blocks",
      "propose_plan",
    ]);
    expect(body.messages[0].content).toContain("计划模式");
    expect(body.messages[0].content).toContain("propose_plan");

    const context = parseEvents(res.text).find((event) => event.event === "context");
    expect(context?.allowedTools).toEqual([
      "get_canvas_info",
      "query_elements",
      "measure_geometry",
      "check_drawing",
      "list_blocks",
      "propose_plan",
    ]);
    expect(context.toolsEnabled).toBe(true);
  });

  it("多方案模式只下发只读工具与 propose_variants", async () => {
    stubModel("OpenAI");
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([{ choices: [{ delta: { content: "给出两个方案" } }] }], true),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/llm/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "给我两个布局方案对比", modelId: "model-1", variantMode: true });
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools.map((tool: any) => tool.function.name)).toEqual([
      "get_canvas_info",
      "query_elements",
      "measure_geometry",
      "check_drawing",
      "list_blocks",
      "propose_variants",
    ]);
    expect(body.messages[0].content).toContain("多方案模式");
    expect(body.messages[0].content).toContain("propose_variants");

    const context = parseEvents(res.text).find((event) => event.event === "context");
    expect(context?.mode).toBe("variants");
  });

  it("Provider 未返回 usage 时按字符数估算 token 指标", async () => {
    stubModel("OpenAI");
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([{ choices: [{ delta: { content: "abcdefgh" } }] }], true),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat();
    expect(res.status).toBe(200);
    expect(res.text).toContain("abcdefgh");

    const snapshot = metrics.snapshot();
    const prompt = snapshot.histograms["ai.tokens.prompt"];
    const completion = snapshot.histograms["ai.tokens.completion"];
    expect(prompt.count).toBe(1);
    expect(prompt.p50).toBeGreaterThan(0);
    expect(completion.p50).toBe(2);
    expect(snapshot.histograms["ai.context_chars"].p50).toBeGreaterThan("draw something".length);
  });

  it("Provider 拒绝 tools 时自动去掉工具重试，保留文本降级", async () => {
    stubModel("OpenAI");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("tools unsupported", { status: 400 }))
      .mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "Plain answer" } }] }], true),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await postChat();
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(retryBody.tools).toBeUndefined();
    expect(retryBody.tool_choice).toBeUndefined();
    expect(res.text).toContain("Plain answer");
  });
});
