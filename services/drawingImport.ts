/**
 * drawingImport.ts — 统一 DXF / DWG 导入入口
 *
 * DXF 在浏览器内直接解析；DWG 由后端 LibreDWG sidecar 转成 ASCII DXF，
 * 再走同一个 parseDXF，保证两种格式的预览、图层与一次撤销语义一致。
 */

import type { CADElement } from "../types";
import { apiService } from "./apiService";
import { parseDXF } from "./dxfService";

export const isDwgFile = (name: string): boolean => /\.dwg$/i.test(name);

export const isDxfFile = (name: string): boolean => /\.dxf$/i.test(name);

export async function parseDrawingFile(file: File): Promise<CADElement[]> {
  if (isDwgFile(file.name)) {
    const { dxf } = await apiService.convertDwg(file);
    return parseDXF(dxf);
  }
  if (!isDxfFile(file.name)) {
    throw new Error("仅支持 .dxf 与 .dwg 文件");
  }
  return parseDXF(await file.text());
}
