/**
 * 录制 README 用的 30 秒演示帧。
 * 运行：npm run docs:gif（由 scripts/make-demo-gif.sh 合成 GIF）
 */

import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { installApiMock, TEST_USER } from "./fixtures/apiMock";

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

const FRAME_DIR = ".demo-frames";

async function shot(page: Page, index: number) {
  await page.screenshot({
    path: `${FRAME_DIR}/${String(index).padStart(2, "0")}.png`,
    caret: "hide",
  });
}

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

test("capture demo frames", async ({ page }) => {
  mkdirSync(FRAME_DIR, { recursive: true });
  await installApiMock(page);

  // 1. 登录
  await page.goto("/");
  await page.getByRole("heading", { name: "欢迎回来" }).waitFor();
  await shot(page, 0);

  // 2. 欢迎页：三步上手 + 示例
  await page.getByLabel("邮箱地址").fill(TEST_USER.email);
  await page.getByLabel("密码", { exact: true }).fill("e2e-secret");
  await page.getByRole("button", { name: /登录/ }).click();
  await page.getByText("欢迎使用 AI Ignite CAD").waitFor();
  await page.waitForTimeout(300);
  await shot(page, 1);

  // 3. 打开齿轮示例
  await page.locator('[data-example="gear"]').click();
  await page.locator("#drawing-surface svg").waitFor();
  await page.waitForTimeout(400);
  await shot(page, 2);

  // 4. 在示例上补画矩形与圆
  await page.locator('[data-tool="RECTANGLE"]').click();
  await dragOnCanvas(page, { x: 0.2, y: 0.28 }, { x: 0.55, y: 0.62 });
  await page.locator('[data-tool="CIRCLE"]').click();
  await dragOnCanvas(page, { x: 0.62, y: 0.35 }, { x: 0.78, y: 0.5 });
  await page.waitForTimeout(250);
  await shot(page, 3);

  // 5. 选取图元，展示选中态
  await page.locator('[data-tool="SELECT"]').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.waitForTimeout(250);
  await shot(page, 4);

  // 6. 图框打印预览
  await page.locator('div[role="menubar"] [data-menu="file"]').click();
  await page.getByRole("menu").getByRole("menuitem", { name: "打印 / 绘图" }).click();
  await page.waitForTimeout(500);
  await shot(page, 5);
  await page.keyboard.press("Escape");

  // 7. 版本历史
  await page.locator('div[role="menubar"] [data-menu="file"]').click();
  await page.getByRole("menu").getByRole("menuitem", { name: "版本历史" }).click();
  await page.waitForTimeout(500);
  await shot(page, 6);
  await page.keyboard.press("Escape");

  // 8. 暗色主题
  await page.getByTitle("切换到深色模式").click();
  await page.waitForTimeout(300);
  await shot(page, 7);

  // 9. 回到亮色并取消选择
  await page.getByTitle("切换到浅色模式").click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await shot(page, 8);

  // 10. 最终画布
  await page.waitForTimeout(300);
  await shot(page, 9);
});
