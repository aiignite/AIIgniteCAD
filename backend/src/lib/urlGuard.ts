/**
 * urlGuard.ts — LLM 端点 SSRF 校验
 *
 * configuration.apiUrl 由用户输入并会被服务端 fetch，因此必须限制协议、
 * 拒绝携带凭据的地址与云元数据地址；内网/回环默认只对本地推理（Ollama）
 * 或显式白名单放行。设置 AI_ALLOW_PRIVATE_ENDPOINTS=true 可让其他 provider
 * 使用内网 HTTP（如局域网里的 OpenAI 兼容网关），但公网 HTTP、元数据与
 * 链路本地地址始终拒绝。这里只做字面量判断，不做 DNS 解析，因此无法防住
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

const isLinkLocal = (host: string): boolean =>
  (isPrivateIpv4(host) && host.startsWith("169.254.")) ||
  // IPv6 链路本地 fe80::/10（fe80–febf）；只对含冒号的字面量判断，避免误伤域名
  (host.includes(":") && /^fe[89ab]/i.test(host));

const isPrivateAddress = (host: string): boolean => {
  if (isLoopback(host)) return true;
  if (host.includes(":")) {
    // IPv6 唯一本地地址 fc00::/7 与链路本地 fe80::/10
    return /^(fc|fd|fe8)/i.test(host);
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

/** 显式允许所有 provider 使用 RFC1918 / 回环 HTTP 端点（默认关闭） */
const privateEndpointsAllowed = (): boolean =>
  /^(1|true|yes|on)$/i.test((process.env.AI_ALLOW_PRIVATE_ENDPOINTS ?? "").trim());

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

  // URL.hostname 对 IPv6 保留方括号，统一去掉后再做回环 / 网段判断
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) throw new UnsafeEndpointError("端点缺少主机名");
  if (BLOCKED_HOSTS.has(host)) throw new UnsafeEndpointError("端点指向被禁止的元数据地址");
  if (isLinkLocal(host)) {
    throw new UnsafeEndpointError("端点指向被禁止的链路本地地址");
  }

  const overrides = allowedOverrides();
  const isLocal = isLoopback(host);
  const whitelisted = overrides.has(host) || overrides.has(parsed.origin.toLowerCase());
  const privateOptIn = privateEndpointsAllowed();
  const allowPrivate = options.provider === "Ollama" || privateOptIn;

  if (isPrivateAddress(host) && !isLocal && !whitelisted && !allowPrivate) {
    throw new UnsafeEndpointError("端点指向内网地址，未在白名单中");
  }
  const privateHttpAllowed = privateOptIn && isPrivateAddress(host);
  if (requireHttps(options) && protocol === "http:" && !isLocal && !whitelisted && !privateHttpAllowed) {
    throw new UnsafeEndpointError(
      "生产环境端点必须使用 https；内网 HTTP 需开启 AI_ALLOW_PRIVATE_ENDPOINTS 或加入白名单",
    );
  }

  return trimmed.replace(/\/+$/, "");
}
