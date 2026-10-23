/**
 * types.ts — Provider 适配层的共享契约
 *
 * 编排器只依赖这套中性结构（消息、工具、流事件），各 provider 的差异
 * （消息形状、流格式、usage 字段名）收敛在适配器内部，避免路由里再出现
 * 按 provider 分支的大段代码。
 */

import type { ToolCallPayload } from "../tools";
import type { TokenUsage } from "../usageAccounting";

export type ProviderRole = "system" | "user" | "assistant" | "tool";

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
  /** assistant 消息携带的调用请求，用于回传给 provider 继续对话 */
  toolCalls?: ToolCallPayload[];
  /** tool 消息对应的调用 id 与工具名 */
  toolCallId?: string;
  toolName?: string;
}

export interface ProviderTurn {
  systemPrompt: string | null;
  messages: ProviderMessage[];
  /** 允许的工具名；为空数组或 null 表示本轮不下发工具 */
  allowedTools: string[] | null;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
}

export interface ProviderStreamHandlers {
  /** 正文增量，编排器转发为 SSE content 事件 */
  onContent(text: string): void;
  /** usage 到达（provider 支持时） */
  onUsage?(usage: TokenUsage): void;
}

export type ProviderErrorCode =
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_BAD_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_UNSUPPORTED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ABORTED"
  | "PROVIDER_NO_BODY"
  | "NETWORK";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    /** 是否可以安全地换模型重试（首 token 之前为 true） */
    readonly retryable: boolean,
    readonly failoverEligible: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderResult {
  ok: boolean;
  /** 模型输出的完整正文（已流式下发，用于落库） */
  content: string;
  toolCalls: ToolCallPayload[];
  usage: TokenUsage;
  finishReason?: string;
  /** provider 侧的响应模型名，便于核对是否被网关改写 */
  responseModel?: string;
  /** 是否已经产出过内容；决定还能不能安全 failover */
  emittedContent: boolean;
  error?: ProviderError;
}

export const emptyResult = (): ProviderResult => ({
  ok: false,
  content: "",
  toolCalls: [],
  usage: {},
  emittedContent: false,
});
