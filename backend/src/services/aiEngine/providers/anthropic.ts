/**
 * anthropic.ts — Anthropic Messages 流式适配
 *
 * 差异点：system 是顶层参数；工具块是 tool_use / tool_result，且
 * tool_result 必须放在 user 消息里；max_tokens 必填，不能再写死 128000。
 */

import { LLMModel } from "@prisma/client";
import {
  CadToolDefinition,
  applyToolCallDelta,
  finalizeToolCalls,
  toAnthropicTools,
} from "../tools";
import { guardedEndpoint, openStreamedRequest, readLines } from "./http";
import {
  ProviderMessage,
  ProviderResult,
  ProviderStreamHandlers,
  ProviderTurn,
  emptyResult,
} from "./types";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;

interface AnthropicInput {
  model: LLMModel;
  apiKey: string;
  turn: ProviderTurn;
  tools: CadToolDefinition[];
  signal?: AbortSignal;
}

const toContentBlocks = (message: ProviderMessage): unknown[] => {
  if (message.role === "tool") {
    return [
      {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      },
    ];
  }
  const blocks: unknown[] = [];
  if (message.content) blocks.push({ type: "text", text: message.content });
  for (const call of message.toolCalls ?? []) {
    blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });
  return blocks;
};

export function toAnthropicMessages(turn: ProviderTurn): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  for (const message of turn.messages) {
    if (message.role === "system") continue;
    const hasPayload = Boolean(message.content) || (message.toolCalls ?? []).length > 0;
    if (message.role === "user" && !hasPayload) continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const blocks = toContentBlocks(message);
    const previous = merged[merged.length - 1];
    // Anthropic 要求 user/assistant 交替；连续的 tool_result 合并进同一条 user 消息
    if (previous && previous.role === role && Array.isArray(previous.content)) {
      previous.content = [...(previous.content as unknown[]), ...blocks];
      continue;
    }
    merged.push({ role, content: blocks });
  }
  return merged;
}

export function buildAnthropicRequest(input: AnthropicInput): {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const { model, apiKey, turn, tools } = input;
  const endpoint = guardedEndpoint(
    (model.configuration as { apiUrl?: string } | null)?.apiUrl || DEFAULT_BASE_URL,
    model.provider,
  );
  const useTools = tools.length > 0 && model.supportsTools;

  const body: Record<string, unknown> = {
    model: model.modelId || DEFAULT_MODEL,
    max_tokens:
      turn.maxOutputTokens ?? model.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages: toAnthropicMessages(turn),
    stream: true,
  };
  if (turn.systemPrompt) body.system = turn.systemPrompt;
  if (typeof turn.temperature === "number") body.temperature = turn.temperature;
  if (typeof turn.topP === "number") body.top_p = turn.topP;
  if (useTools) {
    body.tools = toAnthropicTools(tools);
    body.tool_choice = { type: "auto" };
  }

  return {
    url: `${endpoint}/v1/messages`,
    body,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  };
}

export async function streamAnthropic(
  input: AnthropicInput,
  handlers: ProviderStreamHandlers,
): Promise<ProviderResult> {
  const result = emptyResult();
  const { body, ...request } = buildAnthropicRequest(input);
  const bodyWithoutTools = body.tools
    ? JSON.stringify({ ...body, tools: undefined, tool_choice: undefined })
    : undefined;

  const response = await openStreamedRequest({
    ...request,
    provider: "Anthropic",
    timeoutMs: (input.model.timeoutSeconds ?? 120) * 1000,
    signal: input.signal,
    init: { method: "POST", headers: request.headers, body: JSON.stringify(body) },
    bodyWithoutTools,
  });

  const drafts = new Map<number, { id?: string; name?: string; argumentsJson: string }>();

  for await (const line of readLines(response, input.signal)) {
    if (!line.startsWith("data:")) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(line.slice(line.indexOf(":") + 1).trim());
    } catch {
      continue;
    }

    if (parsed.type === "message_start" && parsed.message?.usage) {
      if (typeof parsed.message.usage.input_tokens === "number") {
        result.usage.promptTokens = parsed.message.usage.input_tokens;
      }
      if (typeof parsed.message.usage.output_tokens === "number") {
        result.usage.completionTokens = parsed.message.usage.output_tokens;
      }
      if (typeof parsed.message.model === "string") result.responseModel = parsed.message.model;
      handlers.onUsage?.(result.usage);
    } else if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") {
      applyToolCallDelta(drafts, {
        index: parsed.index,
        id: parsed.content_block.id,
        name: parsed.content_block.name,
      });
    } else if (parsed.type === "content_block_delta") {
      if (parsed.delta?.type === "input_json_delta") {
        applyToolCallDelta(drafts, { index: parsed.index, arguments: parsed.delta.partial_json });
      } else if (typeof parsed.delta?.text === "string" && parsed.delta.text) {
        result.emittedContent = true;
        result.content += parsed.delta.text;
        handlers.onContent(parsed.delta.text);
      }
    } else if (parsed.type === "message_delta") {
      if (typeof parsed.usage?.output_tokens === "number") {
        result.usage.completionTokens = parsed.usage.output_tokens;
        handlers.onUsage?.(result.usage);
      }
      if (typeof parsed.delta?.stop_reason === "string") {
        result.finishReason = parsed.delta.stop_reason;
      }
    }
  }

  result.toolCalls = finalizeToolCalls(drafts);
  result.ok = true;
  return result;
}

export async function probeAnthropic(input: AnthropicInput): Promise<void> {
  const { body, ...request } = buildAnthropicRequest(input);
  await openStreamedRequest({
    ...request,
    provider: "Anthropic",
    timeoutMs: Math.min((input.model.timeoutSeconds ?? 30) * 1000, 30_000),
    signal: input.signal,
    init: {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        ...body,
        stream: false,
        max_tokens: 1,
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      }),
    },
  });
}
