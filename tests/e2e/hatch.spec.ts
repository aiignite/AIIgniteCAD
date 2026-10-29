/**
 * 端到端：填充（HATCH）的间距参数必须真正影响渲染
 *
 * 1. 画一个矩形并选中，用「填充」工具生成 ANSI31 图案，间距填 200 → 图案线很少
 * 2. 在属性面板把间距改成 20 → 图案线明显变密
 * 如果间距仍被忽略，两个阶段的线数会完全相同，测试失败。
 */

import { expect, test, type Page } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test.setTimeout(60_000);

async function openApp(page: Page): Promise<void> {
    await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Hatch Spacing");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
    await page.getByRole("button", { name: "栅格" }).click();
    await page.getByRole("button", { name: "捕捉" }).click();
}

test("填充间距 200 与 20 生成不同密度的图案线", async ({ page }) => {
    await openApp(page);
    await page.locator('aside [data-action="panel-toggle"]').click();

    const box = await page.locator("#drawing-surface svg").boundingBox();
    if (!box) throw new Error("Drawing surface is not visible");

    // 画矩形
    await page.locator('[data-tool="RECTANGLE"]').click();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.7, { steps: 10 });
    await page.mouse.up();

    // 选中矩形后打开填充对话框
    await page.locator('[data-tool="SELECT"]').click();
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.3);
    await page.locator('[data-tool="HATCH"]').click();
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);

    await expect(page.getByRole("heading", { name: "填充设置" })).toBeVisible();
    await page.locator('[data-field="hatch-spacing"]').fill("200");
    await page.getByRole("button", { name: "应用", exact: true }).click();

    // 间距 200：图案线很少
    const hatchPath = page.locator('#drawing-surface svg path[stroke="#4a5568"]');
    await expect(hatchPath).toBeVisible();
    const lineCount = async () =>
        ((await hatchPath.getAttribute("d"))?.match(/M /g) ?? []).length;
    const sparse = await lineCount();
    expect(sparse).toBeGreaterThan(0);
    expect(sparse).toBeLessThanOrEqual(6);

    // 选中填充，在属性面板把间距改为 20 → 线条明显变密
    // 填充工具应用后仍处于 HATCH 激活态，先切回选择工具，否则点击会再次弹出对话框
    await page.locator('[data-tool="SELECT"]').click();
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await expect(page.getByText("填充属性", { exact: true })).toBeVisible();
    await expect(page.locator("#property-hatch-spacing")).toHaveValue("200");
    await page.locator("#property-hatch-spacing").fill("20");

    await expect
        .poll(lineCount, { timeout: 5000 })
        .toBeGreaterThan(sparse * 3);
});
