/**
 * syncService.test.ts — 离线队列重放、幂等重试与冲突事件
 *
 * 用内存队列替换 IndexedDB，用假 API 模拟断网/恢复/服务端冲突，
 * 验证 30 分钟断网后只补发最终快照且不重复写入。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncService } from "../services/syncService";
import type { SyncEvent } from "../services/syncService";
import type { SaveElementsResponse } from "../services/apiService";
import type { SyncQueueItem } from "../types";

const makeItem = (overrides: Partial<SyncQueueItem> = {}): SyncQueueItem => ({
    id: "queue-1",
    idempotencyKey: "idem-key-1",
    operation: "UPDATE",
    entityType: "PROJECT",
    entityId: "project-1",
    data: {
        id: "project-1",
        name: "Plan",
        lastModified: "2026-10-21T00:00:00.000Z",
        elements: [{ id: "line-1", type: "LINE" }],
    },
    timestamp: "2026-10-21T00:00:00.000Z",
    status: "PENDING",
    ...overrides,
});

const createDb = (items: SyncQueueItem[] = []) => {
    const queue = items;
    const cache = new Map<string, unknown>();

    return {
        queue,
        cache,
        db: {
            getPendingSyncItems: vi.fn(async () =>
                queue.filter((item) => item.status === "PENDING"),
            ),
            getFailedSyncItems: vi.fn(async () => queue.filter((item) => item.status === "FAILED")),
            markSyncItemComplete: vi.fn(async (id: string) => {
                const item = queue.find((entry) => entry.id === id);
                if (item) item.status = "SYNCED";
            }),
            markSyncItemFailed: vi.fn(async (id: string, error: string) => {
                const item = queue.find((entry) => entry.id === id);
                if (item) {
                    item.status = "FAILED";
                    item.error = error;
                }
            }),
            resetFailedSyncItems: vi.fn(async () => {
                queue.forEach((item) => {
                    if (item.status === "FAILED") {
                        item.status = "PENDING";
                        item.error = undefined;
                    }
                });
            }),
            clearSyncedItems: vi.fn(async () => {
                for (let index = queue.length - 1; index >= 0; index -= 1) {
                    if (queue[index].status === "SYNCED") queue.splice(index, 1);
                }
            }),
            getCacheMetadata: vi.fn(async (key: string) => cache.get(key)),
            setCacheMetadata: vi.fn(async (key: string, value: unknown) => {
                cache.set(key, value);
            }),
            remapProjectId: vi.fn(async (oldId: string, newId: string) => {
                queue.forEach((item) => {
                    if (item.entityType === "PROJECT" && item.entityId === oldId) {
                        item.entityId = newId;
                    }
                });
            }),
        },
    };
};

const createApi = () => ({
    isAuthenticated: vi.fn(() => true),
    createProject: vi.fn(
        async (
            _name: string,
            _description?: string,
            _thumbnail?: string,
            _options?: { idempotencyKey?: string },
        ) => ({
            project: {
                id: "server-project-1",
                updatedAt: "2026-10-21T00:01:00.000Z",
            },
        }),
    ),
    updateProject: vi.fn(
        async (
            _id: string,
            _data: {
                name?: string;
                description?: string;
                thumbnail?: string;
                baseUpdatedAt?: string;
            },
            _options?: { idempotencyKey?: string; baseUpdatedAt?: string },
        ) => ({
            project: { updatedAt: "2026-10-21T00:02:00.000Z" },
        }),
    ),
    deleteProject: vi.fn(async (_id: string, _options?: { idempotencyKey?: string }) => ({
        message: "deleted",
    })),
    saveProjectElements: vi.fn(
        async (
            _id: string,
            _elements: any[],
            _options?: { idempotencyKey?: string; baseUpdatedAt?: string },
        ): Promise<SaveElementsResponse> => ({
            message: "Elements saved successfully",
            count: 1,
            updatedAt: "2026-10-21T00:02:00.000Z",
        }),
    ),
});

describe("SyncService", () => {
    let online = true;

    beforeEach(() => {
        online = true;
    });

    it("断网时保留队列，恢复后仅补发一次最新快照", async () => {
        const { db, queue } = createDb([makeItem()]);
        const api = createApi();
        const service = new SyncService(db as any, api as any, () => online);

        online = false;
        await service.flush();

        expect(api.saveProjectElements).not.toHaveBeenCalled();
        expect(service.getSnapshot()).toMatchObject({
            online: false,
            pendingCount: 1,
        });

        online = true;
        await service.flush();

        expect(api.saveProjectElements).toHaveBeenCalledTimes(1);
        expect(api.saveProjectElements.mock.calls[0][0]).toBe("project-1");
        expect(api.saveProjectElements.mock.calls[0][2].idempotencyKey).toBe("idem-key-1");
        expect(api.updateProject).toHaveBeenCalledTimes(1);
        expect(queue).toHaveLength(0);
        expect(service.getSnapshot().pendingCount).toBe(0);
        expect(service.getSnapshot().lastSyncedAt).toBeTruthy();
    });

    it("上一轮同步进行中到达的保存请求不会被丢弃", async () => {
        const { db, queue } = createDb([makeItem()]);
        const api = createApi();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        api.saveProjectElements.mockImplementationOnce(async () => {
            await gate;
            return {
                message: "Elements saved successfully",
                count: 1,
                updatedAt: "2026-10-21T00:02:00.000Z",
            };
        });
        const service = new SyncService(db as any, api as any, () => online);

        const flushing = service.flush();
        queue.push(makeItem({ id: "queue-2", entityId: "project-2" }));
        service.requestFlush();
        release();
        await flushing;

        expect(api.saveProjectElements).toHaveBeenCalledTimes(2);
        expect(api.saveProjectElements.mock.calls[1][0]).toBe("project-2");
    });

    it("网络失败后保留 PENDING，重试复用同一幂等键", async () => {
        const { db, queue } = createDb([makeItem()]);
        const api = createApi();
        const service = new SyncService(db as any, api as any, () => online);

        api.saveProjectElements.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        await service.flush();

        expect(db.markSyncItemFailed).not.toHaveBeenCalled();
        expect(queue[0].status).toBe("PENDING");
        expect(service.getSnapshot().lastError).toBe("Failed to fetch");

        await service.flush();

        expect(api.saveProjectElements).toHaveBeenCalledTimes(2);
        expect(api.saveProjectElements.mock.calls[0][2].idempotencyKey).toBe(
            api.saveProjectElements.mock.calls[1][2].idempotencyKey,
        );
        expect(queue).toHaveLength(0);
        expect(service.getSnapshot().lastError).toBeNull();
    });

    it("服务端标记冲突时发出通知事件，并推进版本游标", async () => {
        const { db, cache } = createDb([makeItem()]);
        const api = createApi();
        api.saveProjectElements.mockResolvedValueOnce({
            message: "saved",
            count: 1,
            conflict: true,
            serverUpdatedAt: "2026-10-20T23:00:00.000Z",
            updatedAt: "2026-10-21T00:02:00.000Z",
        });

        const service = new SyncService(db as any, api as any, () => online);
        const events: SyncEvent[] = [];
        service.onEvent((event) => events.push(event));

        await service.flush();

        expect(events).toEqual([
            {
                type: "conflict",
                projectId: "project-1",
                projectName: "Plan",
                serverUpdatedAt: "2026-10-20T23:00:00.000Z",
            },
        ]);
        expect(cache.get("sync.serverUpdatedAt.project-1")).toBe("2026-10-21T00:02:00.000Z");
    });

    it("离线创建的项目在拿到服务端 id 后迁移队列并继续同步", async () => {
        const createItem = makeItem({
            id: "queue-create",
            operation: "CREATE",
            entityId: "local-project",
            idempotencyKey: "create-key",
            data: {
                id: "local-project",
                name: "Offline drawing",
                lastModified: "2026-10-21T00:00:00.000Z",
                elements: [],
            },
        });
        const updateItem = makeItem({
            id: "queue-update",
            operation: "UPDATE",
            entityId: "local-project",
            idempotencyKey: "update-key",
        });
        const { db } = createDb([createItem, updateItem]);
        const api = createApi();
        const service = new SyncService(db as any, api as any, () => online);
        const events: SyncEvent[] = [];
        service.onEvent((event) => events.push(event));

        await service.flush();

        expect(api.createProject).toHaveBeenCalledWith("Offline drawing", undefined, undefined, {
            idempotencyKey: "create-key",
            designConventions: undefined,
        });
        expect(db.remapProjectId).toHaveBeenCalledWith("local-project", "server-project-1");
        expect(api.saveProjectElements.mock.calls[0][0]).toBe("server-project-1");
        expect(api.saveProjectElements.mock.calls[0][2].idempotencyKey).toBe("update-key");
        expect(events.some((event) => event.type === "project-remapped")).toBe(true);
    });

    it("4xx 失败项进入 FAILED，手动重试后同步成功", async () => {
        const { db } = createDb([makeItem()]);
        const api = createApi();
        api.saveProjectElements.mockRejectedValueOnce(
            Object.assign(new Error("Invalid geometry"), { status: 400 }),
        );

        const service = new SyncService(db as any, api as any, () => online);
        const events: SyncEvent[] = [];
        service.onEvent((event) => events.push(event));

        await service.flush();

        expect(events[0]).toMatchObject({
            type: "sync-error",
            message: "Invalid geometry",
        });
        expect(service.getSnapshot()).toMatchObject({
            failedCount: 1,
            lastError: "Invalid geometry",
        });

        await service.retryFailed();

        expect(db.resetFailedSyncItems).toHaveBeenCalled();
        expect(api.saveProjectElements).toHaveBeenCalledTimes(2);
        expect(service.getSnapshot()).toMatchObject({
            pendingCount: 0,
            failedCount: 0,
            lastError: null,
        });
    });

    it("未登录时不发起同步请求", async () => {
        const { db } = createDb([makeItem()]);
        const api = createApi();
        api.isAuthenticated.mockReturnValue(false);
        const service = new SyncService(db as any, api as any, () => online);

        await service.flush();

        expect(api.saveProjectElements).not.toHaveBeenCalled();
    });
});
