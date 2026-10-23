/**
 * ollama.ts — Ollama /api/chat NDJSON 流适配
 *
 * Ollama 每行是一个完整 JSON 对象，没有 SSE 前缀；usage 在最后一行的
 * prompt_eval_count / eval_count 上。消息形状沿用 OpenAI 的 tool_calls 结构，
 * 因此复用 openaiCompatible 的消息转换，只处理端点与流解析差异。
 */

import { LLMModel } from "@prisma/client";
import { CadToolDefinition, parseToolArguments, toOllamaTools } from "../tools";
import { guardedEndpoint, openStreamedRequest, readLines } from "./http";
import { toOpenAIMessages } from "./openaiCompatible";
import { ProviderResult, ProviderStreamHandlers, ProviderTurn, emptyResult } from "./types";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwq";

interface OllamaInput {
  model: LLMModel;
  turn: ProviderTurn;
  tools: CadToolDefinition[];
  signal?: AbortSignal;
}

export function buildOllamaRequest(input: OllamaInput): {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const { model, turn, tools } = input;
  const endpoint = guardedEndpoint(
    (model.configuration as { apiUrl?: string } | null)?.apiUrl || DEFAULT_BASE_URL,
    "Ollama",
  );
  const useTools = tools.length > 0 && model.supportsTools;

  const options: Record<string, unknown> = {};
  if (typeof turn.temperature === "number") options.temperature = turn.temperature;
  if (typeof turn.topP === "number") options.top_p = turn.topP;
  if (typeof turn.maxOutputTokens === "number") options.num_predict = turn.maxOutputTokens;

  return {
    url: `${endpoint}/api/chat`,
    body: {
      model: model.modelId || DEFAULT_MODEL,
      messages: toOpenAIMessages(turn),
      stream: true,
      ...(Object.keys(options).length > 0 ? { options } : {}),
      ...(useTools ? { tools: toOllamaTools(tools) } : {}),
    },
    headers: { "Content-Type": "application/json" },
  };
}

export async function streamOllama(
  input: OllamaInput,
  handlers: ProviderStreamHandlers,
): Promise<ProviderResult> {
  const result = emptyResult();
  const { body, url, headers } = buildOllamaRequest(input);
  const bodyWithoutTools = body.tools ? JSON.stringify({ ...body, tools: undefined }) : undefined;

  const response = await openStreamedRequest({
    url,
    provider: "Ollama",
    timeoutMs: (input.model.timeoutSeconds ?? 120) * 1000,
    signal: input.signal,
    init: { method: "POST", headers, body: JSON.stringify(body) },
    bodyWithoutTools,
  });

  let seq = 0;

  for await (const line of readLines(response, input.signal)) {
    const jsonText = line.startsWith("data:") ? line.slice(line.indexOf(":") + 1).trim() : line;
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }

    if (typeof parsed.prompt_eval_count === "number") {
      result.usage.promptTokens = parsed.prompt_eval_count;
    }
    if (typeof parsed.eval_count === "number") {
      result.usage.completionTokens = parsed.eval_count;
    }
    if (result.usage.promptTokens !== undefined || result.usage.completionTokens !== undefined) {
      handlers.onUsage?.(result.usage);
    }

    const content = parsed.message?.content;
    if (typeof content === "string" && content) {
      result.emittedContent = true;
      result.content += content;
      handlers.onContent(content);
    }

    if (Array.isArray(parsed.message?.tool_calls)) {
      for (const raw of parsed.message.tool_calls) {
        const name = raw?.function?.name;
        const args = parseToolArguments(raw?.function?.arguments);
        if (!name || !args) continue;
        result.toolCalls.push({ id: raw.id || `call_ollama_${seq++}`, name, arguments: args });
      }
    }

    if (parsed.done === true) {
      result.finishReason = result.toolCalls.length > 0 ? "tool_use" : "stop";
      break;
    }
    if (typeof parsed.error === "string" && parsed.error) {
      result.finishReason = "error";
    }
  }

  result.ok = true;
  return result;
}

export async function probeOllama(input: OllamaInput): Promise<void> {
  const { body, url, headers } = buildOllamaRequest(input);
  await openStreamedRequest({
    url,
    provider: "Ollama",
    timeoutMs: Math.min((input.model.timeoutSeconds ?? 30) * 1000, 30_000),
    signal: input.signal,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...body,
        stream: false,
        messages: [{ role: "user", content: "ping" }],
        options: { ...(body.options as object), num_predict: 1 },
      }),
    },
  });
}
