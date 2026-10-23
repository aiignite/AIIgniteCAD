import React from "react";
import type { ChatToolEntry, ToolEntryStatus } from "../../lib/aiChatHistory";
import { describeToolCall } from "../../lib/aiUi";

interface ToolCallTimelineProps {
    tools: ChatToolEntry[];
    /** 用户放弃了这批动作时，成功条目改为显示 discarded 态 */
    discarded?: boolean;
}

type VisualStatus = ToolEntryStatus | "discarded";

const VISUAL: Record<VisualStatus, { icon: string; className: string; label: string }> = {
    proposed: {
        icon: "hourglass_top",
        className: "text-cad-muted",
        label: "待执行",
    },
    ok: {
        icon: "check_circle",
        className: "text-emerald-500",
        label: "已生效",
    },
    rejected: {
        icon: "error",
        className: "text-red-500",
        label: "被拒绝",
    },
    skipped: {
        icon: "skip_next",
        className: "text-cad-muted",
        label: "已跳过",
    },
    discarded: {
        icon: "block",
        className: "text-amber-500",
        label: "已放弃",
    },
};

const statusOf = (tool: ChatToolEntry, discarded?: boolean): VisualStatus => {
    if (tool.status === "ok" && discarded) return "discarded";
    return tool.status;
};

const ToolCallTimeline: React.FC<ToolCallTimelineProps> = ({ tools, discarded }) => {
    if (tools.length === 0) return null;

    return (
        <ul className="space-y-1">
            {tools.map((tool) => {
                const status = statusOf(tool, discarded);
                const visual = VISUAL[status];
                const line = describeToolCall({
                    name: tool.name,
                    arguments: tool.arguments,
                });
                const hint = tool.error || tool.summary;
                return (
                    <li
                        key={tool.id}
                        className="flex items-start gap-2 text-[11px] leading-relaxed"
                        title={visual.label}
                    >
                        <span
                            className={`material-symbols-outlined text-[14px] shrink-0 ${visual.className}`}
                        >
                            {visual.icon}
                        </span>
                        <span className="min-w-0">
                            <span className="text-cad-text">{line}</span>
                            {hint && (
                                <span
                                    className={`block truncate ${
                                        status === "rejected" ? "text-red-500" : "text-cad-muted"
                                    }`}
                                >
                                    {hint}
                                </span>
                            )}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
};

export default ToolCallTimeline;
