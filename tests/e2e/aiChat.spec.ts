/**
 * AI Agent 端到端：SSE 回合 → 技能 chip → 工具时间线 → 画布幽灵预览 → 确认写入 → 撤销 → 刷新恢复历史
 *
 * /api/llm/chat 由 page.route 直接返回一段 SSE 文本，因此不需要后端进程与 LLM Key；
 * 会话与消息在 mock 内存里落库，用于验证"切图/刷新不串历史"。
 */

import { expect as baseExpect, test, type Page, type Route } from "@playwright/test";
import { installApiMock } from "./fixtures/apiMock";

// 首轮对话要等 Vite 按需编译聊天面板，续轮回传还要再跑一次 HTTP，默认 5s 断言超时不够
const expect = baseExpect.configure({ timeout: 30_000 });

test.setTimeout(60_000);

const SESSION_ID = "session-e2e-1";
const SKILL_NAME = "机械制图规范";

const drawCircleCall = {
    id: "call-circle",
    name: "draw_circle",
    arguments: { cx: 300, cy: 200, radius: 60 },
};

const frame = (event: string, payload: Record<string, unknown>) =>
    `data: ${JSON.stringify({ event, ...payload })}\n\n`;

/** 服务端落库行的最小副本，字段与 ChatLogMessage 对齐 */
interface MockChatRow {
    id: string;
    sessionId: string;
    senderType: "user" | "ai";
    messageType: "text" | "action";
    content: string;
    metadata: {
        feedback?: { rating: "up" | "down"; reason?: string; at: string };
        feedbackSkillCodes?: string[];
    } | null;
    role: "user" | "assistant" | "tool";
    clientMessageId: string | null;
    toolCallId: string | null;
    toolName: string | null;
    toolCalls: unknown[] | null;
    promptTokens: number | null;
    completionTokens: number | null;
    status: string;
    createdAt: string;
}

interface ChatMock {
    rows: MockChatRow[];
    requests: Array<{ phase: string; round: number; toolResults?: unknown[] }>;
    outcomes: Array<{ outcome: string; reason?: string; changedIds?: string[] }>;
    feedback: Array<{ rating: string; reason?: string; skillCodes?: string[] }>;
}

async function installChatMock(page: Page): Promise<ChatMock> {
    const chat: ChatMock = { rows: [], requests: [], outcomes: [], feedback: [] };
    const sessionInfo = {
        id: SESSION_ID,
        projectId: "project-1",
        title: "AI 会话",
        assistantId: null,
        modelId: null,
        messageCount: 0,
        hasSummary: false,
        createdAt: "2026-01-01T08:00:00.000Z",
        updatedAt: "2026-01-01T08:00:00.000Z",
    };

    const json = (route: Route, body: unknown) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(body),
        });

    const addRow = (row: Partial<MockChatRow> & { id: string }) => {
        chat.rows.push({
            sessionId: SESSION_ID,
            senderType: "ai",
            messageType: "text",
            content: "",
            metadata: null,
            role: "assistant",
            clientMessageId: null,
            toolCallId: null,
            toolName: null,
            toolCalls: null,
            promptTokens: null,
            completionTokens: null,
            status: "ok",
            createdAt: new Date().toISOString(),
            ...row,
        });
    };

    await page.route("**/api/chat/sessions/*/active", (route) =>
        json(route, { session: chat.rows.length > 0 ? sessionInfo : null }),
    );
    await page.route("**/api/chat/sessions/*/messages*", (route) =>
        json(route, {
            messages: chat.rows,
            hasMore: false,
            nextCursor: null,
            sessionId: SESSION_ID,
            projectId: "project-1",
        }),
    );
    await page.route("**/api/chat/sessions?*", (route) =>
        json(route, {
            sessions:
                chat.rows.length > 0 ? [{ ...sessionInfo, messageCount: chat.rows.length }] : [],
            hasMore: false,
            nextCursor: null,
        }),
    );
    await page.route("**/api/chat/turns/*/outcome", (route) => {
        const body = route.request().postDataJSON() as ChatMock["outcomes"][number];
        chat.outcomes.push(body);
        return json(route, { recorded: true });
    });

    await page.route("**/api/chat/turns/*/feedback", (route) => {
        const body = route.request().postDataJSON() as {
            turnId: string;
            rating: "up" | "down";
            reason?: string;
            skillCodes?: string[];
        };
        chat.feedback.push({
            rating: body.rating,
            reason: body.reason,
            skillCodes: body.skillCodes,
        });
        const target = [...chat.rows]
            .reverse()
            .find(
                (row) =>
                    row.role === "assistant" &&
                    row.clientMessageId?.startsWith(`${body.turnId}:`),
            );
        if (target) {
            target.metadata = {
                feedback: {
                    rating: body.rating,
                    ...(body.reason ? { reason: body.reason } : {}),
                    at: new Date().toISOString(),
                },
                ...(body.skillCodes?.length ? { feedbackSkillCodes: body.skillCodes } : {}),
            };
        }
        return json(route, { recorded: Boolean(target), messageId: target?.id });
    });

    await page.route("**/api/llm/chat", (route) => {
        const body = route.request().postDataJSON() as {
            turnId: string;
            round: number;
            phase: string;
            message?: string;
            toolResults?: Array<{ toolCallId: string; ok: boolean; summary?: string }>;
        };
        chat.requests.push(body);
        const { turnId } = body;

        if (body.phase === "user_turn") {
            addRow({
                id: `${turnId}-user`,
                senderType: "user",
                role: "user",
                content: body.message ?? "",
                clientMessageId: turnId,
            });
            addRow({
                id: `${turnId}-r0`,
                role: "assistant",
                content: `已匹配${SKILL_NAME}，先画一个圆。`,
                clientMessageId: `${turnId}:r0:assistant`,
                toolCalls: [drawCircleCall],
                promptTokens: 900,
                completionTokens: 40,
            });
            const events = [
                frame("trace_start", {
                    traceId: "trace-e2e",
                    sessionId: SESSION_ID,
                    turnId,
                    round: 0,
                    provider: "openai",
                    modelRowId: "model-e2e",
                    modelId: "gpt-4o-mini",
                }),
                frame("context", {
                    chars: 480,
                    historyMessages: 0,
                    dropped: 0,
                    hasSummary: false,
                    toolsEnabled: true,
                    allowedTools: ["draw_circle"],
                    skillCodes: ["mech-draft"],
                }),
                frame("skill_activated", {
                    code: "mech-draft",
                    name: SKILL_NAME,
                    score: 0.82,
                    reasons: ["关键词：圆"],
                    category: "制图",
                    tools: ["draw_circle"],
                }),
                frame("content", { content: `已匹配${SKILL_NAME}，先画一个圆。` }),
                frame("tool_call", { toolCall: drawCircleCall }),
                frame("usage", {
                    promptTokens: 900,
                    completionTokens: 40,
                    reported: true,
                    costUsd: 0.0021,
                    provider: "openai",
                    modelId: "gpt-4o-mini",
                }),
                frame("done", {
                    traceId: "trace-e2e",
                    sessionId: SESSION_ID,
                    messageId: `${turnId}-r0`,
                    turnId,
                    round: 0,
                    finishReason: "tool_calls",
                    nextPhase: "tool_results",
                }),
            ].join("");
            return route.fulfill({
                status: 200,
                contentType: "text/event-stream",
                body: `: ping\n\n${events}`,
            });
        }

        // 第二轮：浏览器已本地求值，服务端只需收尾
        // 服务端把续轮回传的结果归到提议它的那一轮，与 llmChat.ts 的 clientMessageId 一致
        const resultRound = Math.max(0, body.round - 1);
        for (const result of body.toolResults ?? []) {
            addRow({
                id: `${turnId}-tool-${result.toolCallId}`,
                role: "tool",
                content: result.summary ?? "已执行",
                clientMessageId: `${turnId}:r${resultRound}:tool:${result.toolCallId}`,
                toolCallId: result.toolCallId,
                toolName: drawCircleCall.name,
                status: result.ok ? "ok" : "rejected",
            });
        }
        addRow({
            id: `${turnId}-r1`,
            role: "assistant",
            content: "圆已画好，请在预览中确认。",
            clientMessageId: `${turnId}:r1:assistant`,
            promptTokens: 950,
            completionTokens: 25,
        });
        return route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: [
                frame("trace_start", {
                    traceId: "trace-e2e",
                    sessionId: SESSION_ID,
                    turnId,
                    round: body.round,
                    provider: "openai",
                    modelRowId: "model-e2e",
                    modelId: "gpt-4o-mini",
                }),
                frame("content", { content: "圆已画好，请在预览中确认。" }),
                frame("usage", {
                    promptTokens: 950,
                    completionTokens: 25,
                    reported: true,
                    costUsd: 0.0009,
                    provider: "openai",
                    modelId: "gpt-4o-mini",
                }),
                frame("done", {
                    traceId: "trace-e2e",
                    sessionId: SESSION_ID,
                    messageId: `${turnId}-r1`,
                    turnId,
                    round: body.round,
                    finishReason: "stop",
                    nextPhase: null,
                }),
            ].join(""),
        });
    });

    return chat;
}

async function openChat(page: Page): Promise<ChatMock> {
    await installApiMock(page);
    const chat = await installChatMock(page);
    await page.addInitScript(() => {
        window.localStorage.setItem("auth_token", "e2e-token");
    });
    await page.goto("/");
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("新建图纸", { exact: true }).click();
    await page.getByPlaceholder("图纸名称，例如：装配图").fill("AI Chat Drawing");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator("#drawing-surface svg")).toBeVisible();
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toBeVisible();
    return chat;
}

test("AI 回合走工具循环、预览确认后写入画布并可撤销", async ({ page }) => {
    const chat = await openChat(page);
    const composer = page.getByPlaceholder(/让 AI 画图/);
    await expect(composer).toBeVisible();

    await composer.fill("在原点附近画一个半径 60 的圆");
    await composer.press("Enter");

    const bubble = page.locator(".markdown-body").first();
    await expect(bubble).toContainText("已匹配");
    await expect(page.getByTitle(SKILL_NAME)).toBeVisible();
    await expect(page.getByText("绘制圆 · (300,200) · 半径 60")).toBeVisible();
    await expect(page.getByTitle("已生效")).toBeVisible();
    await expect(page.getByText(/900 in · 40 out/)).toBeVisible();

    // 两轮 HTTP：第二轮携带前端本地求值结果
    await expect.poll(() => chat.requests.length).toBe(2);
    expect(chat.requests[1].phase).toBe("tool_results");
    expect(chat.requests[1].toolResults?.[0]).toMatchObject({
        toolCallId: "call-circle",
        ok: true,
    });

    const dialog = page.getByRole("dialog", { name: "AI 变更预览" });
    await expect(dialog).toBeVisible();
    const svg = page.locator("#drawing-surface svg");
    // 确认前只画幽灵层，真实图纸没有被写入
    const ghost = svg.locator("g[data-ai-ghost]");
    const ghostCircle = ghost.locator("circle");
    await expect(ghostCircle).toHaveCount(1);
    await expect(ghostCircle).toHaveAttribute("stroke", "#a78bfa");
    await expect(ghostCircle).toHaveAttribute("stroke-dasharray", "6,4");
    await expect(svg.locator("g:not([data-ai-ghost]) circle")).toHaveCount(0);

    // 收起为工具条后，可以在真实图纸上下文里核对落点
    await dialog.getByRole("button", { name: "在图纸中查看" }).click();
    const bar = page.getByRole("dialog", { name: "AI 幽灵预览" });
    await expect(bar).toBeVisible();
    await expect(bar.getByText("提议 1")).toBeVisible();
    await expect(ghostCircle).toHaveCount(1);
    await bar.getByRole("button", { name: "返回详情" }).click();

    await dialog.getByRole("button", { name: "应用变更" }).click();
    await expect(dialog).toBeHidden();
    // 落图的图元先脉冲一次，帮用户定位 AI 改在了哪里
    await expect(svg.locator("g.cad-ai-flash circle")).toHaveCount(1);
    await expect(svg.locator("g.cad-ai-flash")).toHaveCount(0);
    await expect(ghost).toHaveCount(0);
    await expect(svg.locator("circle")).toHaveCount(1);

    // 整批只占一步撤销
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(svg.locator("circle")).toHaveCount(0);
});

test("取消预览不落库画布但记录 discarded", async ({ page }) => {
    const chat = await openChat(page);
    const composer = page.getByPlaceholder(/让 AI 画图/);
    await composer.fill("画一个圆");
    await composer.press("Enter");

    const dialog = page.getByRole("dialog", { name: "AI 变更预览" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#drawing-surface svg").locator("circle")).toHaveCount(0);

    await expect.poll(() => chat.outcomes.length).toBe(1);
    expect(chat.outcomes[0]).toMatchObject({ outcome: "discarded", reason: "cancelled" });
});

test("刷新后从服务端恢复会话历史", async ({ page }) => {
    const chat = await openChat(page);
    const composer = page.getByPlaceholder(/让 AI 画图/);
    await composer.fill("画一个圆");
    await composer.press("Enter");
    const dialog = page.getByRole("dialog", { name: "AI 变更预览" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "应用变更" }).click();

    await expect.poll(() => chat.rows.length).toBe(4);

    await page.reload();
    await expect(page.getByText("欢迎使用 AI Ignite CAD")).toBeVisible();
    await page.getByText("AI Chat Drawing", { exact: true }).click();
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toBeVisible();

    await expect(page.getByText("画一个圆").first()).toBeVisible();
    await expect(page.getByText("圆已画好，请在预览中确认。").first()).toBeVisible();
    // 历史回放后不再出现待确认预览
    await expect(page.getByRole("dialog", { name: "AI 变更预览" })).toBeHidden();
});

test("多方案模式对比卡片，采用一个方案后进入预览", async ({ page }) => {
    await openChat(page);
    const requests: Array<{ variantMode?: boolean }> = [];
    const variantsCall = {
        id: "call-variants",
        name: "propose_variants",
        arguments: {
            goal: "两种工位布局",
            variants: [
                {
                    name: "紧凑布局",
                    summary: "间距 400，占用更小",
                    steps: [
                        {
                            title: "绘制工位",
                            tool: "draw_rectangle",
                            arguments: { x: 0, y: 0, width: 100, height: 50 },
                        },
                    ],
                },
                {
                    name: "宽松布局",
                    summary: "间距 800，便于通行",
                    steps: [
                        {
                            title: "绘制工位",
                            tool: "draw_circle",
                            arguments: { cx: 200, cy: 200, radius: 40 },
                        },
                    ],
                },
            ],
        },
    };

    await page.route("**/api/llm/chat", (route) => {
        const body = route.request().postDataJSON() as {
            turnId: string;
            phase: string;
            round: number;
            variantMode?: boolean;
        };
        requests.push(body);
        const events = [
            frame("content", { content: "给出两个布局方案，请对比后选择。" }),
            frame("tool_call", { toolCall: variantsCall }),
            frame("done", {
                traceId: "trace-variants",
                sessionId: SESSION_ID,
                messageId: `${body.turnId}-r${body.round}`,
                turnId: body.turnId,
                round: body.round,
                finishReason: "tool_calls",
                nextPhase: "tool_results",
            }),
        ].join("");
        return route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: `: ping\n\n${events}`,
        });
    });

    const composer = page.getByPlaceholder(/让 AI 画图/);
    await composer.fill("给我两个工位布局方案对比");
    await composer.press("Enter");

    await expect(page.getByText("方案对比", { exact: true })).toBeVisible();
    await expect(page.getByText("紧凑布局")).toBeVisible();
    await expect(page.getByText("宽松布局")).toBeVisible();
    // 卡片刻度来自草稿上的几何差分，不是模型自述的步骤数
    await expect(page.locator('[data-variant="0"]')).toContainText("新增 1");
    expect(requests).toHaveLength(1);
    expect(requests[0].variantMode).toBe(true);
    await expect(page.getByRole("dialog", { name: "AI 变更预览" })).toBeHidden();

    await page.getByRole("button", { name: "采用此方案" }).first().click();
    const dialog = page.getByRole("dialog", { name: "AI 变更预览" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "应用变更" }).click();

    const svg = page.locator("#drawing-surface svg");
    await expect(svg.locator('rect[width="100"][height="50"]')).toHaveCount(1);
    await expect(page.getByText("已采用")).toBeVisible();
});

test("计划模式先出计划，确认后一次预览写入", async ({ page }) => {
    await openChat(page);
    const requests: Array<{ planMode?: boolean; phase: string }> = [];
    const planCall = {
        id: "call-plan",
        name: "propose_plan",
        arguments: {
            goal: "在原点附近补一个圆",
            assumptions: ["圆心取 (300,200)"],
            steps: [
                {
                    title: "绘制圆",
                    tool: "draw_circle",
                    arguments: { cx: 300, cy: 200, radius: 60 },
                },
                { title: "检查图纸", tool: "check_drawing" },
            ],
            checks: ["圆位于画布内"],
        },
    };

    await page.route("**/api/llm/chat", (route) => {
        const body = route.request().postDataJSON() as {
            turnId: string;
            phase: string;
            round: number;
            planMode?: boolean;
        };
        requests.push(body);
        const events = [
            frame("content", { content: "先给出执行计划，确认后再落图。" }),
            frame("tool_call", { toolCall: planCall }),
            frame("done", {
                traceId: "trace-plan",
                sessionId: SESSION_ID,
                messageId: `${body.turnId}-r${body.round}`,
                turnId: body.turnId,
                round: body.round,
                finishReason: "tool_calls",
                nextPhase: "tool_results",
            }),
        ].join("");
        return route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: `: ping\n\n${events}`,
        });
    });

    const composer = page.getByPlaceholder(/让 AI 画图/);
    await composer.fill("帮我规划在原点附近补一个圆");
    await composer.press("Enter");

    // 计划模式只发一轮请求，且不会直接弹出画布预览
    await expect(page.getByText("帮我规划在原点附近补一个圆", { exact: true })).toBeVisible();
    await expect(page.getByText("先给出执行计划，确认后再落图。")).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].planMode).toBe(true);
    await expect(page.getByRole("dialog", { name: "AI 变更预览" })).toBeHidden();
    await expect(page.locator("#drawing-surface svg").locator("circle")).toHaveCount(0);

    await page.getByRole("button", { name: "执行计划" }).click();
    const dialog = page.getByRole("dialog", { name: "AI 变更预览" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "应用变更" }).click();

    await expect(page.locator("#drawing-surface svg").locator("circle")).toHaveCount(1);
    await expect(page.getByText("已确认")).toBeVisible();
});

test("视图类工具只移动视口，不弹预览也不改图纸", async ({ page }) => {
    await openChat(page);

    const svg = page.locator("#drawing-surface svg");
    const box = await svg.boundingBox();
    if (!box) throw new Error("Drawing surface is not visible");

    // 关闭栅格与捕捉，线段端点落在鼠标位置上，命中位置可复现
    await page.getByRole("button", { name: "栅格" }).click();
    await page.getByRole("button", { name: "捕捉" }).click();

    // 画一条线并选中它，作为视图工具的作用目标
    await page.locator('[data-tool="LINE"]').click();
    const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.35 };
    const end = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.55 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, {
        steps: 8,
    });
    await page.mouse.up();
    await expect(svg.locator("line")).toHaveCount(3);

    await page.locator('[data-tool="SELECT"]').click();
    await page.mouse.click((start.x + end.x) / 2, (start.y + end.y) / 2);
    await expect(page.locator("footer").getByText(/已选 1 个/)).toBeVisible();

    // 覆盖聊天路由：模型本轮只提议视图类工具
    const zoomCall = { id: "call-zoom", name: "zoom_to_selection", arguments: {} };
    await page.route("**/api/llm/chat", (route) => {
        const body = route.request().postDataJSON() as {
            turnId: string;
            phase: string;
            round: number;
        };
        const first = body.phase === "user_turn";
        const events = [
            frame("trace_start", {
                traceId: "trace-zoom",
                sessionId: SESSION_ID,
                turnId: body.turnId,
                round: body.round,
                provider: "openai",
                modelRowId: "model-e2e",
                modelId: "gpt-4o-mini",
            }),
            frame("content", {
                content: first ? "把视图缩放到选中的图元。" : "已缩放到选中的图元。",
            }),
            ...(first ? [frame("tool_call", { toolCall: zoomCall })] : []),
            frame("done", {
                traceId: "trace-zoom",
                sessionId: SESSION_ID,
                messageId: `${body.turnId}-r${body.round}`,
                turnId: body.turnId,
                round: body.round,
                finishReason: first ? "tool_calls" : "stop",
                nextPhase: first ? "tool_results" : null,
            }),
        ].join("");
        return route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: `: ping\n\n${events}`,
        });
    });

    const before = await svg.getAttribute("viewBox");
    const composer = page.getByPlaceholder(/让 AI 画图/);
    await composer.fill("把视图缩到我选中的图元");
    await composer.press("Enter");

    // 视口移动了，但没有预览弹窗，图纸也没有新图元
    await expect.poll(async () => svg.getAttribute("viewBox")).not.toBe(before);
    await expect(page.getByRole("dialog", { name: "AI 变更预览" })).toBeHidden();
    await expect(svg.locator("line")).toHaveCount(3);
    await expect(page.getByText("缩放到 1 个图元")).toBeVisible();
});

test("块工具：先查块库再插入，展开为图元并进入预览", async ({ page }) => {
    await openChat(page);
    const requests: Array<{
        round: number;
        phase: string;
        toolResults?: Array<{ toolCallId: string; ok: boolean; summary?: string }>;
    }> = [];
    const listCall = {
        id: "call-list-blocks",
        name: "list_blocks",
        arguments: { keyword: "门" },
    };
    const insertCall = {
        id: "call-insert-block",
        name: "insert_block",
        arguments: { blockId: "block-door", x: 400, y: 300 },
    };

    await page.route("**/api/llm/chat", (route) => {
        const body = route.request().postDataJSON() as {
            turnId: string;
            phase: string;
            round: number;
        };
        requests.push(body);
        const turnId = body.turnId;
        const respond = (events: string[]) =>
            route.fulfill({
                status: 200,
                contentType: "text/event-stream",
                body: `: ping\n\n${events.join("")}`,
            });
        const done = (nextPhase: "tool_results" | null, finishReason: string) =>
            frame("done", {
                traceId: "trace-block",
                sessionId: SESSION_ID,
                messageId: `${turnId}-r${body.round}`,
                turnId,
                round: body.round,
                finishReason,
                nextPhase,
            });

        if (body.round === 0) {
            return respond([
                frame("content", { content: "先查一下块库。" }),
                frame("tool_call", { toolCall: listCall }),
                done("tool_results", "tool_calls"),
            ]);
        }
        if (body.round === 1) {
            return respond([
                frame("tool_call", { toolCall: insertCall }),
                done("tool_results", "tool_calls"),
            ]);
        }
        return respond([
            frame("content", { content: "门洞已插入，请在预览中确认。" }),
            done(null, "stop"),
        ]);
    });

    const composer = page.getByPlaceholder(/让 AI 画图/);
    await composer.fill("在 (400,300) 插入一个标准门洞");
    await composer.press("Enter");

    await expect.poll(() => requests.length).toBe(3);
    expect(requests[1].toolResults?.[0]).toMatchObject({
        toolCallId: "call-list-blocks",
        ok: true,
    });
    expect(requests[1].toolResults?.[0].summary).toContain("标准门洞");
    expect(requests[2].toolResults?.[0]).toMatchObject({
        toolCallId: "call-insert-block",
        ok: true,
    });

    const dialog = page.getByRole("dialog", { name: "AI 变更预览" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "应用变更" }).click();
    await expect(dialog).toBeHidden();

    const svg = page.locator("#drawing-surface svg");
    await expect(svg.locator('rect[width="200"][height="100"]')).toHaveCount(1);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(svg.locator('rect[width="200"][height="100"]')).toHaveCount(0);
});

test("AI 结果含检查错误时必须显式确认才能应用", async ({ page }) => {
    await openChat(page);
    const zeroLine = {
        id: "call-zero-line",
        name: "draw_line",
        arguments: { x1: 200, y1: 200, x2: 200, y2: 200 },
    };

    await page.route("**/api/llm/chat", (route) => {
        const body = route.request().postDataJSON() as {
            turnId: string;
            round: number;
        };
        const doneRound = (nextPhase: "tool_results" | null, finishReason: string) =>
            frame("done", {
                traceId: "trace-review",
                sessionId: SESSION_ID,
                messageId: `${body.turnId}-r${body.round}`,
                turnId: body.turnId,
                round: body.round,
                finishReason,
                nextPhase,
            });
        const events =
            body.round === 0
                ? [
                      frame("content", { content: "画一条线。" }),
                      frame("tool_call", { toolCall: zeroLine }),
                      doneRound("tool_results", "tool_calls"),
                  ]
                : [
                      frame("content", { content: "已完成，请检查预览中的问题。" }),
                      doneRound(null, "stop"),
                  ];
        return route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: `: ping\n\n${events.join("")}`,
        });
    });

    const composer = page.getByPlaceholder(/让 AI 画图/);
    await composer.fill("在 (200,200) 画线");
    await composer.press("Enter");

    const dialog = page.getByRole("dialog", { name: "AI 变更预览" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("自动检查")).toBeVisible();
    await expect(dialog.getByText(/错误 1/)).toBeVisible();

    const apply = dialog.getByRole("button", { name: "应用变更" });
    await expect(apply).toBeDisabled();
    await dialog.getByLabel("确认接受检查错误").check();
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(dialog).toBeHidden();
});

test("回答反馈：没帮助可带原因，写入服务端并回显", async ({ page }) => {
    const chat = await openChat(page);
    const composer = page.getByPlaceholder(/让 AI 画图/);
    await composer.fill("画一个圆");
    await composer.press("Enter");

    await expect(page.locator(".markdown-body").first()).toContainText("已匹配");
    // 先关掉动作预览，反馈按钮才不会被弹窗遮住
    const dialog = page.getByRole("dialog", { name: "AI 变更预览" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "回答没帮助" }).click();
    await page.getByRole("button", { name: "不准确", exact: true }).click();

    await expect.poll(() => chat.feedback.length).toBe(1);
    expect(chat.feedback[0]).toMatchObject({
        rating: "down",
        reason: "不准确",
        skillCodes: ["mech-draft"],
    });
    await expect(page.getByText("已记录：不准确")).toBeVisible();
});
