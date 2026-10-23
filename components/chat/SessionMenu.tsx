import React, { useState } from "react";
import type { ChatSessionInfo } from "../../types";
import { formatSessionTime } from "../../lib/aiUi";

interface SessionMenuProps {
    sessions: ChatSessionInfo[];
    activeSessionId: string | null;
    busy: boolean;
    onOpen: (id: string) => void;
    onNew: () => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
    onCompact: () => void;
}

const SessionMenu: React.FC<SessionMenuProps> = ({
    sessions,
    activeSessionId,
    busy,
    onOpen,
    onNew,
    onRename,
    onDelete,
    onCompact,
}) => {
    const [open, setOpen] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");

    const commitRename = (id: string) => {
        const title = draft.trim();
        setRenamingId(null);
        if (title) onRename(id, title);
    };

    return (
        <div className="relative shrink-0">
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((prev) => !prev);
                }}
                className="p-1.5 rounded-md text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                title="会话历史"
            >
                <span className="material-symbols-outlined text-[18px]">history</span>
            </button>

            {open && (
                <>
                    {/* 透明遮罩：点击外部收起菜单，避免依赖 document 监听 */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOpen(false)}
                        aria-hidden
                    />
                    <div className="absolute right-0 top-9 z-50 w-64 max-h-80 overflow-y-auto rounded-lg border border-cad-border bg-cad-panel shadow-xl">
                        <div className="flex items-center gap-1 p-1 border-b border-cad-border">
                            <button
                                onClick={() => {
                                    setOpen(false);
                                    onNew();
                                }}
                                disabled={busy}
                                className="flex-1 px-2 py-1.5 rounded text-[11px] text-cad-primary hover:bg-cad-primary/10 disabled:opacity-50"
                            >
                                新建会话
                            </button>
                            <button
                                onClick={() => {
                                    setOpen(false);
                                    onCompact();
                                }}
                                disabled={busy || !activeSessionId}
                                title="把较早的消息压成摘要，降低后续 prompt 体积"
                                className="px-2 py-1.5 rounded text-[11px] text-cad-muted hover:text-cad-text hover:bg-cad-text/10 disabled:opacity-50"
                            >
                                压缩上下文
                            </button>
                        </div>
                        {sessions.length === 0 && (
                            <p className="p-3 text-[11px] text-cad-muted">暂无历史会话</p>
                        )}
                        {sessions.map((session) => (
                            <div
                                key={session.id}
                                className={`group flex items-center gap-2 px-2 py-1.5 text-[11px] border-b border-cad-border/50 last:border-0 ${
                                    session.id === activeSessionId
                                        ? "bg-cad-primary/10 text-cad-text"
                                        : "hover:bg-cad-text/5"
                                }`}
                            >
                                {renamingId === session.id ? (
                                    <input
                                        autoFocus
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") commitRename(session.id);
                                            if (e.key === "Escape") setRenamingId(null);
                                        }}
                                        onBlur={() => commitRename(session.id)}
                                        className="flex-1 min-w-0 px-1 py-0.5 rounded border border-cad-primary bg-transparent text-cad-text"
                                    />
                                ) : (
                                    <button
                                        onClick={() => {
                                            setOpen(false);
                                            onOpen(session.id);
                                        }}
                                        className="flex-1 min-w-0 text-left"
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
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setRenamingId(session.id);
                                        setDraft(session.title || "");
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-cad-muted hover:text-cad-text"
                                    title="重命名"
                                >
                                    <span className="material-symbols-outlined text-[14px]">
                                        edit
                                    </span>
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete(session.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-cad-muted hover:text-red-500"
                                    title="删除会话"
                                >
                                    <span className="material-symbols-outlined text-[14px]">
                                        delete
                                    </span>
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default SessionMenu;
