/**
 * versionSnapshot.ts — 版本快照构建
 *
 * 将画布状态整理为可序列化的快照，供手动/自动版本与恢复流程共用。
 */

import type {
    CADElement,
    DesignConventions,
    DrawingSettings,
    Layer,
    ProjectVersion,
} from "../types";

export interface LayerSnapshotInput {
    layerOrder: string[];
    layerColors: Record<string, string>;
    hiddenLayers: string[];
    lockedLayers: string[];
}

/**
 * 汇总图层定义：显式图层顺序在前，再补上仅存在于图元中的历史图层。
 * 版本快照与日常文档保存共用同一套规则，避免两处图层语义漂移。
 */
export function collectLayers(
    elements: CADElement[],
    layerState: LayerSnapshotInput,
): Layer[] {
    const hidden = new Set(layerState.hiddenLayers);
    const locked = new Set(layerState.lockedLayers);
    const seen = new Set<string>();
    const names: string[] = [];

    const add = (name: string) => {
        if (!name || seen.has(name)) return;
        seen.add(name);
        names.push(name);
    };

    // 显式图层顺序在前，再补上仅存在于图元中的历史图层
    layerState.layerOrder.forEach(add);
    elements.forEach((element) => add(element.layer || "0"));

    return names.map((name) => ({
        id: `layer-${name}`,
        name,
        color: layerState.layerColors[name] ?? "#e6edf3",
        isVisible: !hidden.has(name),
        isLocked: locked.has(name),
        lineType: "CONTINUOUS" as const,
    }));
}

export function buildVersionSnapshot(
    elements: CADElement[],
    layerState: LayerSnapshotInput,
    settings: DrawingSettings,
    designConventions?: DesignConventions | null,
): ProjectVersion["snapshotData"] {
    return {
        elements,
        layers: collectLayers(elements, layerState),
        settings,
        // 约定随版本一起保存：恢复版本时制图标准不会退回旧值
        ...(designConventions !== undefined ? { designConventions } : {}),
    };
}
