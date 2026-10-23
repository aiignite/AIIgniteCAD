/**
 * collaboration.ts — 协作会话的瞬态外部 store
 *
 * 与文档状态分离：在线成员、连接状态与远端光标属于会话态，
 * 不进撤销历史，也不写入 IndexedDB。订阅方各自只取需要的切片。
 */

export type CollaborationStatus = "off" | "connecting" | "connected" | "error";

export interface Collaborator {
    socketId: string;
    username: string;
}

export interface PeerCursor {
    socketId: string;
    username: string;
    x: number;
    y: number;
    updatedAt: number;
}

export interface CollaborationSnapshot {
    /** 用户是否显式开启协作 */
    enabled: boolean;
    status: CollaborationStatus;
    selfId: string | null;
    projectId: string | null;
    peers: Collaborator[];
    cursors: Record<string, PeerCursor>;
    lastError: string | null;
}

const INITIAL: CollaborationSnapshot = {
    enabled: false,
    status: "off",
    selfId: null,
    projectId: null,
    peers: [],
    cursors: {},
    lastError: null,
};

let snapshot: CollaborationSnapshot = INITIAL;
const listeners = new Set<() => void>();

export function getCollaborationSnapshot(): CollaborationSnapshot {
    return snapshot;
}

export function subscribeCollaboration(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function update(next: Partial<CollaborationSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
}

export function setCollaborationEnabled(enabled: boolean): void {
    update({
        enabled,
        status: enabled ? "connecting" : "off",
        lastError: null,
        peers: enabled ? snapshot.peers : [],
        cursors: enabled ? snapshot.cursors : {},
        selfId: enabled ? snapshot.selfId : null,
    });
}

export function setCollaborationStatus(
    status: CollaborationStatus,
    error: string | null = null,
): void {
    update({ status, lastError: error });
}

export function setCollaborationSession(
    projectId: string | null,
    selfId: string | null,
): void {
    update({ projectId, selfId });
}

export function setCollaborators(peers: Collaborator[]): void {
    const alive = new Set(peers.map((peer) => peer.socketId));
    const cursors: Record<string, PeerCursor> = {};
    for (const [id, cursor] of Object.entries(snapshot.cursors)) {
        if (alive.has(id)) cursors[id] = cursor;
    }
    update({ peers, cursors });
}

export function upsertPeerCursor(cursor: PeerCursor): void {
    if (snapshot.cursors[cursor.socketId]?.updatedAt === cursor.updatedAt) return;
    update({ cursors: { ...snapshot.cursors, [cursor.socketId]: cursor } });
}

export function removePeerCursor(socketId: string): void {
    if (!snapshot.cursors[socketId]) return;
    const cursors = { ...snapshot.cursors };
    delete cursors[socketId];
    update({ cursors });
}

/** 断开或关闭协同时清空会话态，保留用户开关偏好 */
export function resetCollaborationSession(): void {
    update({ status: "off", selfId: null, projectId: null, peers: [], cursors: {} });
}
