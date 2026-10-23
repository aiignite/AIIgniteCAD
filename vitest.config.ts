/**
 * vitest.config.ts — 前端单元测试配置
 * 使用 Node 环境运行纯逻辑测试（几何、变换、DXF、曲线生成），
 * 与 vite.config.ts 分离，避免测试时加载浏览器插件与环境变量注入。
 */

import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "."),
        },
    },
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            // 仅统计纯逻辑模块，组件与浏览器相关代码不在当前测试范围
            include: [
                "lib/geometry.ts",
                "lib/transform.ts",
                "lib/block.ts",
                "lib/command.ts",
                "lib/aiTools.ts",
                "lib/spatialIndex.ts",
                "lib/snapping.ts",
                "lib/grip.ts",
                "lib/canvasGeometry.ts",
                "lib/selection.ts",
                "lib/viewport.ts",
                "lib/collaboration.ts",
                "lib/frameCoalescer.ts",
                "renderer/svgRenderer.ts",
                "services/dxfService.ts",
                "services/curveGenerationService.ts",
            ],
            exclude: ["tests/**"],
        },
    },
});
