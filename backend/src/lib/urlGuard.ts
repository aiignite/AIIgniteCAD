/**
 * urlGuard.ts — LLM 端点 SSRF 校验
 *
 * configuration.apiUrl 由用户输入并会被服务端 fetch，因此必须限制协议、
 * 拒绝携带凭据的地址与云元数据地址；内网/回环只对本地推理（Ollama）或
 * 显式白名单放行。这里只做字面量判断，不做 DNS 解析，因此无法防住
 * 域名解析到内网的 rebinding；如需更强隔离应在网络层限制出站。
 */

export class UnsafeEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeEndpointError";
  }
}

/** 云端元数据地址，任何 provider 都不允许访问 */
const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts as number[];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
};

const isLoopback = (host: string): boolean =>
  host === "localhost" ||
  /^127\./.test(host) ||
  host === "::1" ||
  host.toLowerCase() === "0:0:0:0:0:0:0:1";

const isPrivateAddress = (host: string): boolean => {
  if (isLoopback(host)) return true;
  if (host.includes(":")) {
    // IPv6 唯一本地地址 fc00::/7 与链路本地 fe80::/10
    return /^(fc|fd|fe8)/i.test(host.replace(/\[|\]/g, ""));
  }
  return isPrivateIpv4(host);
};

export interface EndpointGuardOptions {
  /** 当前 provider；Ollama 默认视为本地推理，允许回环与私网 */
  provider: string;
  /** 是否要求 https（生产环境为 true） */
  requireHttps: boolean;
}

const allowedOverrides = (): Set<string> =>
  new Set(
    (process.env.AI_ALLOWED_ENDPOINTS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );

const requireHttps = (options: EndpointGuardOptions): boolean =>
  options.requireHttps || process.env.NODE_ENV === "production";

/**
 * 校验并返回规范化的 baseUrl（去掉末尾斜杠）。
 * 校验失败抛 UnsafeEndpointError，调用方应转成 400 且不回显原始 URL 之外的信息。
 */
export function assertSafeLLMEndpoint(rawUrl: string, options: EndpointGuardOptions): string {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) throw new UnsafeEndpointError("端点不能为空");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UnsafeEndpointError("端点不是合法的绝对 URL");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new UnsafeEndpointError("端点只允许 http 或 https");
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeEndpointError("端点不能在 URL 中携带凭据");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) throw new UnsafeEndpointError("端点缺少主机名");
  if (BLOCKED_HOSTS.has(host)) throw new UnsafeEndpointError("端点指向被禁止的元数据地址");
  if (isPrivateIpv4(host) && host.startsWith("169.254.")) {
    throw new UnsafeEndpointError("端点指向被禁止的链路本地地址");
  }

  const overrides = allowedOverrides();
  const isLocal = isLoopback(host);
  const whitelisted = overrides.has(host) || overrides.has(parsed.origin.toLowerCase());

  if (isPrivateAddress(host) && !isLocal && !whitelisted && options.provider !== "Ollama") {
    throw new UnsafeEndpointError("端点指向内网地址，未在白名单中");
  }
  if (requireHttps(options) && protocol === "http:" && !isLocal && !whitelisted) {
    throw new UnsafeEndpointError("生产环境端点必须使用 https");
  }

  return trimmed.replace(/\/+$/, "");
}
