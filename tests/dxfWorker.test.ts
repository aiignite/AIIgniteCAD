/**
 * dxfWorker.test.ts — DXF Worker 客户端测试
 *
 * 覆盖：Worker 路径、并发 id 匹配、错误消息、崩溃后主线程回退、
 * 超时、dispose 以及无 Worker 环境的同步回退；
 * 另验证 drawingImport 使用注入的解析器。
 */

import { describe, expect, it, vi } from "vitest";
import { parseDXFWithReport } from "../services/dxfService";
import {
    createDxfParser,
    type DxfParserWorkerLike,
} from "../services/dxfWorker";
import type { DxfWorkerResponse } from "../services/dxfWorkerProtocol";
import { parseDrawingFileWithReport } from "../services/drawingImport";

const SAMPLE_DXF = `0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
11
100
21
50
0
ENDSEC
0
EOF
`;

type MessageListener = (event: MessageEvent<DxfWorkerResponse>) => void;
type ErrorListener = (event: Event) => void;

/** 测试替身：记录请求，按构造时给定的策略回复或保持沉默 */
class FakeWorker implements DxfParserWorkerLike {
    readonly posted: { id: number; dxf: string }[] = [];
    terminated = false;
    private messageListeners: MessageListener[] = [];
    private errorListeners: ErrorListener[] = [];

    constructor(private readonly respond?: (request: { id: number; dxf: string }) => void) {}

    postMessage(message: unknown): void {
        const request = message as { id: number; dxf: string };
        this.posted.push(request);
        this.respond?.(request);
    }

    addEventListener(type: "message", listener: MessageListener): void;
    addEventListener(type: "error", listener: ErrorListener): void;
    addEventListener(
        type: "message" | "error",
        listener: MessageListener | ErrorListener,
    ): void {
        if (type === "message") this.messageListeners.push(listener as MessageListener);
        else this.errorListeners.push(listener as ErrorListener);
    }

    terminate(): void {
        this.terminated = true;
        this.messageListeners = [];
        this.errorListeners = [];
    }

    emit(message: DxfWorkerResponse): void {
        for (const listener of this.messageListeners) {
            listener({ data: message } as MessageEvent<DxfWorkerResponse>);
        }
    }

    crash(): void {
        for (const listener of this.errorListeners) listener(new Event("error"));
    }
}

describe("dxfWorker 客户端", () => {
    it("Worker 可用时通过 postMessage 解析并返回与主线程一致的结果", async () => {
        const worker = new FakeWorker((request) => {
            worker.emit({
                type: "result",
                id: request.id,
                result: parseDXFWithReport(request.dxf),
            });
        });
        const parser = createDxfParser({ workerFactory: () => worker });

        const result = await parser.parse(SAMPLE_DXF);

        expect(parser.mode).toBe("worker");
        expect(worker.posted).toHaveLength(1);
        expect(worker.posted[0].dxf).toBe(SAMPLE_DXF);
        expect(result.elements).toHaveLength(1);
        expect(result.elements[0].type).toBe("LINE");
    });

    it("并发请求按 id 对应，响应乱序也不串包", async () => {
        const worker = new FakeWorker();
        const parser = createDxfParser({ workerFactory: () => worker });

        const first = parser.parse(SAMPLE_DXF);
        const second = parser.parse("second-dxf");
        expect(worker.posted).toHaveLength(2);
        const [reqA, reqB] = worker.posted;
        expect(reqA.dxf).toBe(SAMPLE_DXF);
        expect(reqB.dxf).toBe("second-dxf");

        // 后发的先回，先发的后回
        worker.emit({
            type: "result",
            id: reqB.id,
            result: { elements: [], report: parseDXFWithReport("").report },
        });
        worker.emit({
            type: "result",
            id: reqA.id,
            result: { elements: [], report: parseDXFWithReport("").report },
        });

        await expect(first).resolves.toBeDefined();
        await expect(second).resolves.toBeDefined();
        expect(parser.mode).toBe("worker");
    });

    it("Worker 返回错误消息时以失败结束", async () => {
        const worker = new FakeWorker((request) => {
            worker.emit({ type: "error", id: request.id, message: "DXF 结构损坏" });
        });
        const parser = createDxfParser({ workerFactory: () => worker });

        await expect(parser.parse(SAMPLE_DXF)).rejects.toThrow("DXF 结构损坏");
    });

    it("Worker 崩溃时挂起请求回退主线程解析", async () => {
        const worker = new FakeWorker();
        const parser = createDxfParser({ workerFactory: () => worker });

        const pending = parser.parse(SAMPLE_DXF);
        worker.crash();

        const result = await pending;
        expect(result.elements).toHaveLength(1);
        expect(parser.mode).toBe("inline");
        expect(worker.terminated).toBe(true);
    });

    it("超时终止 Worker 并报错", async () => {
        const worker = new FakeWorker();
        const parser = createDxfParser({ workerFactory: () => worker, timeoutMs: 10 });

        await expect(parser.parse(SAMPLE_DXF)).rejects.toThrow("DXF 解析超时");
        expect(worker.terminated).toBe(true);
        expect(parser.mode).toBe("inline");
    });

    it("dispose 终止 Worker 并拒绝挂起请求", async () => {
        const worker = new FakeWorker();
        const parser = createDxfParser({ workerFactory: () => worker });

        const pending = parser.parse(SAMPLE_DXF);
        parser.dispose();

        await expect(pending).rejects.toThrow("DXF 解析器已关闭");
        expect(worker.terminated).toBe(true);
    });

    it("无 Worker 环境直接走同步解析，且只探测一次", async () => {
        const factory = vi.fn(() => null);
        const parser = createDxfParser({ workerFactory: factory });

        const result = await parser.parse(SAMPLE_DXF);
        await parser.parse(SAMPLE_DXF);

        expect(result.elements).toHaveLength(1);
        expect(parser.mode).toBe("inline");
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it("drawingImport 使用注入的解析器解析 DXF 文件", async () => {
        const parse = vi.fn(async (text: string) => parseDXFWithReport(text));
        const file = new File([SAMPLE_DXF], "drawing.dxf", {
            type: "application/dxf",
        });

        const result = await parseDrawingFileWithReport(file, { parser: { parse } });

        expect(parse).toHaveBeenCalledTimes(1);
        expect(parse.mock.calls[0][0]).toContain("LINE");
        expect(result.elements).toHaveLength(1);
    });
});
