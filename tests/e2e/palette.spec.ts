/**
 * 左侧工具面板的页签：工具 / 图块库互斥切换，折叠态回到工具图标条。
 *
 * 页签只在展开态存在；折叠后由图标条末尾的图块库按钮重新打开，
 * 这样 48px 宽度下不塞切换控件，图块库也不会被挤进图标条。
 */

import { expect, test } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test.setTimeout(60_000);

async function openDrawing(page: import("@playwright/test").Page) {
    await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Palette");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
}

test.describe("左侧面板页签", () => {
    test("工具与图块库互斥切换，折叠后回到图标条", async ({ page }) => {
        await openDrawing(page);

        // 默认工具页签：工具可见，图块库不在页签里
        await expect(page.locator('[data-tab="tools"]')).toHaveAttribute(
            "aria-selected",
            "true",
        );
        await expect(page.locator('[data-tool="LINE"]')).toBeVisible();
        await expect(page.locator('[data-testid="block-library"]')).toHaveCount(0);

        // 切到图块库：工具让位，图块库撑满页签
        await page.locator('[data-tab="blocks"]').click();
        await expect(page.locator('[data-testid="block-library"]')).toBeVisible();
        await expect(page.locator('[data-tool="LINE"]')).toHaveCount(0);
        await expect
            .poll(() => page.evaluate(() => window.localStorage.getItem("cad_palette_tab_v1")))
            .toBe("blocks");

        // 折叠：页签消失、工具图标仍在，图块库退成图标条上的一个按钮
        await page.locator('[data-action="palette-toggle"]').click();
        await expect(page.locator('[data-tab="blocks"]')).toHaveCount(0);
        await expect(page.locator('[data-tool="LINE"]')).toBeVisible();
        await expect(page.locator('[data-action="palette-blocks"]')).toBeVisible();

        // 图标条上的图块库按钮：展开并落回图块库页签
        await page.locator('[data-action="palette-blocks"]').click();
        await expect(page.locator('[data-testid="block-library"]')).toBeVisible();
        await expect(page.locator('[data-tab="blocks"]')).toHaveAttribute(
            "aria-selected",
            "true",
        );
    });
});
