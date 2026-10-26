/**
 * changeExplanation.ts — AI 变更的可解释说明
 *
 * 预览面板已经有「多少条增删改」，但用户真正要判断的是「具体动了什么」。
 * 这里把几何差分转成逐条、可读、可复制的变更明细：
 * 每条形如「+ LINE · OUTLINE · (0,0)→(100,0)」，并给出按图层的分布，
 * 让「AI 有没有画到不该画的图层」这类问题可以一眼核对。
 *
 * 纯函数：不依赖 React 与 store，输入输出都可测。
 */

import type { CADElement, Point } from "../types";
import type { VersionDiff } from "./versionDiff";

export type ChangeKind = "added" | "modified" | "removed";

export interface ChangeEntry {
    kind: ChangeKind;
    id: string;
    type: CADElement["type"];
    layer: string;
    /** 一行几何摘要 */
    summary: string;
    /** 修改类变更的前后对照 */
    detail?: string;
}

export interface LayerDelta {
    layer: string;
    added: number;
    modified: number;
    removed: number;
}

export interface ChangeExplanation {
    entries: ChangeEntry[];
    byLayer: LayerDelta[];
    counts: Record<ChangeKind, number>;
    /** 明细被截断时为 true：entries 只保留前 N 条 */
    truncated: boolean;
    /** 可直接复制给同事或回填给模型的文本说明 */
    text: string;
}

export interface ExplainOptions {
    /** 明细上限，默认 60；超出部分只计入计数 */
    maxEntries?: number;
    /** 操作序列（ADD / MOVE / …），只用于说明文本里的「做了什么」一行 */
    operations?: readonly string[];
}

const round = (value: number | undefined): string =>
    value === undefined ? "?" : String(Math.round(value * 100) / 100);

const point = (value: Point | undefined): string =>
    value ? `(${round(value.x)},${round(value.y)})` : "(?)";

/** 一行几何摘要：不同类型取最能说明差异的几个字段 */
export function describeGeometry(element: CADElement): string {
    switch (element.type) {
        case "LINE":
            return `${point(element.start)}→${point(element.end)}`;
        case "CIRCLE":
            return `c${point(element.center)} r=${round(element.radius)}`;
        case "ARC":
            return `c${point(element.center)} r=${round(element.radius)} ${round(
                element.startAngle,
            )}°→${round(element.endAngle)}°`;
        case "RECTANGLE":
            return `${point(element.start)} ${round(element.width)}×${round(element.height)}`;
        case "TEXT":
            return `"${(element.text ?? "").slice(0, 24)}" @${point(element.start)}`;
        case "LWPOLYLINE":
            return `${(element.points ?? []).length} pts${element.closed ? " closed" : ""}`;
        case "DIMENSION":
            return `${point(element.start)}→${point(element.end)}`;
        default:
            return element.type;
    }
}

const LAYER_ORDER = (a: LayerDelta, b: LayerDelta): number => {
    const weight = (item: LayerDelta) => item.added + item.modified + item.removed;
    return weight(b) - weight(a) || a.layer.localeCompare(b.layer);
};

/**
 * 把差分展开成明细。
 * 顺序刻意固定为「新增 → 修改 → 删除」：先看多了什么，再看改了什么，最后看没了什么。
 */
export function explainChanges(
    diff: VersionDiff,
    options: ExplainOptions = {},
): ChangeExplanation {
    const maxEntries = Math.max(1, options.maxEntries ?? 60);
    const entries: ChangeEntry[] = [];
    const layers = new Map<string, LayerDelta>();

    const record = (layer: string, kind: ChangeKind) => {
        const current = layers.get(layer) ?? { layer, added: 0, modified: 0, removed: 0 };
        if (kind === "added") current.added += 1;
        else if (kind === "modified") current.modified += 1;
        else current.removed += 1;
        layers.set(layer, current);
    };

    const push = (entry: ChangeEntry) => {
        record(entry.layer, entry.kind);
        entries.push(entry);
    };

    for (const element of diff.added) {
        push({
            kind: "added",
            id: element.id,
            type: element.type,
            layer: element.layer || "0",
            summary: describeGeometry(element),
        });
    }
    for (const change of diff.modified) {
        const preview = describeGeometry(change.after);
        const beforeSummary = describeGeometry(change.before);
        push({
            kind: "modified",
            id: change.after.id,
            type: change.after.type,
            layer: change.after.layer || "0",
            summary: preview,
            detail:
                beforeSummary === preview ? "属性变化" : `${beforeSummary} → ${preview}`,
        });
    }
    for (const element of diff.removed) {
        push({
            kind: "removed",
            id: element.id,
            type: element.type,
            layer: element.layer || "0",
            summary: describeGeometry(element),
        });
    }

    const counts: Record<ChangeKind, number> = {
        added: diff.added.length,
        modified: diff.modified.length,
        removed: diff.removed.length,
    };
    const truncated = entries.length > maxEntries;
    const shown = truncated ? entries.slice(0, maxEntries) : entries;
    const byLayer = [...layers.values()].sort(LAYER_ORDER);

    const sign: Record<ChangeKind, string> = { added: "+", modified: "~", removed: "−" };
    const lines = [
        `AI 变更说明：新增 ${counts.added} · 修改 ${counts.modified} · 删除 ${counts.removed}`,
    ];
    if (options.operations && options.operations.length > 0) {
        lines.push(`操作：${[...new Set(options.operations)].join("、")}`);
    }
    if (byLayer.length > 0) {
        lines.push(
            `图层：${byLayer
                .map(
                    (item) =>
                        `${item.layer}(+${item.added}/~${item.modified}/−${item.removed})`,
                )
                .join("、")}`,
        );
    }
    for (const entry of shown) {
        const detail = entry.detail ? ` ${entry.detail}` : ` ${entry.summary}`;
        lines.push(`${sign[entry.kind]} ${entry.type} [${entry.layer}]${detail}`);
    }
    if (truncated) {
        lines.push(`…其余 ${entries.length - shown.length} 条未列出`);
    }

    return {
        entries: shown,
        byLayer,
        counts,
        truncated,
        text: lines.join("\n"),
    };
}
