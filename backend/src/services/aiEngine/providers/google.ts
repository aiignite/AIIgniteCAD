/**
 * google.ts — Gemini generateContent 流式适配
 *
 * 差异点：systemInstruction 独立于 contents；functionCall 出现在 model 回合的
 * parts 里，函数结果要作为 user 回合的 functionResponse 回传；流默认是 NDJSON
 * （也兼容 alt=sse 的 data: 前缀），因此两种行格式都要能吃。
 */

import { LLMModel } from "@prisma/client";
import { CadToolDefinition, ToolCallPayload, toGoogleTools } from "../tools";
import { guardedEndpoint, openStreamedRequest, readLines } from "./http";
import {
  ProviderResult,
  ProviderStreamHandlers,
  ProviderTurn,
  emptyResult,
} from "./types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.0-flash";

interface GoogleInput {
  model: LLMModel;
  apiKey: string;
  turn: ProviderTurn;
  tools: CadToolDefinition[];
  signal?: AbortSignal;
}

const GOOGLE_FINISH_REASONS = new Set(["STOP", "MAX_TOKENS", "SAFETY", "TOOL_CALL", "RECITATION"]);

export function toGoogleContents(turn: ProviderTurn): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = [];

  const pushPart = (role: "user" | "model", part: Record<string, unknown>) => {
    const previous = contents[contents.length - 1];
    if (previous && previous.role === role && Array.isArray(previous.parts)) {
      (previous.parts as unknown[]).push(part);
      return;
    }
    contents.push({ role, parts: [part] });
  };

  for (const message of turn.messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      pushPart("user", {
        functionResponse: {
          name: message.toolName ?? "tool",
          response: { result: message.content },
        },
      });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content) pushPart("model", { text: message.content });
      for (const call of message.toolCalls ?? []) {
        pushPart("model", { functionCall: { name: call.name, args: call.arguments } });
      }
      continue;
    }
    if (message.content) pushPart("user", { text: message.content });
  }

  // Gemini 拒绝以 model 回合结束的历史，补一个空 user 回合即可继续
  const last = contents[contents.length - 1];
  if (last && last.role === "model") contents.push({ role: "user", parts: [{ text: "继续" }] });
  return contents;
}

export function buildGoogleRequest(input: GoogleInput): {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const { model, apiKey, turn, tools } = input;
  const configured = (model.configuration as { apiUrl?: string } | null)?.apiUrl;
  // 默认端点已包含 /models 段，直接拼模型名；自定义端点同样按该约定处理
  const endpoint = guardedEndpoint(configured || DEFAULT_BASE_URL, model.provider);
  const modelId = model.modelId || DEFAULT_MODEL;
  const useTools = tools.length > 0 && model.supportsTools;

  const generationConfig: Record<string, unknown> = {};
  if (typeof turn.temperature === "number") generationConfig.temperature = turn.temperature;
  if (typeof turn.topP === "number") generationConfig.topP = turn.topP;
  if (typeof turn.maxOutputTokens === "number") {
    generationConfig.maxOutputTokens = turn.maxOutputTokens;
  } else if (typeof model.maxOutputTokens === "number") {
    generationConfig.maxOutputTokens = model.maxOutputTokens;
  }

  const body: Record<string, unknown> = {
    contents: toGoogleContents(turn),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
  if (turn.systemPrompt) body.systemInstruction = { parts: [{ text: turn.systemPrompt }] };
  if (useTools) body.tools = toGoogleTools(tools);

  const query = new URLSearchParams();
  if (apiKey) query.set("key", apiKey);
  query.set("alt", "sse");

  return {
    url: `${endpoint}/${modelId}:streamGenerateContent?${query.toString()}`,
    body,
    headers: { "Content-Type": "application/json" },
  };
}

/** Gemini 的 parts 数组可能出现在多个 candidates 里，逐个摊平 */
const iterateParts = (payload: any): Array<Record<string, unknown>> => {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts: Array<Record<string, unknown>> = [];
  for (const candidate of candidates) {
    const list = candidate?.content?.parts;
    if (Array.isArray(list)) parts.push(...list.filter((part: unknown) => part && typeof part === "object"));
  }
  return parts;
};

export async function streamGoogle(
  input: GoogleInput,
  handlers: ProviderStreamHandlers,
): Promise<ProviderResult> {
  const result = emptyResult();
  const { body, url, headers } = buildGoogleRequest(input);
  const bodyWithoutTools = body.tools
    ? JSON.stringify({ ...body, tools: undefined })
    : undefined;

  const response = await openStreamedRequest({
    url,
    provider: "Google",
    timeoutMs: (input.model.timeoutSeconds ?? 120) * 1000,
    signal: input.signal,
    init: { method: "POST", headers, body: JSON.stringify(body) },
    bodyWithoutTools,
  });

  const calls: ToolCallPayload[] = [];

  for await (const line of readLines(response, input.signal)) {
    const jsonText = line.startsWith("data:") ? line.slice(line.indexOf(":") + 1).trim() : line;
    if (!jsonText || jsonText === "[DONE]") continue;

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const usage = parsed.usageMetadata;
    if (usage) {
      if (typeof usage.promptTokenCount === "number") {
        result.usage.promptTokens = usage.promptTokenCount;
      }
      if (typeof usage.candidatesTokenCount === "number") {
        result.usage.completionTokens = usage.candidatesTokenCount;
      }
      handlers.onUsage?.(result.usage);
    }

    const candidate = Array.isArray(parsed.candidates) ? parsed.candidates[0] : undefined;
    if (candidate?.finishReason && GOOGLE_FINISH_REASONS.has(candidate.finishReason)) {
      result.finishReason = candidate.finishReason === "TOOL_CALL" ? "tool_use" : "stop";
    }

    for (const part of iterateParts(parsed)) {
      const text = typeof part.text === "string" ? part.text : "";
      if (text && !part.functionCall) {
        result.emittedContent = true;
        result.content += text;
        handlers.onContent(text);
      }
      const functionCall = part.functionCall as { name?: string; args?: unknown } | undefined;
      if (functionCall?.name) {
        calls.push({
          id: typeof part.id === "string" ? part.id : `call_google_${calls.length}`,
          name: functionCall.name,
          arguments:
            functionCall.args && typeof functionCall.args === "object" && !Array.isArray(functionCall.args)
              ? (functionCall.args as Record<string, unknown>)
              : {},
        });
      }
    }
  }

  result.toolCalls = calls;
  result.ok = true;
  return result;
}

export async function probeGoogle(input: GoogleInput): Promise<void> {
  const { url, body, headers } = buildGoogleRequest(input);
  await openStreamedRequest({
    url,
    provider: "Google",
    timeoutMs: Math.min((input.model.timeoutSeconds ?? 30) * 1000, 30_000),
    signal: input.signal,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...body,
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { ...(body.generationConfig as object), maxOutputTokens: 1 },
      }),
    },
  });
}
