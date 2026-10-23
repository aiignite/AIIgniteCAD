/**
 * 生成 README / 文档使用的真实界面截图。
 * 运行：npm run docs:screenshots
 */

import { test, type Page } from "@playwright/test";
import { installApiMock, TEST_USER } from "./fixtures/apiMock";

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

const SHOT_OPTIONS = {
  caret: "hide" as const,
};

async function canvasBox(page: Page) {
  const box = await page.locator("#drawing-surface svg").boundingBox();
  if (!box) throw new Error("Drawing surface is not visible");
  return box;
}

async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, {
    steps: 12,
  });
  await page.mouse.up();
}

test("capture docs screenshots", async ({ page }) => {
  await installApiMock(page);

  // 1. 登录页
  await page.goto("/");
  await page.getByRole("heading", { name: "欢迎回来" }).waitFor();
  await page.screenshot({ path: "docs/images/login.png", ...SHOT_OPTIONS });

  // 2. 登录后的欢迎面板
  await page.getByLabel("邮箱地址").fill(TEST_USER.email);
  await page.getByLabel("密码", { exact: true }).fill("e2e-secret");
  await page.getByRole("button", { name: /登录/ }).click();
  await page.getByText("欢迎使用 AI Ignite CAD").waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "docs/images/welcome.png", ...SHOT_OPTIONS });

  // 3. 新建图纸并绘制示例图形
  await page.getByText("新建图纸", { exact: true }).click();
  await page.getByPlaceholder("图纸名称，例如：装配图").fill("Mechanical Demo");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.locator("#drawing-surface svg").waitFor();
  await page.waitForTimeout(300);

  await page.locator('[data-tool="RECTANGLE"]').click();
  await dragOnCanvas(page, { x: 0.22, y: 0.28 }, { x: 0.62, y: 0.68 });

  await page.locator('[data-tool="CIRCLE"]').click();
  await dragOnCanvas(page, { x: 0.7, y: 0.4 }, { x: 0.82, y: 0.52 });

  await page.locator('[data-tool="LINE"]').click();
  await dragOnCanvas(page, { x: 0.24, y: 0.74 }, { x: 0.84, y: 0.74 });

  await page.locator('[data-tool="DIMENSION"]').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.28);
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.28);
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.2);

  await page.locator('[data-tool="SELECT"]').click();
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.28);
  await page.waitForTimeout(3200);
  await page.screenshot({ path: "docs/images/canvas.png", ...SHOT_OPTIONS });

  // 4. 暗色主题
  await page.getByTitle("切换到深色模式").click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "docs/images/canvas-dark.png",
    ...SHOT_OPTIONS,
  });
});
