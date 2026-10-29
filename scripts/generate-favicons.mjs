/**
 * generate-favicons.mjs — 由 public/favicon.svg 生成 PNG 站点图标
 *
 * SVG 图标在 Chrome / Edge 生效，但 Safari 与部分国产浏览器只认 PNG，
 * 因此额外产出 32 / 64 / 180 三档 PNG 备用。
 * 用法：node scripts/generate-favicons.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public", "favicon.svg"), "utf8");

/** [文件名, 边长（像素）] */
const targets = [
    ["favicon-32.png", 32],
    ["favicon-64.png", 64],
    ["apple-touch-icon.png", 180],
];

const browser = await chromium.launch();
for (const [file, size] of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
        `<body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">` +
            svg.replace(/width="200" height="200"/, `width="${size}" height="${size}"`) +
            `</body>`,
    );
    await page.screenshot({ path: join(root, "public", file) });
    await page.close();
    console.log(`生成 public/${file}（${size}×${size}）`);
}
await browser.close();
