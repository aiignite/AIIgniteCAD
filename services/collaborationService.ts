/**
 * collaborationService.ts — 实验性实时协作的 Socket.IO 客户端
 *
 * 只负责连接、房间与消息收发；图元差异合并见 lib/collaboration.ts，
 * 会话态写入 store/collaboration.ts。服务端使用同一份补丁协议做校验。
 */

import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "./apiService";
import {
    capElementSnapshot,
    parseElementList,
    type ElementPatch,
    type ElementSnapshot,
} from "../lib/collaboration";
import type { Collaborator, PeerCursor } from "../store/collaboration";
import type { CADElement } from "../types";

export interface CollaborationHandlers {
    onStatus: (status: "connecting" | "connected" | "error", error?: string | null) => void;
    onPeers: (peers: Collaborator[]) => void;
    onPeerJoined: (peer: Collaborator) => void;
    onSelfId: (socketId: string) => void;
    onCursor: (cursor: PeerCursor) => void;
    onPeerLeft: (socketId: string) => void;
    onPatch: (patch: ElementPatch) => void;
    /** 房间内有人请求当前图纸状态；只有被服务端点名的成员会收到 */
    onStateRequest?: (requesterId: string) => void;
    /** 收到其他成员回传的图纸快照（加入房间时的初始对账） */
    onStateSnapshot?: (snapshot: ElementSnapshot) => void;
}

/** 便于测试注入的最小 socket 形状；浏览器里就是 socket.io 的 Socket */
export type CollaborationSocket = Pick<Socket, "on" | "emit" | "disconnect" | "removeAllListeners"> & {
    connected: boolean;
};

export type CollaborationSocketFactory = (
    url: string,
    options: Record<string, unknown>,
) => CollaborationSocket;

/** Socket 与 REST 同源：从 API 地址去掉 /api 后缀 */
export function collaborationSocketUrl(): string {
    try {
        return new URL(API_BASE_URL).origin;
    } catch {
        return typeof location === "undefined" ? "http://localhost:3225" : location.origin;
    }
}

/**
 * 站点挂在网关子路径下时（API 基址形如 /cad/api），socket.io 必须带同一前缀握手，
 * 否则升级请求会落到网关的默认站点上，协作面板只会显示连接失败。
 */
export function collaborationSocketPath(apiBaseUrl: string = API_BASE_URL): string {
    const { pathname } = new URL(apiBaseUrl, "http://localhost");
    const prefix = pathname.replace(/\/?api\/?$/, "").replace(/\/+$/, "");
    return `${prefix}/socket.io/`;
}

const CURSOR_THROTTLE_MS = 60;

export class CollaborationClient {
    private socket: CollaborationSocket | null = null;
    private projectId: string | null = null;
    private handlers: CollaborationHandlers | null = null;
    private lastCursorAt = 0;

    constructor(
        private readonly socketFactory: CollaborationSocketFactory = io as unknown as CollaborationSocketFactory,
    ) {}

    get connected(): boolean {
        return this.socket?.connected ?? false;
    }

    connect(token: string, projectId: string, handlers: CollaborationHandlers): void {
        this.disconnect();
        this.projectId = projectId;
        this.handlers = handlers;
        handlers.onStatus("connecting");

        const socket = this.socketFactory(collaborationSocketUrl(), {
            auth: { token },
            path: collaborationSocketPath(),
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

        // 服务端把「谁需要初始图纸」转给房间内的一个成员，由该成员回传快照
        socket.on("state-request", (payload: { requesterId?: unknown }) => {
            if (typeof payload?.requesterId === "string") {
                this.handlers?.onStateRequest?.(payload.requesterId);
            }
        });

        socket.on("state-snapshot", (payload: { elements?: unknown; truncated?: unknown }) => {
            const elements = parseElementList(payload?.elements);
            if (!elements) return;
            this.handlers?.onStateSnapshot?.({
                elements,
                truncated: payload?.truncated === true,
            });
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

    /**
     * 广播本地图元差集。
     * @returns 是否真正发出：未连接时返回 false，调用方据此决定是否推进广播基线，
     *          避免断线期间的修改被基线"吞掉"、重连后补不出去。
     */
    sendPatch(patch: ElementPatch): boolean {
        if (!this.socket?.connected || !this.projectId) return false;
        this.socket.emit("element-patch", { projectId: this.projectId, patch });
        return true;
    }

    /** 请求房间内的现有成员回传图纸快照（新加入者用） */
    requestState(): boolean {
        if (!this.socket?.connected || !this.projectId) return false;
        this.socket.emit("state-request", { projectId: this.projectId });
        return true;
    }

    /** 响应快照请求：截断到上限后只发给请求方（由服务端定向转发） */
    sendStateSnapshot(targetId: string, elements: readonly CADElement[]): boolean {
        if (!this.socket?.connected || !this.projectId) return false;
        const snapshot = capElementSnapshot(elements);
        this.socket.emit("state-snapshot", {
            projectId: this.projectId,
            targetId,
            elements: snapshot.elements,
            truncated: snapshot.truncated,
        });
        return true;
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
