/**
 * collaboration.test.ts — 协作差集与补丁合并的单元测试
 */

import { describe, expect, it } from "vitest";
import { collaborationSocketPath } from "../services/collaborationService";
import {
    MAX_PATCH_ELEMENTS,
    applyElementPatches,
    diffElementPatches,
    isEmptyPatch,
    isCollaborationProjectId,
    parseCursor,
    parseElementPatch,
} from "../lib/collaboration";
import {
    getCollaborationSnapshot,
    removePeerCursor,
    resetCollaborationSession,
    setCollaborationEnabled,
    setCollaborators,
    upsertPeerCursor,
} from "../store/collaboration";
import type { CADElement } from "../types";

const line = (id: string, x: number): CADElement => ({
    id,
    type: "LINE",
    start: { x, y: 0 },
    end: { x: x + 10, y: 0 },
    layer: "0",
    color: "#e6edf3",
});

describe("collaborationSocketPath", () => {
    it("根路径部署使用默认 socket.io 路径", () => {
        expect(collaborationSocketPath("/api")).toBe("/socket.io/");
        expect(collaborationSocketPath("http://localhost:3225/api")).toBe("/socket.io/");
    });

    it("子路径部署时带上同一前缀", () => {
        expect(collaborationSocketPath("/cad/api")).toBe("/cad/socket.io/");
        expect(collaborationSocketPath("/cad/api/")).toBe("/cad/socket.io/");
    });
});

describe("diffElementPatches", () => {
    it("识别新增、修改与删除", () => {
        const a = line("a", 0);
        const b = line("b", 10);
        const patch = diffElementPatches([a, b], [line("a", 5), line("c", 20)]);

        expect(patch.upserts.map((el) => el.id)).toEqual(["a", "c"]);
        expect(patch.deletes).toEqual(["b"]);
        expect(isEmptyPatch(patch)).toBe(false);
    });

    it("引用未变的图元不进入补丁", () => {
        const a = line("a", 0);
        const patch = diffElementPatches([a], [a]);
        expect(isEmptyPatch(patch)).toBe(true);
    });
});

describe("applyElementPatches", () => {
    it("按 id 覆盖、追加并删除", () => {
        const merged = applyElementPatches(
            [line("a", 0), line("b", 10)],
            { upserts: [line("a", 99), line("c", 30)], deletes: ["b"] },
        );
        expect(merged.map((el) => el.id)).toEqual(["a", "c"]);
        expect((merged[0] as { start: { x: number } }).start.x).toBe(99);
    });

    it("保留补丁未提及的本地图元", () => {
        const merged = applyElementPatches([line("local", 1)], {
            upserts: [line("remote", 2)],
            deletes: [],
        });
        expect(merged.map((el) => el.id)).toEqual(["local", "remote"]);
    });

    it("同一补丁重复应用结果稳定", () => {
        const patch = { upserts: [line("a", 5)], deletes: ["b"] };
        const once = applyElementPatches([line("a", 0), line("b", 1)], patch);
        const twice = applyElementPatches(once, patch);
        expect(twice).toEqual(once);
    });
});

describe("parseElementPatch", () => {
    it("接受合法补丁并收窄数组", () => {
        const patch = parseElementPatch({
            upserts: [{ id: "a", type: "LINE" }],
            deletes: ["b"],
        });
        expect(patch?.upserts).toHaveLength(1);
        expect(patch?.deletes).toEqual(["b"]);
    });

    it("拒绝缺失字段与超限载荷", () => {
        expect(parseElementPatch(null)).toBeNull();
        expect(parseElementPatch({ upserts: [{}], deletes: [] })).toBeNull();
        expect(
            parseElementPatch({
                upserts: Array.from({ length: MAX_PATCH_ELEMENTS + 1 }, (_, i) => ({
                    id: String(i),
                    type: "LINE",
                })),
                deletes: [],
            }),
        ).toBeNull();
    });
});

describe("parseCursor / isCollaborationProjectId", () => {
    it("过滤非有限坐标", () => {
        expect(parseCursor({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
        expect(parseCursor({ x: Number.NaN, y: 2 })).toBeNull();
        expect(parseCursor({ x: 1, y: Infinity })).toBeNull();
    });

    it("只接受服务端 UUID 项目", () => {
        expect(isCollaborationProjectId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
        expect(isCollaborationProjectId("abc123xyz")).toBe(false);
        expect(isCollaborationProjectId(null)).toBe(false);
    });
});

describe("协作会话 store", () => {
    it("关闭协作会清空在线成员与光标", () => {
        setCollaborationEnabled(true);
        setCollaborators([{ socketId: "peer-1", username: "张三" }]);
        upsertPeerCursor({ socketId: "peer-1", username: "张三", x: 1, y: 2, updatedAt: 1 });
        expect(getCollaborationSnapshot().peers).toHaveLength(1);

        setCollaborationEnabled(false);
        const snapshot = getCollaborationSnapshot();
        expect(snapshot.enabled).toBe(false);
        expect(snapshot.peers).toHaveLength(0);
        expect(snapshot.cursors).toEqual({});
    });

    it("成员离开时同步移除其光标", () => {
        setCollaborationEnabled(true);
        setCollaborators([
            { socketId: "peer-1", username: "张三" },
            { socketId: "peer-2", username: "李四" },
        ]);
        upsertPeerCursor({ socketId: "peer-1", username: "张三", x: 1, y: 2, updatedAt: 1 });
        upsertPeerCursor({ socketId: "peer-2", username: "李四", x: 3, y: 4, updatedAt: 1 });

        setCollaborators([{ socketId: "peer-2", username: "李四" }]);
        expect(Object.keys(getCollaborationSnapshot().cursors)).toEqual(["peer-2"]);

        removePeerCursor("peer-2");
        expect(getCollaborationSnapshot().cursors).toEqual({});
        resetCollaborationSession();
    });

    it("相同时间戳的光标更新不触发变更", () => {
        setCollaborationEnabled(true);
        const cursor = { socketId: "peer-1", username: "张三", x: 1, y: 2, updatedAt: 5 };
        upsertPeerCursor(cursor);
        const before = getCollaborationSnapshot().cursors;
        upsertPeerCursor({ ...cursor, x: 9 });
        expect(getCollaborationSnapshot().cursors).toBe(before);
        setCollaborationEnabled(false);
    });
});
