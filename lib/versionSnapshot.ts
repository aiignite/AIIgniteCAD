/**
 * versionSnapshot.ts — 版本快照构建
 *
 * 将画布状态整理为可序列化的快照，供手动/自动版本与恢复流程共用。
 */

import type {
    CADElement,
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

export function buildVersionSnapshot(
    elements: CADElement[],
    layerState: LayerSnapshotInput,
    settings: DrawingSettings,
): ProjectVersion["snapshotData"] {
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

    const layers: Layer[] = names.map((name) => ({
        id: `layer-${name}`,
        name,
        color: layerState.layerColors[name] ?? "#e6edf3",
        isVisible: !hidden.has(name),
        isLocked: locked.has(name),
        lineType: "CONTINUOUS",
    }));

    return { elements, layers, settings };
}
