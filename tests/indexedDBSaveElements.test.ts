/**
 * indexedDBSaveElements.test.ts — 本地元素快照替换测试
 *
 * 覆盖 saveElements 的事务替换语义：已删除图元不能在重新加载时复活，
 * 其他项目的元素不能被误删。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { indexedDBService } from "../services/indexedDBService";
import { CADElement } from "../types";

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

describe("indexedDBService.saveElements", () => {
    beforeEach(() => {
        const database = new FakeDatabase();
        globalThis.indexedDB = new FakeIndexedDB(database) as unknown as IDBFactory;
        globalThis.IDBKeyRange = {
            only: (value: unknown) => value,
        } as unknown as typeof IDBKeyRange;
    });

    it("重新加载时不复活已删除图元", async () => {
        await indexedDBService.saveElements([line("a"), line("b")], "p1");
        await indexedDBService.saveElements([line("a")], "p1");

        await expect(indexedDBService.getElementsByProject("p1")).resolves.toEqual([
            expect.objectContaining({ id: "a" }),
        ]);
    });

    it("不会删除其他项目的元素", async () => {
        await indexedDBService.saveElements([line("a")], "p1");
        await indexedDBService.saveElements([line("b")], "p2");

        const projectElements = await indexedDBService.getElementsByProject("p1");
        expect(projectElements.map((element) => element.id)).toEqual(["a"]);
    });
});
