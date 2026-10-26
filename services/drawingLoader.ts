/**
 * drawingLoader.ts — 按需读取另一张图纸的图元
 *
 * 只读用途（跨图纸快照插入、项目级检查），不改变服务端「当前打开图纸」状态：
 * 不调用 openProject，避免浏览别人的图纸就改写 lastOpenedAt。
 * 服务端不可用时回退本地 IndexedDB 文档，与打开图纸的降级路径一致。
 */

import type { CADElement } from "../types";
import { apiService } from "./apiService";
import { indexedDBService } from "./indexedDBService";
import { normalizeProjectDocument } from "../lib/projectDocument";

/** 服务端项目行里的图元几何存在 geometryData 中 */
function elementsFromProject(project: Record<string, unknown>): CADElement[] {
    const rows = Array.isArray(project.elements) ? project.elements : [];
    const doc = normalizeProjectDocument({
        id: typeof project.id === "string" ? project.id : "",
        name: typeof project.name === "string" ? project.name : "",
        lastModified: typeof project.updatedAt === "string" ? project.updatedAt : undefined,
        elements: rows.map((row) => {
            const geometry = (row as { geometryData?: unknown }).geometryData;
            return geometry && typeof geometry === "object"
                ? { ...(geometry as Record<string, unknown>) }
                : null;
        }),
        layers: project.layers,
        drawingSettings: project.drawingSettings,
        blockReferences: project.blockReferences,
        designConventions: project.designConventions,
    });
    return doc?.elements ?? [];
}

/**
 * 读取指定图纸的图元；读不到返回 null（调用方据此提示，而不是当成空图纸）。
 */
export async function loadDrawingElements(projectId: string): Promise<CADElement[] | null> {
    if (apiService.isAuthenticated()) {
        try {
            const { project } = await apiService.getProject(projectId);
            if (project) return elementsFromProject(project as Record<string, unknown>);
        } catch (error) {
            // 服务端不可用不应该阻断离线用户：继续尝试本地快照
            console.error("Failed to load drawing from server; falling back to local:", error);
        }
    }
    const local = await indexedDBService.loadDocument(projectId);
    return local ? local.elements : null;
}
