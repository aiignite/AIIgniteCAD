/**
 * 端到端：组合 / 解组、复制粘贴与单独选中、右侧面板默认收起、图纸弹窗、AI 左右分栏
 *
 * 所有 API 由 fixtures/apiMock 在浏览器内拦截，无需数据库、后端进程或 LLM Key。
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
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Organize Drawing");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
    // 关闭栅格与捕捉，图元端点落在鼠标位置上，命中位置可复现
    await page.getByRole("button", { name: "栅格" }).click();
    await page.getByRole("button", { name: "捕捉" }).click();
}

/** 世界坐标 → 屏幕坐标，与画布自身的 CTM 换算保持一致 */
async function worldToScreen(
    page: Page,
    x: number,
    y: number,
): Promise<{ x: number; y: number }> {
    return page.evaluate(([wx, wy]) => {
        const svg = document.querySelector<SVGSVGElement>("#drawing-surface svg");
        const ctm = svg?.getScreenCTM();
        if (!ctm) throw new Error("Drawing surface has no screen CTM");
        return { x: wx * ctm.a + ctm.e, y: wy * ctm.d + ctm.f };
    }, [x, y] as [number, number]);
}

/** 读取画布上所有线段的端点，用于比较哪些图元被改动 */
async function readLines(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll("#drawing-surface svg line")].map((line) =>
            ["x1", "y1", "x2", "y2"]
                .map((name) => line.getAttribute(name))
                .join(","),
        ),
    );
}

async function canvasBox(page: Page) {
    const box = await page.locator("#drawing-surface svg").boundingBox();
    if (!box) throw new Error("Drawing surface is not visible");
    return box;
}

/** 在画布上画一条线并返回两端屏幕坐标 */
async function drawLine(
    page: Page,
    from: [number, number],
    to: [number, number],
): Promise<{ start: { x: number; y: number }; end: { x: number; y: number } }> {
    const box = await canvasBox(page);
    const start = { x: box.x + box.width * from[0], y: box.y + box.height * from[1] };
    const end = { x: box.x + box.width * to[0], y: box.y + box.height * to[1] };
    await page.locator('[data-tool="LINE"]').click();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    return { start, end };
}

test("右侧面板默认收起，左侧工具栏的按钮负责打开", async ({ page }) => {
    await openApp(page);

    // 默认收起：画布右侧没有属性面板
    await expect(page.getByText("属性", { exact: true })).toBeHidden();

    await page.locator('aside [data-action="panel-review"]').click();
    const reviewHeading = page.getByRole("heading", { name: "图纸检查" });
    await expect(reviewHeading).toBeVisible();

    await page.locator('aside [data-action="panel-toggle"]').click();
    await expect(reviewHeading).toBeHidden();
});

test("图纸管理在设置页内以主从布局呈现", async ({ page }) => {
    await openApp(page);

    await page.locator('aside [data-action="panel-files"]').click();
    const drawings = page.locator('[data-settings-body="drawings"]');
    await expect(drawings).toBeVisible();
    await expect(page.getByRole("heading", { name: "图纸管理" })).toBeVisible();

    await page.locator('[data-action="settings-close"]').click();
    await expect(drawings).toBeHidden();
});

test("组合与解散：整组选中后可拆回独立图元", async ({ page }) => {
    await openApp(page);

    // 两条互不相连的线
    const first = await drawLine(page, [0.2, 0.25], [0.35, 0.25]);
    const second = await drawLine(page, [0.2, 0.6], [0.35, 0.6]);
    // 点线段中点而不是端点：端点上会先命中夹点
    const firstMid = {
        x: (first.start.x + first.end.x) / 2,
        y: (first.start.y + first.end.y) / 2,
    };
    const svg = page.locator("#drawing-surface svg");
    const before = await svg.locator("line").count();

    // 框选两条线
    await page.locator('[data-tool="SELECT"]').click();
    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.7, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("footer").getByText(/已选 2 个/)).toBeVisible();

    // 组合后点其中一条，整组一起被选中
    await page.locator('aside [data-action="group"]').click();
    await expect(page.getByText("已组合 2 个图元")).toBeVisible();
    await page.mouse.click(firstMid.x, firstMid.y);
    await expect(page.locator("footer").getByText(/已选 2 个/)).toBeVisible();

    // 解散后回到独立图元
    await page.locator('aside [data-action="ungroup"]').click();
    await expect(page.getByText("已解散组合")).toBeVisible();
    await page.mouse.click(firstMid.x, firstMid.y);
    await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();

    // 组合不新增图元
    expect(await svg.locator("line").count()).toBe(before);
    expect(second.start.x).toBeGreaterThan(0);
});

test("复制粘贴：副本可单独选中移动", async ({ page }) => {
    await openApp(page);

    const line = await drawLine(page, [0.3, 0.35], [0.55, 0.35]);
    const svg = page.locator("#drawing-surface svg");
    const before = await svg.locator("line").count();

    await page.locator('[data-tool="SELECT"]').click();
    const lineMid = {
        x: (line.start.x + line.end.x) / 2,
        y: (line.start.y + line.end.y) / 2,
    };
    await page.mouse.click(lineMid.x, lineMid.y);
    await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();

    await page.keyboard.press("Control+c");
    await expect(page.getByText("已复制 1 个图元")).toBeVisible();
    await page.keyboard.press("Control+v");
    await expect(page.getByText("已粘贴 1 个图元")).toBeVisible();
    await expect(svg.locator("line")).toHaveCount(before + 1);
    await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();

    // 粘贴出的副本是独立图元：读出它的世界坐标并换算成屏幕坐标
    const copy = svg.locator("line").last();
    const attrs = await Promise.all(
        (["x1", "y1", "x2", "y2"] as const).map((name) => copy.getAttribute(name)),
    );
    const [x1, y1, x2, y2] = attrs.map(Number) as [number, number, number, number];
    const copyMid = await worldToScreen(page, (x1 + x2) / 2, (y1 + y2) / 2);

    // 点空白清空选择，再单独点中副本
    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.9);
    await page.mouse.click(copyMid.x, copyMid.y);
    await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();

    // 拖动副本：只有副本移动，原图元保持不动
    const beforeDrag = await readLines(page);
    await page.mouse.move(copyMid.x, copyMid.y);
    await page.mouse.down();
    await page.mouse.move(copyMid.x + 60, copyMid.y, { steps: 8 });
    await page.mouse.up();
    const afterDrag = await readLines(page);
    const changed = afterDrag.filter((value, index) => value !== beforeDrag[index]);
    expect(changed).toHaveLength(1);
});

test("AI 助手贴右时与画布左右分开，不覆盖在工作区上层", async ({ page }) => {
    await openApp(page);

    const canvas = page.locator("#drawing-surface svg");
    const widthBefore = (await canvas.boundingBox())!.width;

    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    const ai = page.getByTestId("ai-assistant-window");
    await expect(ai).toBeVisible();

    // 切到贴右分栏模式
    await ai.getByTitle("切换为右侧抽屉").click();
    await expect(ai).toHaveAttribute("data-ai-window-mode", "drawer");

    const widthAfter = (await canvas.boundingBox())!.width;
    expect(widthAfter).toBeLessThan(widthBefore);
});
