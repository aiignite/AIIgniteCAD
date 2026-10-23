import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    chatSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import {
  COMPACT_MIN_DROPPED,
  MAX_MESSAGE_CHARS,
  buildConversationWindow,
  compactSession,
  contextBudgetChars,
  digestHistory,
  mergeSummary,
} from "../src/services/aiEngine/contextManager";
import type { HistoryMessage } from "../src/services/aiEngine/contextManager";

const message = (overrides: Partial<HistoryMessage>): HistoryMessage => ({
  id: "msg-1",
  role: "user",
  content: "内容",
  toolName: null,
  toolCalls: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("digestHistory", () => {
  it("空历史返回空串", () => {
    expect(digestHistory([])).toBe("");
  });

  it("确定性输出：同样输入两次结果一致", () => {
    const rows = [
      message({ id: "a", role: "user", content: "画一个房间" }),
      message({
        id: "b",
        role: "assistant",
        content: "已绘制",
        toolCalls: [{ name: "draw_rectangle" }, { name: "draw_text" }],
      }),
    ];
    expect(digestHistory(rows)).toBe(digestHistory(rows));
  });

  it("记录请求、结论与工具计数", () => {
    const digest = digestHistory([
      message({ role: "user", content: "画一个 5000×4000 的房间" }),
      message({ role: "assistant", content: "房间已生成", toolCalls: [{ name: "draw_rectangle" }] }),
      message({ role: "assistant", content: "", toolCalls: [{ name: "draw_rectangle" }] }),
    ]);
    expect(digest).toContain("早期请求");
    expect(digest).toContain("5000×4000");
    expect(digest).toContain("助手结论");
    expect(digest).toContain("draw_rectangle×2");
  });

  it("超长消息被裁剪，摘要总长度有上限", () => {
    const digest = digestHistory(
      Array.from({ length: 40 }, (_, index) =>
        message({ id: `m${index}`, role: "user", content: `${index} ${"很长".repeat(200)}` }),
      ),
    );
    expect(digest.length).toBeLessThanOrEqual(2000);
  });

  it("工具计数只统计 assistant 消息上的 toolCalls，避免重复计数", () => {
    expect(digestHistory([message({ role: "tool", content: "{}", toolName: "move_elements" })])).not.toContain(
      "执行过的工具",
    );
  });
});

describe("mergeSummary", () => {
  it("任一为空时返回另一个", () => {
    expect(mergeSummary(null, "新摘要")).toBe("新摘要");
    expect(mergeSummary("旧摘要", "")).toBe("旧摘要");
  });

  it("合并后不超过 3000 字符且保留尾部", () => {
    const merged = mergeSummary("旧".repeat(2500), "新".repeat(2500));
    expect(merged.length).toBeLessThanOrEqual(3000);
    expect(merged.endsWith("新".repeat(2500))).toBe(true);
  });
});

describe("contextBudgetChars", () => {
  const original = process.env.AI_CONTEXT_CHAR_BUDGET;

  afterEach(() => {
    if (original === undefined) delete process.env.AI_CONTEXT_CHAR_BUDGET;
    else process.env.AI_CONTEXT_CHAR_BUDGET = original;
  });

  it("默认 24000", () => {
    delete process.env.AI_CONTEXT_CHAR_BUDGET;
    expect(contextBudgetChars()).toBe(24_000);
  });

  it("环境变量生效且过小被视为非法", () => {
    process.env.AI_CONTEXT_CHAR_BUDGET = "40000";
    expect(contextBudgetChars()).toBe(40_000);
    process.env.AI_CONTEXT_CHAR_BUDGET = "10";
    expect(contextBudgetChars()).toBe(24_000);
  });
});

describe("buildConversationWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.chatSession.findUnique.mockResolvedValue({
      contextSummary: null,
      contextSummaryUpToId: null,
    });
    prismaMock.chatSession.update.mockResolvedValue({});
  });

  it("近期消息全部保留时不写库", async () => {
    prismaMock.chatMessage.findMany.mockResolvedValue([
      message({ id: "m1", content: "短问题" }),
      message({ id: "m2", role: "assistant", content: "短回答" }),
    ]);
    const window = await buildConversationWindow({ sessionId: "s1" });
    expect(window.messages.map((row) => row.id)).toEqual(["m1", "m2"]);
    expect(window.droppedCount).toBe(0);
    expect(prismaMock.chatSession.update).not.toHaveBeenCalled();
  });

  it("超出预算时保留最近消息并折叠更早的", async () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      message({
        id: `m${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        content: "x".repeat(1_000),
      }),
    );
    prismaMock.chatMessage.findMany.mockResolvedValue(rows);

    const window = await buildConversationWindow({ sessionId: "s1", budgetChars: 10_000 });
    // 60% 预算 → 约 6000 字符，即最近 6 条
    expect(window.usedChars).toBeLessThanOrEqual(6_000);
    expect(window.messages.length).toBeLessThan(rows.length);
    expect(window.messages[window.messages.length - 1].id).toBe("m19");
    expect(window.droppedCount).toBeGreaterThanOrEqual(COMPACT_MIN_DROPPED);
    expect(prismaMock.chatSession.update).toHaveBeenCalledTimes(1);
    expect(window.summary).toContain("早期请求");
  });

  it("单条超长消息只截取注入上限", async () => {
    prismaMock.chatMessage.findMany.mockResolvedValue([
      message({ id: "big", content: "y".repeat(MAX_MESSAGE_CHARS + 5_000) }),
    ]);
    const window = await buildConversationWindow({ sessionId: "s1" });
    expect(window.usedChars).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
  });

  it("水位线之前的消息不再重复注入", async () => {
    prismaMock.chatSession.findUnique.mockResolvedValue({
      contextSummary: "已有摘要",
      contextSummaryUpToId: "m2",
    });
    prismaMock.chatMessage.findMany.mockResolvedValue([
      message({ id: "m1", createdAt: new Date("2026-01-01") }),
      message({ id: "m2", createdAt: new Date("2026-01-02") }),
      message({ id: "m3", createdAt: new Date("2026-01-03"), content: "新问题" }),
    ]);
    const window = await buildConversationWindow({ sessionId: "s1" });
    expect(window.messages.map((row) => row.id)).toEqual(["m3"]);
    expect(window.summary).toBe("已有摘要");
  });

  it("写摘要失败只降级告警，不影响本轮返回", async () => {
    prismaMock.chatMessage.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) =>
        message({ id: `m${index}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)), content: "x".repeat(2_000) }),
      ),
    );
    prismaMock.chatSession.update.mockRejectedValue(new Error("db down"));
    const window = await buildConversationWindow({ sessionId: "s1", budgetChars: 10_000 });
    expect(window.messages.length).toBeGreaterThan(0);
  });
});

describe("compactSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.chatSession.update.mockResolvedValue({});
  });

  it("把全部历史折叠为摘要并推进水位线", async () => {
    prismaMock.chatMessage.findMany.mockResolvedValue([
      message({ id: "m1", content: "画房间", createdAt: new Date("2026-01-01") }),
      message({ id: "m2", role: "assistant", content: "完成", createdAt: new Date("2026-01-02") }),
    ]);
    const result = await compactSession("s1");
    expect(result.droppedCount).toBe(2);
    expect(result.summary).toContain("画房间");
    expect(prismaMock.chatSession.update.mock.calls[0][0].data.contextSummaryUpToId).toBe("m2");
  });

  it("空会话写入空摘要", async () => {
    prismaMock.chatMessage.findMany.mockResolvedValue([]);
    const result = await compactSession("s1");
    expect(result.summary).toBe("");
    expect(prismaMock.chatSession.update.mock.calls[0][0].data.contextSummaryUpToId).toBeNull();
  });
});
