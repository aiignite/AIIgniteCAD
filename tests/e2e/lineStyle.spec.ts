/**
 * 端到端：右侧属性面板的线型 / 线宽 / 常用色板
 *
 * 画一个矩形 → 选中 → 改虚线、1.00 mm 线宽与常用色 → 取消选中后
 * 直接断言画布 SVG 上的 stroke / stroke-dasharray / stroke-width，
 * 确保属性面板的修改真正落到图元渲染，而不只是面板内部状态。
 */

import { expect, test, type Page } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test.setTimeout(60_000);

async function openApp(page: Page): Promise<void> {
    await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Line Style");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
    // 关闭栅格与捕捉，矩形边落在鼠标位置上，命中点可复现
    await page.getByRole("button", { name: "栅格" }).click();
    await page.getByRole("button", { name: "捕捉" }).click();
}

test("属性面板可修改线型、线宽与常用颜色", async ({ page }) => {
    await openApp(page);

    // 先展开右侧属性面板，再取画布尺寸（面板展开会改变画布宽度）
    await page.locator('aside [data-action="panel-toggle"]').click();
    await expect(page.getByText("属性", { exact: true })).toBeVisible();

    const box = await page.locator("#drawing-surface svg").boundingBox();
    if (!box) throw new Error("Drawing surface is not visible");

    await page.locator('[data-tool="RECTANGLE"]').click();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, {
        steps: 10,
    });
    await page.mouse.up();

    // 点矩形上边选中（选中态图元为黄色）
    await page.locator('[data-tool="SELECT"]').click();
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.3);

    const selectedRect = page.locator('#drawing-surface svg rect[stroke="#fbbf24"]');
    await expect(selectedRect).toBeVisible();
    await expect(page.getByText("线型与线宽", { exact: true })).toBeVisible();
    await expect(page.locator("#property-line-type")).toHaveValue("CONTINUOUS");
    await expect(page.locator("#property-line-weight")).toHaveValue("default");

    // 线型改为虚线：选中态直接显示图元线型，便于即时预览
    await page.locator("#property-line-type").selectOption("DASHED");
    await expect(selectedRect).toHaveAttribute("stroke-dasharray", "8 4");

    // 线宽 1.00 mm ≈ 3.78px；选中态取 max(3px 高亮宽度, 图元线宽)
    await page.locator("#property-line-weight").selectOption("1");
    await expect(selectedRect).toHaveAttribute("stroke-width", "3.78");

    // 常用色板一档即改色，再点空白处取消选中以读取真实颜色（避开右下角小地图）
    await page.getByRole("button", { name: "#ef4444" }).click();
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25);

    const recoloredRect = page.locator('#drawing-surface svg rect[stroke="#ef4444"]');
    await expect(recoloredRect).toBeVisible();
    await expect(recoloredRect).toHaveAttribute("stroke-dasharray", "8 4");
    await expect(recoloredRect).toHaveAttribute("stroke-width", "3.78");
});
