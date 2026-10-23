/**
 * imageTraceService.ts — 把用户选择的图片解码为像素数据
 *
 * 只在浏览器本地读取并缩放，避免大图追踪阻塞主线程；不上传服务器。
 */

import type { TraceImageData } from "../lib/imageTrace";

export const MAX_TRACE_SOURCE_SIZE = 512;

export async function loadTraceImage(file: File): Promise<TraceImageData> {
    if (!file.type.startsWith("image/")) {
        throw new Error("请选择 PNG / JPG / WebP 等图片文件");
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_TRACE_SOURCE_SIZE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        bitmap.close();
        throw new Error("当前浏览器无法读取图片像素");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
}
