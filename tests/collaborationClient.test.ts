/**
 * collaborationClient.test.ts — 协作客户端协议测试
 *
 * 用替身 socket 验证：断线时 sendPatch 不推进基线、状态请求与快照的收发、
 * 快照截断、入站载荷校验。真实网络与房间转发由后端协议测试覆盖。
 */

import { describe, expect, it, vi } from "vitest";
import {
    CollaborationClient,
    type CollaborationHandlers,
    type CollaborationSocket,
    type CollaborationSocketFactory,
} from "../services/collaborationService";
import { MAX_STATE_ELEMENTS } from "../lib/collaboration";
import type { CADElement } from "../types";

const PROJECT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const line = (id: string, x: number): CADElement => ({
    id,
    type: "LINE",
    start: { x, y: 0 },
    end: { x: x + 10, y: 0 },
    layer: "0",
    color: "#e6edf3",
});

class FakeSocket {
    connected = false;
    readonly emitted: Array<{ event: string; payload?: unknown }> = [];
    private handlers = new Map<string, (payload?: unknown) => void>();

    on(event: string, handler: (payload?: unknown) => void): this {
        this.handlers.set(event, handler);
        return this;
    }

    emit(event: string, payload?: unknown): boolean {
        this.emitted.push({ event, payload });
        return true;
    }

    disconnect(): void {
        this.connected = false;
    }

    removeAllListeners(): this {
        this.handlers.clear();
        return this;
    }

    trigger(event: string, payload?: unknown): void {
        this.handlers.get(event)?.(payload);
    }

    lastPayload(event: string): unknown {
        const entries = this.emitted.filter((entry) => entry.event === event);
        return entries[entries.length - 1]?.payload;
    }
}

const createHandlers = () => ({
    onStatus: vi.fn(),
    onPeers: vi.fn(),
    onPeerJoined: vi.fn(),
    onSelfId: vi.fn(),
    onCursor: vi.fn(),
    onPeerLeft: vi.fn(),
    onPatch: vi.fn(),
    onStateRequest: vi.fn(),
    onStateSnapshot: vi.fn(),
});

function setup() {
    const socket = new FakeSocket();
    const factory = vi.fn(() => socket as unknown as CollaborationSocket) as unknown as CollaborationSocketFactory;
    const client = new CollaborationClient(factory);
    const handlers = createHandlers();
    return { socket, factory, client, handlers };
}

/** 模拟握手完成：socket 已连接并加入房间 */
function joinRoom(socket: FakeSocket, client: CollaborationClient, handlers: CollaborationHandlers) {
    client.connect("token", PROJECT_ID, handlers);
    socket.connected = true;
    socket.trigger("connect");
    socket.trigger("project-joined", { selfId: "self-1", peers: [] });
}

describe("CollaborationClient 补丁发送", () => {
    it("未连接时 sendPatch 返回 false 且不发包", () => {
        const { client } = setup();
        expect(client.sendPatch({ upserts: [line("a", 0)], deletes: [] })).toBe(false);
    });

    it("加入房间后 sendPatch 发出补丁并返回 true", () => {
        const { socket, client, handlers } = setup();
        joinRoom(socket, client, handlers);

        const sent = client.sendPatch({ upserts: [line("a", 0)], deletes: ["b"] });

        expect(sent).toBe(true);
        expect(socket.lastPayload("element-patch")).toEqual({
            projectId: PROJECT_ID,
            patch: { upserts: [line("a", 0)], deletes: ["b"] },
        });
    });

    it("断开后 sendPatch 再次返回 false", () => {
        const { socket, client, handlers } = setup();
        joinRoom(socket, client, handlers);
        socket.connected = false;

        expect(client.sendPatch({ upserts: [], deletes: ["a"] })).toBe(false);
    });
});

describe("CollaborationClient 状态对账", () => {
    it("requestState 只向服务端发请求，等待被点名的成员应答", () => {
        const { socket, client, handlers } = setup();
        joinRoom(socket, client, handlers);

        expect(client.requestState()).toBe(true);
        expect(socket.lastPayload("state-request")).toEqual({ projectId: PROJECT_ID });
    });

    it("入站 state-request 把请求者 id 交给上层", () => {
        const { socket, client, handlers } = setup();
        joinRoom(socket, client, handlers);

        socket.trigger("state-request", { requesterId: "peer-9" });

        expect(handlers.onStateRequest).toHaveBeenCalledWith("peer-9");
    });

    it("缺少请求者 id 的 state-request 被忽略", () => {
        const { socket, client, handlers } = setup();
        joinRoom(socket, client, handlers);

        socket.trigger("state-request", {});

        expect(handlers.onStateRequest).not.toHaveBeenCalled();
    });

    it("sendStateSnapshot 截断到上限并定向发送", () => {
        const { socket, client, handlers } = setup();
        joinRoom(socket, client, handlers);
        const elements = Array.from({ length: MAX_STATE_ELEMENTS + 1 }, (_, i) =>
            line(`el-${i}`, i),
        );

        expect(client.sendStateSnapshot("peer-9", elements)).toBe(true);

        const payload = socket.lastPayload("state-snapshot") as {
            targetId: string;
            elements: CADElement[];
            truncated: boolean;
        };
        expect(payload.targetId).toBe("peer-9");
        expect(payload.elements).toHaveLength(MAX_STATE_ELEMENTS);
        expect(payload.truncated).toBe(true);
    });

    it("入站 state-snapshot 校验图元数组后交给上层", () => {
        const { socket, client, handlers } = setup();
        joinRoom(socket, client, handlers);

        socket.trigger("state-snapshot", { elements: [line("a", 0)], truncated: false });

        expect(handlers.onStateSnapshot).toHaveBeenCalledWith({
            elements: [line("a", 0)],
            truncated: false,
        });
    });

    it("非法 state-snapshot 被丢弃", () => {
        const { socket, client, handlers } = setup();
        joinRoom(socket, client, handlers);

        socket.trigger("state-snapshot", { elements: [{ type: "LINE" }] });

        expect(handlers.onStateSnapshot).not.toHaveBeenCalled();
    });
});
