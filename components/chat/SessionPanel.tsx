import React, { useState } from "react";
import type { ChatSessionInfo } from "../../types";
import { formatSessionTime } from "../../lib/aiUi";

interface SessionPanelProps {
    sessions: ChatSessionInfo[];
    activeSessionId: string | null;
    busy: boolean;
    onOpen: (id: string) => void;
    onNew: () => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
    onCompact: () => void;
}

/** 会话历史抽屉：替代原来的下拉菜单，长标题和更多操作不再挤在弹层里 */
const SessionPanel: React.FC<SessionPanelProps> = ({
    sessions,
    activeSessionId,
    busy,
    onOpen,
    onNew,
    onRename,
    onDelete,
    onCompact,
}) => {
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");

    const commitRename = (id: string) => {
        const title = draft.trim();
        setRenamingId(null);
        if (title) onRename(id, title);
    };

    return (
        <div className="flex h-full flex-col bg-cad-bg">
            <div className="flex items-center gap-1 border-b border-cad-border bg-cad-panel p-2">
                <button
                    onClick={onNew}
                    disabled={busy}
                    className="flex-1 rounded border border-cad-primary/30 px-2 py-1.5 text-[11px] text-cad-primary hover:bg-cad-primary/10 disabled:opacity-50"
                >
                    新建会话
                </button>
                <button
                    onClick={onCompact}
                    disabled={busy || !activeSessionId}
                    title="把较早的消息压成摘要，降低后续 prompt 体积"
                    className="rounded px-2 py-1.5 text-[11px] text-cad-muted hover:bg-cad-text/10 hover:text-cad-text disabled:opacity-50"
                >
                    压缩上下文
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-1">
                {sessions.length === 0 && (
                    <p className="p-3 text-[11px] text-cad-muted">暂无历史会话</p>
                )}
                {sessions.map((session) => (
                    <div
                        key={session.id}
                        className={`group flex items-center gap-2 rounded px-2 py-2 text-[11px] ${
                            session.id === activeSessionId
                                ? "bg-cad-primary/10 text-cad-text"
                                : "hover:bg-cad-text/5"
                        }`}
                    >
                        {renamingId === session.id ? (
                            <input
                                autoFocus
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") commitRename(session.id);
                                    if (event.key === "Escape") setRenamingId(null);
                                }}
                                onBlur={() => commitRename(session.id)}
                                className="min-w-0 flex-1 rounded border border-cad-primary bg-transparent px-1 py-0.5 text-cad-text"
                            />
                        ) : (
                            <button
                                onClick={() => onOpen(session.id)}
                                className="min-w-0 flex-1 text-left"
                                title={session.contextSummary ?? undefined}
                            >
                                <span className="block truncate">
                                    {session.title || "未命名会话"}
                                </span>
                                <span className="block text-[10px] text-cad-muted">
                                    {formatSessionTime(session.updatedAt)}
                                    {typeof session.messageCount === "number"
                                        ? ` · ${session.messageCount} 条`
                                        : ""}
                                    {session.hasSummary ? " · 有摘要" : ""}
                                </span>
                            </button>
                        )}
                        <button
                            onClick={() => {
                                setRenamingId(session.id);
                                setDraft(session.title || "");
                            }}
                            className="p-1 text-cad-muted opacity-0 transition-opacity hover:text-cad-text group-hover:opacity-100"
                            title="重命名"
                            aria-label={`重命名会话 ${session.title || "未命名会话"}`}
                        >
                            <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                        <button
                            onClick={() => onDelete(session.id)}
                            className="p-1 text-cad-muted opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                            title="删除会话"
                            aria-label={`删除会话 ${session.title || "未命名会话"}`}
                        >
                            <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SessionPanel;
