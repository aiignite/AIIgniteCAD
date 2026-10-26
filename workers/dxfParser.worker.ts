/**
 * dxfParser.worker.ts — 在 Worker 线程解析 DXF
 *
 * 大文件（数 MB 的 DXF）在主线程同步解析会冻结交互；这里只做「收文本 → 解析 → 回结果」，
 * 解析实现仍复用 services/dxfService，保证 Worker 与主线程两条路径结果一致。
 */

import { parseDXFWithReport } from "../services/dxfService";
import type { DxfWorkerRequest, DxfWorkerResponse } from "../services/dxfWorkerProtocol";

const scope = self as unknown as {
    onmessage: ((event: MessageEvent<DxfWorkerRequest>) => void) | null;
    postMessage: (message: DxfWorkerResponse) => void;
};

scope.onmessage = (event) => {
    const request = event.data;
    if (!request || request.type !== "parse" || typeof request.dxf !== "string") return;

    try {
        scope.postMessage({
            type: "result",
            id: request.id,
            result: parseDXFWithReport(request.dxf),
        });
    } catch (error) {
        scope.postMessage({
            type: "error",
            id: request.id,
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
