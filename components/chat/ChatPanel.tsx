import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    AIActionResponse,
    AiSkill,
    Assistant,
    CADElement,
    DesignConventions,
    LLMModel,
} from "../../types";
import { apiService } from "../../services/apiService";
import { getBlockCatalog } from "../../services/blockService";
import type { BlockCatalogEntry } from "../../lib/blockCatalog";
import { useAIChat, type TurnMeta } from "../../hooks/useAIChat";
import type { DesignContextMeta } from "../../lib/aiContext";
import { applyToolCalls, createDraft } from "../../lib/aiAgentLoop";
import { planToToolCalls, type PlanProposal } from "../../lib/aiPlan";
import { variantToToolCalls, type DesignVariant, type VariantProposal } from "../../lib/aiVariants";
import { formatCostUsd, formatTokens } from "../../lib/aiUi";
import ChatMessageItem from "./ChatMessageItem";
import SessionMenu from "./SessionMenu";
import SkillPinMenu from "./SkillPinMenu";

interface ChatPanelProps {
    projectId: string | null;
    /** 稳定的项目身份键；服务端 id 回填时不变 */
    projectKey?: string | null;
    currentElements: CADElement[];
    selectedIds: ReadonlySet<string>;
    units?: string;
    contextMeta?: DesignContextMeta;
    /** 项目设计约定；会随草稿进入确定性检查 */
    conventions?: DesignConventions | null;
    assistants: Assistant[];
    assistant: Assistant | null;
    onAssistantChange: (assistant: Assistant | null) => void;
    models: LLMModel[];
    onPreviewActions: (actions: AIActionResponse[], meta: TurnMeta) => void;
    onOpenAssistants: () => void;
    onOpenSkills: () => void;
    /** 画布「问 AI」送来的草稿：nonce 递增表示一次新请求 */
    draft?: { text: string; nonce: number } | null;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
    projectId,
    projectKey,
    currentElements,
    selectedIds,
    units,
    contextMeta,
    conventions,
    assistants,
    assistant,
    onAssistantChange,
    models,
    onPreviewActions,
    onOpenAssistants,
    onOpenSkills,
    draft,
}) => {
    const [input, setInput] = useState("");
    // undefined = 跟随会话绑定的模型；null = 用户显式选择自动；string = 用户显式覆盖
    const [modelChoice, setModelChoice] = useState<string | null | undefined>(undefined);
    const [skills, setSkills] = useState<AiSkill[]>([]);
    const [blockCatalog, setBlockCatalog] = useState<BlockCatalogEntry[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        let cancelled = false;
        getBlockCatalog(projectId ?? undefined).then(({ entries }) => {
            if (!cancelled) setBlockCatalog(entries);
        });
        return () => {
            cancelled = true;
        };
    }, [projectId]);

    const chat = useAIChat({
        projectId,
        projectKey,
        currentElements,
        selectedIds,
        units,
        contextMeta,
        conventions,
        assistant,
        modelId: modelChoice,
        onPreviewActions,
    });

    const {
        messages,
        busy,
        sessionId,
        sessions,
        pinnedSkillCodes,
        totals,
        resolvePlan,
        resolveVariants,
    } = chat;

    /** 计划/方案是模型回合的延续，采纳率要归到同一批激活技能上 */
    const skillCodesOf = useCallback(
        (messageId: string): string[] => {
            const message = chat.messages.find((item) => item.id === messageId);
            if (!message) return [];
            return [
                ...new Set(
                    message.rounds.flatMap((round) => round.skills.map((skill) => skill.code)),
                ),
            ].slice(0, 8);
        },
        [chat.messages],
    );

    const handleApprovePlan = useCallback(
        async (messageId: string, roundIndex: number, plan: PlanProposal, turnId?: string) => {
            const calls = planToToolCalls(plan);
            const catalog = await getBlockCatalog(projectId ?? undefined);
            const outcome = applyToolCalls(
                calls,
                createDraft(currentElements, [...selectedIds], catalog, conventions ?? undefined),
            );
            if (outcome.draft.actions.length === 0) {
                resolvePlan(messageId, roundIndex, "failed", plan);
                return;
            }
            const changed = new Set<string>();
            for (const result of outcome.results) {
                for (const id of result.changedIds ?? []) changed.add(id);
            }
            resolvePlan(messageId, roundIndex, "approved", plan);
            onPreviewActions(outcome.draft.actions, {
                sessionId,
                turnId: turnId ?? `plan-${Date.now()}`,
                changedIds: [...changed],
                skillCodes: skillCodesOf(messageId),
            });
        },
        [
            currentElements,
            selectedIds,
            projectId,
            resolvePlan,
            sessionId,
            onPreviewActions,
            skillCodesOf,
            conventions,
        ],
    );

    const handleDismissPlan = useCallback(
        (messageId: string, roundIndex: number) => {
            resolvePlan(messageId, roundIndex, "dismissed");
        },
        [resolvePlan],
    );

    const handleChooseVariant = useCallback(
        async (
            messageId: string,
            roundIndex: number,
            proposal: VariantProposal,
            variantIndex: number,
            turnId?: string,
        ) => {
            const variant: DesignVariant | undefined = proposal.variants[variantIndex];
            if (!variant) return;
            const catalog = await getBlockCatalog(projectId ?? undefined);
            const outcome = applyToolCalls(
                variantToToolCalls(variant),
                createDraft(currentElements, [...selectedIds], catalog, conventions ?? undefined),
            );
            if (outcome.draft.actions.length === 0) {
                resolveVariants(messageId, roundIndex, "failed", {
                    proposal,
                    selectedIndex: variantIndex,
                });
                return;
            }
            const changed = new Set<string>();
            for (const result of outcome.results) {
                for (const id of result.changedIds ?? []) changed.add(id);
            }
            resolveVariants(messageId, roundIndex, "approved", {
                proposal,
                selectedIndex: variantIndex,
            });
            onPreviewActions(outcome.draft.actions, {
                sessionId,
                turnId: turnId ?? `variants-${Date.now()}`,
                changedIds: [...changed],
                skillCodes: skillCodesOf(messageId),
            });
        },
        [
            currentElements,
            selectedIds,
            projectId,
            resolveVariants,
            sessionId,
            onPreviewActions,
            skillCodesOf,
            conventions,
        ],
    );

    const handleDismissVariants = useCallback(
        (messageId: string, roundIndex: number) => {
            resolveVariants(messageId, roundIndex, "dismissed");
        },
        [resolveVariants],
    );

    useEffect(() => {
        apiService
            .getSkills()
            .then(({ skills: rows }) => setSkills(rows))
            .catch(() => setSkills([]));
    }, []);

    useEffect(() => {
        const node = scrollRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [messages]);

    /** 「问 AI」送来的草稿：nonce 变化时在渲染期同步进输入框 */
    const [seenDraftNonce, setSeenDraftNonce] = useState(0);
    if (draft && draft.nonce !== seenDraftNonce) {
        setSeenDraftNonce(draft.nonce);
        setInput(draft.text);
    }

    /** 聚焦放在渲染之后，光标停在草稿末尾便于直接改 */
    useEffect(() => {
        if (!draft) return;
        const node = composerRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(draft.text.length, draft.text.length);
    }, [draft]);
    const activeSession = useMemo(
        () => sessions.find((session) => session.id === sessionId) ?? null,
        [sessions, sessionId],
    );
    const modelId = modelChoice === undefined ? (activeSession?.modelId ?? null) : modelChoice;

    const activeModel = useMemo(() => {
        if (modelId) return models.find((model) => model.id === modelId) ?? null;
        const byAssistant = assistant?.llmModelId
            ? models.find((model) => model.id === assistant.llmModelId)
            : null;
        return byAssistant ?? models.find((model) => model.isDefault) ?? null;
    }, [modelId, models, assistant]);

    const handleAssistantChange = useCallback(
        (id: string) => {
            const next = assistants.find((item) => item.id === id) ?? null;
            onAssistantChange(next);
            if (sessionId) {
                void apiService
                    .patchChatSession(sessionId, { assistantId: next?.id ?? null })
                    .catch(() => undefined);
            }
        },
        [assistants, onAssistantChange, sessionId],
    );

    const handleModelChange = useCallback(
        (id: string) => {
            const next = id || null;
            setModelChoice(next);
            if (sessionId) {
                void apiService
                    .patchChatSession(sessionId, { modelId: next })
                    .catch(() => undefined);
            }
        },
        [sessionId],
    );

    const handleOpenSession = useCallback(
        (id: string) => {
            setModelChoice(undefined);
            void chat.openSession(id);
        },
        [chat],
    );

    const handleSend = useCallback(() => {
        if (busy) {
            chat.stop();
            return;
        }
        const text = input.trim();
        if (!text) return;
        setInput("");
        void chat.send(text);
    }, [busy, chat, input]);

    return (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-cad-border bg-cad-panel">
                <div className="p-1.5 bg-black/10 dark:bg-black/30 rounded-md shrink-0">
                    <span
                        className={`material-symbols-outlined ${assistant ? assistant.color : "text-cad-primary"} text-[20px]`}
                    >
                        {assistant ? assistant.icon : "architecture"}
                    </span>
                </div>
                <div className="flex-1 min-w-0">
                    <select
                        value={assistant?.id || ""}
                        onChange={(e) => handleAssistantChange(e.target.value)}
                        className="w-full text-xs font-bold text-cad-text bg-transparent border-0 p-0 focus:ring-0 cursor-pointer"
                        title="选择助手"
                    >
                        <option value="">AI CAD Designer</option>
                        {assistants.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                    <select
                        value={modelId || ""}
                        onChange={(e) => handleModelChange(e.target.value)}
                        className="w-full text-[10px] text-cad-muted bg-transparent border-0 p-0 focus:ring-0 cursor-pointer"
                        title="会话级模型覆盖，留空则由服务端解析链选择"
                    >
                        <option value="">
                            {activeModel ? `自动 · ${activeModel.name}` : "自动模型（未配置）"}
                        </option>
                        {models
                            .filter((model) => model.isActive)
                            .map((model) => (
                                <option key={model.id} value={model.id}>
                                    {model.name} · {model.provider}
                                </option>
                            ))}
                    </select>
                </div>
                <SkillPinMenu
                    skills={skills}
                    pinned={pinnedSkillCodes}
                    onChange={chat.setPinnedSkillCodes}
                />
                <SessionMenu
                    sessions={sessions}
                    activeSessionId={sessionId}
                    busy={busy}
                    onOpen={handleOpenSession}
                    onNew={() => void chat.startSession()}
                    onRename={(id, title) => {
                        void apiService
                            .patchChatSession(id, { title })
                            .then(() => chat.loadSessions());
                    }}
                    onDelete={(id) => {
                        if (confirm("删除该会话及其历史？")) void chat.removeSession(id);
                    }}
                    onCompact={() => void chat.compact()}
                />
            </div>

            {!projectId && (
                <p className="px-3 py-1.5 text-[10px] text-amber-500 bg-amber-500/10 border-b border-cad-border">
                    未打开图纸，本轮对话不会写入服务端历史。
                </p>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-cad-bg">
                {messages.length === 0 && (
                    <div className="space-y-2 text-[11px] text-cad-muted">
                        <p>
                            用自然语言描述要画的图形或要做的编辑，例如"在原点画一个 100×60
                            的矩形，再向右阵列 3 个"。
                        </p>
                        <p>
                            工具先在草稿上求值，结果需在预览对话框确认后才会写入图纸，整批只占一步撤销。
                        </p>
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={onOpenAssistants}
                                className="px-2 py-1 rounded border border-cad-border hover:bg-cad-text/5"
                            >
                                配置助手
                            </button>
                            <button
                                onClick={onOpenSkills}
                                className="px-2 py-1 rounded border border-cad-border hover:bg-cad-text/5"
                            >
                                管理技能
                            </button>
                        </div>
                    </div>
                )}
                {messages.map((message) => (
                    <ChatMessageItem
                        key={message.id}
                        message={message}
                        elements={currentElements}
                        selectedIds={selectedIds}
                        blockCatalog={blockCatalog}
                        onRetry={chat.retry}
                        onApprovePlan={handleApprovePlan}
                        onDismissPlan={handleDismissPlan}
                        onChooseVariant={handleChooseVariant}
                        onDismissVariants={handleDismissVariants}
                        onFeedback={chat.submitFeedback}
                    />
                ))}
                {chat.error && messages.length === 0 && (
                    <p className="text-[11px] text-red-500">{chat.error.message}</p>
                )}
            </div>

            <div className="px-3 py-2 bg-cad-panel border-t border-cad-border">
                <div className="flex items-center justify-between text-[10px] text-cad-muted pb-1">
                    <span>
                        工具轮次上限 {chat.maxRounds}
                        {assistant?.toolNames ? ` · 白名单 ${assistant.toolNames.length} 个` : ""}
                    </span>
                    <span className="font-mono">
                        {formatTokens(totals.promptTokens + totals.completionTokens)} tok ·{" "}
                        {formatCostUsd(totals.costUsd)}
                    </span>
                </div>
                <div className="relative bg-white dark:bg-[#0d1116] border border-cad-border rounded-lg focus-within:ring-1 focus-within:ring-cad-primary focus-within:border-cad-primary transition-all">
                    <textarea
                        ref={composerRef}
                        className="w-full bg-transparent border-0 rounded-lg pl-3 pr-20 py-3 text-sm text-cad-text placeholder-gray-500 focus:ring-0 resize-none min-h-[44px]"
                        placeholder={assistant ? `向 ${assistant.name} 提问…` : "让 AI 画图…"}
                        rows={2}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <div className="absolute right-2 bottom-2 flex items-center gap-1">
                        <button
                            onClick={chat.clearLocal}
                            disabled={busy || messages.length === 0}
                            className="p-1.5 text-cad-muted hover:text-cad-text rounded-md disabled:opacity-40"
                            title="清空当前视图（服务端历史保留，可从会话历史重新打开）"
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                delete_sweep
                            </span>
                        </button>
                        <button
                            onClick={handleSend}
                            disabled={!busy && !input.trim()}
                            className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
                                busy
                                    ? "text-red-500 hover:bg-red-500/10"
                                    : "text-cad-primary hover:bg-cad-primary/10"
                            }`}
                            title={busy ? "停止生成" : "发送"}
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                {busy ? "stop_circle" : "send"}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChatPanel;
