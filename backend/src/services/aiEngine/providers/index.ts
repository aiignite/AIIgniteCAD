/**
 * index.ts — Provider 分发入口
 *
 * 路由只需要 `streamWithProvider` / `probeProvider`：按 model.provider 选择适配器、
 * 解密密钥、把允许的工具名裁剪成该 provider 的定义列表。新增 provider 时在这里
 * 注册一个适配器即可，不需要改动编排逻辑。
 */

import { LLMModel } from "@prisma/client";
import { CadToolDefinition, selectToolDefinitions } from "../tools";
import { decryptSecret } from "../../../lib/crypto";
import { ProviderError, ProviderResult, ProviderStreamHandlers, ProviderTurn } from "./types";
import {
  buildOpenAIRequest,
  probeOpenAICompatible,
  streamOpenAICompatible,
} from "./openaiCompatible";
import { probeAnthropic, streamAnthropic } from "./anthropic";
import { probeGoogle, streamGoogle } from "./google";
import { buildOllamaRequest, probeOllama, streamOllama } from "./ollama";

export * from "./types";
export { ProviderError };

const PROVIDERS = ["OpenAI", "Anthropic", "Google", "Ollama"] as const;
export type KnownProvider = (typeof PROVIDERS)[number];

export function isKnownProvider(provider: string): boolean {
  return (PROVIDERS as readonly string[]).includes(provider);
}

export interface DecryptedKey {
  apiKey: string;
}

/** 解密模型密钥；Ollama 无密钥，失败时抛出可展示的 ProviderError */
export function decryptModelKey(model: LLMModel): string {
  if (model.provider === "Ollama") return "";
  if (!model.apiKeyEncrypted) return "";
  try {
    return decryptSecret(model.apiKeyEncrypted);
  } catch {
    throw new ProviderError(
      "PROVIDER_AUTH",
      "API Key 解密失败，请重新保存密钥或检查 ENCRYPTION_KEY",
      false,
      false,
    );
  }
}

interface StreamArgs {
  model: LLMModel;
  turn: ProviderTurn;
  allowedTools: readonly string[] | null;
  handlers: ProviderStreamHandlers;
  signal?: AbortSignal;
}

function toolsFor(model: LLMModel, allowedTools: readonly string[] | null): CadToolDefinition[] {
  if (!allowedTools || allowedTools.length === 0) return [];
  return selectToolDefinitions(allowedTools);
}

export async function streamWithProvider(args: StreamArgs): Promise<ProviderResult> {
  const { model, turn, handlers, signal } = args;
  const tools = toolsFor(model, args.allowedTools);
  const apiKey = decryptModelKey(model);

  switch (model.provider) {
    case "Ollama":
      return streamOllama({ model, turn, tools, signal }, handlers);
    case "Google":
      return streamGoogle({ model, apiKey, turn, tools, signal }, handlers);
    case "Anthropic":
      return streamAnthropic({ model, apiKey, turn, tools, signal }, handlers);
    case "OpenAI":
      return streamOpenAICompatible({ model, apiKey, turn, tools, signal }, handlers);
    default:
      throw new ProviderError(
        "PROVIDER_UNSUPPORTED",
        `暂不支持的 provider：${model.provider}`,
        false,
        false,
      );
  }
}

export interface ProbeArgs {
  model: LLMModel;
  signal?: AbortSignal;
}

/** 模型面板"测试连接"：最小非流式请求，验证 Key、端点与模型名 */
export async function probeProvider(args: ProbeArgs): Promise<void> {
  const { model, signal } = args;
  const turn: ProviderTurn = {
    systemPrompt: null,
    messages: [{ role: "user", content: "ping" }],
    allowedTools: null,
    maxOutputTokens: 1,
  };
  const tools: CadToolDefinition[] = [];
  const apiKey = decryptModelKey(model);

  switch (model.provider) {
    case "Ollama":
      return probeOllama({ model, turn, tools, signal });
    case "Google":
      return probeGoogle({ model, apiKey, turn, tools, signal });
    case "Anthropic":
      return probeAnthropic({ model, apiKey, turn, tools, signal });
    case "OpenAI":
      return probeOpenAICompatible({ model, apiKey, turn, tools, signal });
    default:
      throw new ProviderError("PROVIDER_UNSUPPORTED", `暂不支持的 provider：${model.provider}`, false, false);
  }
}

/** 保存模型时校验端点，避免把不安全 URL 写进配置 */
export { guardedEndpoint } from "./http";
export { buildOpenAIRequest, buildOllamaRequest };
