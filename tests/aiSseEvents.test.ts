import { describe, expect, it } from "vitest";
import {
    effectiveMaxRounds,
    initialAgentTurn,
    needsToolResults,
    parseSseLine,
    reduceAgentTurn,
    rejectionResults,
    splitSseLines,
    type AgentEvent,
} from "../lib/aiSseEvents";

const data = (payload: unknown) => `data: ${JSON.stringify(payload)}`;

describe("SSE line parsing", () => {
    it("忽略心跳、注释与不可用负载", () => {
        expect(parseSseLine(": ping")).toBeNull();
        expect(parseSseLine("")).toBeNull();
        expect(parseSseLine("data:")).toBeNull();
        expect(parseSseLine("data: {truncated")).toBeNull();
        expect(parseSseLine("data: [1,2]")).toBeNull();
        expect(parseSseLine("data: {}")).toBeNull();
        expect(parseSseLine('data: {"event":"future_event","x":1}')).toBeNull();
    });

    it("按 event 判别字段解析新契约", () => {
        expect(parseSseLine(data({ event: "content", content: "画好了" }))).toEqual({
            kind: "content",
            content: "画好了",
        });

        const trace = parseSseLine(
            data({
                event: "trace_start",
                traceId: "t-1",
                sessionId: "s-1",
                turnId: "u-1",
                round: 0,
                provider: "OpenAI",
                modelRowId: "m-1",
                modelId: "gpt-4o-mini",
            }),
        );
        expect(trace).toMatchObject({ kind: "trace_start", sessionId: "s-1", turnId: "u-1" });

        expect(
            parseSseLine(
                data({
                    event: "skill_activated",
                    code: "cad_drafting_basic",
                    name: "基础绘图",
                    score: 24,
                    reasons: ["keyword:画", "assistant_binding"],
                    category: "drafting",
                    tools: ["draw_line"],
                }),
            ),
        ).toMatchObject({
            kind: "skill_activated",
            skill: { code: "cad_drafting_basic", score: 24, tools: ["draw_line"] },
        });
    });

    it("tool_rejected 即使带旧 toolCall 字段也按拒绝解析", () => {
        const event = parseSseLine(
            data({
                event: "tool_rejected",
                toolCallId: "call-1",
                name: "move_elements",
                reason: "NO_TARGET",
                error: "没有选中图元",
                toolCall: { id: "call-1", name: "move_elements", arguments: {} },
            }),
        );
        expect(event).toMatchObject({
            kind: "tool_rejected",
            rejection: { toolCallId: "call-1", reason: "NO_TARGET", error: "没有选中图元" },
        });
    });

    it("缺少 id 的工具调用补序号，未知工具名仍原样下发", () => {
        const event = parseSseLine(
            data({ event: "tool_call", toolCall: { name: "draw_circle", arguments: { cx: 1, cy: 2, radius: 3 } } }),
        );
        expect(event).toMatchObject({
            kind: "tool_call",
            call: { id: "tool-0", name: "draw_circle" },
        });
    });

    it("过滤非字符串 reasons 与非法数值", () => {
        const event = parseSseLine(
            data({
                event: "context",
                chars: 1200,
                historyMessages: 4,
                dropped: 2,
                hasSummary: true,
                toolsEnabled: true,
                allowedTools: ["draw_line", 42, null],
                skillCodes: ["cad_drafting_basic"],
            }),
        );
        expect(event).toMatchObject({
            kind: "context",
            context: { chars: 1200, dropped: 2, allowedTools: ["draw_line"] },
        });
    });

    it("回落解析旧服务端的字段特征", () => {
        expect(parseSseLine('data: {"content":"legacy"}')).toEqual({ kind: "content", content: "legacy" });
        expect(parseSseLine('data: {"toolCall":{"id":"c","name":"draw_line","arguments":{}}}')).toMatchObject({
            kind: "tool_call",
            call: { id: "c", name: "draw_line" },
        });
        expect(parseSseLine('data: {"done":true,"sessionId":"s-9","nextPhase":"tool_results"}')).toMatchObject({
            kind: "done",
            done: { sessionId: "s-9", nextPhase: "tool_results" },
        });
        expect(parseSseLine('data: {"error":"boom","code":"PROVIDER_AUTH","retryable":false}')).toMatchObject({
            kind: "error",
            error: { error: "boom", code: "PROVIDER_AUTH", retryable: false },
        });
    });

    it("分包时把不完整行留到下一次", () => {
        const first = splitSseLines('data: {"event":"content","content":"a"}\ndata: {"eve');
        expect(first.completed).toEqual(['data: {"event":"content","content":"a"}']);
        expect(first.rest).toBe('data: {"eve');

        const empty = splitSseLines("no newline yet");
        expect(empty.completed).toEqual([]);
        expect(empty.rest).toBe("no newline yet");
    });
});

describe("回合状态折叠", () => {
    it("累加文本、技能与工具调用，并跳过重复项", () => {
        const events: AgentEvent[] = [
            {
                kind: "trace_start",
                traceId: "t-1",
                sessionId: "s-1",
                turnId: "u-1",
                round: 0,
                provider: "OpenAI",
                modelRowId: "m-1",
                modelId: "gpt-4o-mini",
            },
            { kind: "content", content: "先" },
            { kind: "content", content: "画房间" },
            {
                kind: "skill_activated",
                skill: { code: "cad_drafting_basic", name: "基础绘图", score: 24, reasons: [], category: "", tools: [] },
            },
            {
                kind: "skill_activated",
                skill: { code: "cad_drafting_basic", name: "基础绘图", score: 30, reasons: [], category: "", tools: [] },
            },
            {
                kind: "skill_activated",
                skill: { code: "cad_dimensioning", name: "标注注释", score: 16, reasons: [], category: "", tools: [] },
            },
            {
                kind: "tool_call",
                call: { id: "call-1", name: "draw_rectangle", arguments: { x: 0, y: 0, width: 5000, height: 4000 } },
            },
            {
                kind: "tool_call",
                call: { id: "call-1", name: "draw_rectangle", arguments: { x: 0, y: 0, width: 5000, height: 4000 } },
            },
            {
                kind: "usage",
                usage: {
                    promptTokens: 900,
                    completionTokens: 120,
                    reported: true,
                    costUsd: 0.0031,
                    provider: "OpenAI",
                    modelId: "gpt-4o-mini",
                },
            },
            {
                kind: "done",
                done: {
                    traceId: "t-1",
                    sessionId: "s-1",
                    messageId: "msg-1",
                    turnId: "u-1",
                    round: 0,
                    finishReason: "tool_use",
                    nextPhase: "tool_results",
                },
            },
        ];

        const state = events.reduce(reduceAgentTurn, initialAgentTurn());

        expect(state.content).toBe("先画房间");
        expect(state.skills.map((skill) => skill.code)).toEqual(["cad_drafting_basic", "cad_dimensioning"]);
        expect(state.toolCalls).toHaveLength(1);
        expect(state.usage?.promptTokens).toBe(900);
        expect(state.messageId).toBe("msg-1");
        expect(state.finishReason).toBe("tool_use");
        expect(needsToolResults(state)).toBe(true);
    });

    it("故障转移替换模型标识并保留历史", () => {
        const events: AgentEvent[] = [
            {
                kind: "trace_start",
                traceId: "t-1",
                sessionId: null,
                turnId: "u-1",
                round: 0,
                provider: "OpenAI",
                modelRowId: "m-1",
                modelId: "gpt-4o-mini",
            },
            {
                kind: "model_fallback",
                fallback: {
                    from: "m-1",
                    to: "m-2",
                    provider: "Google",
                    modelId: "gemini-2.5-flash",
                    reason: "PROVIDER_UNAVAILABLE",
                    message: "主模型暂不可用，已切换到 Gemini",
                },
            },
        ];
        const state = events.reduce(reduceAgentTurn, initialAgentTurn());

        expect(state.modelRowId).toBe("m-2");
        expect(state.provider).toBe("Google");
        expect(state.fallbacks).toHaveLength(1);
    });

    it("无工具调用时不进入续轮，错误事件可被读取", () => {
        const withError = reduceAgentTurn(initialAgentTurn(), {
            kind: "error",
            error: { error: "模型鉴权失败", code: "PROVIDER_AUTH", retryable: false, requestId: "t-1" },
        });
        expect(needsToolResults(withError)).toBe(false);
        expect(withError.error?.code).toBe("PROVIDER_AUTH");
        expect(withError.content).toBe("");
    });

    it("只有一条被拒调用时也要续轮，并把原因回传", () => {
        const state = reduceAgentTurn(initialAgentTurn(), {
            kind: "tool_rejected",
            rejection: {
                toolCallId: "call_1",
                name: "draw_circle",
                reason: "BAD_NUMBER",
                error: "draw_circle.radius 超出允许范围",
            },
        });
        expect(state.toolCalls).toHaveLength(0);
        expect(needsToolResults(state)).toBe(true);
        expect(rejectionResults(state)).toEqual([
            {
                toolCallId: "call_1",
                name: "draw_circle",
                ok: false,
                error: "draw_circle.radius 超出允许范围",
            },
        ]);
    });

    it("缺少错误文案时回传拒绝原因码", () => {
        const state = reduceAgentTurn(initialAgentTurn(), {
            kind: "tool_rejected",
            rejection: {
                toolCallId: "call_2",
                name: "draw_everything",
                reason: "UNKNOWN_TOOL",
                error: "",
            },
        });
        expect(rejectionResults(state)[0].error).toBe("UNKNOWN_TOOL");
    });

    it("解析 tool_rejected 事件行", () => {
        const event = parseSseLine(
            data({
                event: "tool_rejected",
                toolCallId: "call_3",
                name: "move_elements",
                reason: "NO_TARGET",
                error: "没有选中图元",
            }),
        );
        expect(event).toMatchObject({
            kind: "tool_rejected",
            rejection: { toolCallId: "call_3", name: "move_elements", reason: "NO_TARGET" },
        });
    });
});

describe("工具轮次上限由服务端下发", () => {
    it("context 事件携带 maxRounds", () => {
        const event = parseSseLine(data({ event: "context", chars: 10, maxRounds: 2 }));
        expect(event).toMatchObject({ kind: "context", context: { chars: 10, maxRounds: 2 } });
    });

    it("旧服务端不下发 maxRounds 时保持缺失", () => {
        const event = parseSseLine(data({ event: "context", chars: 10 }));
        const context = (event as Extract<AgentEvent, { kind: "context" }>).context;
        expect(context.maxRounds).toBeUndefined();
        expect(effectiveMaxRounds(context.maxRounds)).toBe(4);
    });

    it("有效上限以服务端为准，本地硬上限 8 兜底", () => {
        expect(effectiveMaxRounds(2)).toBe(2);
        expect(effectiveMaxRounds(12)).toBe(8);
        expect(effectiveMaxRounds(0)).toBe(1);
        expect(effectiveMaxRounds(null)).toBe(4);
    });

    it("服务端声明 2 轮时前端不会发起第 3 轮", () => {
        const cap = effectiveMaxRounds(2);
        const started: number[] = [];
        for (let roundIndex = 0; ; roundIndex++) {
            started.push(roundIndex);
            // 每轮都仍有工具结果待回传，只有上限检查能终止循环
            if (roundIndex + 1 >= cap) break;
        }
        expect(started).toEqual([0, 1]);
    });
});
