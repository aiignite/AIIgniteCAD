/**
 * usageAccounting.ts — token 用量估算、成本计算与调用台账
 *
 * 进程内指标只能看趋势，无法回答"这个月花了多少"。这里把每次模型调用写入
 * ai_call_logs，并在 provider 未返回 usage 时用字符数估算 token（约 4 字符/1 token）。
 * 台账是旁路观测：写失败只告警，绝不影响已经流式返回给用户的响应。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { metrics } from "../../lib/metrics";

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface CostModel {
  promptPricePer1k?: number | null;
  completionPricePer1k?: number | null;
}

/** 没有字符数或 provider 未上报 usage 时使用的估算比例 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

export interface ResolvedUsage {
  promptTokens: number;
  completionTokens: number;
  /** provider 是否真实上报，false 表示估算 */
  reported: boolean;
}

export function resolveUsage(
  usage: TokenUsage,
  fallback: { promptChars: number; completionChars: number },
): ResolvedUsage {
  const promptTokens =
    typeof usage.promptTokens === "number" && Number.isFinite(usage.promptTokens)
      ? Math.max(0, Math.round(usage.promptTokens))
      : estimateTokens(fallback.promptChars);
  const completionTokens =
    typeof usage.completionTokens === "number" && Number.isFinite(usage.completionTokens)
      ? Math.max(0, Math.round(usage.completionTokens))
      : estimateTokens(fallback.completionChars);
  const reported =
    typeof usage.promptTokens === "number" || typeof usage.completionTokens === "number";
  return { promptTokens, completionTokens, reported };
}

const price = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** 按每千 token 单价计算成本；模型未配置价格时返回 null（而不是伪造 0） */
export function computeCost(model: CostModel, usage: ResolvedUsage): number | null {
  const promptPrice = price(model.promptPricePer1k);
  const completionPrice = price(model.completionPricePer1k);
  if (promptPrice === 0 && completionPrice === 0) return null;
  const cost =
    (usage.promptTokens / 1000) * promptPrice + (usage.completionTokens / 1000) * completionPrice;
  return Math.round(cost * 1e6) / 1e6;
}

export interface AiCallLogInput {
  traceId: string;
  userId: string;
  projectId?: string | null;
  sessionId?: string | null;
  assistantId?: string | null;
  provider: string;
  modelRowId?: string | null;
  modelId: string;
  status: "ok" | "error" | "cancelled" | "rejected";
  errorCode?: string | null;
  round?: number;
  usage: ResolvedUsage;
  latencyMs: number;
  toolCallCount?: number;
  skillCodes?: string[];
}

const observeCall = (input: AiCallLogInput): void => {
  metrics.observe("ai.tokens.prompt", input.usage.promptTokens);
  metrics.observe("ai.tokens.completion", input.usage.completionTokens);
  metrics.observe("ai.duration_ms", Math.max(0, input.latencyMs));
  if (input.status !== "ok") metrics.increment("ai.failures");
};

/** 写入台账；指标先于数据库，台账异常只记日志，不拖慢也不中断 SSE */
export async function recordAiCallLog(input: AiCallLogInput): Promise<void> {
  observeCall(input);
  try {
    const model = input.modelRowId
      ? await prisma.lLMModel.findUnique({
          where: { id: input.modelRowId },
          select: { promptPricePer1k: true, completionPricePer1k: true },
        })
      : null;
    await prisma.aiCallLog.create({
      data: {
        traceId: input.traceId,
        userId: input.userId,
        projectId: input.projectId ?? null,
        sessionId: input.sessionId ?? null,
        assistantId: input.assistantId ?? null,
        provider: input.provider,
        modelRowId: input.modelRowId ?? null,
        modelId: input.modelId,
        status: input.status,
        errorCode: input.errorCode ?? null,
        round: input.round ?? 0,
        promptTokens: input.usage.promptTokens,
        completionTokens: input.usage.completionTokens,
        costUsd: costFrom(model, input.usage),
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        toolCallCount: input.toolCallCount ?? 0,
        skillCodes: (input.skillCodes ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    metrics.increment("ai.call_logs");
  } catch (error) {
    logger.warn("Failed to record AI call log", {
      traceId: input.traceId,
      provider: input.provider,
      error,
    });
    metrics.increment("ai.log_write_failures");
  }
}

const costFrom = (
  model: { promptPricePer1k: number | null; completionPricePer1k: number | null } | null,
  usage: ResolvedUsage,
): number | null => (model ? computeCost(model, usage) : null);

/** 用量摘要：供模型面板显示近 N 天调用数、失败率、token 与成本 */
export async function summarizeUsage(userId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.aiCallLog.findMany({
    where: { userId, createdAt: { gte: since } },
    select: {
      status: true,
      provider: true,
      modelId: true,
      promptTokens: true,
      completionTokens: true,
      costUsd: true,
      latencyMs: true,
    },
  });

  const byProvider = new Map<string, { calls: number; failures: number }>();
  let promptTokens = 0;
  let completionTokens = 0;
  let cost = 0;
  let failures = 0;
  let latencySum = 0;

  for (const row of rows) {
    promptTokens += row.promptTokens;
    completionTokens += row.completionTokens;
    cost += row.costUsd ?? 0;
    latencySum += row.latencyMs;
    if (row.status !== "ok") failures += 1;
    const entry = byProvider.get(row.provider) ?? { calls: 0, failures: 0 };
    entry.calls += 1;
    if (row.status !== "ok") entry.failures += 1;
    byProvider.set(row.provider, entry);
  }

  return {
    days,
    calls: rows.length,
    failures,
    failureRate: rows.length > 0 ? Math.round((failures / rows.length) * 1000) / 1000 : 0,
    promptTokens,
    completionTokens,
    costUsd: Math.round(cost * 1e4) / 1e4,
    avgLatencyMs: rows.length > 0 ? Math.round(latencySum / rows.length) : 0,
    byProvider: [...byProvider.entries()].map(([provider, value]) => ({
      provider,
      ...value,
    })),
  };
}
