/**
 * syncService.ts — 离线优先的云端同步 worker
 *
 * 本地写入由 IndexedDB 立即完成，远端写入进入 syncQueue：
 * - 每个队列项携带 idempotencyKey，重试不会在服务端产生重复数据
 * - 同一项目的连续保存合并为最新快照，断网恢复后只补发最终状态
 * - 冲突采用"服务端最后写入胜"，并通过事件提示被覆盖的云端版本
 */

import { apiService } from "./apiService";
import type { SaveElementsResponse } from "./apiService";
import { indexedDBService } from "./indexedDBService";
import type { ProjectFile, SyncQueueItem } from "../types";

export interface SyncStatusSnapshot {
    online: boolean;
    syncing: boolean;
    pendingCount: number;
    failedCount: number;
    lastError: string | null;
    lastSyncedAt: string | null;
}

export type SyncEvent =
    | {
          type: "conflict";
          projectId: string;
          projectName: string;
          serverUpdatedAt?: string;
      }
    | { type: "sync-error"; message: string; projectId: string }
    | { type: "project-remapped"; oldId: string; newId: string; name: string };

interface SyncDb {
    getPendingSyncItems(): Promise<SyncQueueItem[]>;
    getFailedSyncItems(): Promise<SyncQueueItem[]>;
    markSyncItemComplete(itemId: string): Promise<void>;
    markSyncItemFailed(itemId: string, error: string): Promise<void>;
    resetFailedSyncItems(): Promise<void>;
    clearSyncedItems(): Promise<void>;
    getCacheMetadata(key: string): Promise<unknown>;
    setCacheMetadata(key: string, value: unknown): Promise<void>;
    remapProjectId(oldId: string, newId: string): Promise<void>;
}

interface SyncApi {
    isAuthenticated(): boolean;
    createProject(
        name: string,
        description?: string,
        thumbnail?: string,
        options?: {
            idempotencyKey?: string;
            designConventions?: ProjectFile["designConventions"];
        },
    ): Promise<{ project: any; duplicate?: boolean }>;
    updateProject(
        id: string,
        data: {
            name?: string;
            description?: string;
            thumbnail?: string;
            designConventions?: ProjectFile["designConventions"];
            baseUpdatedAt?: string;
        },
        options?: { idempotencyKey?: string; baseUpdatedAt?: string },
    ): Promise<{
        project: any;
        duplicate?: boolean;
        conflict?: boolean;
        serverUpdatedAt?: string;
    }>;
    deleteProject(id: string, options?: { idempotencyKey?: string }): Promise<unknown>;
    saveProjectElements(
        id: string,
        elements: any[],
        options?: { idempotencyKey?: string; baseUpdatedAt?: string },
    ): Promise<SaveElementsResponse>;
}

const cursorKey = (projectId: string) => `sync.serverUpdatedAt.${projectId}`;
const idMapKey = (projectId: string) => `sync.idMap.${projectId}`;

const toError = (error: unknown): Error & { status?: number } =>
    error instanceof Error
        ? (error as Error & { status?: number })
        : Object.assign(new Error(String(error)), { status: undefined });

export class SyncService {
    private snapshot: SyncStatusSnapshot = {
        online: true,
        syncing: false,
        pendingCount: 0,
        failedCount: 0,
        lastError: null,
        lastSyncedAt: null,
    };

    private listeners = new Set<() => void>();
    private eventListeners = new Set<(event: SyncEvent) => void>();
    private flushPromise: Promise<void> | null = null;
    private flushRequested = false;
    private initialized = false;

    constructor(
        private db: SyncDb = indexedDBService,
        private api: SyncApi = apiService,
        private isOnline: () => boolean = () =>
            typeof navigator === "undefined" || navigator.onLine,
    ) {}

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = (): SyncStatusSnapshot => this.snapshot;

    onEvent(listener: (event: SyncEvent) => void): () => void {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
    }

    private emit(event: SyncEvent): void {
        this.eventListeners.forEach((listener) => listener(event));
    }

    private setSnapshot(patch: Partial<SyncStatusSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...patch };
        this.listeners.forEach((listener) => listener());
    }

    init(): void {
        if (this.initialized) return;
        this.initialized = true;

        if (typeof window !== "undefined") {
            window.addEventListener("online", this.handleOnline);
            window.addEventListener("offline", this.handleOffline);
            window.setInterval(() => {
                void this.flush();
            }, 30_000);
        }

        void this.refreshStatus();
        void this.flush();
    }

    private handleOnline = (): void => {
        this.setSnapshot({ online: true });
        void this.flush();
    };

    private handleOffline = (): void => {
        this.setSnapshot({ online: false });
    };

    async refreshStatus(): Promise<void> {
        try {
            const [pending, failed] = await Promise.all([
                this.db.getPendingSyncItems(),
                this.db.getFailedSyncItems(),
            ]);
            this.setSnapshot({
                pendingCount: pending.length,
                failedCount: failed.length,
                online: this.isOnline(),
                lastError: failed[0]?.error ?? this.snapshot.lastError,
            });
        } catch (error) {
            console.error("Sync status refresh failed", error);
        }
    }

    /** 自动保存后调用：不阻塞调用方，失败由设置面板与事件呈现 */
    requestFlush(): void {
        this.flushRequested = true;
        if (this.flushPromise) return;
        void this.flush();
    }

    async flush(): Promise<void> {
        if (this.flushPromise) return this.flushPromise;
        this.flushPromise = this.runFlushLoop().finally(() => {
            this.flushPromise = null;
        });
        return this.flushPromise;
    }

    /** 上一轮 flush 进行中到达的新请求不能丢：结束后再跑一轮，把期间入队的项目写出去 */
    private async runFlushLoop(): Promise<void> {
        try {
            do {
                this.flushRequested = false;
                await this.runFlush();
            } while (this.flushRequested);
        } catch (error) {
            console.error("Sync flush failed", error);
            this.setSnapshot({
                syncing: false,
                lastError: toError(error).message,
            });
        }
    }

    async setServerCursor(projectId: string, updatedAt?: string): Promise<void> {
        if (!updatedAt) return;
        await this.db.setCacheMetadata(cursorKey(projectId), updatedAt);
    }

    async retryFailed(): Promise<void> {
        await this.db.resetFailedSyncItems();
        this.setSnapshot({ lastError: null });
        if (this.flushPromise) await this.flushPromise;
        await this.refreshStatus();
        await this.flush();
    }

    private async runFlush(): Promise<void> {
        if (!this.api.isAuthenticated() || !this.isOnline()) {
            await this.refreshStatus();
            return;
        }

        const pending = (await this.db.getPendingSyncItems()).sort((a, b) =>
            a.timestamp.localeCompare(b.timestamp),
        );
        if (pending.length === 0) {
            await this.refreshStatus();
            return;
        }

        this.setSnapshot({ syncing: true, online: true });
        let lastError: string | null = null;
        let lastSyncedAt = this.snapshot.lastSyncedAt;

        for (const item of pending) {
            if (!this.isOnline()) break;

            try {
                await this.processItem(item, pending);
                await this.db.markSyncItemComplete(item.id);
                lastSyncedAt = new Date().toISOString();
            } catch (error) {
                const normalized = toError(error);
                const status = normalized.status;

                if (item.operation === "DELETE" && status === 404) {
                    await this.db.markSyncItemComplete(item.id);
                    lastSyncedAt = new Date().toISOString();
                    continue;
                }

                if (
                    !status ||
                    status === 401 ||
                    status === 408 ||
                    status === 409 ||
                    status === 429 ||
                    status >= 500
                ) {
                    // 网络/服务端暂不可用：保留 PENDING，恢复后自动重试
                    lastError = normalized.message;
                    break;
                }

                lastError = normalized.message;
                await this.db.markSyncItemFailed(item.id, normalized.message);
                this.emit({
                    type: "sync-error",
                    message: normalized.message,
                    projectId: item.entityId,
                });
            }
        }

        await this.db.clearSyncedItems();
        await this.refreshStatus();
        this.setSnapshot({
            syncing: false,
            lastError,
            lastSyncedAt,
        });
    }

    private async processItem(item: SyncQueueItem, pendingItems: SyncQueueItem[]): Promise<void> {
        if (item.entityType !== "PROJECT") {
            // 旧版本遗留的本地实体项没有远端接口，直接出队
            return;
        }

        if (item.operation === "CREATE") {
            await this.processCreate(item, pendingItems);
            return;
        }

        if (item.operation === "UPDATE") {
            await this.processUpdate(item);
            return;
        }

        const mappedId = await this.db.getCacheMetadata(idMapKey(item.entityId));
        const targetId = typeof mappedId === "string" ? mappedId : item.entityId;
        await this.api.deleteProject(targetId, {
            idempotencyKey: item.idempotencyKey,
        });
    }

    private async processCreate(item: SyncQueueItem, pendingItems: SyncQueueItem[]): Promise<void> {
        const project = item.data as ProjectFile;
        const response = await this.api.createProject(
            project.name,
            project.description,
            project.thumbnail,
            {
                idempotencyKey: item.idempotencyKey,
                designConventions: project.designConventions,
            },
        );

        const serverId = response.project?.id;
        if (!serverId) {
            throw Object.assign(new Error("Project creation is still being confirmed"), {
                status: 409,
            });
        }

        if (serverId !== item.entityId) {
            const oldId = item.entityId;
            await this.db.remapProjectId(oldId, serverId);
            for (const queued of pendingItems) {
                if (queued.entityType === "PROJECT" && queued.entityId === oldId) {
                    queued.entityId = serverId;
                }
            }
            item.entityId = serverId;
            this.emit({
                type: "project-remapped",
                oldId,
                newId: serverId,
                name: project.name,
            });
        }

        if (response.project?.updatedAt) {
            await this.db.setCacheMetadata(cursorKey(serverId), response.project.updatedAt);
        }
    }

    private async processUpdate(item: SyncQueueItem): Promise<void> {
        const project = item.data as ProjectFile;
        const baseUpdatedAt =
            item.baseUpdatedAt ??
            (await this.db.getCacheMetadata(cursorKey(item.entityId))) ??
            undefined;

        let conflict = false;
        let serverUpdatedAt: string | undefined;
        let lastUpdatedAt: string | undefined;

        if (Array.isArray(project.elements)) {
            const response = await this.api.saveProjectElements(item.entityId, project.elements, {
                idempotencyKey: item.idempotencyKey,
                baseUpdatedAt: typeof baseUpdatedAt === "string" ? baseUpdatedAt : undefined,
            });
            conflict = !!response.conflict;
            serverUpdatedAt = response.serverUpdatedAt;
            lastUpdatedAt = response.updatedAt;
        }

        if (project.name) {
            const metadataBase = lastUpdatedAt ?? baseUpdatedAt;
            const response = await this.api.updateProject(
                item.entityId,
                {
                    name: project.name,
                    description: project.description,
                    thumbnail: project.thumbnail,
                    designConventions: project.designConventions,
                },
                {
                    baseUpdatedAt: typeof metadataBase === "string" ? metadataBase : undefined,
                },
            );
            conflict = conflict || !!response.conflict;
            serverUpdatedAt = response.serverUpdatedAt ?? serverUpdatedAt;
            lastUpdatedAt = response.project?.updatedAt ?? lastUpdatedAt;
        }

        if (conflict) {
            this.emit({
                type: "conflict",
                projectId: item.entityId,
                projectName: project.name,
                serverUpdatedAt,
            });
        }

        if (lastUpdatedAt) {
            await this.db.setCacheMetadata(cursorKey(item.entityId), lastUpdatedAt);
        }
    }
}

export const syncService = new SyncService();
