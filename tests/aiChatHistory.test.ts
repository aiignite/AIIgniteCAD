import { describe, expect, it } from "vitest";
import type { AIToolCall, ChatLogMessage } from "../types";
import {
    applyToolStatuses,
    createTurnId,
    toUiMessages,
    type ChatUiMessage,
} from "../lib/aiChatHistory";

const row = (overrides: Partial<ChatLogMessage>): ChatLogMessage => ({
    id: "m-1",
    sessionId: "s-1",
    senderType: "user",
    messageType: "text",
    content: "",
    metadata: null,
    role: "user",
    clientMessageId: null,
    toolCallId: null,
    toolName: null,
    toolCalls: null,
    promptTokens: null,
    completionTokens: null,
    status: "ok",
    createdAt: "2026-01-01T08:30:00.000Z",
    ...overrides,
});

const userRow = (turnId: string, content: string): ChatLogMessage =>
    row({
        id: `${turnId}-user`,
        senderType: "user",
        role: "user",
        content,
        clientMessageId: turnId,
    });

const assistantRow = (
    turnId: string,
    round: number,
    content: string,
    toolCalls: AIToolCall[] = [],
): ChatLogMessage =>
    row({
        id: `${turnId}-r${round}-assistant`,
        senderType: "ai",
        role: "assistant",
        content,
        clientMessageId: `${turnId}:r${round}:assistant`,
        toolCalls,
        promptTokens: 120,
        completionTokens: 30,
    });

const toolRow = (
    turnId: string,
    round: number,
    call: AIToolCall,
    options: { ok?: boolean; content?: string } = {},
): ChatLogMessage =>
    row({
        id: `${turnId}-r${round}-${call.id}`,
        senderType: "ai",
        role: "tool",
        content: options.content ?? `${call.name} 成功`,
        clientMessageId: `${turnId}:r${round}:tool:${call.id}`,
        toolCallId: call.id,
        toolName: call.name,
        status: options.ok === false ? "rejected" : "ok",
    });

const moveCall: AIToolCall = { id: "call-1", name: "move_elements", arguments: { dx: 10, dy: 5 } };

describe("toUiMessages 还原会话历史", () => {
    it("一次提问只有一个助手气泡", () => {
        const messages = toUiMessages([
            userRow("t1", "把矩形右移 10"),
            assistantRow("t1", 1, "先移动", [moveCall]),
            toolRow("t1", 1, moveCall),
            assistantRow("t1", 2, "已完成"),
        ]);

        expect(messages.map((message) => message.sender)).toEqual(["user", "ai"]);
        const ai = messages[1];
        expect(ai.turnId).toBe("t1");
        expect(ai.rounds.map((round) => round.round)).toEqual([1, 2]);
        expect(ai.text).toBe("已完成");
        expect(ai.rounds[1].text).toBe("已完成");
    });

    it("tool 行按 toolCallId 落到对应轮次并带上摘要", () => {
        const messages = toUiMessages([
            userRow("t1", "画两个圆"),
            assistantRow("t1", 1, "", [
                { id: "a", name: "draw_circle", arguments: { cx: 0, cy: 0, radius: 5 } },
                { id: "b", name: "draw_circle", arguments: { cx: 20, cy: 0, radius: 5 } },
            ]),
            toolRow("t1", 1, { id: "a", name: "draw_circle", arguments: {} }, { content: "已新增 1 个图元\n细节" }),
            toolRow("t1", 1, { id: "b", name: "draw_circle", arguments: {} }, { ok: false, content: "半径非法" }),
        ]);

        const tools = messages[1].rounds[0].tools;
        expect(tools).toHaveLength(2);
        // 结果行不带参数，合并后仍要能还原"绘制圆 · (0,0) · 半径 5"这类摘要
        expect(tools[0]).toMatchObject({
            id: "a",
            status: "ok",
            summary: "已新增 1 个图元",
            arguments: { cx: 0, cy: 0, radius: 5 },
        });
        expect(tools[1]).toMatchObject({ id: "b", status: "rejected", error: "半径非法" });
    });

    it("助手轮次里未知 id 的 toolCall 保持 proposed 态", () => {
        const messages = toUiMessages([
            userRow("t1", "清空"),
            assistantRow("t1", 1, "准备清空", [{ id: "c", name: "clear_canvas", arguments: {} }]),
        ]);
        expect(messages[1].rounds[0].tools[0]).toMatchObject({
            id: "c",
            status: "proposed",
            arguments: {},
        });
    });

    it("按 turnId 切分不同轮次的助手气泡", () => {
        const messages = toUiMessages([
            userRow("t1", "第一个问题"),
            assistantRow("t1", 1, "回答一"),
            userRow("t2", "第二个问题"),
            assistantRow("t2", 1, "回答二"),
        ]);

        expect(messages.map((message) => message.turnId)).toEqual(["t1", "t1", "t2", "t2"]);
        expect(messages.map((message) => message.text)).toEqual([
            "第一个问题",
            "回答一",
            "第二个问题",
            "回答二",
        ]);
    });

    it("工具结果先于助手行到达时也能建气泡", () => {
        const messages = toUiMessages([
            userRow("t1", "移动"),
            toolRow("t1", 1, moveCall),
            assistantRow("t1", 1, "已移动", [moveCall]),
        ]);

        expect(messages).toHaveLength(2);
        const ai = messages[1];
        expect(ai.rounds[0].tools).toHaveLength(1);
        expect(ai.rounds[0].tools[0].status).toBe("ok");
        expect(ai.text).toBe("已移动");
    });

    it("落库的 token 计数还原成用量事件", () => {
        const messages = toUiMessages([userRow("t1", "hi"), assistantRow("t1", 1, "hello")]);
        expect(messages[1].rounds[0].usage).toMatchObject({
            promptTokens: 120,
            completionTokens: 30,
            reported: true,
        });
    });

    it("缺少 clientMessageId 的旧行退化为独立气泡", () => {
        const messages = toUiMessages([
            row({ senderType: "ai", role: "assistant", content: "早期消息" }),
        ]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ sender: "ai", text: "早期消息", turnId: "" });
        expect(messages[0].rounds[0].round).toBe(0);
    });

    it("助手行 metadata 上的反馈还原到气泡", () => {
        const messages = toUiMessages([
            userRow("t1", "画个圆"),
            row({
                id: "t1-r1-assistant",
                senderType: "ai",
                role: "assistant",
                content: "已画好",
                clientMessageId: "t1:r1:assistant",
                metadata: {
                    feedback: { rating: "down", reason: "不准确", at: "2026-01-01T08:31:00.000Z" },
                },
            }),
        ]);

        expect(messages[1].feedback).toEqual({ rating: "down", reason: "不准确" });
    });

    it("无反馈或非法反馈字段时不产生 feedback", () => {
        const messages = toUiMessages([
            userRow("t1", "画个圆"),
            row({
                id: "t1-r1-assistant",
                senderType: "ai",
                role: "assistant",
                content: "已画好",
                clientMessageId: "t1:r1:assistant",
                metadata: { feedback: { rating: "maybe" } },
            }),
            row({
                id: "t1-r2-assistant",
                senderType: "ai",
                role: "assistant",
                content: "补充",
                clientMessageId: "t1:r2:assistant",
                metadata: null,
            }),
        ]);

        expect(messages[1].feedback).toBeUndefined();
    });
});

describe("applyToolStatuses", () => {
    const aiMessage = (status: ChatUiMessage["rounds"][0]["tools"][0]["status"]): ChatUiMessage => ({
        id: "t1",
        sender: "ai",
        text: "",
        timestamp: "08:30",
        turnId: "t1",
        rounds: [
            {
                round: 1,
                text: "",
                skills: [],
                tools: [{ ...moveCall, arguments: moveCall.arguments, status, summary: undefined }],
                usage: null,
                context: null,
                fallbacks: [],
            },
        ],
    });

    it("按 toolCallId 写回执行结果", () => {
        const updated = applyToolStatuses(aiMessage("proposed"), 1, [
            { toolCallId: "call-1", name: "move_elements", ok: true, summary: "修改 1 个图元" },
        ]);
        expect(updated.rounds[0].tools[0]).toMatchObject({
            status: "ok",
            summary: "修改 1 个图元",
        });
    });

    it("只更新命中轮次，失败原因落到 error", () => {
        const message = aiMessage("ok");
        const updated = applyToolStatuses(message, 9, [
            { toolCallId: "call-1", name: "move_elements", ok: false, error: "参数非法" },
        ]);
        expect(updated.rounds[0].tools[0].status).toBe("ok");
        expect(updated).not.toBe(message);
    });

    it("拒绝结果同时清空摘要", () => {
        const updated = applyToolStatuses(aiMessage("ok"), 1, [
            { toolCallId: "call-1", name: "move_elements", ok: false, error: "被跳过" },
        ]);
        expect(updated.rounds[0].tools[0]).toMatchObject({ status: "rejected", error: "被跳过" });
        expect(updated.rounds[0].tools[0].summary).toBeUndefined();
    });
});

describe("createTurnId", () => {
    it("生成长度受限且唯一的 turnId", () => {
        const ids = new Set(Array.from({ length: 200 }, () => createTurnId()));
        expect(ids.size).toBe(200);
        for (const id of ids) {
            expect(id.length).toBeLessThanOrEqual(128);
            expect(id.startsWith("t-")).toBe(true);
        }
    });
});
