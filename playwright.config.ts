/**
 * playwright.config.ts — 浏览器冒烟测试配置
 *
 * 测试通过 page.route 在浏览器内模拟 API，无需后端数据库或 LLM Key；
 * webServer 使用独立端口启动 Vite，避免与本机开发服务器冲突。
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3221);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/screenshots.spec.ts", "**/demoGif.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_API_URL: "/api",
    },
  },
});
