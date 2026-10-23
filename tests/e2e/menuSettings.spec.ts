/**
 * menuSettings.spec.ts — 菜单栏、设置页与快捷键速查
 *
 * 覆盖三条来自真实用户路径的链路：菜单命令落到既有处理函数、
 * 设置页可导航与搜索、偏好块真的把默认模型写到服务端注册表。
 */

import { expect, test, type Page } from "@playwright/test";
import { installApiMock, type ApiMock } from "./fixtures/apiMock";

async function openApp(page: Page): Promise<ApiMock> {
    const api = await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Menu Settings Drawing");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
    return api;
}

/** 展开菜单栏的一个菜单 */
async function openMenu(page: Page, menu: string): Promise<void> {
    await page.locator(`div[role="menubar"] [data-menu="${menu}"]`).click();
    await expect(page.getByRole("menu")).toBeVisible();
}

test("菜单栏：文件菜单打开图纸管理，视图菜单切换绘图辅助", async ({ page }) => {
    await openApp(page);

    await openMenu(page, "file");
    await page.getByRole("menu").getByRole("menuitem", { name: "打开图纸" }).click();
    await expect(page.getByTestId("files-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("files-modal")).toBeHidden();

    // 菜单里的网格项与 F7 走同一条切换路径，因此同样给出状态提示
    await openMenu(page, "view");
    await page.getByRole("menu").getByRole("menuitem", { name: "显示网格" }).click();
    await expect(page.getByText("栅格 已关闭")).toBeVisible();
});

test("设置页：导航切换分区、搜索过滤模型并可返回画布", async ({ page }) => {
    await openApp(page);

    await page.locator('aside [data-action="panel-settings"]').click();
    await expect(page.getByRole("heading", { name: "绘图设置" })).toBeVisible();

    await page.locator('[data-nav="models"]').click();
    await expect(page.getByRole("heading", { name: "AI 模型管理" })).toBeVisible();

    // 模型名也会出现在 AI 浮窗与偏好块的下拉里，断言只看设置页正文
    const body = page.locator("[data-settings-body]");
    await expect(body.getByText("本地 Qwen").first()).toBeVisible();
    await expect(body.getByText("云端 GPT").first()).toBeVisible();

    await page.getByLabel(/搜索/).fill("qwen");
    await expect(body.getByText("云端 GPT")).toHaveCount(0);
    await expect(page.locator("[data-settings-count]")).toHaveText("1/2");

    await page.getByLabel(/搜索/).fill("不存在的关键字");
    await expect(body.getByText("暂无匹配模型")).toBeVisible();

    await page.locator('[data-nav="appearance"]').click();
    await expect(page.getByRole("heading", { name: "界面外观" })).toBeVisible();
    // 语言切换按钮真正来自 AppearanceSection，说明分区内容已渲染
    await expect(page.getByRole("button", { name: "English", exact: true })).toBeVisible();

    await page.locator('[data-action="settings-close"]').click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
});

test("偏好块：设为默认模型写入服务端注册表", async ({ page }) => {
    const api = await openApp(page);

    await page.locator('aside [data-action="panel-settings"]').click();
    await page.locator('[data-action="prefs-default-model"]').selectOption("model-cloud");
    await page.locator('[data-action="settings-prefs-save"]').click();
    await expect(page.getByText("偏好已保存")).toBeVisible();

    expect(api.state.defaultModelCalls).toContain("model-cloud");
    expect(
        api.state.models.find((model) => model.id === "model-cloud")?.isDefault,
    ).toBe(true);
});

test("F1 打开快捷键速查，Esc 关闭", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("F1");
    const sheet = page.getByRole("dialog", { name: "快捷键速查" });
    await expect(sheet).toBeVisible();
    // 速查表由菜单模型派生，工具键位与命令键位都要在
    await expect(sheet.getByText("直线")).toBeVisible();
    await expect(sheet.getByText("撤销")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
});
