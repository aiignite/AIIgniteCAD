/**
 * dxfWorkerProtocol.ts — DXF Worker 的消息协议
 *
 * 主线程与 Worker 共用同一份类型：请求带自增 id，响应按 id 对应。
 * 只传文本与纯数据结果，不传 DOM / File 对象，保证结构化克隆可用。
 */

import type { DxfImportResult } from "./dxfService";

/** 主线程 → Worker：解析一段 DXF 文本 */
export interface DxfWorkerParseRequest {
    type: "parse";
    id: number;
    dxf: string;
}

export type DxfWorkerRequest = DxfWorkerParseRequest;

/** Worker → 主线程：解析结果或失败原因 */
export type DxfWorkerResponse =
    | { type: "result"; id: number; result: DxfImportResult }
    | { type: "error"; id: number; message: string };
