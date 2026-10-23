/**
 * logger.ts — 结构化 JSON 日志
 *
 * 所有日志输出为单行 JSON，便于容器日志采集与检索；
 * 敏感字段（密码、token、API Key、Authorization 等）在序列化前统一脱敏。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY = /(password|secret|token|authorization|api[-_]?key|cookie)/i;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 50;
const MAX_DEPTH = 5;

const activeLevel = (): LogLevel => {
  const configured = (process.env.LOG_LEVEL || "info").toLowerCase();
  return configured in LEVEL_WEIGHT ? (configured as LogLevel) : "info";
};

const truncate = (value: string): string =>
  value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
    : value;

/** 递归脱敏并限制深度，避免日志被大对象或密钥污染 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value !== "object") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message),
      stack: value.stack ? truncate(value.stack) : undefined,
    };
  }
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => redact(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // 数值型 token 字段是计数指标（promptTokens 等），不是凭据
    output[key] =
      SENSITIVE_KEY.test(key) && typeof item !== "number"
        ? "[REDACTED]"
        : redact(item, depth + 1);
  }
  return output;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[activeLevel()]) return;

  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: "aiignitecad-backend",
    ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
  };

  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) =>
    write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    write("error", message, meta),
};
