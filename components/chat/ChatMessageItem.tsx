import React, { useState } from "react";
import type { CADElement, DesignConventions } from "../../types";
import type { ChatFeedback, ChatUiMessage } from "../../lib/aiChatHistory";
import type { PlanProposal } from "../../lib/aiPlan";
import type { DesignVariant, VariantProposal } from "../../lib/aiVariants";
import { formatCostUsd, formatTokens } from "../../lib/aiUi";
import type { BlockCatalogEntry } from "../../lib/blockCatalog";
import MarkdownMessage from "../MarkdownMessage";
import PlanCard from "./PlanCard";
import VariantCards from "./VariantCards";
import SkillActivationChips from "./SkillActivationChips";
import ToolCallTimeline from "./ToolCallTimeline";

interface ChatMessageItemProps {
    message: ChatUiMessage;
    elements: CADElement[];
    selectedIds: ReadonlySet<string>;
    blockCatalog?: BlockCatalogEntry[];
    /** 项目设计约定：计划预检会按它检查图层与字高 */
    conventions?: DesignConventions | null;
    onRetry?: () => void;
    onApprovePlan?: (
        messageId: string,
        roundIndex: number,
        plan: PlanProposal,
        turnId?: string,
    ) => void;
    onDismissPlan?: (messageId: string, roundIndex: number) => void;
    onChooseVariant?: (
        messageId: string,
        roundIndex: number,
        proposal: VariantProposal,
        variantIndex: number,
        turnId?: string,
    ) => void;
    onDismissVariants?: (messageId: string, roundIndex: number) => void;
    onFeedback?: (
        message: ChatUiMessage,
        rating: ChatFeedback["rating"],
        reason?: string,
    ) => Promise<boolean>;
}

const DOWN_REASONS = ["不准确", "不符合约定", "改动多余"];

const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
    message,
    elements,
    selectedIds,
    blockCatalog,
    conventions,
    onRetry,
    onApprovePlan,
    onDismissPlan,
    onChooseVariant,
    onDismissVariants,
    onFeedback,
}) => {
    const [copied, setCopied] = useState(false);
    const [reasonPickerOpen, setReasonPickerOpen] = useState(false);

    const handleCopy = () => {
        void navigator.clipboard.writeText(message.text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    if (message.sender === "user") {
        return (
            <div className="flex flex-row-reverse gap-3">
                <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-none text-sm leading-relaxed bg-cad-primary text-white shadow-sm">
                    <span className="whitespace-pre-wrap break-words">{message.text}</span>
                </div>
            </div>
        );
    }

    const lastRound = message.rounds[message.rounds.length - 1];
    const isStreaming = Boolean(message.streaming);

    return (
        <div className="flex gap-3">
            <div className="size-8 rounded-full bg-white dark:bg-[#1e293b] flex items-center justify-center shrink-0 border border-cad-border shadow-sm">
                <span className="material-symbols-outlined text-cad-primary text-[16px]">
                    smart_toy
                </span>
            </div>
            <div className="flex flex-col gap-2 max-w-[85%] min-w-0 flex-1">
                <div className="group relative p-3 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-sm border bg-white dark:bg-[#1e293b] border-cad-border text-cad-text space-y-3">
                    {message.rounds.map((round) => (
                        <div key={round.round} className="space-y-1.5">
                            {message.rounds.length > 1 && (
                                <p className="text-[10px] uppercase tracking-wide text-cad-muted">
                                    第 {round.round + 1} 轮
                                </p>
                            )}
                            <SkillActivationChips skills={round.skills} />
                            {round.fallbacks.map((fallback, index) => (
                                <p
                                    key={`${fallback.to}-${index}`}
                                    className="text-[11px] text-amber-500"
                                    title={fallback.message}
                                >
                                    模型故障转移：{fallback.from} → {fallback.to}
                                </p>
                            ))}
                            {round.text && <MarkdownMessage content={round.text} />}
                            <ToolCallTimeline tools={round.tools} discarded={message.discarded} />
                            {round.plan && (
                                <PlanCard
                                    proposal={round.plan.proposal}
                                    status={round.plan.status}
                                    elements={elements}
                                    selectedIds={[...selectedIds]}
                                    blockCatalog={blockCatalog}
                                    conventions={conventions}
                                    onApprove={(proposal) =>
                                        onApprovePlan?.(
                                            message.id,
                                            round.round,
                                            proposal,
                                            message.turnId,
                                        )
                                    }
                                    onDismiss={() => onDismissPlan?.(message.id, round.round)}
                                />
                            )}
                            {round.variants && (
                                <VariantCards
                                    proposal={round.variants.proposal}
                                    status={round.variants.status}
                                    selectedIndex={round.variants.selectedIndex}
                                    elements={elements}
                                    selectedIds={selectedIds}
                                    blockCatalog={blockCatalog}
                                    onChoose={(variant: DesignVariant, index: number) =>
                                        onChooseVariant?.(
                                            message.id,
                                            round.round,
                                            round.variants!.proposal,
                                            index,
                                            message.turnId,
                                        )
                                    }
                                    onDismiss={() => onDismissVariants?.(message.id, round.round)}
                                />
                            )}
                            {round.usage && (
                                <p className="text-[10px] text-cad-muted font-mono">
                                    {formatTokens(round.usage.promptTokens)} in ·{" "}
                                    {formatTokens(round.usage.completionTokens)} out
                                    {round.usage.costUsd !== null
                                        ? ` · ${formatCostUsd(round.usage.costUsd)}`
                                        : ""}
                                    {round.usage.provider ? ` · ${round.usage.provider}` : ""}
                                </p>
                            )}
                        </div>
                    ))}

                    {isStreaming && !lastRound?.text && lastRound?.tools.length === 0 && (
                        <div className="flex gap-1 items-center py-1">
                            <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" />
                            <span
                                className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"
                                style={{ animationDelay: "0.1s" }}
                            />
                            <span
                                className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"
                                style={{ animationDelay: "0.2s" }}
                            />
                        </div>
                    )}

                    {message.discarded && (
                        <p className="text-[11px] text-amber-500">
                            本批草稿动作已放弃，未写入图纸。
                        </p>
                    )}

                    {!isStreaming && message.text && (
                        <button
                            onClick={handleCopy}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-cad-text rounded border border-cad-border flex items-center gap-1"
                            title="复制回复"
                        >
                            <span className="material-symbols-outlined text-[14px]">
                                {copied ? "check" : "content_copy"}
                            </span>
                            {copied ? "已复制" : "复制"}
                        </button>
                    )}
                </div>

                {message.error && (
                    <div className="flex items-start gap-2 p-2 rounded-lg border border-red-500/40 bg-red-500/10 text-[11px] text-cad-text">
                        <span className="material-symbols-outlined text-red-500 text-[16px] shrink-0">
                            cloud_off
                        </span>
                        <div className="min-w-0">
                            <p className="break-words">{message.error.message}</p>
                            {message.error.hint && (
                                <p className="text-cad-muted break-words">{message.error.hint}</p>
                            )}
                            <p className="font-mono text-[10px] text-cad-muted">
                                {message.error.code}
                            </p>
                        </div>
                        {message.error.retryable && onRetry && (
                            <button
                                onClick={onRetry}
                                className="ml-auto shrink-0 px-2 py-1 rounded border border-red-500/40 hover:bg-red-500/20 text-red-500"
                            >
                                重试
                            </button>
                        )}
                    </div>
                )}

                {!isStreaming && message.turnId && onFeedback && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-cad-muted">
                        <span>这个回答有帮助吗？</span>
                        <button
                            onClick={() => {
                                setReasonPickerOpen(false);
                                void onFeedback(message, "up");
                            }}
                            aria-label="回答有帮助"
                            aria-pressed={message.feedback?.rating === "up"}
                            className={`px-1.5 py-0.5 rounded border flex items-center gap-0.5 ${
                                message.feedback?.rating === "up"
                                    ? "border-emerald-500/60 text-emerald-500 bg-emerald-500/10"
                                    : "border-cad-border hover:text-cad-text hover:bg-cad-text/10"
                            }`}
                        >
                            <span className="material-symbols-outlined text-[13px]">thumb_up</span>
                            有帮助
                        </button>
                        <button
                            onClick={() => setReasonPickerOpen((open) => !open)}
                            aria-label="回答没帮助"
                            aria-pressed={message.feedback?.rating === "down"}
                            className={`px-1.5 py-0.5 rounded border flex items-center gap-0.5 ${
                                message.feedback?.rating === "down"
                                    ? "border-amber-500/60 text-amber-500 bg-amber-500/10"
                                    : "border-cad-border hover:text-cad-text hover:bg-cad-text/10"
                            }`}
                        >
                            <span className="material-symbols-outlined text-[13px]">thumb_down</span>
                            没帮助
                        </button>
                        {reasonPickerOpen && (
                            <div className="flex flex-wrap items-center gap-1">
                                {DOWN_REASONS.map((reason) => (
                                    <button
                                        key={reason}
                                        onClick={() => {
                                            setReasonPickerOpen(false);
                                            void onFeedback(message, "down", reason);
                                        }}
                                        className="px-1.5 py-0.5 rounded border border-cad-border hover:bg-cad-text/10 hover:text-cad-text"
                                    >
                                        {reason}
                                    </button>
                                ))}
                            </div>
                        )}
                        {message.feedback && !reasonPickerOpen && (
                            <span>
                                已记录
                                {message.feedback.reason ? `：${message.feedback.reason}` : ""}
                            </span>
                        )}
                    </div>
                )}

                {message.timestamp && (
                    <p className="text-[10px] text-cad-muted">{message.timestamp}</p>
                )}
            </div>
        </div>
    );
};

export default ChatMessageItem;
