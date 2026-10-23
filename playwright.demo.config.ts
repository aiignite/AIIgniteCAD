import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testMatch: ["**/demoGif.spec.ts"],
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  outputDir: "test-results/demo",
});
