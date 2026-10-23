/**
 * CollaborationToggle.tsx — 状态栏的协作开关（实验性）
 *
 * 默认关闭，避免多个客户端在用户不知情时互相覆盖；
 * 只有登录且项目已同步到服务端时才可开启。
 */

import React, { useSyncExternalStore } from "react";
import { useApp } from "../store/appStore";
import {
    getCollaborationSnapshot,
    setCollaborationEnabled,
    subscribeCollaboration,
} from "../store/collaboration";
import { isCollaborationProjectId } from "../lib/collaboration";

const STATUS_DOT: Record<string, string> = {
    connected: "bg-emerald-500",
    connecting: "bg-amber-400 animate-pulse",
    error: "bg-rose-500",
    off: "bg-cad-muted/50",
};

export const CollaborationToggle: React.FC = () => {
    const { state: appState } = useApp();
    const snapshot = useSyncExternalStore(
        subscribeCollaboration,
        getCollaborationSnapshot,
        getCollaborationSnapshot,
    );

    const eligible =
        Boolean(appState.currentUser) &&
        isCollaborationProjectId(appState.activeFile?.id);
    const active = snapshot.enabled;
    const online = snapshot.peers.length;

    const title = !eligible
        ? "登录并等待项目同步到服务端后可用"
        : snapshot.lastError
          ? snapshot.lastError
          : active
            ? `实时协作（实验性）：${online} 位其他协作者在线，最后写入胜`
            : "开启实时协作（实验性，全员可写，最后写入胜）";

    return (
        <button
            data-action="collaboration-toggle"
            onClick={() => {
                if (!eligible) return;
                setCollaborationEnabled(!active);
            }}
            disabled={!eligible}
            title={title}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors
            ${
                active
                    ? "bg-cad-primary/20 text-cad-primary border-cad-primary/30"
                    : "text-cad-muted border-transparent hover:bg-cad-text/10 hover:text-cad-text"
            }
            ${eligible ? "" : "opacity-50 cursor-not-allowed"}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[snapshot.status]}`} />
            协作
            <span className="font-normal opacity-70">实验</span>
            {active && online > 0 && (
                <span className="rounded bg-cad-primary/20 px-1">{online}</span>
            )}
        </button>
    );
};
