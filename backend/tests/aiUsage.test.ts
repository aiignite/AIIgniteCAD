import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lLMModel: { findUnique: vi.fn() },
    aiCallLog: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import { metrics } from "../src/lib/metrics";
import {
  CHARS_PER_TOKEN,
  computeCost,
  estimateTokens,
  recordAiCallLog,
  resolveUsage,
  summarizeUsage,
} from "../src/services/aiEngine/usageAccounting";

const usage = (promptTokens: number, completionTokens: number, reported = true) => ({
  promptTokens,
  completionTokens,
  reported,
});

beforeEach(() => {
  vi.clearAllMocks();
  metrics.reset();
  prismaMock.lLMModel.findUnique.mockResolvedValue(null);
  prismaMock.aiCallLog.create.mockResolvedValue({ id: "log-1" });
});

describe("estimateTokens / resolveUsage", () => {
  it("按 4 字符约等于 1 token 向上取整", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(9)).toBe(3);
  });

  it("provider 未上报 usage 时使用字符数估算并标记 reported=false", () => {
    const resolved = resolveUsage({}, { promptChars: 400, completionChars: 80 });
    expect(resolved).toEqual({ promptTokens: 100, completionTokens: 20, reported: false });
  });

  it("provider 上报时优先使用真实值", () => {
    const resolved = resolveUsage(
      { promptTokens: 1234, completionTokens: 56 },
      { promptChars: 400, completionChars: 80 },
    );
    expect(resolved).toEqual({ promptTokens: 1234, completionTokens: 56, reported: true });
  });

  it("只上报一半 usage 时另一半仍走估算", () => {
    const resolved = resolveUsage(
      { completionTokens: 40 },
      { promptChars: 1_000, completionChars: 200 },
    );
    expect(resolved.promptTokens).toBe(250);
    expect(resolved.completionTokens).toBe(40);
    expect(resolved.reported).toBe(true);
  });

  it("NaN 与负数被归一，不会写入非法 token 数", () => {
    const resolved = resolveUsage(
      { promptTokens: Number.NaN, completionTokens: -5 },
      { promptChars: 8, completionChars: 8 },
    );
    expect(resolved.promptTokens).toBe(2);
    expect(resolved.completionTokens).toBe(0);
  });
});

describe("computeCost", () => {
  it("未配置价格返回 null 而不是伪造成 0", () => {
    expect(computeCost({}, usage(1000, 1000))).toBeNull();
    expect(computeCost({ promptPricePer1k: 0, completionPricePer1k: 0 }, usage(1, 1))).toBeNull();
  });

  it("按每千 token 单价计算并保留 6 位小数", () => {
    expect(
      computeCost({ promptPricePer1k: 0.5, completionPricePer1k: 1.5 }, usage(1000, 1000)),
    ).toBe(2);
    expect(computeCost({ promptPricePer1k: 0.5 }, usage(333, 0))).toBe(0.1665);
  });

  it("负单价与非法单价被忽略", () => {
    expect(computeCost({ promptPricePer1k: -1, completionPricePer1k: Number.NaN }, usage(10, 10))).toBeNull();
  });
});

describe("recordAiCallLog", () => {
  const base = {
    traceId: "trace-1",
    userId: "user-1",
    provider: "OpenAI",
    modelRowId: "model-1",
    modelId: "gpt-test",
    status: "ok" as const,
    usage: usage(1000, 500),
    latencyMs: 1234.7,
  };

  it("写入台账时计算成本并四舍五入耗时", async () => {
    prismaMock.lLMModel.findUnique.mockResolvedValue({
      promptPricePer1k: 1,
      completionPricePer1k: 2,
    });
    await recordAiCallLog(base);
    expect(prismaMock.aiCallLog.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.aiCallLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      traceId: "trace-1",
      provider: "OpenAI",
      status: "ok",
      promptTokens: 1000,
      completionTokens: 500,
      costUsd: 2,
      latencyMs: 1235,
    });
    expect(metrics.snapshot().counters["ai.call_logs"]).toBe(1);
  });

  it("模型未配置价格时成本为 null", async () => {
    await recordAiCallLog(base);
    expect(prismaMock.aiCallLog.create.mock.calls[0][0].data.costUsd).toBeNull();
  });

  it("数据库写入失败只告警，不向上抛异常", async () => {
    prismaMock.aiCallLog.create.mockRejectedValue(new Error("db down"));
    await expect(recordAiCallLog(base)).resolves.toBeUndefined();
    expect(metrics.snapshot().counters["ai.log_write_failures"]).toBe(1);
  });

  it("失败状态同时计入 ai.failures", async () => {
    await recordAiCallLog({ ...base, status: "cancelled", errorCode: "CLIENT_ABORTED" });
    const counters = metrics.snapshot().counters;
    expect(counters["ai.failures"]).toBe(1);
    expect(prismaMock.aiCallLog.create.mock.calls[0][0].data).toMatchObject({
      status: "cancelled",
      errorCode: "CLIENT_ABORTED",
    });
  });

  it("没有 modelRowId 时不查询模型价格", async () => {
    await recordAiCallLog({ ...base, modelRowId: null });
    expect(prismaMock.lLMModel.findUnique).not.toHaveBeenCalled();
  });
});

describe("summarizeUsage", () => {
  it("聚合调用数、失败率、token、成本与按 provider 分布", async () => {
    prismaMock.aiCallLog.findMany.mockResolvedValue([
      { status: "ok", provider: "OpenAI", modelId: "a", promptTokens: 100, completionTokens: 50, costUsd: 0.5, latencyMs: 1000 },
      { status: "error", provider: "OpenAI", modelId: "a", promptTokens: 10, completionTokens: 0, costUsd: null, latencyMs: 3000 },
      { status: "ok", provider: "Google", modelId: "b", promptTokens: 200, completionTokens: 100, costUsd: 0.25, latencyMs: 2000 },
    ]);
    const summary = await summarizeUsage("user-1", 30);
    expect(summary).toMatchObject({
      days: 30,
      calls: 3,
      failures: 1,
      failureRate: 0.333,
      promptTokens: 310,
      completionTokens: 150,
      costUsd: 0.75,
      avgLatencyMs: 2000,
    });
    expect(summary.byProvider).toEqual([
      { provider: "OpenAI", calls: 2, failures: 1 },
      { provider: "Google", calls: 1, failures: 0 },
    ]);
  });

  it("零调用时比率与均值都为 0，不产生除零", async () => {
    prismaMock.aiCallLog.findMany.mockResolvedValue([]);
    expect(await summarizeUsage("user-1")).toMatchObject({
      calls: 0,
      failures: 0,
      failureRate: 0,
      avgLatencyMs: 0,
      costUsd: 0,
    });
  });
});
