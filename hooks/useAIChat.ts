/**
 * useAIChat — Agent 会话状态与多轮工具循环
 *
 * 循环策略：每个 HTTP 回合一次模型调用，工具在浏览器草稿数组上求值后把结果续轮回传，
 * 让模型可以自检修正；循环结束后整批动作一次性交给宿主预览，因此多轮仍只占一步撤销。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
    AIActionResponse,
    AgentChatRequest,
    AgentToolResultPayload,
    Assistant,
    CADElement,
    ChatSessionInfo,
    DesignConventions,
} from "../types";
import { apiService } from "../services/apiService";
import { telemetryService } from "../services/telemetryService";
import { getBlockCatalog } from "../services/blockService";
import {
    applyToolCalls,
    createDraft,
    fallbackActionsFromText,
    summarizeCanvas,
    type AgentDraft,
} from "../lib/aiAgentLoop";
import {
    chooseContextTier,
    summarizeCanvasContext,
    type DesignContextMeta,
} from "../lib/aiContext";
import {
    applyToolStatuses,
    createTurnId,
    emptyRound,
    toUiMessages,
    toolEntryFromCall,
    type ChatFeedback,
    type ChatRound,
    type ChatToolEntry,
    type ChatUiMessage,
} from "../lib/aiChatHistory";
import {
    describeToolRejectReason,
    isAbortError,
    toAIErrorInfo,
    type AIErrorInfo,
} from "../lib/aiErrors";
import type { AgentEvent } from "../lib/aiSseEvents";
import { effectiveMaxRounds, needsToolResults, rejectionResults } from "../lib/aiSseEvents";
import { shouldProposePlan, type PlanProposal, type PlanStatus } from "../lib/aiPlan";
import { shouldProposeVariants, type VariantProposal } from "../lib/aiVariants";
import { zoomViewportToBounds } from "../store/viewport";

export interface TurnMeta {
    sessionId: string | null;
    turnId: string;
    changedIds: string[];
    /** 本轮激活的技能：用于统计每技能的采纳率 */
    skillCodes: string[];
}

export interface UseAIChatOptions {
    projectId: string | null;
    /** 稳定的项目身份键；离线项目回填服务端 id 时保持不变，避免清空对话 */
    projectKey?: string | null;
    currentElements: CADElement[];
    selectedIds: ReadonlySet<string>;
    units?: string;
    /** 设计上下文元数据：项目、图层可见性/锁定、块、修订号与隐藏对象 */
    contextMeta?: DesignContextMeta;
    /** 项目设计约定；进入草稿后供确定性检查读取 */
    conventions?: DesignConventions | null;
    assistant: Assistant | null;
    /** 会话级模型覆盖；传 undefined 表示跟随会话绑定的模型，null 表示由服务端解析链选择 */
    modelId?: string | null;
    onPreviewActions: (actions: AIActionResponse[], meta: TurnMeta) => void;
}

export type ChatStatus = "idle" | "running" | "stopped" | "error";

const HISTORY_LIMIT = 100;
/** 单轮最多上报的技能数，与服务端校验上限保持一致 */
const MAX_TURN_SKILL_CODES = 8;

const nowTime = (): string =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

interface ChatSnapshot {
    sessions: ChatSessionInfo[];
    sessionId: string | null;
    messages: ChatUiMessage[];
}

/** 拉取某张图纸的会话视图；未打开图纸时返回空快照 */
async function loadProjectChat(projectId: string | null): Promise<ChatSnapshot> {
    if (!projectId) return { sessions: [], sessionId: null, messages: [] };
    const [{ session }, list] = await Promise.all([
        apiService.getActiveChatSession(projectId),
        apiService.getChatSessions(projectId, { limit: 20 }),
    ]);
    if (!session) return { sessions: list.sessions, sessionId: null, messages: [] };
    const { messages: rows } = await apiService.getChatMessages(session.id, {
        limit: HISTORY_LIMIT,
    });
    return { sessions: list.sessions, sessionId: session.id, messages: toUiMessages(rows) };
}

export function useAIChat(options: UseAIChatOptions) {
    const { projectId, currentElements, selectedIds, units, assistant, modelId, onPreviewActions } =
        options;
    const projectKey = options.projectKey;
    const scopeKey = projectKey ?? projectId;
    const contextMeta = options.contextMeta;

    const [messages, setMessages] = useState<ChatUiMessage[]>([]);
    const [status, setStatus] = useState<ChatStatus>("idle");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
    const [pinnedSkillCodes, setPinnedSkillCodes] = useState<string[]>([]);
    const [error, setError] = useState<AIErrorInfo | null>(null);
    /** 服务端 context 事件下发的工具轮次上限；null 表示本轮还没收到 */
    const [serverMaxRounds, setServerMaxRounds] = useState<number | null>(null);

    const serverMaxRoundsRef = useRef<number | null>(null);

    const elementsRef = useRef(currentElements);
    const selectedRef = useRef(selectedIds);
    const assistantRef = useRef(assistant);
    const modelRef = useRef(modelId ?? null);
    const sessionRef = useRef<string | null>(null);
    const pinnedRef = useRef(pinnedSkillCodes);
    const contextMetaRef = useRef(contextMeta);
    const conventionsRef = useRef(options.conventions);
    const previewRef = useRef(onPreviewActions);
    const runningRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);
    const lastTextRef = useRef("");
    const lastRecommendedRef = useRef<string[]>([]);
    const projectIdRef = useRef(projectId);
    const projectScopeRef = useRef(projectKey ?? projectId);
    const pendingReloadRef = useRef<string | null>(null);
    /** 当前本地视图是否已包含一次尚未从服务端回放的本地回合 */
    const localTurnScopeRef = useRef<string | null>(null);

    elementsRef.current = currentElements;
    selectedRef.current = selectedIds;
    assistantRef.current = assistant;
    projectIdRef.current = projectId;
    projectScopeRef.current = scopeKey;
    contextMetaRef.current = contextMeta;
    conventionsRef.current = options.conventions;
    const boundModelId = sessions.find((session) => session.id === sessionId)?.modelId ?? null;
    modelRef.current = modelId === undefined ? boundModelId : modelId;
    sessionRef.current = sessionId;
    pinnedRef.current = pinnedSkillCodes;
    previewRef.current = onPreviewActions;

    const maxRounds = effectiveMaxRounds(serverMaxRounds);

    const loadSessions = useCallback(async () => {
        if (!projectId) {
            setSessions([]);
            return;
        }
        try {
            const { sessions: rows } = await apiService.getChatSessions(projectId, { limit: 20 });
            setSessions(rows);
        } catch (loadError) {
            console.error("Failed to load chat sessions", loadError);
        }
    }, [projectId]);

    const openSession = useCallback(async (id: string) => {
        try {
            const { messages: rows } = await apiService.getChatMessages(id, {
                limit: HISTORY_LIMIT,
            });
            localTurnScopeRef.current = null;
            setSessionId(id);
            setMessages(toUiMessages(rows));
            setError(null);
        } catch (openError) {
            setError(toAIErrorInfo(openError));
        }
    }, []);

    const applySnapshot = useCallback((snapshot: ChatSnapshot) => {
        setSessions(snapshot.sessions);
        setSessionId(snapshot.sessionId);
        setMessages(snapshot.messages);
        setError(null);
    }, []);

    const refreshProjectChat = useCallback(
        (scope: string | null, apiProjectId: string | null) => {
            loadProjectChat(apiProjectId)
                .then((snapshot) => {
                    if (scope !== projectScopeRef.current) return;
                    // 同一图纸已经有本地回合时，迟到的服务端快照不得覆盖本地视图
                    if (scope !== null && localTurnScopeRef.current === scope) return;
                    // 回合进行中不覆盖本地视图，等本轮结束后再重新拉取
                    if (runningRef.current) {
                        pendingReloadRef.current = scope;
                        return;
                    }
                    applySnapshot(snapshot);
                })
                .catch((loadError) => {
                    console.error("Failed to restore chat session", loadError);
                });
        },
        [applySnapshot],
    );

    // 切图即切会话：整体替换视图，历史不会串图；服务端 id 回填不改变 scopeKey
    useEffect(() => {
        localTurnScopeRef.current = null;
        pendingReloadRef.current = null;
        refreshProjectChat(scopeKey, projectIdRef.current);
    }, [scopeKey, refreshProjectChat]);

    const patchRound = useCallback(
        (messageId: string, roundIndex: number, mutate: (round: ChatRound) => ChatRound) => {
            setMessages((prev) =>
                prev.map((message) =>
                    message.id !== messageId
                        ? message
                        : {
                              ...message,
                              rounds: message.rounds.map((round) =>
                                  round.round === roundIndex ? mutate(round) : round,
                              ),
                          },
                ),
            );
        },
        [],
    );

    const appendEvent = useCallback(
        (messageId: string, roundIndex: number, event: AgentEvent) => {
            if (event.kind === "content") {
                patchRound(messageId, roundIndex, (round) => ({
                    ...round,
                    text: round.text + event.content,
                }));
                setMessages((prev) =>
                    prev.map((message) =>
                        message.id === messageId
                            ? { ...message, text: message.text + event.content }
                            : message,
                    ),
                );
                return;
            }
            if (event.kind === "skill_activated") {
                patchRound(messageId, roundIndex, (round) =>
                    round.skills.some((skill) => skill.code === event.skill.code)
                        ? round
                        : { ...round, skills: [...round.skills, event.skill] },
                );
                return;
            }
            if (event.kind === "tool_call") {
                patchRound(messageId, roundIndex, (round) => ({
                    ...round,
                    tools: [...round.tools, toolEntryFromCall(event.call)],
                }));
                return;
            }
            if (event.kind === "tool_rejected") {
                const entry: ChatToolEntry = {
                    id: event.rejection.toolCallId,
                    name: event.rejection.name,
                    arguments: {},
                    status: "rejected",
                    error:
                        event.rejection.error || describeToolRejectReason(event.rejection.reason),
                };
                patchRound(messageId, roundIndex, (round) => ({
                    ...round,
                    tools: [...round.tools, entry],
                }));
                return;
            }
            if (event.kind === "model_fallback") {
                patchRound(messageId, roundIndex, (round) => ({
                    ...round,
                    fallbacks: [...round.fallbacks, event.fallback],
                }));
                return;
            }
            if (event.kind === "context") {
                patchRound(messageId, roundIndex, (round) => ({
                    ...round,
                    context: event.context,
                }));
                return;
            }
            if (event.kind === "usage") {
                patchRound(messageId, roundIndex, (round) => ({ ...round, usage: event.usage }));
                return;
            }
        },
        [patchRound],
    );

    const send = useCallback(
        async (rawText: string, recommendedSkillCodes: string[] = []) => {
            const text = rawText.trim();
            if (!text || runningRef.current) return false;
            // 先占位再 await：否则连点两次会同时通过守卫并发发起多个回合
            runningRef.current = true;

            lastTextRef.current = text;
            lastRecommendedRef.current = recommendedSkillCodes;
            localTurnScopeRef.current = scopeKey;
            const turnId = createTurnId();
            const aiMessageId = `${turnId}-ai`;
            const activatedSkillCodes = new Set<string>();
            let draft: AgentDraft;
            try {
                const blockCatalog = await getBlockCatalog(projectIdRef.current ?? undefined);
                draft = createDraft(
                    elementsRef.current,
                    [...selectedRef.current],
                    blockCatalog,
                    conventionsRef.current ?? undefined,
                );
            } catch (catalogError) {
                runningRef.current = false;
                setError(toAIErrorInfo(catalogError));
                setStatus("error");
                return false;
            }

            setMessages((prev) => [
                ...prev,
                {
                    id: turnId,
                    sender: "user",
                    text,
                    timestamp: nowTime(),
                    rounds: [],
                    turnId,
                },
                {
                    id: aiMessageId,
                    sender: "ai",
                    text: "",
                    timestamp: nowTime(),
                    rounds: [emptyRound(0)],
                    turnId,
                    streaming: true,
                },
            ]);
            setStatus("running");
            setError(null);

            const controller = new AbortController();
            abortRef.current = controller;

            let currentDraft = draft;
            let toolResults: AgentToolResultPayload[] | undefined;
            let round = 0;
            let activeSession = sessionRef.current;
            let failed: AIErrorInfo | null = null;
            let stopped = false;
            let lastContent = "";
            const changed = new Set<string>();
            const contextTier = chooseContextTier({
                message: text,
                elementCount: elementsRef.current.length,
                selectedCount: selectedRef.current.size,
            });
            const variantMode = shouldProposeVariants(text);
            const planMode =
                !variantMode &&
                shouldProposePlan(text, {
                    elementCount: elementsRef.current.length,
                    selectedCount: selectedRef.current.size,
                });

            try {
                for (;;) {
                    // setMessages 的 updater 在渲染时才执行，绝不能读可变的 round
                    const roundIndex = round;
                    // 块目录与摘要必须用同一个计数，否则提示词里「块引用：N 个」会和上下文文本矛盾
                    const blockCount =
                        (contextMetaRef.current?.blockCount ?? 0) + currentDraft.blockInsertions.length;
                    const summary = summarizeCanvasContext(
                        currentDraft.elements,
                        new Set(currentDraft.selection),
                        {
                            tier: contextTier,
                            meta: contextMetaRef.current
                                ? { ...contextMetaRef.current, blockCount }
                                : { blockCount },
                        },
                    );
                    const stats = summarizeCanvas(currentDraft);
                    if (roundIndex === 0) {
                        telemetryService.reportClientInfo("ai.context-summary", {
                            channel: "agent",
                            tier: summary.tier,
                            elementCount: summary.elementCount,
                            selectedCount: summary.selectedCount,
                            contextChars: summary.chars,
                            estimatedContextTokens: summary.estimatedTokens,
                        });
                    }

                    const request: AgentChatRequest = {
                        phase: roundIndex === 0 ? "user_turn" : "tool_results",
                        turnId,
                        round: roundIndex,
                        message: roundIndex === 0 ? text : undefined,
                        sessionId: activeSession,
                        projectId,
                        assistantId: assistantRef.current?.id ?? null,
                        modelId: modelRef.current,
                        enableTools: true,
                        planMode,
                        variantMode,
                        pinnedSkillCodes: pinnedRef.current,
                        recommendedSkillCodes,
                        canvasContext: {
                            text: summary.text,
                            elementCount: stats.elementCount,
                            selectedIds: currentDraft.selection,
                            selectionTypes: currentDraft.selection
                                .map(
                                    (id) =>
                                        currentDraft.elements.find((element) => element.id === id)
                                            ?.type,
                                )
                                .filter((type): type is CADElement["type"] => Boolean(type)),
                            units,
                            bounds: stats.bounds,
                            projectName: contextMetaRef.current?.projectName,
                            layerNames: contextMetaRef.current?.layers
                                ?.map((layer) => layer.name)
                                .slice(0, 64),
                            // 草稿里刚插入的块同样算事实：否则模型看不到块已进去，会重复插
                            blockCount,
                            revision: contextMetaRef.current?.revision ?? 0,
                            hiddenCount: contextMetaRef.current?.hiddenCount ?? 0,
                            hasDimensions: (stats.byType.DIMENSION ?? 0) > 0,
                        },
                        toolResults,
                    };

                    const state = await apiService.runAgentTurn(request, {
                        signal: controller.signal,
                        onEvent: (event) => {
                            if (event.kind === "skill_activated") {
                                activatedSkillCodes.add(event.skill.code);
                            }
                            // 服务端下发的轮次上限才是权威值，context 事件一到就生效
                            if (event.kind === "context" && typeof event.context.maxRounds === "number") {
                                serverMaxRoundsRef.current = event.context.maxRounds;
                                setServerMaxRounds(event.context.maxRounds);
                            }
                            appendEvent(aiMessageId, roundIndex, event);
                        },
                    });

                    if (state.content.trim()) lastContent = state.content;

                    if (state.sessionId && state.sessionId !== activeSession) {
                        activeSession = state.sessionId;
                        setSessionId(state.sessionId);
                    }

                    const outcome = applyToolCalls(state.toolCalls, currentDraft, roundIndex);
                    currentDraft = outcome.draft;
                    // 服务端拒绝的调用不会出现在 state.toolCalls 里，
                    // 但它的失败原因必须回传，模型才能在下一轮修正参数
                    toolResults = [...outcome.results, ...rejectionResults(state)];
                    for (const result of outcome.results) {
                        for (const id of result.changedIds ?? []) changed.add(id);
                    }
                    // 视图类工具直接移动视口：不写画布，也不进预览
                    for (const request of outcome.viewRequests) {
                        zoomViewportToBounds(request.bounds);
                    }
                    setMessages((prev) =>
                        prev.map((message) =>
                            message.id === aiMessageId
                                ? applyToolStatuses(message, roundIndex, outcome.results)
                                : message,
                        ),
                    );

                    if (outcome.plan) {
                        const proposal = outcome.plan;
                        setMessages((prev) =>
                            prev.map((message) =>
                                message.id === aiMessageId
                                    ? {
                                          ...message,
                                          streaming: false,
                                          rounds: message.rounds.map((item) =>
                                              item.round === roundIndex
                                                  ? {
                                                        ...item,
                                                        plan: { proposal, status: "pending" },
                                                    }
                                                  : item,
                                          ),
                                      }
                                    : message,
                            ),
                        );
                        break;
                    }

                    if (outcome.variants) {
                        const proposal = outcome.variants;
                        setMessages((prev) =>
                            prev.map((message) =>
                                message.id === aiMessageId
                                    ? {
                                          ...message,
                                          streaming: false,
                                          rounds: message.rounds.map((item) =>
                                              item.round === roundIndex
                                                  ? {
                                                        ...item,
                                                        variants: {
                                                            proposal,
                                                            status: "pending",
                                                            selectedIndex: null,
                                                        },
                                                    }
                                                  : item,
                                          ),
                                      }
                                    : message,
                            ),
                        );
                        break;
                    }

                    if (!needsToolResults(state)) break;
                    // 读 ref 而不是渲染期快照：context 事件在本轮才把上限送回来
                    const cap = effectiveMaxRounds(serverMaxRoundsRef.current);
                    if (roundIndex + 1 >= cap) {
                        patchRound(aiMessageId, roundIndex, (item) => ({
                            ...item,
                            tools: [
                                ...item.tools,
                                {
                                    id: `${turnId}-round-cap`,
                                    name: "tool_loop",
                                    arguments: {},
                                    status: "skipped",
                                    error: `已达单次提问的工具轮次上限（${cap} 轮），请预览当前结果或继续追问`,
                                },
                            ],
                        }));
                        break;
                    }

                    const nextRound = round + 1;
                    round = nextRound;
                    setMessages((prev) =>
                        prev.map((message) =>
                            message.id === aiMessageId
                                ? { ...message, rounds: [...message.rounds, emptyRound(nextRound)] }
                                : message,
                        ),
                    );
                }
            } catch (turnError) {
                if (isAbortError(turnError) || controller.signal.aborted) {
                    stopped = true;
                } else {
                    failed = toAIErrorInfo(turnError);
                    setError(failed);
                }
            } finally {
                runningRef.current = false;
                abortRef.current = null;
                const changedIds = [...changed];
                setMessages((prev) =>
                    prev.map((message) =>
                        message.id === aiMessageId
                            ? {
                                  ...message,
                                  streaming: false,
                                  error: failed ?? undefined,
                                  discarded: stopped && changedIds.length === 0 ? true : undefined,
                              }
                            : message,
                    ),
                );
                setStatus(failed ? "error" : stopped ? "stopped" : "idle");

                // 模型不支持工具时降级到文本 JSON 指令，两条路径都要能进入预览
                const actions =
                    currentDraft.actions.length > 0
                        ? currentDraft.actions
                        : stopped || failed
                          ? []
                          : fallbackActionsFromText(lastContent);

                if (actions.length > 0) {
                    previewRef.current(actions, {
                        sessionId: activeSession,
                        turnId,
                        changedIds,
                        skillCodes: [...activatedSkillCodes].slice(0, MAX_TURN_SKILL_CODES),
                    });
                } else if (activeSession && stopped) {
                    void apiService
                        .recordTurnOutcome({
                            sessionId: activeSession,
                            turnId,
                            outcome: "discarded",
                            reason: "stopped",
                            skillCodes: [...activatedSkillCodes].slice(0, MAX_TURN_SKILL_CODES),
                        })
                        .catch(() => undefined);
                }

                // 只在回合期间切了图时才刷新；同一图纸的本地回合已经完整，回拉会覆盖本地视图
                const pendingScope = pendingReloadRef.current;
                pendingReloadRef.current = null;
                if (pendingScope && pendingScope !== localTurnScopeRef.current) {
                    refreshProjectChat(pendingScope, projectIdRef.current);
                }
                void loadSessions();
            }

            return !failed;
        },
        [
            appendEvent,
            loadSessions,
            patchRound,
            projectId,
            refreshProjectChat,
            scopeKey,
            units,
        ],
    );

    const stop = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const retry = useCallback(
        () => send(lastTextRef.current, lastRecommendedRef.current),
        [send],
    );

    const resolvePlan = useCallback(
        (messageId: string, roundIndex: number, status: PlanStatus, proposal?: PlanProposal) => {
            setMessages((prev) =>
                prev.map((message) =>
                    message.id === messageId
                        ? {
                              ...message,
                              streaming: false,
                              rounds: message.rounds.map((round) =>
                                  round.round === roundIndex && round.plan
                                      ? {
                                            ...round,
                                            plan: {
                                                proposal: proposal ?? round.plan.proposal,
                                                status,
                                            },
                                        }
                                      : round,
                              ),
                          }
                        : message,
                ),
            );
        },
        [],
    );

    const resolveVariants = useCallback(
        (
            messageId: string,
            roundIndex: number,
            status: PlanStatus,
            variant?: { proposal: VariantProposal; selectedIndex: number | null },
        ) => {
            setMessages((prev) =>
                prev.map((message) =>
                    message.id === messageId
                        ? {
                              ...message,
                              streaming: false,
                              rounds: message.rounds.map((round) =>
                                  round.round === roundIndex && round.variants
                                      ? {
                                            ...round,
                                            variants: {
                                                proposal:
                                                    variant?.proposal ?? round.variants.proposal,
                                                status,
                                                selectedIndex: variant
                                                    ? variant.selectedIndex
                                                    : round.variants.selectedIndex,
                                            },
                                        }
                                      : round,
                              ),
                          }
                        : message,
                ),
            );
        },
        [],
    );

    const startSession = useCallback(async () => {
        if (!projectId) return null;
        try {
            const { session } = await apiService.createChatSession({
                projectId,
                assistantId: assistantRef.current?.id ?? null,
                modelId: modelRef.current,
            });
            localTurnScopeRef.current = null;
            setSessionId(session.id);
            setMessages([]);
            setError(null);
            void loadSessions();
            return session.id;
        } catch (createError) {
            setError(toAIErrorInfo(createError));
            return null;
        }
    }, [loadSessions, projectId]);

    const renameSession = useCallback(
        async (title: string) => {
            if (!sessionRef.current) return;
            try {
                await apiService.patchChatSession(sessionRef.current, { title });
                void loadSessions();
            } catch (renameError) {
                setError(toAIErrorInfo(renameError));
            }
        },
        [loadSessions],
    );

    const removeSession = useCallback(
        async (id: string) => {
            try {
                await apiService.deleteChatSession(id);
                if (sessionRef.current === id) {
                    setSessionId(null);
                    setMessages([]);
                }
                void loadSessions();
            } catch (removeError) {
                setError(toAIErrorInfo(removeError));
            }
        },
        [loadSessions],
    );

    const compact = useCallback(async () => {
        if (!sessionRef.current) return null;
        try {
            const result = await apiService.compactChatSession(sessionRef.current);
            void loadSessions();
            return result;
        } catch (compactError) {
            setError(toAIErrorInfo(compactError));
            return null;
        }
    }, [loadSessions]);

    const clearLocal = useCallback(() => {
        localTurnScopeRef.current = null;
        setMessages([]);
        setSessionId(null);
        setError(null);
    }, []);

    const totals = messages.reduce(
        (acc, message) => {
            for (const item of message.rounds) {
                if (!item.usage) continue;
                acc.promptTokens += item.usage.promptTokens;
                acc.completionTokens += item.usage.completionTokens;
                acc.costUsd += item.usage.costUsd ?? 0;
            }
            return acc;
        },
        { promptTokens: 0, completionTokens: 0, costUsd: 0 },
    );

    /** 回答反馈：乐观更新本地气泡；写库失败时回滚，避免气泡一直显示「已评价」 */
    const submitFeedback = useCallback(
        async (message: ChatUiMessage, rating: "up" | "down", reason?: string) => {
            const turnId = message.turnId;
            const activeSessionId = sessionRef.current;
            if (!turnId || !activeSessionId) return false;
            const skillCodes = [
                ...new Set(
                    message.rounds.flatMap((round) => round.skills.map((skill) => skill.code)),
                ),
            ].slice(0, 8);
            const nextFeedback: ChatFeedback = {
                rating,
                ...(reason?.trim() ? { reason: reason.trim() } : {}),
            };
            const previousFeedback = message.feedback;
            setMessages((prev) =>
                prev.map((item) =>
                    item.id === message.id ? { ...item, feedback: nextFeedback } : item,
                ),
            );
            try {
                await apiService.sendChatFeedback({
                    sessionId: activeSessionId,
                    turnId,
                    rating,
                    ...(nextFeedback.reason ? { reason: nextFeedback.reason } : {}),
                    ...(skillCodes.length > 0 ? { skillCodes } : {}),
                });
                return true;
            } catch (feedbackError) {
                console.error("Failed to record chat feedback", feedbackError);
                setMessages((prev) =>
                    prev.map((item) =>
                        item.id === message.id ? { ...item, feedback: previousFeedback } : item,
                    ),
                );
                return false;
            }
        },
        [],
    );

    return {
        messages,
        status,
        error,
        sessionId,
        sessions,
        pinnedSkillCodes,
        setPinnedSkillCodes,
        maxRounds,
        busy: status === "running",
        totals,
        send,
        stop,
        retry,
        resolvePlan,
        resolveVariants,
        submitFeedback,
        startSession,
        openSession,
        renameSession,
        removeSession,
        compact,
        clearLocal,
        loadSessions,
    };
}
