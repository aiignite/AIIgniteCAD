import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    AIActionResponse,
    Assistant,
    CADElement,
    DesignConventions,
    SkillContextSignal,
} from "../../types";
import type { UseAIRegistryResult } from "../../hooks/useAIRegistry";
import AssistantsPanel from "../AssistantsPanel";
import AISkillsPanel from "../AISkillsPanel";
import LLMModelsPanel from "../LLMModelsPanel";
import { apiService } from "../../services/apiService";
import { getBlockCatalog } from "../../services/blockService";
import type { BlockCatalogEntry } from "../../lib/blockCatalog";
import { useAIChat, type TurnMeta } from "../../hooks/useAIChat";
import { useSkillCandidates } from "../../hooks/useSkillCandidates";
import type { DesignContextMeta } from "../../lib/aiContext";
import { applyToolCalls, createDraft } from "../../lib/aiAgentLoop";
import { planToToolCalls, type PlanProposal } from "../../lib/aiPlan";
import { variantToToolCalls, type DesignVariant, type VariantProposal } from "../../lib/aiVariants";
import { formatCostUsd, formatTokens } from "../../lib/aiUi";
import ChatMessageItem from "./ChatMessageItem";
import SessionPanel from "./SessionPanel";
import SkillCandidateBar from "./SkillCandidateBar";
import SkillPinMenu from "./SkillPinMenu";
import { useI18n, type TranslationKey } from "../../lib/i18n";

export type AIDrawerPanel = "assistants" | "skills" | "models" | "sessions";

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
    /** 助手 / 技能 / 模型共用同一份注册表，内部抽屉直接读写 */
    registry: UseAIRegistryResult;
    assistant: Assistant | null;
    onAssistantChange: (assistant: Assistant | null) => void;
    onPreviewActions: (actions: AIActionResponse[], meta: TurnMeta) => void;
    /** 浮窗关闭时暂停候选技能解析，避免隐藏面板持续请求 */
    active?: boolean;
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
    registry,
    assistant,
    onAssistantChange,
    onPreviewActions,
    active = true,
    draft,
}) => {
    const { t } = useI18n();
    const { assistants, models, skills } = registry;
    const [input, setInput] = useState("");
    // undefined = 跟随会话绑定的模型；null = 用户显式选择自动；string = 用户显式覆盖
    const [modelChoice, setModelChoice] = useState<string | null | undefined>(undefined);
    const [activeDrawer, setActiveDrawer] = useState<AIDrawerPanel | null>(null);
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

    /** 上轮技能用于会话惯性与短消息沿用；只取最近一条助手消息 */
    const recentSkillCodes = useMemo(() => {
        const lastAi = [...messages].reverse().find((message) => message.sender === "ai");
        if (!lastAi) return [];
        return [
            ...new Set(lastAi.rounds.flatMap((round) => round.skills.map((skill) => skill.code))),
        ].slice(0, 8);
    }, [messages]);

    /** 旧→新，最多 3 条用户消息；后端按轮次衰减关键词权重 */
    const historyTexts = useMemo(
        () =>
            messages
                .filter((message) => message.sender === "user")
                .slice(-3)
                .map((message) => message.text),
        [messages],
    );

    const selectionTypes = useMemo(
        () => [
            ...new Set(
                currentElements
                    .filter((element) => selectedIds.has(element.id))
                    .map((element) => element.type),
            ),
        ],
        [currentElements, selectedIds],
    );

    const contextSignals = useMemo<SkillContextSignal[]>(() => {
        const signals: SkillContextSignal[] = [];
        if (selectedIds.size > 0) signals.push("selection");
        if (contextMeta?.layers?.some((layer) => layer.name !== "0")) signals.push("layers");
        if ((contextMeta?.blockCount ?? 0) > 0) signals.push("blocks");
        if ((contextMeta?.revision ?? 0) > 0) signals.push("revision");
        if (currentElements.some((element) => element.type === "DIMENSION")) {
            signals.push("dimensions");
        }
        return signals;
    }, [selectedIds, contextMeta, currentElements]);

    const skillCandidates = useSkillCandidates({
        enabled: active,
        message: input,
        assistant,
        skills,
        pinnedSkillCodes,
        recentSkillCodes,
        historyTexts,
        selectionTypes,
        contextSignals,
        conversationId: sessionId,
    });

    const availableSkills = useMemo(
        () =>
            skills
                .filter((skill) => skill.isEnabled)
                .slice()
                .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)),
        [skills],
    );

    const quickPrompts = useMemo(() => {
        const examples = availableSkills.flatMap((skill) => skill.examples ?? []).slice(0, 3);
        return [
            t("chat.quickPromptRectangle"),
            t("chat.quickPromptReview"),
            ...examples,
        ].slice(0, 4);
    }, [availableSkills, t]);

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

    const fillComposer = useCallback((text: string) => {
        setInput(text);
        requestAnimationFrame(() => {
            composerRef.current?.focus();
            composerRef.current?.setSelectionRange(text.length, text.length);
        });
    }, []);

    const handleOpenSession = useCallback(
        (id: string) => {
            setModelChoice(undefined);
            skillCandidates.reset();
            setActiveDrawer(null);
            void chat.openSession(id);
        },
        [chat, skillCandidates],
    );

    const handleSend = useCallback(() => {
        if (busy) {
            chat.stop();
            return;
        }
        const text = input.trim();
        if (!text) return;
        const recommended = skillCandidates.recommendedSkillCodes;
        setInput("");
        skillCandidates.reset();
        void chat.send(text, recommended);
    }, [busy, chat, input, skillCandidates]);

    return (
        <div className="relative flex flex-col h-full bg-cad-bg">
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
                        title={t("chat.assistantSelect")}
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
                        title={t("chat.modelOverride")}
                    >
                        <option value="">
                            {activeModel
                                ? t("chat.autoModel", { name: activeModel.name })
                                : t("chat.autoModelUnset")}
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
                <button
                    onClick={() => setActiveDrawer("assistants")}
                    className="p-1.5 rounded-md text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                    title={t("chat.assistantManage")}
                    aria-label={t("chat.assistantManage")}
                >
                    <span className="material-symbols-outlined text-[18px]">group</span>
                </button>
                <button
                    onClick={() => setActiveDrawer("skills")}
                    className="p-1.5 rounded-md text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                    title={t("chat.skillManage")}
                    aria-label={t("chat.skillManage")}
                >
                    <span className="material-symbols-outlined text-[18px]">extension</span>
                </button>
                <button
                    onClick={() => setActiveDrawer("models")}
                    className="p-1.5 rounded-md text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                    title={t("chat.modelSettings")}
                    aria-label={t("chat.modelSettings")}
                >
                    <span className="material-symbols-outlined text-[18px]">deployed_code</span>
                </button>
                <button
                    onClick={() => setActiveDrawer("sessions")}
                    className="p-1.5 rounded-md text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                    title={t("chat.sessions")}
                    aria-label={t("chat.sessions")}
                >
                    <span className="material-symbols-outlined text-[18px]">history</span>
                </button>
            </div>

            {!projectId && (
                <p className="px-3 py-1.5 text-[10px] text-amber-500 bg-amber-500/10 border-b border-cad-border">
                    {t("chat.noProjectWarning")}
                </p>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-cad-bg">
                {messages.length === 0 && (
                    <div className="space-y-5 text-[11px] text-cad-muted">
                        <div className="space-y-2">
                            <p className="text-sm font-bold text-cad-text">
                                {assistant?.name || "AI CAD Designer"}
                            </p>
                            <p>{t("chat.intro")}</p>
                            <p>{t("chat.introTools")}</p>
                        </div>

                        <div>
                            <p className="mb-1.5 font-bold text-cad-text">
                                {t("chat.suggested")}
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {quickPrompts.map((prompt) => (
                                    <button
                                        key={prompt}
                                        onClick={() => fillComposer(prompt)}
                                        title={prompt}
                                        className="max-w-full truncate rounded-md border border-cad-border bg-cad-panel px-2 py-1 text-[10px] text-cad-muted transition-colors hover:border-cad-primary/50 hover:bg-cad-primary/10 hover:text-cad-text"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="mb-1.5 flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[13px] text-emerald-500">
                                    auto_awesome
                                </span>
                                <span className="font-bold text-cad-text">
                                    {t("chat.skillsAvailable")}
                                </span>
                                <span className="ml-auto text-[10px] text-cad-muted">
                                    {t("chat.skillsCount", { count: availableSkills.length })}
                                </span>
                            </div>
                            <div className="grid gap-1">
                                {availableSkills.slice(0, 6).map((skill) => (
                                    <button
                                        key={skill.code}
                                        onClick={() =>
                                            fillComposer(
                                                t("chat.skillInvoke", { name: skill.name }),
                                            )
                                        }
                                        className="flex items-center gap-2 rounded-lg border border-cad-border bg-cad-panel px-2.5 py-1.5 text-left text-[11px] text-cad-text transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/5"
                                        title={`${skill.description}\n${t("chat.skillKeywords", {
                                            keywords:
                                                skill.keywords.join(", ") ||
                                                t("chat.skillNoKeywords"),
                                        })}`}
                                    >
                                        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                                        <span className="min-w-0 flex-1 truncate">
                                            {skill.name}
                                        </span>
                                        <span className="shrink-0 text-[9px] text-cad-muted">
                                            {skill.category}
                                        </span>
                                    </button>
                                ))}
                                {availableSkills.length === 0 && (
                                    <p className="text-[10px] text-cad-muted">
                                        {t("chat.noSkills")}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-1">
                            <button
                                onClick={() => setActiveDrawer("assistants")}
                                className="px-2 py-1 rounded border border-cad-border hover:bg-cad-text/5"
                            >
                                {t("chat.configureAssistant")}
                            </button>
                            <button
                                onClick={() => setActiveDrawer("skills")}
                                className="px-2 py-1 rounded border border-cad-border hover:bg-cad-text/5"
                            >
                                {t("chat.manageSkills")}
                            </button>
                            <button
                                onClick={() => setActiveDrawer("models")}
                                className="px-2 py-1 rounded border border-cad-border hover:bg-cad-text/5"
                            >
                                {t("chat.modelSettings")}
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
                <SkillCandidateBar
                    candidates={skillCandidates.candidates}
                    isResolving={skillCandidates.isResolving}
                    error={skillCandidates.error}
                    removedCount={skillCandidates.removedCount}
                    onRemove={skillCandidates.removeCandidate}
                    onRestore={skillCandidates.restoreCandidates}
                />
                <div className="flex items-center justify-between text-[10px] text-cad-muted pb-1">
                    <span>
                        {t("chat.maxRounds", { count: chat.maxRounds })}
                        {assistant?.toolNames
                            ? t("chat.toolWhitelist", { count: assistant.toolNames.length })
                            : ""}
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
                        placeholder={
                            assistant
                                ? t("chat.askAssistant", { name: assistant.name })
                                : t("chat.askAI")
                        }
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
                            onClick={() => {
                                chat.clearLocal();
                                skillCandidates.reset();
                            }}
                            disabled={busy || messages.length === 0}
                            className="p-1.5 text-cad-muted hover:text-cad-text rounded-md disabled:opacity-40"
                            title={t("chat.clearView")}
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
                            title={busy ? t("chat.stop") : t("chat.send")}
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                {busy ? "stop_circle" : "send"}
                            </span>
                        </button>
                    </div>
                </div>
            </div>

            {activeDrawer && (
                <div
                    className="absolute inset-0 z-30 flex justify-end bg-black/20"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setActiveDrawer(null);
                    }}
                >
                    <div
                        role="dialog"
                        aria-label={t("chat.drawerAria", {
                            title: t(DRAWER_TITLE_KEYS[activeDrawer]),
                        })}
                        className="flex h-full w-[min(380px,92%)] flex-col border-l border-cad-border bg-cad-panel shadow-2xl"
                    >
                        <div className="flex items-center justify-between border-b border-cad-border px-3 py-2">
                            <span className="flex items-center gap-1.5 text-xs font-bold text-cad-text">
                                <span className="material-symbols-outlined text-[18px] text-cad-primary">
                                    {DRAWER_ICONS[activeDrawer]}
                                </span>
                                {t(DRAWER_TITLE_KEYS[activeDrawer])}
                            </span>
                            <button
                                onClick={() => setActiveDrawer(null)}
                                className="rounded p-1 text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                                title={t("chat.closeDrawer")}
                                aria-label={t("chat.closeDrawer")}
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                            {activeDrawer === "assistants" && (
                                <AssistantsPanel registry={registry} />
                            )}
                            {activeDrawer === "skills" && <AISkillsPanel registry={registry} />}
                            {activeDrawer === "models" && <LLMModelsPanel registry={registry} />}
                            {activeDrawer === "sessions" && (
                                <SessionPanel
                                    sessions={sessions}
                                    activeSessionId={sessionId}
                                    busy={busy}
                                    onOpen={handleOpenSession}
                                    onNew={() => {
                                        skillCandidates.reset();
                                        setActiveDrawer(null);
                                        void chat.startSession();
                                    }}
                                    onRename={(id, title) => {
                                        void apiService
                                            .patchChatSession(id, { title })
                                            .then(() => chat.loadSessions());
                                    }}
                                    onDelete={(id) => {
                                        if (confirm(t("chat.deleteSessionConfirm"))) {
                                            void chat.removeSession(id);
                                        }
                                    }}
                                    onCompact={() => void chat.compact()}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const DRAWER_TITLE_KEYS: Record<AIDrawerPanel, TranslationKey> = {
    assistants: "chat.drawer.assistants",
    skills: "chat.drawer.skills",
    models: "chat.drawer.models",
    sessions: "chat.drawer.sessions",
};

const DRAWER_ICONS: Record<AIDrawerPanel, string> = {
    assistants: "group",
    skills: "extension",
    models: "deployed_code",
    sessions: "history",
};

export default ChatPanel;
