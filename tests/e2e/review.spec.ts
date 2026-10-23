import { expect, test } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test("检查面板列出问题、定位选中并带着摘要切到 AI 修复", async ({ page }) => {
    await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("Welcome to AI Ignite CAD")).toBeVisible();
    await page.getByText("New Drawing", { exact: true }).click();
    await page.getByPlaceholder("My Drawing").fill("Review Drawing");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    const svg = page.locator("#drawing-surface svg");
    await expect(svg).toBeVisible();
    const box = await svg.boundingBox();
    if (!box) throw new Error("Drawing surface is not visible");

    await page.locator('[data-tool="LINE"]').click();
    for (let index = 0; index < 3; index += 1) {
        const y = box.y + box.height * (0.3 + index * 0.12);
        await page.mouse.move(box.x + box.width * 0.3, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.6, y, { steps: 6 });
        await page.mouse.up();
    }

    await page.locator('nav button[title="检查"]').click();
    await expect(page.getByText("图纸检查")).toBeVisible();

    const issue = page.locator('[data-review-issue="missing-dimension"]');
    await expect(issue).toBeVisible();
    await expect(issue).toContainText("缺少尺寸标注");

    await issue.locator('button[title="选中并缩放到问题位置"]').click();
    await expect(page.getByText("已选中 3 个对象")).toBeVisible();

    await issue.locator('button[title="忽略这条问题"]').click();
    await expect(page.getByText("当前筛选下没有问题")).toBeVisible();
    await page.getByRole("button", { name: /恢复忽略/ }).click();
    await expect(issue).toBeVisible();

    await page.getByRole("button", { name: "让 AI 修复" }).click();
    const composer = page.getByPlaceholder(/让 AI 画图/);
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue(/请检查并修复当前图纸中的以下问题/);
    await expect(composer).toHaveValue(/图中没有尺寸标注/);
});
