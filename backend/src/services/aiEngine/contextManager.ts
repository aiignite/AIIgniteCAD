/**
 * contextManager.ts — 会话上下文窗口与确定性摘要
 *
 * 长对话会撑爆 prompt 并抬高成本，但为了可控与可测试，这里不额外调用模型做
 * 摘要，而是生成确定性 digest（早期用户请求 + 助手结论 + 工具动作计数），
 * 写入 ChatSession.contextSummary 并记录水位线，早于水位线的消息不再逐条注入。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { metrics } from "../../lib/metrics";

export const DEFAULT_CONTEXT_BUDGET_CHARS = 24_000;
/** 留给逐条历史的预算比例，其余给系统提示词与画布快照 */
export const RECENT_RATIO = 0.6;
/** 单条消息注入上限，防止一条超长粘贴内容吃掉整个窗口 */
export const MAX_MESSAGE_CHARS = 4_000;
/** 少于该条溢出消息不触发写库，避免频繁小更新 */
export const COMPACT_MIN_DROPPED = 4;
export const MAX_DIGEST_MESSAGES = 2_000;

export const contextBudgetChars = (): number => {
  const parsed = Number.parseInt(process.env.AI_CONTEXT_CHAR_BUDGET ?? "", 10);
  return Number.isFinite(parsed) && parsed > 2_000 ? parsed : DEFAULT_CONTEXT_BUDGET_CHARS;
};

export interface HistoryMessage {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  toolCallId?: string | null;
  toolCalls: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface ConversationWindow {
  /** 需要注入 prompt 的近期消息（时间升序） */
  messages: HistoryMessage[];
  /** 已折叠进摘要的说明文本 */
  summary: string | null;
  /** 被折叠的消息条数 */
  droppedCount: number;
  /** 注入历史的字符数 */
  usedChars: number;
}

/** 去掉工具调用的 JSON 噪声，只保留可读文本 */
const contentForPrompt = (message: HistoryMessage): string => {
  const text = (message.content ?? "").trim();
  if (message.role === "tool") return text.slice(0, 400);
  return text.slice(0, MAX_MESSAGE_CHARS);
};

export function digestHistory(messages: readonly HistoryMessage[]): string {
  if (messages.length === 0) return "";

  const requests: string[] = [];
  const conclusions: string[] = [];
  const toolCounts = new Map<string, number>();

  for (const message of messages) {
    const toolCallCount = Array.isArray(message.toolCalls) ? message.toolCalls.length : 0;
    if (toolCallCount > 0) {
      for (const raw of message.toolCalls as unknown[]) {
        const name =
          raw && typeof raw === "object" && typeof (raw as { name?: unknown }).name === "string"
            ? (raw as { name: string }).name
            : (message.toolName ?? "unknown");
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      }
    }
    if (message.role === "user") {
      const text = (message.content ?? "").replace(/\s+/g, " ").trim();
      if (text) requests.push(text.slice(0, 160));
    } else if (message.role === "assistant") {
      const text = (message.content ?? "").replace(/\s+/g, " ").trim();
      if (text) conclusions.push(text.slice(0, 160));
    }
  }

  const lines: string[] = [];
  if (requests.length > 0) {
    lines.push(`早期请求：\n${requests.slice(-12).map((text) => `- ${text}`).join("\n")}`);
  }
  if (conclusions.length > 0) {
    lines.push(`助手结论：\n${conclusions.slice(-8).map((text) => `- ${text}`).join("\n")}`);
  }
  if (toolCounts.size > 0) {
    const tools = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => `${name}×${count}`)
      .join("、");
    lines.push(`执行过的工具：${tools}`);
  }

  const digest = lines.join("\n");
  return digest.length > 2_000 ? `${digest.slice(0, 1999)}…` : digest;
}

/** 已有摘要 + 新折叠内容，控制在预算内 */
export function mergeSummary(existing: string | null, fresh: string): string {
  if (!existing) return fresh;
  if (!fresh) return existing;
  const combined = `${existing.trim()}\n\n${fresh.trim()}`;
  return combined.length > 3_000 ? `…${combined.slice(-2999)}` : combined;
}

export interface BuildWindowOptions {
  sessionId: string;
  budgetChars?: number;
  /** 最多取回的历史消息条数 */
  take?: number;
}

export async function buildConversationWindow(
  options: BuildWindowOptions,
): Promise<ConversationWindow> {
  const budget = options.budgetChars ?? contextBudgetChars();
  const recentBudget = Math.floor(budget * RECENT_RATIO);

  const session = await prisma.chatSession.findUnique({
    where: { id: options.sessionId },
    select: { contextSummary: true, contextSummaryUpToId: true },
  });

  const rows = await prisma.chatMessage.findMany({
    where: { sessionId: options.sessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: options.take ?? 400,
    select: {
      id: true,
      role: true,
      content: true,
      toolName: true,
      toolCallId: true,
      toolCalls: true,
      createdAt: true,
    },
  });

  const watermark = session?.contextSummaryUpToId ?? null;
  const afterWatermark = watermark
    ? rows.filter((row) => !beforeWatermark(row.createdAt, watermark, rows))
    : rows;

  const kept: HistoryMessage[] = [];
  let used = 0;
  for (const message of [...afterWatermark].reverse()) {
    const length = contentForPrompt(message).length;
    if (kept.length > 0 && used + length > recentBudget) break;
    kept.unshift(message);
    used += length;
  }

  const dropped = afterWatermark.slice(0, Math.max(0, afterWatermark.length - kept.length));
  let summary = session?.contextSummary ?? null;

  if (dropped.length >= COMPACT_MIN_DROPPED) {
    const fresh = digestHistory(dropped);
    summary = mergeSummary(summary, fresh);
    const upToId = dropped[dropped.length - 1]?.id ?? watermark;
    if (upToId) {
      await prisma.chatSession
        .update({
          data: {
            contextSummary: summary,
            contextSummaryUpToId: upToId,
            contextUpdatedAt: new Date(),
          },
          where: { id: options.sessionId },
        })
        .catch((error) => {
          logger.warn("Failed to persist context summary", { sessionId: options.sessionId, error });
        });
      metrics.increment("ai.context_compacted");
    }
  }

  return { messages: kept, summary, droppedCount: dropped.length, usedChars: used };
}

/**
 * 水位线按 id 记录但读取按时间排序，因此用该消息的 createdAt 做时间截断，
 * 保证同一时刻的消息不会被反复折叠。
 */
function beforeWatermark(
  createdAt: Date,
  watermarkId: string,
  rows: readonly HistoryMessage[],
): boolean {
  const anchor = rows.find((row) => row.id === watermarkId);
  if (!anchor) return false;
  return createdAt.getTime() <= anchor.createdAt.getTime();
}

/** 手动 compact：把全部历史折叠成摘要，清空逐条注入 */
export async function compactSession(sessionId: string): Promise<{ summary: string; droppedCount: number }> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_DIGEST_MESSAGES,
    select: {
      id: true,
      role: true,
      content: true,
      toolName: true,
      toolCallId: true,
      toolCalls: true,
      createdAt: true,
    },
  });

  const summary = digestHistory(rows);
  const last = rows[rows.length - 1];
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      contextSummary: summary,
      contextSummaryUpToId: last?.id ?? null,
      contextUpdatedAt: new Date(),
    },
  });
  metrics.increment("ai.context_compacted");
  metrics.observe("ai.context_dropped", rows.length);
  return { summary, droppedCount: rows.length };
}
