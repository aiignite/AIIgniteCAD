// IndexedDB Service for AIIgniteCAD
// Provides local offline storage mirroring PostgreSQL structure

import {
    ProjectFile,
    CADElement,
    BlockDefinition,
    BlockReference,
    Layer,
    ChatMessage,
    SyncQueueItem,
    User
} from '../types';
import {
    normalizeProjectDocument,
    projectFileFromDocument,
    type ProjectDocument
} from '../lib/projectDocument';

const DB_NAME = 'AIIgniteCAD';
const DB_VERSION = 1;

// Object Store names
const STORES = {
    PROJECTS: 'projects',
    ELEMENTS: 'elements',
    BLOCK_DEFINITIONS: 'blockDefinitions',
    BLOCK_ELEMENTS: 'blockElements',
    BLOCK_REFERENCES: 'blockReferences',
    LAYERS: 'layers',
    DRAWING_SETTINGS: 'drawingSettings',
    CHAT_SESSIONS: 'chatSessions',
    CHAT_MESSAGES: 'chatMessages',
    SYNC_QUEUE: 'syncQueue',
    CACHE_METADATA: 'cacheMetadata',
    USER: 'user'
};

const createLocalId = () => Math.random().toString(36).substr(2, 9);

/** 客户端生成的幂等键：重试时保持不变，由服务端按 key 去重 */
const createIdempotencyKey = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

class IndexedDBService {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<IDBDatabase> | null = null;

    // Initialize database
    async init(): Promise<IDBDatabase> {
        if (this.db) {
            return this.db;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                reject(new Error('Failed to open IndexedDB'));
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;
                this.createObjectStores(db);
            };
        });

        return this.initPromise;
    }

    // Create all object stores with indexes
    private createObjectStores(db: IDBDatabase): void {
        // Projects store
        if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
            const projectStore = db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
            projectStore.createIndex('userId', 'userId', { unique: false });
            projectStore.createIndex('updatedAt', 'lastModified', { unique: false });
            projectStore.createIndex('lastOpenedAt', 'lastOpened', { unique: false });
        }

        // Elements store
        if (!db.objectStoreNames.contains(STORES.ELEMENTS)) {
            const elementStore = db.createObjectStore(STORES.ELEMENTS, { keyPath: 'id' });
            elementStore.createIndex('projectId', 'projectId', { unique: false });
            elementStore.createIndex('layerId', 'layer', { unique: false });
            elementStore.createIndex('elementType', 'type', { unique: false });
        }

        // Block Definitions store
        if (!db.objectStoreNames.contains(STORES.BLOCK_DEFINITIONS)) {
            const blockDefStore = db.createObjectStore(STORES.BLOCK_DEFINITIONS, { keyPath: 'id' });
            blockDefStore.createIndex('userId', 'userId', { unique: false });
            blockDefStore.createIndex('projectId', 'projectId', { unique: false });
            blockDefStore.createIndex('name', 'name', { unique: false });
            blockDefStore.createIndex('isPublic', 'isPublic', { unique: false });
        }

        // Block Elements store
        if (!db.objectStoreNames.contains(STORES.BLOCK_ELEMENTS)) {
            const blockElemStore = db.createObjectStore(STORES.BLOCK_ELEMENTS, { keyPath: 'id' });
            blockElemStore.createIndex('blockDefinitionId', 'blockDefinitionId', { unique: false });
        }

        // Block References store
        if (!db.objectStoreNames.contains(STORES.BLOCK_REFERENCES)) {
            const blockRefStore = db.createObjectStore(STORES.BLOCK_REFERENCES, { keyPath: 'id' });
            blockRefStore.createIndex('projectId', 'projectId', { unique: false });
            blockRefStore.createIndex('blockDefinitionId', 'blockDefinitionId', { unique: false });
        }

        // Layers store
        if (!db.objectStoreNames.contains(STORES.LAYERS)) {
            const layerStore = db.createObjectStore(STORES.LAYERS, { keyPath: 'id' });
            layerStore.createIndex('projectId', 'projectId', { unique: false });
        }

        // Drawing Settings store
        if (!db.objectStoreNames.contains(STORES.DRAWING_SETTINGS)) {
            const settingsStore = db.createObjectStore(STORES.DRAWING_SETTINGS, { keyPath: 'id' });
            settingsStore.createIndex('projectId', 'projectId', { unique: true });
        }

        // Chat Sessions store
        if (!db.objectStoreNames.contains(STORES.CHAT_SESSIONS)) {
            const chatSessionStore = db.createObjectStore(STORES.CHAT_SESSIONS, { keyPath: 'id' });
            chatSessionStore.createIndex('projectId', 'projectId', { unique: false });
        }

        // Chat Messages store
        if (!db.objectStoreNames.contains(STORES.CHAT_MESSAGES)) {
            const chatMsgStore = db.createObjectStore(STORES.CHAT_MESSAGES, { keyPath: 'id' });
            chatMsgStore.createIndex('sessionId', 'sessionId', { unique: false });
            chatMsgStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Sync Queue store
        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
            const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
            syncStore.createIndex('status', 'status', { unique: false });
            syncStore.createIndex('timestamp', 'timestamp', { unique: false });
            syncStore.createIndex('entityType', 'entityType', { unique: false });
        }

        // Cache Metadata store
        if (!db.objectStoreNames.contains(STORES.CACHE_METADATA)) {
            db.createObjectStore(STORES.CACHE_METADATA, { keyPath: 'key' });
        }

        // User store
        if (!db.objectStoreNames.contains(STORES.USER)) {
            db.createObjectStore(STORES.USER, { keyPath: 'id' });
        }
    }

    // Generic CRUD operations
    async add<T>(storeName: string, data: T): Promise<string> {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);

            request.onsuccess = () => resolve(request.result as string);
            request.onerror = () => reject(request.error);
        });
    }

    async get<T>(storeName: string, id: string): Promise<T | undefined> {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result as T | undefined);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll<T>(storeName: string): Promise<T[]> {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result as T[]);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllByIndex<T>(storeName: string, indexName: string, value: any): Promise<T[]> {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);

            request.onsuccess = () => resolve(request.result as T[]);
            request.onerror = () => reject(request.error);
        });
    }

    async update<T>(storeName: string, data: T): Promise<void> {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName: string, id: string): Promise<void> {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clear(storeName: string): Promise<void> {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Project-specific operations
    async saveProject(project: ProjectFile): Promise<void> {
        await this.update(STORES.PROJECTS, project);
        await this.enqueueProjectUpdate(project);
    }

    /** 新建项目：本地立即落地，远端创建走 CREATE 队列并支持离线补建 */
    async saveNewProject(project: ProjectFile): Promise<void> {
        await this.update(STORES.PROJECTS, project);
        await this.removeSyncItemsForEntity(project.id);
        await this.addToSyncQueue({
            id: createLocalId(),
            idempotencyKey: createIdempotencyKey(),
            operation: 'CREATE',
            entityType: 'PROJECT',
            entityId: project.id,
            data: project,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
    }

    /**
     * 同一项目的连续自动保存合并为一个 UPDATE 队列项：
     * 保留原 idempotencyKey，重试不会产生重复写入；快照始终是最新版本，离线恢复不丢改动。
     */
    async enqueueProjectUpdate(project: ProjectFile): Promise<void> {
        const items = await this.getAll<SyncQueueItem>(STORES.SYNC_QUEUE);
        const existing = items.find(
            (item) =>
                item.entityType === 'PROJECT' &&
                item.entityId === project.id &&
                item.operation === 'UPDATE'
        );

        if (existing) {
            await this.update<SyncQueueItem>(STORES.SYNC_QUEUE, {
                ...existing,
                data: project,
                timestamp: new Date().toISOString(),
                status: 'PENDING',
                error: undefined
            });
            return;
        }

        await this.addToSyncQueue({
            id: createLocalId(),
            idempotencyKey: createIdempotencyKey(),
            operation: 'UPDATE',
            entityType: 'PROJECT',
            entityId: project.id,
            data: project,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
    }

    private async removeSyncItemsForEntity(entityId: string): Promise<void> {
        const items = await this.getAll<SyncQueueItem>(STORES.SYNC_QUEUE);
        for (const item of items) {
            if (item.entityType === 'PROJECT' && item.entityId === entityId) {
                await this.delete(STORES.SYNC_QUEUE, item.id);
            }
        }
    }

    private async enqueueProjectDelete(projectId: string): Promise<void> {
        await this.removeSyncItemsForEntity(projectId);
        await this.addToSyncQueue({
            id: createLocalId(),
            idempotencyKey: createIdempotencyKey(),
            operation: 'DELETE',
            entityType: 'PROJECT',
            entityId: projectId,
            data: null,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
    }

    /** 离线新建后拿到服务端 id：迁移本地项目、图元与排队中的操作 */
    async remapProjectId(oldId: string, newId: string): Promise<void> {
        const project = await this.getProject(oldId);
        if (project) {
            await this.delete(STORES.PROJECTS, oldId);
            await this.update(STORES.PROJECTS, { ...project, id: newId });
        }

        for (const storeName of [STORES.ELEMENTS, STORES.BLOCK_REFERENCES, STORES.LAYERS]) {
            const records = await this.getAllByIndex<any>(storeName, 'projectId', oldId);
            for (const record of records) {
                await this.update(storeName, { ...record, projectId: newId });
            }
        }

        // 绘图设置行以项目 id 为主键，回填服务端 id 时需要整体迁移
        const settings = await this.get<any>(STORES.DRAWING_SETTINGS, oldId);
        if (settings) {
            await this.delete(STORES.DRAWING_SETTINGS, oldId);
            await this.update(STORES.DRAWING_SETTINGS, { ...settings, id: newId, projectId: newId });
        }

        const queued = await this.getAll<SyncQueueItem>(STORES.SYNC_QUEUE);
        for (const item of queued) {
            if (item.entityType === 'PROJECT' && item.entityId === oldId) {
                await this.update<SyncQueueItem>(STORES.SYNC_QUEUE, {
                    ...item,
                    entityId: newId
                });
            }
        }

        await this.setCacheMetadata(`sync.idMap.${oldId}`, newId);
    }

    async getProject(projectId: string): Promise<ProjectFile | undefined> {
        return this.get<ProjectFile>(STORES.PROJECTS, projectId);
    }

    async getAllProjects(): Promise<ProjectFile[]> {
        return this.getAll<ProjectFile>(STORES.PROJECTS);
    }

    async deleteProject(projectId: string): Promise<void> {
        // Delete project and all related data
        await this.delete(STORES.PROJECTS, projectId);

        // Delete elements
        const elements = await this.getAllByIndex<CADElement>(STORES.ELEMENTS, 'projectId', projectId);
        for (const elem of elements) {
            await this.delete(STORES.ELEMENTS, elem.id);
        }

        // Delete block references
        const blockRefs = await this.getAllByIndex<BlockReference>(STORES.BLOCK_REFERENCES, 'projectId', projectId);
        for (const ref of blockRefs) {
            await this.delete(STORES.BLOCK_REFERENCES, ref.id);
        }

        // Delete layers
        const layers = await this.getAllByIndex<Layer>(STORES.LAYERS, 'projectId', projectId);
        for (const layer of layers) {
            await this.delete(STORES.LAYERS, layer.id);
        }

        // Delete drawing settings row
        await this.delete(STORES.DRAWING_SETTINGS, projectId);

        await this.enqueueProjectDelete(projectId);
    }

    // Block operations
    async saveBlockDefinition(blockDef: BlockDefinition): Promise<void> {
        await this.update(STORES.BLOCK_DEFINITIONS, blockDef);
    }

    async getBlockDefinition(blockId: string): Promise<BlockDefinition | undefined> {
        return this.get<BlockDefinition>(STORES.BLOCK_DEFINITIONS, blockId);
    }

    async getAllBlockDefinitions(): Promise<BlockDefinition[]> {
        return this.getAll<BlockDefinition>(STORES.BLOCK_DEFINITIONS);
    }

    async getPublicBlockDefinitions(): Promise<BlockDefinition[]> {
        return this.getAllByIndex<BlockDefinition>(STORES.BLOCK_DEFINITIONS, 'isPublic', true);
    }

    async saveBlockReference(blockRef: BlockReference, projectId: string): Promise<void> {
        const refWithProject = { ...blockRef, projectId };
        await this.update(STORES.BLOCK_REFERENCES, refWithProject);
    }

    async getBlockReferencesByProject(projectId: string): Promise<BlockReference[]> {
        return this.getAllByIndex<BlockReference>(STORES.BLOCK_REFERENCES, 'projectId', projectId);
    }

    // Element operations
    async saveElement(element: CADElement, projectId: string): Promise<void> {
        const elemWithProject = { ...element, projectId };
        await this.update(STORES.ELEMENTS, elemWithProject);
    }

    /**
     * 用当前快照替换项目元素：先删除该项目旧记录，再写入新快照。
     * 删除与写入在同一事务内完成，避免失败后留下半份快照或复活已删除图元。
     */
    async saveElements(elements: CADElement[], projectId: string): Promise<void> {
        const db = await this.init();
        const transaction = db.transaction([STORES.ELEMENTS], 'readwrite');
        const store = transaction.objectStore(STORES.ELEMENTS);
        const index = store.index('projectId');
        const staleKeys: IDBValidKey[] = [];

        index.openCursor(IDBKeyRange.only(projectId)).onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor) {
                for (const key of staleKeys) {
                    store.delete(key);
                }
                for (const element of elements) {
                    store.put({ ...element, projectId });
                }
                return;
            }

            staleKeys.push(cursor.primaryKey);
            cursor.continue();
        };

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
        });
    }

    async getElementsByProject(projectId: string): Promise<CADElement[]> {
        return this.getAllByIndex<CADElement>(STORES.ELEMENTS, 'projectId', projectId);
    }

    /** 把 IDBRequest 包成 Promise，供文档级多 store 事务使用 */
    private request<T>(request: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 在同一事务内把某个索引范围内的旧记录全部收集为待删主键。
     * 游标走完成后再统一删除并写入新快照，避免边遍历边写导致漏删。
     */
    private collectStaleKeys(
        store: IDBObjectStore,
        indexName: string,
        value: IDBValidKey,
    ): Promise<IDBValidKey[]> {
        return new Promise((resolve, reject) => {
            const staleKeys: IDBValidKey[] = [];
            const cursorRequest = store.index(indexName).openCursor(IDBKeyRange.only(value));
            cursorRequest.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                if (!cursor) {
                    resolve(staleKeys);
                    return;
                }
                staleKeys.push(cursor.primaryKey);
                cursor.continue();
            };
            cursorRequest.onerror = () => reject(cursorRequest.error);
        });
    }

    /**
     * 保存完整文档：项目元数据、图元、块引用、图层快照与绘图设置在同一事务内替换写入。
     * 任一 store 失败整体回滚，不会留下"图元新、图层旧"的半份文档。
     * 同步入队由调用方决定（saveProject 的既有行为保持不变）。
     */
    async saveDocument(doc: ProjectDocument): Promise<void> {
        const db = await this.init();
        const transaction = db.transaction(
            [
                STORES.PROJECTS,
                STORES.ELEMENTS,
                STORES.BLOCK_REFERENCES,
                STORES.LAYERS,
                STORES.DRAWING_SETTINGS
            ],
            'readwrite'
        );

        const projectStore = transaction.objectStore(STORES.PROJECTS);
        const elementStore = transaction.objectStore(STORES.ELEMENTS);
        const blockRefStore = transaction.objectStore(STORES.BLOCK_REFERENCES);
        const layerStore = transaction.objectStore(STORES.LAYERS);
        const settingsStore = transaction.objectStore(STORES.DRAWING_SETTINGS);

        // 项目记录只存元数据：图元等正文以快照形式存在各自 store，避免同一份数据写两遍
        const metadata = projectFileFromDocument(doc);
        delete (metadata as { elements?: unknown }).elements;
        projectStore.put({ ...metadata, elementCount: doc.elements.length });

        // 图元 / 块引用 / 图层都是"按项目整份替换"的快照语义
        const staleElementKeys = await this.collectStaleKeys(elementStore, 'projectId', doc.id);
        for (const key of staleElementKeys) elementStore.delete(key);
        for (const element of doc.elements) {
            elementStore.put({ ...element, projectId: doc.id });
        }

        const staleBlockRefKeys = await this.collectStaleKeys(blockRefStore, 'projectId', doc.id);
        for (const key of staleBlockRefKeys) blockRefStore.delete(key);
        for (const reference of doc.blockReferences ?? []) {
            blockRefStore.put({ ...reference, projectId: doc.id });
        }

        const staleLayerKeys = await this.collectStaleKeys(layerStore, 'projectId', doc.id);
        for (const key of staleLayerKeys) layerStore.delete(key);
        for (const layer of doc.layers) {
            layerStore.put({ ...layer, projectId: doc.id });
        }

        // 设置行以项目 id 作为主键：单次 put 即完成 upsert，无需先读后写
        settingsStore.put({
            id: doc.id,
            projectId: doc.id,
            ...doc.drawingSettings
        });

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () =>
                reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
        });
    }

    /**
     * 读取完整文档：项目记录 + 图元 / 块引用 / 图层快照 + 绘图设置。
     * 旧存档缺少图层或设置时由 normalizeProjectDocument 补默认值。
     */
    async loadDocument(projectId: string): Promise<ProjectDocument | null> {
        const db = await this.init();
        const transaction = db.transaction(
            [
                STORES.PROJECTS,
                STORES.ELEMENTS,
                STORES.BLOCK_REFERENCES,
                STORES.LAYERS,
                STORES.DRAWING_SETTINGS
            ],
            'readonly'
        );

        const projectStore = transaction.objectStore(STORES.PROJECTS);
        const elementStore = transaction.objectStore(STORES.ELEMENTS);
        const blockRefStore = transaction.objectStore(STORES.BLOCK_REFERENCES);
        const layerStore = transaction.objectStore(STORES.LAYERS);
        const settingsStore = transaction.objectStore(STORES.DRAWING_SETTINGS);

        const [project, elements, blockReferences, layers, settings] = await Promise.all([
            this.request(projectStore.get(projectId)),
            this.request(elementStore.index('projectId').getAll(projectId)),
            this.request(blockRefStore.index('projectId').getAll(projectId)),
            this.request(layerStore.index('projectId').getAll(projectId)),
            this.request(settingsStore.index('projectId').get(projectId))
        ]);

        if (!project) return null;

        return normalizeProjectDocument({
            ...(project as Record<string, unknown>),
            elements,
            blockReferences,
            layers,
            drawingSettings: settings ?? undefined
        });
    }

    // Layer operations
    async saveLayer(layer: Layer, projectId: string): Promise<void> {
        const layerWithProject = { ...layer, projectId };
        await this.update(STORES.LAYERS, layerWithProject);
    }

    async getLayersByProject(projectId: string): Promise<Layer[]> {
        return this.getAllByIndex<Layer>(STORES.LAYERS, 'projectId', projectId);
    }

    // Sync queue operations
    async addToSyncQueue(item: SyncQueueItem): Promise<void> {
        await this.add(STORES.SYNC_QUEUE, item);
    }

    async getPendingSyncItems(): Promise<SyncQueueItem[]> {
        return this.getAllByIndex<SyncQueueItem>(STORES.SYNC_QUEUE, 'status', 'PENDING');
    }

    async getFailedSyncItems(): Promise<SyncQueueItem[]> {
        return this.getAllByIndex<SyncQueueItem>(STORES.SYNC_QUEUE, 'status', 'FAILED');
    }

    /** 手动重试：把失败项重新放回待同步队列 */
    async resetFailedSyncItems(): Promise<void> {
        const items = await this.getFailedSyncItems();
        for (const item of items) {
            await this.update<SyncQueueItem>(STORES.SYNC_QUEUE, {
                ...item,
                status: 'PENDING',
                error: undefined
            });
        }
    }

    async markSyncItemComplete(itemId: string): Promise<void> {
        const item = await this.get<SyncQueueItem>(STORES.SYNC_QUEUE, itemId);
        if (item) {
            item.status = 'SYNCED';
            await this.update(STORES.SYNC_QUEUE, item);
        }
    }

    async markSyncItemFailed(itemId: string, error: string): Promise<void> {
        const item = await this.get<SyncQueueItem>(STORES.SYNC_QUEUE, itemId);
        if (item) {
            item.status = 'FAILED';
            item.error = error;
            item.retryCount = (item.retryCount || 0) + 1;
            await this.update(STORES.SYNC_QUEUE, item);
        }
    }

    async clearSyncedItems(): Promise<void> {
        const syncedItems = await this.getAllByIndex<SyncQueueItem>(STORES.SYNC_QUEUE, 'status', 'SYNCED');
        for (const item of syncedItems) {
            await this.delete(STORES.SYNC_QUEUE, item.id);
        }
    }

    // Cache metadata operations
    async setCacheMetadata(key: string, value: any): Promise<void> {
        await this.update(STORES.CACHE_METADATA, { key, value, timestamp: Date.now() });
    }

    async getCacheMetadata(key: string): Promise<any> {
        const result = await this.get<{ key: string; value: any; timestamp: number }>(STORES.CACHE_METADATA, key);
        return result?.value;
    }

    // User operations
    async saveUser(user: User): Promise<void> {
        await this.update(STORES.USER, user);
    }

    async getCurrentUser(): Promise<User | undefined> {
        const users = await this.getAll<User>(STORES.USER);
        return users[0]; // Only one user in local storage
    }

    // Chat operations
    async saveChatMessage(message: ChatMessage, sessionId: string): Promise<void> {
        const msgWithSession = { ...message, sessionId };
        await this.add(STORES.CHAT_MESSAGES, msgWithSession);
    }

    async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
        return this.getAllByIndex<ChatMessage>(STORES.CHAT_MESSAGES, 'sessionId', sessionId);
    }

    // Utility: Clear all data
    async clearAllData(): Promise<void> {
        const storeNames = Object.values(STORES);
        for (const storeName of storeNames) {
            await this.clear(storeName);
        }
    }

    // Export data as JSON
    async exportAllData(): Promise<any> {
        const data: any = {};
        const storeNames = Object.values(STORES);

        for (const storeName of storeNames) {
            data[storeName] = await this.getAll(storeName);
        }

        return data;
    }

    // Import data from JSON
    async importAllData(data: any): Promise<void> {
        for (const [storeName, items] of Object.entries(data)) {
            if (Array.isArray(items)) {
                for (const item of items) {
                    await this.update(storeName, item);
                }
            }
        }
    }
}

// Export singleton instance
export const indexedDBService = new IndexedDBService();
export default indexedDBService;
