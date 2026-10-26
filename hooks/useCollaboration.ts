/**
 * useCollaboration.ts — 把协作客户端接到画布状态
 *
 * 本地提交后把差集广播出去；远端补丁合并进当前图元并成为新的撤销基线。
 * 协作属于会话态：不进历史、不写 IndexedDB，断开即回到单机编辑。
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useCanvas } from "../store/canvasStore";
import { useApp } from "../store/appStore";
import {
    getCollaborationSnapshot,
    removePeerCursor,
    resetCollaborationSession,
    setCollaborationSession,
    setCollaborationStatus,
    setCollaborators,
    subscribeCollaboration,
    upsertPeerCursor,
} from "../store/collaboration";
import {
    broadcastPendingChanges,
    isCollaborationProjectId,
    applyElementPatches,
    applyElementSnapshot,
} from "../lib/collaboration";
import { collaborationClient } from "../services/collaborationService";
import { useI18n } from "../lib/i18n";
import type { CADElement } from "../types";

/** 本地连续编辑（拖拽、属性输入）合并成一个广播窗口 */
const BROADCAST_DEBOUNCE_MS = 120;

export function useCollaboration(): void {
    const { t } = useI18n();
    const { state: appState } = useApp();
    const { state: canvasState, getElements, applyRemoteElements } = useCanvas();
    const snapshot = useSyncExternalStore(
        subscribeCollaboration,
        getCollaborationSnapshot,
        getCollaborationSnapshot,
    );
    const lastBroadcastRef = useRef<readonly CADElement[] | null>(null);

    const projectId = appState.activeFile?.id ?? null;
    const eligible = isCollaborationProjectId(projectId);
    const userId = appState.currentUser?.id ?? null;

    useEffect(() => {
        if (!snapshot.enabled) {
            collaborationClient.disconnect();
            lastBroadcastRef.current = null;
            resetCollaborationSession();
            return;
        }

        const token =
            typeof localStorage === "undefined" ? null : localStorage.getItem("auth_token");
        if (!userId || !token) {
            setCollaborationStatus("error", t("collab.needLogin"));
            return;
        }
        if (!projectId || !eligible) {
            setCollaborationStatus("error", t("collab.needSync"));
            return;
        }

        lastBroadcastRef.current = getElements();

        /** 把「基线 → 当前」的差异发给房间；只有真正发出才推进基线 */
        const flushToPeers = () => {
            const current = getElements();
            lastBroadcastRef.current = broadcastPendingChanges(
                lastBroadcastRef.current ?? [],
                current,
                (patch) => collaborationClient.sendPatch(patch),
            );
        };

        collaborationClient.connect(token, projectId, {
            onStatus: (status, error) => setCollaborationStatus(status, error ?? null),
            onPeers: (peers) => {
                setCollaborators(peers);
                // 加入 / 重连后先补发断线期间的本地修改，再向现有成员要一份图纸快照
                flushToPeers();
                if (peers.length > 0) collaborationClient.requestState();
            },
            onSelfId: (socketId) => setCollaborationSession(projectId, socketId),
            onPeerJoined: (peer) => {
                const current = getCollaborationSnapshot().peers.filter(
                    (item) => item.socketId !== peer.socketId,
                );
                setCollaborators([...current, peer]);
            },
            onPeerLeft: (socketId) => {
                setCollaborators(
                    getCollaborationSnapshot().peers.filter(
                        (item) => item.socketId !== socketId,
                    ),
                );
                removePeerCursor(socketId);
            },
            onCursor: (cursor) => upsertPeerCursor(cursor),
            onPatch: (patch) => {
                const merged = applyElementPatches(getElements(), patch);
                lastBroadcastRef.current = merged;
                applyRemoteElements(merged);
            },
            onStateRequest: (requesterId) => {
                collaborationClient.sendStateSnapshot(requesterId, getElements());
            },
            onStateSnapshot: (snapshot) => {
                // 只覆盖 / 追加，不删除本地独有图元：本地可能还有未广播的编辑
                const merged = applyElementSnapshot(getElements(), snapshot.elements);
                lastBroadcastRef.current = merged;
                applyRemoteElements(merged);
            },
        });

        return () => {
            collaborationClient.disconnect();
            resetCollaborationSession();
        };
        // 仅在开着协作、切换项目或用户时重连；光标与状态变化不应重建连接
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snapshot.enabled, eligible, projectId, userId]);

    useEffect(() => {
        if (!snapshot.enabled || snapshot.status !== "connected") return;
        const current = canvasState.elements;
        if (lastBroadcastRef.current === current) return;

        const timer = setTimeout(() => {
            const next = getElements();
            // 未连接时广播基线保持不动：重连后 flushToPeers 会把这段差异补发
            lastBroadcastRef.current = broadcastPendingChanges(
                lastBroadcastRef.current ?? [],
                next,
                (patch) => collaborationClient.sendPatch(patch),
            );
        }, BROADCAST_DEBOUNCE_MS);

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasState.elements, snapshot.enabled, snapshot.status]);
}
