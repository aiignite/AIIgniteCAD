/**
 * dxfWorker.ts — DXF 解析的 Worker 客户端
 *
 * 目标：把 DXF 解析从主线程移走，导入大文件时画布不冻结。
 * 设计要点：
 * - 请求带自增 id，多个解析请求可并发，响应按 id 对应；
 * - Worker 不可用（Node / 测试环境、构造失败）时自动回退主线程同步解析；
 * - Worker 崩溃时把挂起请求改走主线程重试一次，导入不会因此失败；
 * - 超时说明 Worker 卡死，终止线程并报错，避免无限等待；
 * - 解析实现只有一份（services/dxfService），两条路径结果一致。
 */

import { parseDXFWithReport, type DxfImportResult } from "./dxfService";
import type { DxfWorkerResponse } from "./dxfWorkerProtocol";

/** 测试可注入的最小 Worker 接口（浏览器 Worker 满足该形状） */
export interface DxfParserWorkerLike {
    postMessage(message: unknown): void;
    addEventListener(
        type: "message",
        listener: (event: MessageEvent<DxfWorkerResponse>) => void,
    ): void;
    addEventListener(type: "error", listener: (event: Event) => void): void;
    terminate(): void;
}

export type DxfParseMode = "worker" | "inline";

export interface DxfParser {
    /** 解析 DXF 文本；Worker 不可用时回退主线程 */
    parse(text: string): Promise<DxfImportResult>;
    /** 终止 Worker 并拒绝挂起请求 */
    dispose(): void;
    /** 当前实际生效的解析路径（首次解析后才确定） */
    readonly mode: DxfParseMode;
}

export interface DxfParserOptions {
    /** Worker 工厂；返回 null 表示当前环境不使用 Worker */
    workerFactory?: () => DxfParserWorkerLike | null;
    /** 单次解析超时（毫秒），默认 30s */
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingParse {
    text: string;
    resolve: (result: DxfImportResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * 默认工厂：浏览器里创建模块化 Worker；Node / 测试环境没有 Worker 时返回 null。
 * Vite 会把 `new URL(..., import.meta.url)` 识别为 Worker 入口并单独打包。
 */
function defaultWorkerFactory(): DxfParserWorkerLike | null {
    if (typeof Worker === "undefined") return null;
    try {
        return new Worker(new URL("../workers/dxfParser.worker.ts", import.meta.url), {
            type: "module",
        }) as unknown as DxfParserWorkerLike;
    } catch {
        return null;
    }
}

/** 主线程同步解析；包一层 Promise 让调用方不关心执行线程 */
function parseInline(text: string): Promise<DxfImportResult> {
    try {
        return Promise.resolve(parseDXFWithReport(text));
    } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
}

export function createDxfParser(options: DxfParserOptions = {}): DxfParser {
    const factory = options.workerFactory ?? defaultWorkerFactory;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let worker: DxfParserWorkerLike | null = null;
    let mode: DxfParseMode = "inline";
    let disposed = false;
    let unavailable = false;
    let nextId = 1;
    const pending = new Map<number, PendingParse>();

    /** Worker 崩溃：挂起请求改走主线程重试一次，然后转入 inline 模式 */
    const recoverFromCrash = (): void => {
        const orphaned = Array.from(pending.values());
        pending.clear();
        for (const entry of orphaned) clearTimeout(entry.timer);
        worker?.terminate();
        worker = null;
        mode = "inline";
        unavailable = true;
        for (const entry of orphaned) {
            parseInline(entry.text).then(entry.resolve, entry.reject);
        }
    };

    const ensureWorker = (): DxfParserWorkerLike | null => {
        if (disposed || unavailable) return null;
        if (worker) return worker;

        try {
            const created = factory();
            if (!created) {
                // 环境不支持（Node / 测试）或构造失败：记住结论，不再反复尝试
                unavailable = true;
                mode = "inline";
                return null;
            }

            created.addEventListener("message", (event) => {
                const message = event.data;
                if (!message || typeof message.id !== "number") return;
                const entry = pending.get(message.id);
                if (!entry) return;
                pending.delete(message.id);
                clearTimeout(entry.timer);
                if (message.type === "result") entry.resolve(message.result);
                else entry.reject(new Error(message.message));
            });
            created.addEventListener("error", recoverFromCrash);

            worker = created;
            mode = "worker";
            return created;
        } catch {
            mode = "inline";
            return null;
        }
    };

    return {
        get mode(): DxfParseMode {
            return mode;
        },

        parse(text: string): Promise<DxfImportResult> {
            const target = ensureWorker();
            if (!target) return parseInline(text);

            const id = nextId++;
            return new Promise<DxfImportResult>((resolve, reject) => {
                const timer = setTimeout(() => {
                    // 超时说明 Worker 卡死：终止线程，后续请求回退主线程
                    pending.delete(id);
                    worker?.terminate();
                    worker = null;
                    mode = "inline";
                    unavailable = true;
                    reject(new Error("DXF 解析超时"));
                }, timeoutMs);

                pending.set(id, { text, resolve, reject, timer });

                try {
                    target.postMessage({ type: "parse", id, dxf: text });
                } catch (error) {
                    pending.delete(id);
                    clearTimeout(timer);
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        },

        dispose(): void {
            disposed = true;
            const orphaned = Array.from(pending.values());
            pending.clear();
            for (const entry of orphaned) clearTimeout(entry.timer);
            worker?.terminate();
            worker = null;
            for (const entry of orphaned) entry.reject(new Error("DXF 解析器已关闭"));
        },
    };
}

/** 应用共享实例：首次解析时按环境决定走 Worker 还是主线程 */
export const dxfParser = createDxfParser();
