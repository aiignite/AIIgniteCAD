// IndexedDB Service for AIIgniteCAD
// Provides local offline storage mirroring PostgreSQL structure

import {
    ProjectFile,
    CADElement,
    BlockDefinition,
    BlockReference,
    Layer,
    DrawingSettings,
    ChatMessage,
    SyncQueueItem,
    User
} from '../types';

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

        // Queue for sync
        await this.addToSyncQueue({
            id: Math.random().toString(36).substr(2, 9),
            operation: 'UPDATE',
            entityType: 'PROJECT',
            entityId: project.id,
            data: project,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
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

        await this.addToSyncQueue({
            id: Math.random().toString(36).substr(2, 9),
            operation: 'DELETE',
            entityType: 'PROJECT',
            entityId: projectId,
            data: null,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
    }

    // Block operations
    async saveBlockDefinition(blockDef: BlockDefinition): Promise<void> {
        await this.update(STORES.BLOCK_DEFINITIONS, blockDef);

        await this.addToSyncQueue({
            id: Math.random().toString(36).substr(2, 9),
            operation: 'UPDATE',
            entityType: 'BLOCK_DEFINITION',
            entityId: blockDef.id,
            data: blockDef,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
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

        await this.addToSyncQueue({
            id: Math.random().toString(36).substr(2, 9),
            operation: 'UPDATE',
            entityType: 'BLOCK_REFERENCE',
            entityId: blockRef.id,
            data: refWithProject,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
    }

    async getBlockReferencesByProject(projectId: string): Promise<BlockReference[]> {
        return this.getAllByIndex<BlockReference>(STORES.BLOCK_REFERENCES, 'projectId', projectId);
    }

    // Element operations
    async saveElement(element: CADElement, projectId: string): Promise<void> {
        const elemWithProject = { ...element, projectId };
        await this.update(STORES.ELEMENTS, elemWithProject);

        await this.addToSyncQueue({
            id: Math.random().toString(36).substr(2, 9),
            operation: 'UPDATE',
            entityType: 'ELEMENT',
            entityId: element.id,
            data: elemWithProject,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
    }

    async saveElements(elements: CADElement[], projectId: string): Promise<void> {
        const db = await this.init();
        const transaction = db.transaction([STORES.ELEMENTS], 'readwrite');
        const store = transaction.objectStore(STORES.ELEMENTS);

        for (const element of elements) {
            const elemWithProject = { ...element, projectId };
            store.put(elemWithProject);
        }

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getElementsByProject(projectId: string): Promise<CADElement[]> {
        return this.getAllByIndex<CADElement>(STORES.ELEMENTS, 'projectId', projectId);
    }

    // Layer operations
    async saveLayer(layer: Layer, projectId: string): Promise<void> {
        const layerWithProject = { ...layer, projectId };
        await this.update(STORES.LAYERS, layerWithProject);

        await this.addToSyncQueue({
            id: Math.random().toString(36).substr(2, 9),
            operation: 'UPDATE',
            entityType: 'LAYER',
            entityId: layer.id,
            data: layerWithProject,
            timestamp: new Date().toISOString(),
            status: 'PENDING'
        });
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
