/**
 * openaiCompatible.ts — OpenAI 及兼容网关的流式适配
 *
 * 覆盖 /chat/completions + SSE(`data: …` + `[DONE]`) 这一事实标准。
 * 分片的 tool_calls 用 tools.ts 的累加器拼装，正文增量立即下发，
 * usage 通过 stream_options.include_usage 索取，provider 不回传时由上层估算。
 */

import { LLMModel } from "@prisma/client";
import { CadToolDefinition, finalizeToolCalls, applyToolCallDelta, toOpenAITools } from "../tools";
import { openStreamedRequest, readLines, guardedEndpoint } from "./http";
import {
  ProviderMessage,
  ProviderResult,
  ProviderStreamHandlers,
  ProviderTurn,
  emptyResult,
} from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

interface OpenAIAdapterInput {
  model: LLMModel;
  apiKey: string;
  turn: ProviderTurn;
  tools: CadToolDefinition[];
  signal?: AbortSignal;
}

/** OpenAI 的对话形状，Ollama 复用同一结构 */
export function toOpenAIMessages(turn: ProviderTurn): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  if (turn.systemPrompt) {
    messages.push({ role: "system", content: turn.systemPrompt });
  }
  for (const message of turn.messages) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }
    if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
      continue;
    }
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

export function buildOpenAIRequest(input: OpenAIAdapterInput): {
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
    messages: toOpenAIMessages(turn),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (typeof turn.temperature === "number") body.temperature = turn.temperature;
  if (typeof turn.topP === "number") body.top_p = turn.topP;
  if (typeof turn.maxOutputTokens === "number") body.max_tokens = turn.maxOutputTokens;
  if (useTools) {
    body.tools = toOpenAITools(tools);
    body.tool_choice = "auto";
  }

  return {
    url: `${endpoint}/chat/completions`,
    body,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  };
}

export async function streamOpenAICompatible(
  input: OpenAIAdapterInput,
  handlers: ProviderStreamHandlers,
): Promise<ProviderResult> {
  const result = emptyResult();
  const { body, ...request } = buildOpenAIRequest(input);
  const bodyWithoutTools = body.tools
    ? JSON.stringify({ ...body, tools: undefined, tool_choice: undefined })
    : undefined;

  const response = await openStreamedRequest({
    ...request,
    provider: input.model.provider,
    timeoutMs: (input.model.timeoutSeconds ?? 120) * 1000,
    signal: input.signal,
    init: { method: "POST", headers: request.headers, body: JSON.stringify(body) },
    bodyWithoutTools,
  });

  const drafts = new Map<number, { id?: string; name?: string; argumentsJson: string }>();

  for await (const line of readLines(response, input.signal)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(line.indexOf(":") + 1).trim();
    if (payload === "[DONE]") break;

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    if (typeof parsed.model === "string") result.responseModel = parsed.model;
    if (parsed.usage) {
      if (typeof parsed.usage.prompt_tokens === "number") {
        result.usage.promptTokens = parsed.usage.prompt_tokens;
      }
      if (typeof parsed.usage.completion_tokens === "number") {
        result.usage.completionTokens = parsed.usage.completion_tokens;
      }
      handlers.onUsage?.(result.usage);
    }

    const choice = parsed.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) {
      result.emittedContent = true;
      result.content += delta.content;
      handlers.onContent(delta.content);
    }
    if (Array.isArray(delta?.tool_calls)) {
      for (const toolDelta of delta.tool_calls) {
        applyToolCallDelta(drafts, {
          index: toolDelta.index,
          id: toolDelta.id,
          name: toolDelta.function?.name,
          arguments: toolDelta.function?.arguments,
        });
      }
    }
    if (typeof choice?.finish_reason === "string") result.finishReason = choice.finish_reason;
  }

  result.toolCalls = finalizeToolCalls(drafts);
  result.ok = true;
  return result;
}

/** 非流式最小探测：模型面板的"测试连接"用它验证 Key 与端点 */
export async function probeOpenAICompatible(input: OpenAIAdapterInput): Promise<void> {
  const { body, ...request } = buildOpenAIRequest(input);
  await openStreamedRequest({
    ...request,
    provider: input.model.provider,
    timeoutMs: Math.min((input.model.timeoutSeconds ?? 30) * 1000, 30_000),
    signal: input.signal,
    init: {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        ...body,
        stream: false,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    },
  });
}

export type { ProviderMessage };
