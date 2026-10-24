/**
 * 端到端：全局快捷键（删除、复制粘贴、文件操作）
 *
 * 所有 API 由 fixtures/apiMock 在浏览器内拦截，无需数据库、后端进程或 LLM Key。
 */

import { expect, test, type Page } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test.setTimeout(60_000);

/** macOS 用 Cmd，其余平台用 Ctrl */
const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function openApp(page: Page): Promise<void> {
    await installApiMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Shortcut Drawing");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
    // 关闭栅格与捕捉，图元端点落在鼠标位置上，命中位置可复现
    await page.getByRole("button", { name: "栅格" }).click();
    await page.getByRole("button", { name: "捕捉" }).click();
}

async function canvasBox(page: Page) {
    const box = await page.locator("#drawing-surface svg").boundingBox();
    if (!box) throw new Error("Drawing surface is not visible");
    return box;
}

/** 读取图元线段的端点；排除原点坐标轴那两条红绿线 */
async function readElementLines(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll("#drawing-surface svg line")]
            .filter(
                (line) =>
                    line.getAttribute("stroke") !== "red" &&
                    line.getAttribute("stroke") !== "green",
            )
            .map((line) =>
                ["x1", "y1", "x2", "y2"]
                    .map((name) => line.getAttribute(name))
                    .join(","),
            ),
    );
}

/** 在画布上拖出一条线，返回线段中点的屏幕坐标 */
async function drawLine(page: Page): Promise<{ x: number; y: number }> {
    const box = await canvasBox(page);
    const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    const end = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.3 };
    await page.locator('aside [data-tool="LINE"]').click();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

test("删除键在焦点落到工具栏按钮后仍然生效", async ({ page }) => {
    await openApp(page);

    const mid = await drawLine(page);
    expect(await readElementLines(page)).toHaveLength(1);

    await page.locator('aside [data-tool="SELECT"]').click();
    await page.mouse.click(mid.x, mid.y);
    await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();

    // 再点一次工具栏按钮：焦点离开画布，按 Delete 仍应删除选中集
    await page.locator('aside [data-tool="SELECT"]').click();
    await page.keyboard.press("Delete");

    expect(await readElementLines(page)).toHaveLength(0);
    await expect(page.getByText(/已删除 1 个图元/)).toBeVisible();
});

test("连续粘贴的副本逐次错开，不完全重叠", async ({ page }) => {
    await openApp(page);

    const mid = await drawLine(page);
    await page.locator('aside [data-tool="SELECT"]').click();
    await page.mouse.click(mid.x, mid.y);
    await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();

    await page.keyboard.press(`${MOD}+c`);
    await expect(page.getByText("已复制 1 个图元")).toBeVisible();

    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByText("已粘贴 1 个图元")).toBeVisible();
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByText("已粘贴 1 个图元")).toBeVisible();

    // 原图与两份副本：数量为 3，坐标互不相同
    const lines = await readElementLines(page);
    expect(lines).toHaveLength(3);
    expect(new Set(lines).size).toBe(3);
});

test("Ctrl+S 保存图纸，Ctrl+O / Ctrl+N 打开图纸清单", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press(`${MOD}+s`);
    await expect(page.getByText("保存成功").first()).toBeVisible();

    await page.keyboard.press(`${MOD}+o`);
    const drawings = page.getByRole("dialog", { name: "图纸清单" });
    await expect(drawings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawings).toBeHidden();

    await page.keyboard.press(`${MOD}+n`);
    await expect(drawings).toBeVisible();
});

test("Ctrl+P 打开打印面板", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press(`${MOD}+p`);
    await expect(page.getByRole("heading", { name: "打印 / 绘图" })).toBeVisible();
});

test("单键切换画布工具", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("l");
    await expect(page.getByText("已切换到「直线」工具").first()).toBeVisible();
    await expect(page.locator("footer")).toContainText("直线");

    await page.keyboard.press("c");
    await expect(page.getByText("已切换到「圆」工具").first()).toBeVisible();
    await expect(page.locator("footer")).toContainText("圆");

    // 组合键优先：Ctrl+C 仍然是复制，不会被单键映射截胡
    await page.keyboard.press(`${MOD}+c`);
    await expect(page.getByText("没有可复制的图元").first()).toBeVisible();
});

test("右键弹出上下文菜单并可执行菜单项", async ({ page }) => {
    await openApp(page);

    const mid = await drawLine(page);
    await page.locator('aside [data-tool="SELECT"]').click();
    await page.mouse.click(mid.x, mid.y);
    await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();

    await page.mouse.click(mid.x, mid.y, { button: "right" });
    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("全选")).toBeHidden();

    await menu.getByText("删除").click();
    await expect(menu).toBeHidden();
    expect(await readElementLines(page)).toHaveLength(0);
});

test("没有选择集时右键菜单提供全选与缩放到范围", async ({ page }) => {
    await openApp(page);

    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4, {
        button: "right",
    });

    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("全选")).toBeVisible();
    await expect(menu.getByText("缩放到范围")).toBeVisible();
    await expect(menu.getByText("删除")).toBeHidden();
});

test("右键拖拽仍是平移，不弹出菜单", async ({ page }) => {
    await openApp(page);

    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 6 });
    await page.mouse.up({ button: "right" });

    await expect(page.getByTestId("context-menu")).toBeHidden();
});
