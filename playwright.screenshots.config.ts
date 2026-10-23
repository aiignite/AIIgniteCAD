import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testMatch: ["**/screenshots.spec.ts"],
  testIgnore: [],
  outputDir: "test-results/screenshots",
});
