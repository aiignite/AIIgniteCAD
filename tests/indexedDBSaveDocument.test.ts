/**
 * indexedDBSaveDocument.test.ts — 文档级原子保存测试
 *
 * 覆盖 saveDocument / loadDocument 的事务替换语义：
 * 图元、块引用、图层与绘图设置整份替换，删除不复活、旧图层被清理、
 * 其他项目不受影响，旧存档（只有图元快照）加载时按默认文档迁移。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CADElement, DrawingSettings, Layer } from "../types";
import type { ProjectDocument } from "../lib/projectDocument";

type IndexedDBServiceModule = typeof import("../services/indexedDBService");

/** indexedDBService 是模块级单例：每个用例前重置模块，保证拿到全新的库实例 */
let indexedDBService: IndexedDBServiceModule["indexedDBService"];

type RequestHandler = ((event: { target: any }) => void) | null;

class FakeRequest<T = any> {
    onsuccess: RequestHandler = null;
    onupgradeneeded: RequestHandler = null;
    onerror: RequestHandler = null;
    result: T | undefined = undefined;
    error: unknown = undefined;

    succeed(result: T): void {
        this.result = result;
        queueMicrotask(() => this.onsuccess?.({ target: this }));
    }
}

class FakeIndex {
    constructor(private store: FakeObjectStore, private keyPath: string) {}

    getAll(value: unknown): FakeRequest<any[]> {
        const values = [...this.store.data.values()].filter(
            (record) => record[this.keyPath] === value,
        );
        const request = new FakeRequest<any[]>();
        request.succeed(values);
        return request;
    }

    get(value: unknown): FakeRequest<any> {
        const record = [...this.store.data.values()].find(
            (entry) => entry[this.keyPath] === value,
        );
        const request = new FakeRequest<any>();
        request.succeed(record);
        return request;
    }

    openCursor(value: unknown): FakeRequest<any> {
        const request = new FakeRequest<any>();
        const keys = [...this.store.data.entries()].filter(
            ([, record]) => record[this.keyPath] === value,
        );

        let position = 0;
        const emit = () => {
            const entry = keys[position];
            if (!entry) {
                request.succeed(null);
                return;
            }

            const [key] = entry;
            const cursor = {
                primaryKey: key,
                delete: () => this.store.data.delete(key),
                continue: () => {
                    position += 1;
                    queueMicrotask(emit);
                },
            };
            request.succeed(cursor);
        };

        queueMicrotask(emit);
        return request;
    }
}

class FakeObjectStore {
    data = new Map<string, any>();
    indexes = new Map<string, FakeIndex>();

    constructor(public name: string) {}

    createIndex(indexName: string, keyPath: string): FakeIndex {
        const index = new FakeIndex(this, keyPath);
        this.indexes.set(indexName, index);
        return index;
    }

    index(indexName: string): FakeIndex {
        const index = this.indexes.get(indexName);
        if (!index) {
            throw new Error(`Missing index: ${indexName}`);
        }
        return index;
    }

    put(value: any): FakeRequest<string> {
        const request = new FakeRequest<string>();
        this.data.set(value.id, value);
        request.succeed(value.id);
        return request;
    }

    add(value: any): FakeRequest<string> {
        return this.put(value);
    }

    get(key: string): FakeRequest<any> {
        const request = new FakeRequest<any>();
        request.succeed(this.data.get(key));
        return request;
    }

    getAll(): FakeRequest<any[]> {
        const request = new FakeRequest<any[]>();
        request.succeed([...this.data.values()]);
        return request;
    }

    delete(key: string): FakeRequest<undefined> {
        const request = new FakeRequest<undefined>();
        this.data.delete(key);
        request.succeed(undefined);
        return request;
    }
}

class FakeTransaction {
    oncomplete: RequestHandler = null;
    onerror: RequestHandler = null;
    onabort: RequestHandler = null;
    error: unknown = undefined;

    constructor(private stores: Map<string, FakeObjectStore>) {
        setTimeout(() => this.oncomplete?.({ target: this }), 0);
    }

    objectStore(name: string): FakeObjectStore {
        const store = this.stores.get(name);
        if (!store) {
            throw new Error(`Missing store: ${name}`);
        }
        return store;
    }
}

class FakeDatabase {
    stores = new Map<string, FakeObjectStore>();
    objectStoreNames = {
        contains: (name: string) => this.stores.has(name),
    };

    createObjectStore(name: string): FakeObjectStore {
        const store = new FakeObjectStore(name);
        this.stores.set(name, store);
        return store;
    }

    transaction(storeNames: string[]): FakeTransaction {
        return new FakeTransaction(this.stores);
    }
}

class FakeIndexedDB {
    constructor(private database: FakeDatabase) {}

    open(): FakeRequest<FakeDatabase> {
        const request = new FakeRequest<FakeDatabase>();
        queueMicrotask(() => {
            request.result = this.database;
            request.onupgradeneeded?.({ target: request });
            request.succeed(this.database);
        });
        return request;
    }
}

const line = (id: string, layer = "0"): CADElement => ({
    id,
    type: "LINE",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    layer,
    color: "#000000",
});

const layer = (name: string, overrides: Partial<Layer> = {}): Layer => ({
    id: `layer-${name}`,
    name,
    color: "#e6edf3",
    isVisible: true,
    isLocked: false,
    lineType: "CONTINUOUS",
    ...overrides,
});

const settings = (overrides: Partial<DrawingSettings> = {}): DrawingSettings => ({
    units: "mm",
    gridSpacing: 50,
    snapDistance: 10,
    dimScale: 1,
    dimPrecision: 2,
    ...overrides,
});

const document = (
    id: string,
    overrides: Partial<ProjectDocument> = {},
): ProjectDocument => ({
    schemaVersion: 1,
    id,
    name: `Drawing ${id}`,
    lastModified: "2026-01-01T00:00:00.000Z",
    elements: [],
    layers: createLayers(),
    drawingSettings: settings(),
    ...overrides,
});

const createLayers = (): Layer[] => [
    layer("0"),
    layer("DIM", { color: "#4ade80" }),
];

describe("indexedDBService.saveDocument / loadDocument", () => {
    beforeEach(async () => {
        vi.resetModules();
        const database = new FakeDatabase();
        globalThis.indexedDB = new FakeIndexedDB(database) as unknown as IDBFactory;
        globalThis.IDBKeyRange = {
            only: (value: unknown) => value,
        } as unknown as typeof IDBKeyRange;
        ({ indexedDBService } = await import("../services/indexedDBService"));
    });

    it("整份替换：删除的图元不复活，旧图层被清理，设置被更新", async () => {
        await indexedDBService.saveDocument(
            document("p1", {
                elements: [line("a"), line("b")],
                layers: [...createLayers(), layer("TEMP")],
                drawingSettings: settings({ units: "cm", gridSpacing: 20 }),
            }),
        );

        await indexedDBService.saveDocument(
            document("p1", {
                elements: [line("a")],
                layers: createLayers(),
                drawingSettings: settings({ units: "in", gridSpacing: 5 }),
            }),
        );

        const loaded = await indexedDBService.loadDocument("p1");
        expect(loaded).not.toBeNull();
        expect(loaded!.elements.map((el) => el.id)).toEqual(["a"]);
        expect(loaded!.layers.map((l) => l.name)).toEqual(["0", "DIM"]);
        // enabledSnapTypes 由 normalize 显式落地为默认捕捉集
        expect(loaded!.drawingSettings).toMatchObject({ units: "in", gridSpacing: 5 });
        expect(loaded!.name).toBe("Drawing p1");
    });

    it("不影响其他项目的文档", async () => {
        await indexedDBService.saveDocument(document("p1", { elements: [line("a")] }));
        await indexedDBService.saveDocument(
            document("p2", { elements: [line("b"), line("c")] }),
        );

        const p1 = await indexedDBService.loadDocument("p1");
        const p2 = await indexedDBService.loadDocument("p2");
        expect(p1!.elements.map((el) => el.id)).toEqual(["a"]);
        expect(p2!.elements.map((el) => el.id)).toEqual(["b", "c"]);
    });

    it("旧存档（只有图元快照、无项目记录）由回退链路迁移", async () => {
        await indexedDBService.saveElements([line("a"), line("b", "LEGACY")], "p1");

        // loadDocument 要求项目记录存在：纯图元快照的旧存档返回 null，
        // 由调用方回退到 getElementsByProject 再按默认文档迁移
        await expect(indexedDBService.loadDocument("p1")).resolves.toBeNull();

        const legacy = await indexedDBService.getElementsByProject("p1");
        expect(legacy.map((el) => el.id).sort()).toEqual(["a", "b"]);

        // 首次保存文档后即可按完整文档加载
        await indexedDBService.saveDocument(
            document("p1", { elements: legacy }),
        );
        const migrated = await indexedDBService.loadDocument("p1");
        expect(migrated!.layers.map((l) => l.name)).toEqual(["0", "DIM"]);
        expect(migrated!.drawingSettings.gridSpacing).toBe(50);
    });

    it("loadDocument 对不存在的项目返回 null", async () => {
        await expect(indexedDBService.loadDocument("missing")).resolves.toBeNull();
    });

    it("deleteProject 连带清除绘图设置行", async () => {
        await indexedDBService.saveDocument(document("p1"));
        await indexedDBService.deleteProject("p1");
        await expect(indexedDBService.loadDocument("p1")).resolves.toBeNull();
    });

    it("文档中的图层隐藏与锁定状态完整往返", async () => {
        const layers = [
            layer("0"),
            layer("DIM", { isVisible: false, isLocked: true, lineType: "DASHED" }),
        ];
        await indexedDBService.saveDocument(document("p1", { layers }));

        const loaded = await indexedDBService.loadDocument("p1");
        expect(loaded!.layers).toEqual(layers);
    });
});
