/**
 * cors.ts — 允许来源的白名单解析
 *
 * FRONTEND_URL 支持逗号分隔的多个来源，便于同时放行本地开发与生产域名；
 * 未配置时只放行本地前端端口。
 */

const DEFAULT_ORIGIN = "http://localhost:3220";

export function parseAllowedOrigins(value: string | undefined): string[] {
  const origins = (value ?? DEFAULT_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : [DEFAULT_ORIGIN];
}

/** 无 Origin 的请求（curl、服务端调用、同源导航）不启用 CORS 限制 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[],
): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}
