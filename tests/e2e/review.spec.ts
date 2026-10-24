import { expect, test } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test("检查面板列出问题、定位选中并带着摘要切到 AI 修复", async ({ page }) => {
    await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Review Drawing");
    await page.getByRole("button", { name: "创建", exact: true }).click();

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

    // 状态栏的「已选 N」提示只在选择工具下出现，先切过去再开检查窗体
    await page.locator('[data-tool="SELECT"]').first().click();
    await page.locator('aside [data-action="panel-review"]').click();
    const reviewDialog = page.getByRole("dialog", { name: "图纸检查" });
    await expect(reviewDialog).toBeVisible();

    const issue = page.locator('[data-review-issue="missing-dimension"]');
    await expect(issue).toBeVisible();
    await expect(issue).toContainText("缺少尺寸标注");

    await issue.locator('button[title="选中并缩放到问题位置"]').click();
    // 满屏窗体下属性面板被覆盖，改从状态栏断言选择集
    await expect(page.locator("footer").getByText(/已选 3 个/)).toBeVisible();

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
