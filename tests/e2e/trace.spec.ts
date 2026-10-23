import path from "node:path";
import { expect, test } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test("参考图在本地矢量化后插入图纸并可撤销", async ({ page }) => {
    await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("Welcome to AI Ignite CAD")).toBeVisible();
    await page.getByText("New Drawing", { exact: true }).click();
    await page.getByPlaceholder("My Drawing").fill("Trace Drawing");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    const svg = page.locator("#drawing-surface svg");
    await expect(svg).toBeVisible();

    await page.locator('header button[title="参考图转 CAD"]').click();
    const dialog = page.getByRole("dialog", { name: "参考图转 CAD" });
    await expect(dialog).toBeVisible();

    await dialog
        .locator('input[aria-label="参考图片文件"]')
        .setInputFiles(path.resolve("tests/e2e/fixtures/trace-square.png"));

    await expect(dialog.getByText(/识别到 \d+ 条轮廓/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "插入图纸" })).toBeEnabled();

    await dialog.getByRole("button", { name: "插入图纸" }).click();
    await expect(dialog).toBeHidden();

    await expect(svg.locator("polygon")).toHaveCount(1);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(svg.locator("polygon")).toHaveCount(0);
});
