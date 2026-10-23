/**
 * aiChatHistory.ts — 会话消息与 UI 气泡的映射
 *
 * 纯函数：把服务端落库的 user/assistant/tool 行还原成"一次提问一个助手气泡、
 * 气泡内按轮次展示工具时间线"的结构，供 hooks/useAIChat 与组件复用。
 */

import type { AIToolCall, ChatLogMessage } from "../types";
import type { ContextEvent, FallbackEvent, SkillActivationEvent, UsageEvent } from "./aiSseEvents";
import type { AIErrorInfo } from "./aiErrors";
import type { PlanProposal, PlanStatus } from "./aiPlan";
import type { VariantProposal } from "./aiVariants";

export type ToolEntryStatus = "proposed" | "ok" | "rejected" | "skipped";

export interface ChatToolEntry {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    status: ToolEntryStatus;
    summary?: string;
    error?: string;
}

export interface ChatRound {
    round: number;
    text: string;
    skills: SkillActivationEvent[];
    tools: ChatToolEntry[];
    usage: UsageEvent | null;
    context: ContextEvent | null;
    fallbacks: FallbackEvent[];
    /** 计划模式下模型提出的计划，等待用户确认或取消 */
    plan?: { proposal: PlanProposal; status: PlanStatus };
    /** 多方案模式下模型提出的方案，selectedIndex 为已采用方案 */
    variants?: {
        proposal: VariantProposal;
        status: PlanStatus;
        selectedIndex: number | null;
    };
}

export interface ChatFeedback {
    rating: "up" | "down";
    reason?: string;
}

export interface ChatUiMessage {
    id: string;
    sender: "user" | "ai";
    /** user 输入原文；ai 气泡只渲染 rounds，这里保留最后一轮正文用于复制 */
    text: string;
    timestamp: string;
    rounds: ChatRound[];
    turnId?: string;
    streaming?: boolean;
    error?: AIErrorInfo;
    /** 该批动作是否已被用户放弃，用于时间线显示 discarded 态 */
    discarded?: boolean;
    /** 用户对本条回答的反馈，持久化在服务端消息 metadata */
    feedback?: ChatFeedback;
}

export const emptyRound = (round: number): ChatRound => ({
    round,
    text: "",
    skills: [],
    tools: [],
    usage: null,
    context: null,
    fallbacks: [],
});

/** 工具调用的展示条目，状态先为 proposed，回传结果后落地 */
export const toolEntryFromCall = (call: AIToolCall): ChatToolEntry => ({
    id: call.id,
    name: call.name,
    arguments: call.arguments ?? {},
    status: "proposed",
});

export function createTurnId(): string {
    const cryptoObj = globalThis.crypto;
    const random =
        cryptoObj && typeof cryptoObj.randomUUID === "function"
            ? cryptoObj.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `t-${random}`.slice(0, 128);
}

const timeOf = (iso: string): string => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/** clientMessageId 形如 turnId / turnId:r2:assistant / turnId:r2:tool:call-1 */
const splitClientMessageId = (value: string | null): { turnId: string; round: number } => {
    if (!value) return { turnId: "", round: 0 };
    const [turnId, second] = value.split(":");
    const round = second ? Number(/^r(\d+)$/.exec(second)?.[1] ?? NaN) : 0;
    return { turnId: turnId ?? "", round: Number.isFinite(round) ? round : 0 };
};

const parseToolCalls = (value: unknown): AIToolCall[] => {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is AIToolCall => {
            if (!item || typeof item !== "object") return false;
            const call = item as Record<string, unknown>;
            return typeof call.name === "string";
        })
        .map((call, index) => ({
            id: typeof call.id === "string" && call.id ? call.id : `history-${index}`,
            name: call.name as string,
            arguments:
                call.arguments && typeof call.arguments === "object"
                    ? (call.arguments as Record<string, unknown>)
                    : {},
        }));
};

/** 落库的 tool 正文由后端 describeToolResult 生成，这里只取首句做摘要 */
const toolSummary = (content: string): string => {
    const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "";
    return firstLine.replace(/^[-•]\s*/, "").slice(0, 200);
};

const readFeedback = (metadata: unknown): ChatFeedback | undefined => {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
    const raw = (metadata as Record<string, unknown>).feedback;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    if (record.rating !== "up" && record.rating !== "down") return undefined;
    const reason =
        typeof record.reason === "string" && record.reason.trim()
            ? record.reason.trim().slice(0, 200)
            : undefined;
    return { rating: record.rating, ...(reason ? { reason } : {}) };
};

export function toUiMessages(rows: ChatLogMessage[]): ChatUiMessage[] {
    const out: ChatUiMessage[] = [];
    let open: ChatUiMessage | null = null;

    const ensureRound = (message: ChatUiMessage, round: number): ChatRound => {
        const existing = message.rounds.find((item) => item.round === round);
        if (existing) return existing;
        const created = emptyRound(round);
        message.rounds = [...message.rounds, created].sort((a, b) => a.round - b.round);
        return created;
    };

    for (const row of rows) {
        const { turnId, round } = splitClientMessageId(row.clientMessageId);

        if (row.role === "user" || row.senderType === "user") {
            open = null;
            out.push({
                id: row.id,
                sender: "user",
                text: row.content,
                timestamp: timeOf(row.createdAt),
                rounds: [],
                turnId,
            });
            continue;
        }

        if (row.role === "tool") {
            if (!open || (open.turnId && turnId && open.turnId !== turnId)) {
                open = {
                    id: `${row.sessionId}-ai-${turnId || row.id}`,
                    sender: "ai",
                    text: "",
                    timestamp: timeOf(row.createdAt),
                    rounds: [],
                    turnId,
                };
                out.push(open);
            }
            const target = ensureRound(open, round);
            const name = row.toolName ?? "tool";
            const ok = row.status !== "rejected";
            const toolCallId = row.toolCallId ?? `${row.id}-tool`;
            const index = target.tools.findIndex((tool) => tool.id === toolCallId);
            // 工具结果行不带参数，合并时保留同 id 的 proposed 条目，回放才有参数摘要
            const entry: ChatToolEntry = {
                id: toolCallId,
                name,
                arguments: index >= 0 ? target.tools[index].arguments : {},
                status: ok ? "ok" : "rejected",
                summary: ok ? toolSummary(row.content) : undefined,
                error: ok ? undefined : toolSummary(row.content),
            };
            target.tools =
                index >= 0
                    ? target.tools.map((tool, i) => (i === index ? entry : tool))
                    : [...target.tools, entry];
            continue;
        }

        if (row.role !== "assistant") continue;

        const sameTurn = open && open.turnId === turnId && turnId !== "";
        if (!sameTurn) {
            open = {
                id: row.id,
                sender: "ai",
                text: row.content,
                timestamp: timeOf(row.createdAt),
                rounds: [],
                turnId,
            };
            out.push(open);
        }
        const target = ensureRound(open, round);
        target.text = row.content;
        open.text = row.content;
        const feedback = readFeedback(row.metadata);
        if (feedback) open.feedback = feedback;
        const calls = parseToolCalls(row.toolCalls);
        if (calls.length > 0) {
            const known = new Set(target.tools.map((tool) => tool.id));
            target.tools = [
                ...target.tools,
                ...calls.filter((call) => !known.has(call.id)).map(toolEntryFromCall),
            ];
        }
        if (row.promptTokens !== null || row.completionTokens !== null) {
            target.usage = {
                promptTokens: row.promptTokens ?? 0,
                completionTokens: row.completionTokens ?? 0,
                reported: true,
                costUsd: null,
                provider: "",
                modelId: "",
            };
        }
    }

    return out;
}

/** 把工具执行结果按 toolCallId 落到时间线条目上 */
export function applyToolStatuses(
    message: ChatUiMessage,
    roundIndex: number,
    results: Array<{
        toolCallId: string;
        name: string;
        ok: boolean;
        summary?: string;
        error?: string;
    }>,
): ChatUiMessage {
    const byId = new Map(results.map((result) => [result.toolCallId, result]));
    return {
        ...message,
        rounds: message.rounds.map((round) =>
            round.round !== roundIndex
                ? round
                : {
                      ...round,
                      tools: round.tools.map((tool) => {
                          const result = byId.get(tool.id);
                          if (!result) return tool;
                          return {
                              ...tool,
                              status: result.ok ? "ok" : "rejected",
                              summary: result.summary,
                              error: result.error,
                          } as ChatToolEntry;
                      }),
                  },
        ),
    };
}
