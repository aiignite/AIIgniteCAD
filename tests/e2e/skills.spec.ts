/**
 * 技能编辑器端到端：Playbook 字段可创建、回填并更新版本号。
 * 技能接口在浏览器内拦截，不依赖后端与数据库。
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

test.setTimeout(60_000);

interface MockSkill {
    id: string;
    code: string;
    name: string;
    description: string;
    category: string;
    promptTemplate: string;
    toolNames: string[];
    selectionTypes: string[];
    keywords: string[];
    steps: Array<{ title: string; detail?: string; tool?: string }>;
    checks: string[];
    examples: string[];
    requiredContext: string[];
    negativeKeywords: string[];
    version: number;
    priority: number;
    isEnabled: boolean;
    isSystem: boolean;
    userId: string | null;
    updatedAt: string;
}

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });

async function installSkillMock(page: Page) {
    const state: { skills: MockSkill[]; created: any[]; updated: any[] } = {
        skills: [],
        created: [],
        updated: [],
    };

    await page.route("**/api/skills**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const method = request.method();

        if (path === "/api/skills" && method === "GET") {
            return json(route, 200, { skills: state.skills });
        }
        if (path === "/api/skills" && method === "POST") {
            const body = request.postDataJSON();
            state.created.push(body);
            const skill: MockSkill = {
                id: "skill-e2e-1",
                code: body.code ?? "user-e2e-playbook",
                name: body.name,
                description: body.description ?? "",
                category: body.category ?? "Custom",
                promptTemplate: body.promptTemplate,
                toolNames: body.toolNames ?? [],
                selectionTypes: body.selectionTypes ?? [],
                keywords: body.keywords ?? [],
                steps: body.steps ?? [],
                checks: body.checks ?? [],
                examples: body.examples ?? [],
                requiredContext: body.requiredContext ?? [],
                negativeKeywords: body.negativeKeywords ?? [],
                version: 1,
                priority: body.priority ?? 50,
                isEnabled: body.isEnabled ?? true,
                isSystem: false,
                userId: "user-1",
                updatedAt: new Date().toISOString(),
            };
            state.skills = [skill];
            return json(route, 201, { skill });
        }
        if (path.startsWith("/api/skills/") && method === "PUT") {
            const body = request.postDataJSON();
            state.updated.push(body);
            const existing = state.skills[0];
            const skill: MockSkill = { ...existing, ...body, version: existing.version + 1 };
            state.skills = [skill];
            return json(route, 200, { skill });
        }
        return json(route, 404, { error: "Not Found" });
    });

    return state;
}

async function openSkillsPanel(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("Skill Playbook");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();

    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    const assistantPanel = page.getByRole("dialog", { name: "AI 助手" });
    await expect(assistantPanel).toBeVisible();
    await assistantPanel.getByRole("button", { name: "技能管理" }).click();
    await expect(page.getByRole("dialog", { name: "技能抽屉" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建技能" })).toBeVisible();
}

test("技能编辑器保存 steps/checks/examples 并在更新后递增版本", async ({ page }) => {
    await installApiMock(page);
    const state = await installSkillMock(page);
    await openSkillsPanel(page);

    await page.getByRole("button", { name: "新建技能" }).click();
    await page.getByLabel("技能名称").fill("标注审查");
    await page.getByLabel("技能代码").fill("dimension-review");
    await page.getByLabel("提示词模板").fill("先测量再标注，审查时只读。");
    await page.getByLabel("关键词", { exact: true }).fill("标注, 审查");
    await page.getByLabel("反关键词", { exact: true }).fill("三维, 渲染");
    await page
        .getByLabel("执行步骤")
        .fill(
            "确定对象 | 优先使用 selectedIds | query_elements\n执行标注 | 使用真实测量值 | draw_dimension",
        );
    await page.getByLabel("完成检查").fill("标注值与实际距离一致\n只读任务不修改图元");
    await page.getByLabel("示例请求").fill("给这条线加尺寸\n检查缺哪些标注");
    await page.getByRole("button", { name: "选择集", exact: true }).click();

    await page.getByRole("button", { name: "创建", exact: true }).click();

    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
        name: "标注审查",
        code: "dimension-review",
        keywords: ["标注", "审查"],
        negativeKeywords: ["三维", "渲染"],
        requiredContext: ["selection"],
        steps: [
            { title: "确定对象", detail: "优先使用 selectedIds", tool: "query_elements" },
            { title: "执行标注", detail: "使用真实测量值", tool: "draw_dimension" },
        ],
        checks: ["标注值与实际距离一致", "只读任务不修改图元"],
        examples: ["给这条线加尺寸", "检查缺哪些标注"],
    });

    await expect(page.getByText("标注审查", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/v1/).first()).toBeVisible();
    await expect(page.getByText("2 步", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("技能名称")).toHaveValue("标注审查");
    await expect(page.getByLabel("执行步骤")).toHaveValue(
        "确定对象 | 优先使用 selectedIds | query_elements\n执行标注 | 使用真实测量值 | draw_dimension",
    );
    await expect(page.getByLabel("完成检查")).toHaveValue(
        "标注值与实际距离一致\n只读任务不修改图元",
    );

    await page.getByLabel("技能名称").fill("标注审查 v2");
    await page
        .getByTestId("ai-assistant-window")
        .getByRole("button", { name: "保存" })
        .first()
        .click();

    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]).toMatchObject({
        name: "标注审查 v2",
        requiredContext: ["selection"],
    });
    await expect(page.getByText("标注审查 v2", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/v2/).first()).toBeVisible();
});

const seedSkill = (overrides: Partial<MockSkill> = {}): MockSkill => ({
    id: "skill-e2e-seed",
    code: "dimension-review",
    name: "标注审查",
    description: "只读审查流程",
    category: "mechanical",
    promptTemplate: "先测量再标注，审查时只读。",
    toolNames: ["query_elements", "measure_geometry"],
    selectionTypes: [],
    keywords: ["标注"],
    steps: [{ title: "确定对象", detail: "优先使用 selectedIds", tool: "query_elements" }],
    checks: ["标注值与实际距离一致"],
    examples: ["给这条线加尺寸"],
    requiredContext: ["selection"],
    negativeKeywords: ["三维"],
    version: 2,
    priority: 50,
    isEnabled: true,
    isSystem: false,
    userId: "user-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
});

test("技能可导出为 JSON，导入时校验并避让重复代码", async ({ page }) => {
    await installApiMock(page);
    const state = await installSkillMock(page);
    state.skills = [seedSkill()];
    await openSkillsPanel(page);

    const downloadPromise = page.waitForEvent("download");
    await page
        .getByTestId("ai-assistant-window")
        .getByRole("button", { name: "导出", exact: true })
        .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("dimension-review.aiignite-skill.json");

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(payload.kind).toBe("aiignite-skill");
    expect(payload.skill.code).toBe("dimension-review");
    expect(payload.skill.toolNames).toEqual(["query_elements", "measure_geometry"]);

    await page.setInputFiles('input[aria-label="导入技能文件"]', {
        name: "dimension-review.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(payload)),
    });

    await expect(page.getByText("导入预览", { exact: true })).toBeVisible();
    await expect(page.getByText(/dimension-review-copy/)).toBeVisible();

    await page.getByRole("button", { name: "确认导入" }).click();

    await expect.poll(() => state.created.length).toBe(1);
    expect(state.created[0]).toMatchObject({
        name: "标注审查",
        code: "dimension-review-copy",
        promptTemplate: "先测量再标注，审查时只读。",
        toolNames: ["query_elements", "measure_geometry"],
        requiredContext: ["selection"],
    });
});

test("导入非法技能文件时被拒绝并提示原因", async ({ page }) => {
    await installApiMock(page);
    const state = await installSkillMock(page);
    await openSkillsPanel(page);

    await page.setInputFiles('input[aria-label="导入技能文件"]', {
        name: "broken.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ kind: "aiignite-skill", version: 1, skill: {} })),
    });

    await expect(page.getByText(/技能文件校验失败/)).toBeVisible();
    await expect(page.getByText("导入预览", { exact: true })).toHaveCount(0);
    expect(state.created).toHaveLength(0);
});
