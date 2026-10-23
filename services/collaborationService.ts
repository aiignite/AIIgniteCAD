/**
 * collaborationService.ts — 实验性实时协作的 Socket.IO 客户端
 *
 * 只负责连接、房间与消息收发；图元差异合并见 lib/collaboration.ts，
 * 会话态写入 store/collaboration.ts。服务端使用同一份补丁协议做校验。
 */

import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "./apiService";
import type { ElementPatch } from "../lib/collaboration";
import type { Collaborator, PeerCursor } from "../store/collaboration";

export interface CollaborationHandlers {
    onStatus: (status: "connecting" | "connected" | "error", error?: string | null) => void;
    onPeers: (peers: Collaborator[]) => void;
    onPeerJoined: (peer: Collaborator) => void;
    onSelfId: (socketId: string) => void;
    onCursor: (cursor: PeerCursor) => void;
    onPeerLeft: (socketId: string) => void;
    onPatch: (patch: ElementPatch) => void;
}

/** Socket 与 REST 同源：从 API 地址去掉 /api 后缀 */
export function collaborationSocketUrl(): string {
    try {
        return new URL(API_BASE_URL).origin;
    } catch {
        return typeof location === "undefined" ? "http://localhost:3225" : location.origin;
    }
}

const CURSOR_THROTTLE_MS = 60;

export class CollaborationClient {
    private socket: Socket | null = null;
    private projectId: string | null = null;
    private handlers: CollaborationHandlers | null = null;
    private lastCursorAt = 0;

    get connected(): boolean {
        return this.socket?.connected ?? false;
    }

    connect(token: string, projectId: string, handlers: CollaborationHandlers): void {
        this.disconnect();
        this.projectId = projectId;
        this.handlers = handlers;
        handlers.onStatus("connecting");

        const socket = io(collaborationSocketUrl(), {
            auth: { token },
            transports: ["websocket", "polling"],
            reconnectionAttempts: 5,
            timeout: 8000,
        });
        this.socket = socket;

        socket.on("connect", () => {
            this.lastCursorAt = 0;
            socket.emit("join-project", { projectId });
        });

        socket.on("project-joined", (payload: { peers?: Collaborator[]; selfId?: string }) => {
            this.handlers?.onStatus("connected");
            this.handlers?.onPeers(Array.isArray(payload?.peers) ? payload.peers : []);
            if (payload?.selfId) this.handlers?.onSelfId(payload.selfId);
        });

        socket.on("user-joined", (peer: Collaborator) => {
            if (!peer?.socketId) return;
            this.handlers?.onPeerJoined({
                socketId: peer.socketId,
                username: peer.username || "协作者",
            });
        });

        socket.on("user-left", (payload: { socketId?: string }) => {
            if (payload?.socketId) this.handlers?.onPeerLeft(payload.socketId);
        });

        socket.on("element-patch", (payload: { patch?: ElementPatch }) => {
            if (payload?.patch) this.handlers?.onPatch(payload.patch);
        });

        socket.on("cursor-move", (payload: PeerCursor) => {
            if (payload?.socketId && Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
                this.handlers?.onCursor(payload);
            }
        });

        socket.on("collaboration-error", (payload: { message?: string }) => {
            this.handlers?.onStatus("error", payload?.message || "协作服务拒绝了当前请求");
        });

        socket.on("connect_error", (error: Error) => {
            // 只透出通用原因，不回传 token 或握手细节
            this.handlers?.onStatus("error", error?.message || "无法连接协作服务");
        });

        socket.on("disconnect", () => {
            this.handlers?.onStatus("connecting");
        });
    }

    /** 广播本地图元差集；未连接时静默丢弃，重连后由下一次提交补齐 */
    sendPatch(patch: ElementPatch): void {
        if (!this.socket?.connected || !this.projectId) return;
        this.socket.emit("element-patch", { projectId: this.projectId, patch });
    }

    /** 光标位置按 60ms 节流，只用于在线提示 */
    sendCursor(x: number, y: number): void {
        if (!this.socket?.connected || !this.projectId) return;
        const now = Date.now();
        if (now - this.lastCursorAt < CURSOR_THROTTLE_MS) return;
        this.lastCursorAt = now;
        this.socket.emit("cursor-move", { projectId: this.projectId, x, y });
    }

    disconnect(): void {
        this.socket?.removeAllListeners();
        this.socket?.disconnect();
        this.socket = null;
        this.projectId = null;
        this.handlers = null;
        this.lastCursorAt = 0;
    }
}

export const collaborationClient = new CollaborationClient();
