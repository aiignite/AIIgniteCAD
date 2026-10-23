/**
 * aiSseEvents.ts — Agent SSE 事件解析与回合状态折叠
 *
 * 纯函数模块：把服务端 `data:` 行解析成判别联合，再把事件折叠进一个回合状态。
 * 网络读取留在 services/，这样事件契约可以在 Node 测试里直接断言。
 */

import type { AIToolCall, AgentToolResultPayload } from "../types";

export interface SkillActivationEvent {
    code: string;
    name: string;
    score: number;
    reasons: string[];
    category: string;
    tools: string[];
}

export interface ToolRejectionEvent {
    toolCallId: string;
    name: string;
    reason: string;
    error: string;
}

export interface ContextEvent {
    chars: number;
    historyMessages: number;
    dropped: number;
    hasSummary: boolean;
    toolsEnabled: boolean;
    allowedTools: string[];
    skillCodes: string[];
    /** 服务端允许的工具循环轮次上限；旧服务端不下发时为 undefined */
    maxRounds?: number;
}

export interface UsageEvent {
    promptTokens: number;
    completionTokens: number;
    reported: boolean;
    costUsd: number | null;
    provider: string;
    modelId: string;
}

export interface FallbackEvent {
    from: string;
    to: string;
    provider: string;
    modelId: string;
    reason: string;
    message: string;
}

export interface DoneEvent {
    traceId: string;
    sessionId: string | null;
    messageId: string | null;
    turnId: string;
    round: number;
    finishReason: string;
    nextPhase: string | null;
}

export interface AgentErrorEvent {
    error: string;
    code: string;
    retryable: boolean;
    requestId: string;
}

export type AgentEvent =
    | { kind: "trace_start"; traceId: string; sessionId: string | null; turnId: string; round: number; provider: string; modelRowId: string; modelId: string }
    | { kind: "context"; context: ContextEvent }
    | { kind: "skill_activated"; skill: SkillActivationEvent }
    | { kind: "content"; content: string }
    | { kind: "tool_call"; call: AIToolCall }
    | { kind: "tool_rejected"; rejection: ToolRejectionEvent }
    | { kind: "model_fallback"; fallback: FallbackEvent }
    | { kind: "usage"; usage: UsageEvent }
    | { kind: "done"; done: DoneEvent }
    | { kind: "error"; error: AgentErrorEvent };

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asNumber = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

const asOptionalNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const asNullableId = (value: unknown): string | null =>
    typeof value === "string" && value ? value : null;

const asArguments = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

const KNOWN_EVENTS = new Set([
    "trace_start",
    "context",
    "skill_activated",
    "content",
    "tool_call",
    "tool_rejected",
    "model_fallback",
    "usage",
    "done",
    "error",
]);

/** 老服务端没有 `event` 字段，按字段特征回落，保证前端可以先行部署 */
function inferLegacyEvent(parsed: Record<string, unknown>): string | null {
    if (typeof parsed.error === "string") return "error";
    if (parsed.done === true) return "done";
    if (parsed.toolCall) return "tool_call";
    if (typeof parsed.content === "string") return "content";
    if (parsed.usage || parsed.promptTokens !== undefined) return "usage";
    return null;
}

const readToolCall = (raw: unknown, index: number): AIToolCall | null => {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const name = asString(record.name);
    if (!name) return null;
    const id = asString(record.id);
    return {
        id: id || `tool-${index}`,
        name,
        arguments: asArguments(record.arguments),
    };
};

const buildEvent = (
    kind: string,
    parsed: Record<string, unknown>,
): AgentEvent | null => {
    switch (kind) {
        case "trace_start":
            return {
                kind: "trace_start",
                traceId: asString(parsed.traceId),
                sessionId: asNullableId(parsed.sessionId),
                turnId: asString(parsed.turnId),
                round: asNumber(parsed.round),
                provider: asString(parsed.provider),
                modelRowId: asString(parsed.modelRowId),
                modelId: asString(parsed.modelId),
            };
        case "context": {
            const serverMaxRounds = asOptionalNumber(parsed.maxRounds);
            return {
                kind: "context",
                context: {
                    chars: asNumber(parsed.chars),
                    historyMessages: asNumber(parsed.historyMessages),
                    dropped: asNumber(parsed.dropped),
                    hasSummary: parsed.hasSummary === true,
                    toolsEnabled: parsed.toolsEnabled === true,
                    allowedTools: asStringArray(parsed.allowedTools),
                    skillCodes: asStringArray(parsed.skillCodes),
                    ...(serverMaxRounds !== null ? { maxRounds: serverMaxRounds } : {}),
                },
            };
        }
        case "skill_activated": {
            const code = asString(parsed.code);
            if (!code) return null;
            return {
                kind: "skill_activated",
                skill: {
                    code,
                    name: asString(parsed.name) || code,
                    score: asNumber(parsed.score),
                    reasons: asStringArray(parsed.reasons),
                    category: asString(parsed.category),
                    tools: asStringArray(parsed.tools),
                },
            };
        }
        case "content": {
            const content = asString(parsed.content);
            return content ? { kind: "content", content } : null;
        }
        case "tool_call": {
            const call = readToolCall(parsed.toolCall, 0);
            return call ? { kind: "tool_call", call } : null;
        }
        case "tool_rejected": {
            const name = asString(parsed.name);
            if (!name) return null;
            return {
                kind: "tool_rejected",
                rejection: {
                    toolCallId: asString(parsed.toolCallId) || `rejected-${name}`,
                    name,
                    reason: asString(parsed.reason) || "MALFORMED",
                    error: asString(parsed.error),
                },
            };
        }
        case "model_fallback":
            return {
                kind: "model_fallback",
                fallback: {
                    from: asString(parsed.from),
                    to: asString(parsed.to),
                    provider: asString(parsed.provider),
                    modelId: asString(parsed.modelId),
                    reason: asString(parsed.reason),
                    message: asString(parsed.message),
                },
            };
        case "usage":
            return {
                kind: "usage",
                usage: {
                    promptTokens: asNumber(parsed.promptTokens),
                    completionTokens: asNumber(parsed.completionTokens),
                    reported: parsed.reported === true,
                    costUsd: asOptionalNumber(parsed.costUsd),
                    provider: asString(parsed.provider),
                    modelId: asString(parsed.modelId),
                },
            };
        case "done":
            return {
                kind: "done",
                done: {
                    traceId: asString(parsed.traceId),
                    sessionId: asNullableId(parsed.sessionId),
                    messageId: asNullableId(parsed.messageId),
                    turnId: asString(parsed.turnId),
                    round: asNumber(parsed.round),
                    finishReason: asString(parsed.finishReason),
                    nextPhase: asNullableId(parsed.nextPhase),
                },
            };
        case "error":
            return {
                kind: "error",
                error: {
                    error: asString(parsed.error) || asString(parsed.message),
                    code: asString(parsed.code) || "UNKNOWN",
                    retryable: parsed.retryable === true,
                    requestId: asString(parsed.requestId),
                },
            };
        default:
            return null;
    }
};

/** 解析单行 SSE 数据；心跳、注释与不完整分包返回 null */
export function parseSseLine(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return null;
    const raw = trimmed.slice(5).trim();
    if (!raw) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const declared = asString(record.event);
    const kind = KNOWN_EVENTS.has(declared) ? declared : inferLegacyEvent(record);
    if (!kind) return null;
    return buildEvent(kind, record);
}

export interface SseLines {
    completed: string[];
    rest: string;
}

/** SSE 事件可能跨网络分包，按行切分并把半行留到下一次 */
export function splitSseLines(buffer: string): SseLines {
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";
    return { completed: lines, rest };
}

/** 一次 HTTP 回合的累积状态（多轮循环由调用方按轮次分别持有） */
export interface AgentTurnState {
    traceId: string;
    sessionId: string | null;
    messageId: string | null;
    turnId: string;
    round: number;
    provider: string;
    modelRowId: string;
    modelId: string;
    content: string;
    context: ContextEvent | null;
    skills: SkillActivationEvent[];
    toolCalls: AIToolCall[];
    rejections: ToolRejectionEvent[];
    fallbacks: FallbackEvent[];
    usage: UsageEvent | null;
    finishReason: string;
    nextPhase: string | null;
    error: AgentErrorEvent | null;
}

export function initialAgentTurn(): AgentTurnState {
    return {
        traceId: "",
        sessionId: null,
        messageId: null,
        turnId: "",
        round: 0,
        provider: "",
        modelRowId: "",
        modelId: "",
        content: "",
        context: null,
        skills: [],
        toolCalls: [],
        rejections: [],
        fallbacks: [],
        usage: null,
        finishReason: "",
        nextPhase: null,
        error: null,
    };
}

/** 折叠事件到回合状态；content 累加，其余按类型追加，未知事件原样忽略 */
export function reduceAgentTurn(state: AgentTurnState, event: AgentEvent): AgentTurnState {
    switch (event.kind) {
        case "trace_start":
            return {
                ...state,
                traceId: event.traceId,
                sessionId: event.sessionId ?? state.sessionId,
                turnId: event.turnId || state.turnId,
                round: event.round,
                provider: event.provider,
                modelRowId: event.modelRowId,
                modelId: event.modelId,
            };
        case "context":
            return { ...state, context: event.context };
        case "skill_activated":
            return state.skills.some((s) => s.code === event.skill.code)
                ? state
                : { ...state, skills: [...state.skills, event.skill] };
        case "content":
            return { ...state, content: state.content + event.content };
        case "tool_call":
            return state.toolCalls.some((call) => call.id === event.call.id)
                ? state
                : { ...state, toolCalls: [...state.toolCalls, event.call] };
        case "tool_rejected":
            return { ...state, rejections: [...state.rejections, event.rejection] };
        case "model_fallback":
            return {
                ...state,
                fallbacks: [...state.fallbacks, event.fallback],
                modelRowId: event.fallback.to || state.modelRowId,
                modelId: event.fallback.modelId || state.modelId,
                provider: event.fallback.provider || state.provider,
            };
        case "usage":
            return { ...state, usage: event.usage };
        case "done":
            return {
                ...state,
                traceId: event.done.traceId || state.traceId,
                sessionId: event.done.sessionId ?? state.sessionId,
                messageId: event.done.messageId ?? state.messageId,
                turnId: event.done.turnId || state.turnId,
                round: event.done.round,
                finishReason: event.done.finishReason,
                nextPhase: event.done.nextPhase,
            };
        case "error":
            return { ...state, error: event.error };
        default:
            return state;
    }
}

/** 只读工具由前端本地求值，不进入画布动作 */
export function needsToolResults(state: AgentTurnState): boolean {
    return state.toolCalls.length > 0 || state.rejections.length > 0;
}

/**
 * 被拒调用同样是模型的一次错误输入，必须以 tool 结果的形式回传，
 * 否则模型看不到失败原因，只能重复提交同样的非法参数。
 */
export function rejectionResults(state: AgentTurnState): AgentToolResultPayload[] {
    return state.rejections.map((rejection) => ({
        toolCallId: rejection.toolCallId,
        name: rejection.name,
        ok: false,
        error: rejection.error || rejection.reason,
    }));
}

const MIN_ROUNDS = 1;
/** 本地硬上限：服务端配置异常时也不允许无限循环 */
const LOCAL_MAX_ROUNDS = 8;
/** 服务端未下发上限时的回落值，与后端 DEFAULT_MAX_TOOL_ROUNDS 保持一致 */
const SERVER_DEFAULT_MAX_ROUNDS = 4;

/**
 * 有效轮次上限以服务端为准：前端写死更大的值会让第 N+1 轮直接 400，
 * 宁可少跑一轮。拿不到 context 事件时回落到后端默认值。
 */
export function effectiveMaxRounds(serverMax: number | null | undefined): number {
    return Math.max(MIN_ROUNDS, Math.min(LOCAL_MAX_ROUNDS, serverMax ?? SERVER_DEFAULT_MAX_ROUNDS));
}
