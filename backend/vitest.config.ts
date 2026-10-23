/**
 * vitest.config.ts — 后端测试配置
 *
 * 使用 Node 环境 + Supertest 直接请求 Express 实例，
 * 数据库访问通过 vi.mock 替换 Prisma，无需真实 PostgreSQL。
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 测试期间固定 JWT 密钥，避免依赖本地 .env
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret",
      // 32 字节测试密钥，仅用于覆盖加解密路径，不承载真实数据
      ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000001",
      // 测试进程共用同一 IP，放宽限流避免用例之间互相阻塞；
      // 限流行为由 tests/rateLimit.test.ts 显式覆盖。
      AUTH_RATE_LIMIT_MAX: "1000",
      AI_RATE_LIMIT_MAX: "1000",
      CHAT_RATE_LIMIT_MAX: "1000",
      SKILL_RATE_LIMIT_MAX: "1000",
      BLOCK_RATE_LIMIT_MAX: "1000",
    },
    clearMocks: true,
  },
});
