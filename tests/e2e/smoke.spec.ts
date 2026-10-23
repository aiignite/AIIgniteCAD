/**
 * 端到端冒烟：登录 → 画线 → 标注 → 导出 DXF → 刷新恢复
 *
 * 所有 API 由 fixtures/apiMock 在浏览器内拦截并保持状态，
 * 因此无需数据库、后端进程或 LLM Key 即可在 CI 中运行。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installApiMock, TEST_USER, type ApiMock } from "./fixtures/apiMock";

test.setTimeout(60_000);

async function openLoggedInApp(page: Page): Promise<ApiMock> {
  const api = await installApiMock(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("auth_token", "e2e-token");
  });
  await page.goto("/");
  await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
  return api;
}

async function openFileMenu(page: Page, item: string): Promise<void> {
  await page.locator('header [data-action="file-menu"]').click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function createDrawing(page: Page, name: string): Promise<void> {
  await page.getByText("新建图纸", { exact: true }).click();
  await page.getByPlaceholder("图纸名称，例如：装配图").fill(name);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeHidden();
  await expect(page.locator("#drawing-surface svg")).toBeVisible();
  await expect(
    page.locator("header").getByText(name, { exact: true }),
  ).toBeVisible();
}

async function canvasBox(page: Page) {
  const box = await page.locator("#drawing-surface svg").boundingBox();
  if (!box) throw new Error("Drawing surface is not visible");
  return box;
}

/** 在画布上从 A 拖到 B 画一条直线，返回绘制后的 line 数量 */
async function drawLine(page: Page): Promise<number> {
  const svg = page.locator("#drawing-surface svg");
  const before = await svg.locator("line").count();
  await page.locator('[data-tool="LINE"]').click();

  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(svg.locator("line")).toHaveCount(before + 1);
  return before + 1;
}

test("登录后进入欢迎界面并保存 token", async ({ page }) => {
  const api = await installApiMock(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await page.getByLabel("邮箱地址").fill(TEST_USER.email);
  await page.getByLabel("密码", { exact: true }).fill("e2e-secret");
  await page.getByRole("button", { name: /登录/ }).click();

  await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
  await expect(page.getByText(`你好，${TEST_USER.username}！`)).toBeVisible();
  expect(api.state.loginAttempts).toBe(1);

  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  expect(token).toBe("e2e-token");
});

test("语言默认中文，可切换英文并在刷新后保持", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Language Drawing");

  await expect(page.getByRole("button", { name: /切换语言/ })).toBeVisible();
  await expect(page.locator('header [data-action="file-menu"]')).toContainText("文件");

  await page.getByRole("button", { name: /切换语言/ }).click();
  await expect(page.locator('header [data-action="file-menu"]')).toContainText("File");
  await expect(
    page.locator("header button").filter({ hasText: "Export" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText("Welcome to AI Ignite CAD")).toBeVisible();
  await expect(page.getByText("New drawing", { exact: true })).toBeVisible();
});

test("在画布上绘制直线", async ({ page }) => {
  const api = await openLoggedInApp(page);
  await createDrawing(page, "Line Drawing");

  await drawLine(page);

  await expect.poll(() => api.state.projects.size).toBe(1);
  await expect(
    page.locator("#drawing-surface svg").locator("line"),
  ).toHaveCount(3);
});

test("导入 DWG 时调用转换接口并把图元写入画布", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "DWG Drawing");

  const svg = page.locator("#drawing-surface svg");
  const before = await svg.locator("line").count();

  await page.locator('input[type="file"]').setInputFiles({
    name: "plan.dwg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("AC1027\x00\x00\x00\x00payload", "binary"),
  });

  await expect(svg.locator("line")).toHaveCount(before + 1);
  await expect(page.getByText(/已导入 plan\.dwg/)).toBeVisible();
});

test("添加尺寸标注", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Dimension Drawing");

  await page.getByTitle("更多工具").click();
  await page.locator('[data-tool="DIMENSION"]').click();
  await expect(page.getByText("标注 · 指定标注起点")).toBeVisible();

  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);

  const svg = page.locator("#drawing-surface svg");
  await expect(svg.locator("text")).toHaveCount(1);
  const label = await svg.locator("text").textContent();
  expect(Number(label)).toBeGreaterThan(0);
});

/** 读取一条 SVG 直线图元的端点（世界坐标） */
async function lineEnds(locator: Locator): Promise<[number, number, number, number]> {
  const attrs = await Promise.all(
    (["x1", "y1", "x2", "y2"] as const).map(name => locator.getAttribute(name)),
  );
  return attrs.map(value => Number(value)) as [number, number, number, number];
}

/** 画布上第一个图元渲染在世界坐标轴（两条 line）之后 */
function firstElementLine(page: Page) {
  return page.locator("#drawing-surface svg").locator("line").nth(2);
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

test("动态输入：首次点击留住锚点，键入长度后回车成线", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Dynamic Input Drawing");

  const svg = page.locator("#drawing-surface svg");
  const box = await canvasBox(page);
  const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 };

  await page.locator('[data-tool="LINE"]').click();
  await page.mouse.click(start.x, start.y);
  await expect(page.getByText("直线 · 指定下一点")).toBeVisible();

  await page.mouse.move(start.x + 120, start.y + 8);
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");

  await expect(svg.locator("line")).toHaveCount(3);
  const [x1, y1, x2, y2] = await lineEnds(firstElementLine(page));
  expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(100, 3);

  // 预选高亮：选择工具下光标经过图元即变浅蓝，与选中态的黄色区分
  await page.locator('[data-tool="SELECT"]').click();
  const mid = await worldToScreen(page, (x1 + x2) / 2, (y1 + y2) / 2);
  await page.mouse.move(mid.x, mid.y);
  await expect(firstElementLine(page)).toHaveCSS("stroke", "rgb(56, 189, 248)");
});

test("极轴追踪把接近水平方向的点吸附到 0°", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Polar Drawing");

  const box = await canvasBox(page);
  const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 };

  // 栅格会把点量化到 50 单位，先关闭才能验证纯角度吸附
  await page.getByRole("button", { name: "栅格" }).click();
  await page.getByRole("button", { name: "极轴" }).click();
  await page.locator('[data-tool="LINE"]').click();

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y + 8, { steps: 6 });
  await page.mouse.up();

  const [x1, y1, x2, y2] = await lineEnds(firstElementLine(page));
  expect(x2).toBeGreaterThan(x1);
  expect(y2).toBe(y1);
});

test("导出 DXF 文件", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Export Drawing");
  await drawLine(page);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("header button").filter({ hasText: "导出" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.dxf$/);
  const filePath = await download.path();
  if (!filePath) throw new Error("DXF download has no local path");
  const content = await readFile(filePath, "utf8");

  expect(content).toContain("ENTITIES");
  expect(content).toContain("LINE");
});

test("图框打印预览包含图元并可调用浏览器打印", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Plot Drawing");
  await drawLine(page);

  await openFileMenu(page, "打印 / 绘图");
  const dialog = page.getByRole("dialog", { name: "打印与绘图" });
  await expect(dialog).toBeVisible();

  const sheet = dialog.locator("#plot-sheet");
  await expect(sheet).toHaveAttribute("aria-label", /Plot sheet A3/);
  await expect(
    sheet.locator('[data-plot-elements="true"] line'),
  ).toHaveCount(1);

  await page.getByLabel("纸张尺寸").selectOption("A4");
  await page.getByLabel("方向").selectOption("portrait");
  await expect(sheet).toHaveAttribute("aria-label", /Plot sheet A4/);

  await page.evaluate(() => {
    (window as any).__printCalls = 0;
    window.print = () => {
      (window as any).__printCalls += 1;
    };
  });
  await page.getByRole("button", { name: "打印 / 另存 PDF" }).click();
  expect(await page.evaluate(() => (window as any).__printCalls)).toBe(1);

  // 打印媒体下只保留图框，应用本体必须隐藏
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".plot-print-root")).toBeVisible();
  await expect(page.locator("#root")).toBeHidden();

  // A4 纵向：210×297mm ≈ 595×842pt；验证 @page 尺寸真正进入 PDF
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const pdfText = pdf.toString("latin1");
  const mediaBox = pdfText.match(
    /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/,
  );
  expect(mediaBox).not.toBeNull();
  expect(Number(mediaBox?.[1])).toBeCloseTo((210 * 72) / 25.4, 0);
  expect(Number(mediaBox?.[2])).toBeCloseTo((297 * 72) / 25.4, 0);

  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: "关闭打印设置" }).click();
  await expect(dialog).toBeHidden();
});

test("版本历史可保存、对比并恢复", async ({ page }) => {
  const api = await openLoggedInApp(page);
  await createDrawing(page, "Version Drawing");
  const firstCount = await drawLine(page);

  await openFileMenu(page, "版本历史");
  const dialog = page.getByRole("dialog", { name: "版本历史" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("版本名称").fill("Baseline line");
  await page.getByRole("button", { name: "保存版本" }).click();
  await expect(dialog.getByText("Baseline line").first()).toBeVisible();
  await expect(dialog.getByText("v1", { exact: true }).first()).toBeVisible();

  const projectId = [...api.state.projects.keys()][0];
  expect(api.state.versions.get(projectId)?.[0]?.elementCount).toBe(1);

  await page.getByRole("button", { name: "关闭版本历史" }).click();
  await expect(dialog).toBeHidden();

  await drawLine(page);

  await openFileMenu(page, "版本历史");
  await expect(dialog).toBeVisible();
  await page.getByLabel("对比版本 v1").check();
  await expect(dialog.getByText("当前 → v1")).toBeVisible();

  await page.getByRole("button", { name: "恢复此版本" }).click();
  await page.locator('[data-action="restore-confirm"]').click();
  await expect(dialog).toBeHidden();

  const svg = page.locator("#drawing-surface svg");
  await expect(svg.locator("line")).toHaveCount(firstCount);

  // 恢复写入撤销历史，可立即用 Ctrl+Z 回到恢复前
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(svg.locator("line")).toHaveCount(firstCount + 1);
});

test("刷新后从服务端恢复图纸", async ({ page }) => {
  const api = await openLoggedInApp(page);
  await createDrawing(page, "Persistent Drawing");
  await drawLine(page);

  await page.locator('header button[title="保存"]').click();
  await expect.poll(() => api.state.elementSaves).toBeGreaterThan(0);
  await expect
    .poll(() => [...api.state.projects.values()][0]?.elements.length ?? 0)
    .toBe(1);

  await page.reload();
  await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
  await page.getByText("Persistent Drawing", { exact: true }).click();

  const svg = page.locator("#drawing-surface svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("line")).toHaveCount(3);
  await expect(
    page.locator("header").getByText("Persistent Drawing", { exact: true }),
  ).toBeVisible();
});

test("选中集迷你工具栏：切换工具、问 AI 草稿与删除", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Selection Bar");
  const lineCount = await drawLine(page);
  await page.locator('[data-tool="SELECT"]').click();

  const svg = page.locator("#drawing-surface svg");
  const [x1, y1, x2, y2] = await lineEnds(firstElementLine(page));
  const from = await worldToScreen(page, Math.min(x1, x2) - 40, Math.min(y1, y2) - 40);
  const to = await worldToScreen(page, Math.max(x1, x2) + 40, Math.max(y1, y2) + 40);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();

  const askAI = page.locator('main [data-action="ask-ai"]');
  await expect(askAI).toBeVisible();

  // 工具按钮沿用工具态：切到旋转后迷你工具栏让位，Esc 回到选择再出现
  await page.locator('main [data-tool="ROTATE"]').click();
  await expect(askAI).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(askAI).toBeVisible();

  // 问 AI：切到对话面板，选择集摘要作为草稿写进输入框，用户改完再发
  await askAI.click();
  await expect(page.getByPlaceholder(/让 AI 画图/)).toHaveValue(
    /检查选中的 1 个图元（LINE ×1）/,
  );

  await page.locator('main [data-action="delete"]').click();
  await expect(page.getByText("已删除 1 个图元 · Ctrl+Z 可撤销")).toBeVisible();
  await expect(svg.locator("line")).toHaveCount(lineCount - 1);
  await expect(askAI).toHaveCount(0);
});

test("隔离与选择同类：临时隐藏集只影响屏幕显示", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Isolation");

  const svg = page.locator("#drawing-surface svg");
  const box = await canvasBox(page);

  /** 画一条不重叠的直线，便于分别点选 */
  const drawAt = async (
    from: [number, number],
    to: [number, number],
  ) => {
    await page.locator('[data-tool="LINE"]').click();
    await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 6 });
    await page.mouse.up();
  };
  const runCommand = async (command: string) => {
    const input = page.getByPlaceholder(/输入命令/);
    await input.click();
    await input.fill(command);
    await input.press("Enter");
  };

  await drawAt([0.2, 0.3], [0.42, 0.3]);
  await drawAt([0.55, 0.62], [0.78, 0.62]);
  // 两条坐标轴 + 两条直线
  await expect(svg.locator("line")).toHaveCount(4);

  await page.locator('[data-tool="SELECT"]').click();
  const [ax1, ay1, ax2, ay2] = await lineEnds(firstElementLine(page));
  const aMid = await worldToScreen(page, (ax1 + ax2) / 2, (ay1 + ay2) / 2);
  await page.mouse.click(aMid.x, aMid.y);

  await runCommand("SSI");
  await expect(page.getByText("Selected 2 similar objects")).toBeVisible();
  await expect(page.locator("footer").getByText(/已选 2 个/)).toBeVisible();

  // 点选已选中的图元不会缩小选择集，先点空白清空再单选
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9);
  await page.mouse.click(aMid.x, aMid.y);
  await runCommand("ISOLATE");
  await expect(page.getByText("Isolated 1 objects")).toBeVisible();
  await expect(svg.locator("line")).toHaveCount(3);

  const badge = page.locator('footer [data-action="show-all-objects"]');
  await expect(badge).toHaveText("已隐藏 1");
  await badge.click();
  await expect(svg.locator("line")).toHaveCount(4);
  await expect(badge).toHaveCount(0);
});

test("快速选择：按类型过滤并实时预览命中数量", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Quick Select");

  const svg = page.locator("#drawing-surface svg");
  const box = await canvasBox(page);

  await page.locator('[data-tool="LINE"]').click();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 6 });
  await page.mouse.up();

  await page.locator('[data-tool="CIRCLE"]').click();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7, { steps: 6 });
  await page.mouse.up();

  await expect(svg.locator("circle")).toHaveCount(1);

  const input = page.getByPlaceholder(/输入命令/);
  await input.click();
  await input.fill("QSELECT");
  await input.press("Enter");

  const modal = page.locator('[data-action="quick-select-modal"]');
  await expect(modal).toBeVisible();
  const counter = modal.locator('[data-action="quick-select-count"]');
  await expect(counter).toHaveText("将选中 2 个图元");

  // 勾选类型后命中数量实时收敛
  await modal.locator('button[data-value="LINE"]').click();
  await expect(counter).toHaveText("将选中 1 个图元");

  await modal.locator('[data-action="quick-select-apply"]').click();
  await expect(page.getByText("已选中 1 个图元")).toBeVisible();
  await page.locator('[data-tool="SELECT"]').click();
  await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();
});

test("迷你导航图：点击即把视口移到对应位置", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "MiniMap");

  const svg = page.locator("#drawing-surface svg");
  await drawLine(page);

  const minimap = page.locator('[data-action="minimap"]');
  await expect(minimap).toBeVisible();
  await expect(minimap.locator('[data-action="minimap-viewport"]')).toHaveCount(1);

  const before = await svg.getAttribute("viewBox");
  const box = await minimap.boundingBox();
  if (!box) throw new Error("Minimap is not visible");

  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await expect.poll(async () => svg.getAttribute("viewBox")).not.toBe(before);
});

test("视图命令：ZOOM 取景与命名视图不改变文档", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "View Commands");

  const svg = page.locator("#drawing-surface svg");
  const runCommand = async (command: string) => {
    const input = page.getByPlaceholder(/输入命令/);
    await input.click();
    await input.fill(command);
    await input.press("Enter");
  };
  const currentViewBox = async () => (await svg.getAttribute("viewBox")) ?? "";

  await drawLine(page);
  const initial = await currentViewBox();

  await runCommand("ZOOM E");
  await expect(page.getByText("Zoom to extents")).toBeVisible();
  const extents = await currentViewBox();
  expect(extents).not.toBe(initial);

  await runCommand("VIEW SAVE 俯视图");
  await expect(page.getByText("Saved view: 俯视图")).toBeVisible();

  await runCommand("VIEW LIST");
  await expect(page.getByText("Named views: 俯视图")).toBeVisible();

  await runCommand("ZOOM W 0 0 50 50");
  await expect(page.getByText("Zoom to window")).toBeVisible();
  expect(await currentViewBox()).not.toBe(extents);

  await runCommand("VIEW RESTORE 俯视图");
  await expect(page.getByText("Restored view: 俯视图")).toBeVisible();
  await expect.poll(currentViewBox).toBe(extents);

  // 视图类操作不占撤销步骤：一次撤销直接回到画线之前
  await page.getByPlaceholder(/输入命令/).blur();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(svg.locator("line")).toHaveCount(2);
});

test("F 键切换绘图辅助，命令行空回车重复上一条命令", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Keyboard Shortcuts");
  const grid = page.locator('#drawing-surface svg rect[fill="url(#grid)"]');
  const footer = page.locator("footer");
  await expect(grid).toHaveCount(1);

  await page.keyboard.press("F7");
  await expect(grid).toHaveCount(0);
  await expect(page.getByText("栅格 已关闭")).toBeVisible();
  await page.keyboard.press("F7");
  await expect(grid).toHaveCount(1);

  const command = page.getByPlaceholder(/输入命令/);
  await command.click();
  await command.fill("LINE");
  await command.press("Enter");
  await expect(footer.getByText(/直线 · 指定起点/)).toBeVisible();

  await page.locator('[data-tool="SELECT"]').click();
  await expect(footer.getByText(/选择 · 点击选择/)).toBeVisible();

  // 空回车重复上一条命令
  await command.click();
  await command.press("Enter");
  await expect(footer.getByText(/直线 · 指定起点/)).toBeVisible();
});

test("点击循环：重叠图元在同一位置重复点击可切换", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Click Cycle");

  const svg = page.locator("#drawing-surface svg");
  const box = await canvasBox(page);

  // 关闭栅格，避免图元被量化到网格后与点击位置错开
  await page.getByRole("button", { name: "栅格" }).click();

  const drawLineTo = async (fromX: number, fromY: number, toX: number, toY: number) => {
    await page.locator('[data-tool="LINE"]').click();
    await page.mouse.move(box.x + box.width * fromX, box.y + box.height * fromY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * toX, box.y + box.height * toY, {
      steps: 6,
    });
    await page.mouse.up();
  };

  // 两条相交的直线，后画的竖线在上层；交点刻意避开两条线的中点（夹点）
  await drawLineTo(0.15, 0.3, 0.85, 0.3);
  await drawLineTo(0.3, 0.1, 0.3, 0.9);
  await expect(svg.locator("line")).toHaveCount(4);

  // 两条坐标轴 + 横线 + 竖线
  const horizontal = svg.locator("line").nth(2);
  const vertical = svg.locator("line").nth(3);

  await page.locator('[data-tool="SELECT"]').click();
  const cross = {
    x: box.x + box.width * 0.3,
    y: box.y + box.height * 0.3,
  };

  // 连续两次点击同一位置：第一次命中最上层，第二次循环到下层
  await page.mouse.click(cross.x, cross.y);
  await page.mouse.click(cross.x, cross.y);
  await expect(horizontal).toHaveAttribute("stroke-dasharray", "5,2");
  await expect(vertical).not.toHaveAttribute("stroke-dasharray", "5,2");

  // 循环窗口之外再单击一次：重新命中最上层
  await page.waitForTimeout(400);
  await page.mouse.click(cross.x, cross.y);
  await expect(vertical).toHaveAttribute("stroke-dasharray", "5,2");
});

test("工具栏分组：高频工具常驻，低频工具按分组收进溢出菜单", async ({ page }) => {
  await openLoggedInApp(page);
  await createDrawing(page, "Toolbar Groups");

  const toolbar = page.locator("aside");
  await expect(toolbar.locator('[data-tool="LINE"]')).toBeVisible();
  await expect(toolbar.locator('[data-tool="TRIM"]')).toBeVisible();

  await page.getByTitle("更多工具").click();
  const overflow = page.locator('[data-action="tool-overflow"]');
  await expect(overflow).toBeVisible();

  // 四类分组都在溢出菜单里
  for (const group of ["draw", "modify", "annotate", "parametric"]) {
    await expect(overflow.locator(`[data-group="${group}"]`)).toHaveCount(1);
  }

  // 低频工具从这里进入
  await expect(overflow.locator('[data-tool="ARRAY"]')).toBeVisible();
  await overflow.locator('[data-tool="ARRAY"]').click();
  await expect(overflow).toBeHidden();
  await expect(page.locator("footer").getByText(/阵列/)).toBeVisible();
});

test("欢迎页：三步上手与内置示例可直接打开", async ({ page }) => {
  await openLoggedInApp(page);

  await expect(page.getByText("三步上手")).toBeVisible();
  await expect(page.getByText("示例图纸")).toBeVisible();
  await expect(page.locator('[data-example="gear"]')).toBeVisible();

  await page.locator('[data-example="gear"]').click();
  await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeHidden();
  await expect(page.locator("header").getByText("齿轮.dxf", { exact: true })).toBeVisible();

  const svg = page.locator("#drawing-surface svg");
  // 齿轮示例包含外轮廓多段线与 6 个圆（中心孔、节圆、4 个减重孔）
  await expect(svg.locator("circle")).toHaveCount(6);
  await expect(svg.locator("polygon")).toHaveCount(1);
  await expect(svg.getByText("GEAR m=2 z=20")).toBeVisible();
});
