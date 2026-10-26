/**
 * drawingImport.ts — 统一 DXF / DWG 导入入口
 *
 * DXF 在浏览器内解析（默认交给 Worker，避免大文件冻结主线程）；
 * DWG 由后端 LibreDWG sidecar 转成 ASCII DXF，再走同一个解析器，
 * 保证两种格式的预览、图层与一次撤销语义一致。
 *
 * 解析结果附带导入报告（单位换算、不支持的实体、截断），
 * 调用方应把报告展示给用户，避免"看起来导入成功但有丢失"。
 */

import type { CADElement } from "../types";
import { apiService } from "./apiService";
import type { DxfImportReport } from "./dxfService";
import { dxfParser, type DxfParser } from "./dxfWorker";

export const isDwgFile = (name: string): boolean => /\.dwg$/i.test(name);

export const isDxfFile = (name: string): boolean => /\.dxf$/i.test(name);

export interface DrawingImportResult {
    elements: CADElement[];
    report: DxfImportReport;
}

/** 测试或自定义环境可注入解析器；默认使用共享的 Worker 解析器 */
export interface DrawingImportOptions {
    parser?: Pick<DxfParser, "parse">;
}

/** DWG 经 sidecar 转换，无法读取原始 $INSUNITS；按 mm（1:1）处理并在报告中标注 */
const dwgFallbackReport = (elementCount: number): DxfImportReport => ({
    insunits: null,
    unitScale: 1,
    supportedEntities: elementCount,
    imported: elementCount,
    unsupported: [],
    dropped: 0,
    blockDepthLimitHit: false,
    entityLimitHit: false,
});

export async function parseDrawingFileWithReport(
    file: File,
    options: DrawingImportOptions = {},
): Promise<DrawingImportResult> {
    const parser = options.parser ?? dxfParser;

    if (isDwgFile(file.name)) {
        const { dxf } = await apiService.convertDwg(file);
        const { elements } = await parser.parse(dxf);
        return { elements, report: dwgFallbackReport(elements.length) };
    }
    if (!isDxfFile(file.name)) {
        throw new Error("仅支持 .dxf 与 .dwg 文件");
    }
    return parser.parse(await file.text());
}

export async function parseDrawingFile(
    file: File,
    options: DrawingImportOptions = {},
): Promise<CADElement[]> {
    const { elements } = await parseDrawingFileWithReport(file, options);
    return elements;
}
