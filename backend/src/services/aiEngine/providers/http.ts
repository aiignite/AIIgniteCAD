/**
 * http.ts — provider 请求的超时、重试与流式行读取
 *
 * 统一在这里处理：端点 SSRF 校验、超时与客户端断开合并的 AbortSignal、
 * 429 按 Retry-After 等待、5xx/网络错误有限次指数退避、400/422 才做
 * "去掉 tools 再试一次"。401/403 视为配置问题，不重试也不 failover 到
 * 同一个 Key 的其他模型之外，避免拿着错 Key 反复打上游。
 */

import { assertSafeLLMEndpoint, UnsafeEndpointError } from "../../../lib/urlGuard";
import { logger } from "../../../lib/logger";
import { metrics } from "../../../lib/metrics";
import { ProviderError, ProviderErrorCode } from "./types";

export const MAX_RETRY_ATTEMPTS = 2;
const MAX_RETRY_WAIT_MS = 8_000;

export interface RequestAttempt {
  url: string;
  init: RequestInit;
  /** 去掉 tools 后的备用请求体，provider 不支持 function calling 时使用 */
  bodyWithoutTools?: string;
  provider: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

const errorCodeForStatus = (status: number): ProviderErrorCode => {
  if (status === 401 || status === 403) return "PROVIDER_AUTH";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  if (status === 400 || status === 422) return "PROVIDER_BAD_REQUEST";
  return "PROVIDER_UNAVAILABLE";
};

/** 截断错误响应，避免把上游返回体（可能含 Key 或内部信息）整体透传 */
const briefErrorBody = async (response: globalThis.Response): Promise<string> => {
  try {
    const text = await response.text();
    return text.slice(0, 400).replace(/\s+/g, " ");
  } catch {
    return "";
  }
};

const retryAfterMs = (response: globalThis.Response): number => {
  const raw = response.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  const date = Date.parse(raw);
  return Number.isFinite(date)
    ? Math.min(Math.max(0, date - Date.now()), MAX_RETRY_WAIT_MS)
    : 0;
};

const wait = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError("PROVIDER_ABORTED", "请求已取消", false, false));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const withTimeout = (timeoutMs: number, caller?: AbortSignal): AbortSignal => {
  const timeout = AbortSignal.timeout(Math.max(1_000, timeoutMs));
  return caller ? AbortSignal.any([timeout, caller]) : timeout;
};

const isTimeoutSignal = (signal: AbortSignal | undefined): boolean => {
  const reason = signal?.reason as { name?: string } | undefined;
  return reason?.name === "TimeoutError";
};

const abortReason = (signal: AbortSignal | undefined, timeoutMs: number): ProviderError => {
  if (isTimeoutSignal(signal)) {
    return new ProviderError(
      "PROVIDER_TIMEOUT",
      `模型响应超过 ${Math.round(timeoutMs / 1000)} 秒，请在模型设置里提高超时或更换模型`,
      true,
      true,
    );
  }
  return new ProviderError("PROVIDER_ABORTED", "请求已取消", false, false);
};

export function guardedEndpoint(rawUrl: string, provider: string): string {
  try {
    return assertSafeLLMEndpoint(rawUrl, { provider, requireHttps: false });
  } catch (error) {
    if (error instanceof UnsafeEndpointError) {
      throw new ProviderError("PROVIDER_BAD_REQUEST", `模型端点不合法：${error.message}`, false, false);
    }
    throw error;
  }
}

/**
 * 发起请求并按错误类型决定是否重试。返回已建立 SSE/NDJSON 流的 Response，
 * 流式内容的读取与解析留给各 provider 适配器。
 */
export async function openStreamedRequest(attempt: RequestAttempt): Promise<globalThis.Response> {
  const { provider, timeoutMs, signal } = attempt;
  let lastError: ProviderError | null = null;

  for (let attemptIndex = 0; attemptIndex <= MAX_RETRY_ATTEMPTS; attemptIndex += 1) {
    if (signal?.aborted) throw abortReason(signal, timeoutMs);

    let response: globalThis.Response;
    try {
      response = await fetch(attempt.url, {
        ...attempt.init,
        signal: withTimeout(timeoutMs, signal),
      });
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal, timeoutMs);
      const aborted = error instanceof Error && /AbortError|TimeoutError/.test(error.name + error.message);
      lastError = aborted
        ? abortReason(signal, timeoutMs)
        : new ProviderError("NETWORK", "无法连接模型服务，请检查端点与网络", true, true);
      logger.warn("LLM request transport failed", {
        provider,
        attempt: attemptIndex + 1,
        message: error instanceof Error ? lastError.message : "unknown",
      });
      metrics.increment("ai.transport_retries");
      if (attemptIndex < MAX_RETRY_ATTEMPTS) {
        await wait(Math.min(2 ** attemptIndex * 500, MAX_RETRY_WAIT_MS), signal);
        continue;
      }
      throw lastError;
    }

    if (response.ok) return response;

    const status = response.status;
    const body = await briefErrorBody(response);
    const code = errorCodeForStatus(status);

    // provider 不接受 tools：去掉工具再试一次，让不支持 function calling 的模型仍可对话
    if ((status === 400 || status === 422) && attempt.bodyWithoutTools) {
      logger.warn("LLM tools request rejected; retrying without tools", { provider, status });
      metrics.increment("ai.tool_fallback_retries");
      const withoutTools = { ...attempt, bodyWithoutTools: undefined };
      const init: RequestInit = { ...attempt.init, body: attempt.bodyWithoutTools };
      return openStreamedRequest({ ...withoutTools, init });
    }

    lastError = new ProviderError(
      code,
      code === "PROVIDER_AUTH"
        ? "模型鉴权失败，请检查 API Key 是否正确或已过期"
        : `模型服务返回 ${status}${body ? `：${body}` : ""}`,
      code === "PROVIDER_RATE_LIMIT" || code === "PROVIDER_UNAVAILABLE",
      code !== "PROVIDER_AUTH",
      status,
    );

    if (code === "PROVIDER_AUTH" || code === "PROVIDER_BAD_REQUEST") throw lastError;

    if (attemptIndex < MAX_RETRY_ATTEMPTS) {
      const delay =
        code === "PROVIDER_RATE_LIMIT"
          ? retryAfterMs(response) || Math.min(2 ** attemptIndex * 500, MAX_RETRY_WAIT_MS)
          : Math.min(2 ** attemptIndex * 500, MAX_RETRY_WAIT_MS);
      logger.warn("LLM request retrying", { provider, status, attempt: attemptIndex + 1, delayMs: delay });
      metrics.increment("ai.request_retries");
      await wait(delay, signal);
      continue;
    }
    throw lastError;
  }

  throw lastError ?? new ProviderError("PROVIDER_UNAVAILABLE", "模型调用失败", true, true);
}

/** 按行消费响应流；SSE 适配器自行过滤 `data:` 前缀，NDJSON 适配器直接解析整行 */
export async function* readLines(
  response: globalThis.Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ProviderError("PROVIDER_NO_BODY", "模型服务未返回响应流", true, true);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) throw new ProviderError("PROVIDER_ABORTED", "请求已取消", false, false);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield trimmed;
      }
    }
    const tail = buffer.trim();
    if (tail) yield tail;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (signal?.aborted) throw new ProviderError("PROVIDER_ABORTED", "请求已取消", false, false);
    throw new ProviderError("NETWORK", "模型响应流读取中断", true, false);
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** 非流式 JSON 响应读取，供连接测试与降级路径使用 */
export async function readJsonResponse(
  response: globalThis.Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ProviderError("PROVIDER_BAD_REQUEST", "模型服务返回了非 JSON 响应", false, false);
  }
}
