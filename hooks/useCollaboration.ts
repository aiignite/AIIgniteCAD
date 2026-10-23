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
    diffElementPatches,
    isCollaborationProjectId,
    isEmptyPatch,
    applyElementPatches,
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
    const lastBroadcastRef = useRef<CADElement[] | null>(null);

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
        collaborationClient.connect(token, projectId, {
            onStatus: (status, error) => setCollaborationStatus(status, error ?? null),
            onPeers: (peers) => setCollaborators(peers),
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
            const baseline = lastBroadcastRef.current ?? [];
            const patch = diffElementPatches(baseline, next);
            lastBroadcastRef.current = next;
            if (!isEmptyPatch(patch)) collaborationClient.sendPatch(patch);
        }, BROADCAST_DEBOUNCE_MS);

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasState.elements, snapshot.enabled, snapshot.status]);
}
