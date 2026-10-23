import { expect, test } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test("设计约定保存后随项目同步，并在刷新后回填", async ({ page }) => {
    await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Convention Drawing");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();

    await page.locator('nav button[title="约定"]').click();
    await expect(page.getByText("设计约定").first()).toBeVisible();
    await page.getByLabel("制图标准").fill("GB/T 14689");
    await page.getByLabel("建议字高").fill("5");
    await page.getByLabel("尺寸精度").fill("1");

    await page.getByRole("button", { name: "+ 添加图层" }).click();
    await page.getByLabel("图层 1 名称").fill("WALLS");
    await page.getByLabel("图层 1 用途").fill("墙体");
    await page.getByLabel("约定备注").fill("门洞现场复核");

    const put = page.waitForResponse(
        (response) =>
            response.request().method() === "PUT" &&
            /\/api\/projects\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "保存约定" }).click();
    await expect(page.getByText(/设计约定已保存/)).toBeVisible();
    const response = await put;
    expect(response.request().postDataJSON()).toMatchObject({
        designConventions: {
            standard: "GB/T 14689",
            textHeight: 5,
            dimensionPrecision: 1,
            layerRules: [{ name: "WALLS", purpose: "墙体" }],
            notes: ["门洞现场复核"],
        },
    });

    await page.reload();
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("Convention Drawing", { exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
    await page.locator('nav button[title="约定"]').click();
    await expect(page.getByLabel("制图标准")).toHaveValue("GB/T 14689");
    await expect(page.getByLabel("建议字高")).toHaveValue("5");
    await expect(page.getByLabel("图层 1 名称")).toHaveValue("WALLS");
    await expect(page.getByLabel("约定备注")).toHaveValue("门洞现场复核");
});
