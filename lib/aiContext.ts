/**
 * aiContext.ts — 发给 LLM 的设计上下文包
 *
 * 分三档：brief 给统计、选择 id 与一行图纸事实（标注 / 块 / 图层状态计数），
 * standard 增加图层可见性、块、标注覆盖与最多 10 个选中图元的几何，
 * deep 再扩展到 30 个选中图元与全部图层。
 * 不倾倒完整图元 JSON，既控制 token 又让模型知道"当前图纸是什么状态"。
 */

import type { CADElement, Point } from "../types";
import { getElementBoundingBox } from "./geometry";

export type ContextTier = "brief" | "standard" | "deep";

export interface LayerContextInfo {
    name: string;
    visible?: boolean;
    locked?: boolean;
}

export interface DesignContextMeta {
    projectName?: string;
    units?: string;
    layers?: readonly LayerContextInfo[];
    blockCount?: number;
    revision?: number;
    hiddenCount?: number;
}

export interface CanvasContextOptions {
    tier?: ContextTier;
    meta?: DesignContextMeta;
}

interface LayerState {
    hidden: number;
    locked: number;
}

export interface CanvasContextSummary {
    text: string;
    tier: ContextTier;
    elementCount: number;
    selectedCount: number;
    chars: number;
    estimatedTokens: number;
}

const MAX_DETAILS: Record<ContextTier, number> = { brief: 0, standard: 10, deep: 30 };
const MAX_LAYERS: Record<ContextTier, number> = { brief: 0, standard: 8, deep: 32 };
const MAX_SELECTION_IDS = 10;
const MAX_TEXT_LENGTH = 40;

const DEEP_KEYWORDS = [
    "检查",
    "审查",
    "评审",
    "测量",
    "尺寸",
    "标注",
    "布局",
    "规划",
    "整体",
    "全部",
    "分析",
    "核对",
    "规范",
    "优化",
    "review",
    "audit",
    "measure",
    "layout",
];

/**
 * 按本轮问题与图纸规模选择档位：审查/测量/布局类问题需要完整上下文，
 * 小图上的短指令用 brief 节省 token，其余保持 standard。
 */
export function chooseContextTier(input: {
    message: string;
    elementCount: number;
    selectedCount: number;
}): ContextTier {
    const message = input.message.toLowerCase();
    if (input.elementCount > 150) return "deep";
    if (DEEP_KEYWORDS.some((keyword) => message.includes(keyword))) return "deep";
    if (input.elementCount <= 30 && input.selectedCount <= 3 && input.message.length <= 40) {
        return "brief";
    }
    return "standard";
}

const round = (value: number): number => Number(value.toFixed(2));

const point = (value: Point | undefined): string =>
    value ? `(${round(value.x)},${round(value.y)})` : "(?)";

const describeElement = (element: CADElement): string => {
    const id = element.id;
    switch (element.type) {
        case "LINE":
            return `${id} LINE ${point(element.start)}→${point(element.end)}`;
        case "RECTANGLE":
            return `${id} RECTANGLE ${point(element.start)} ${round(element.width ?? 0)}×${round(element.height ?? 0)}`;
        case "CIRCLE":
            return `${id} CIRCLE center${point(element.center)} r=${round(element.radius ?? 0)}`;
        case "TEXT":
            return `${id} TEXT ${point(element.start)} "${(element.text ?? "").slice(0, MAX_TEXT_LENGTH)}"`;
        case "LWPOLYLINE": {
            const points = element.points ?? [];
            const first = points[0];
            const last = points[points.length - 1];
            return `${id} LWPOLYLINE ${points.length}pts ${point(first)}→${point(last)}${element.closed ? " closed" : ""}`;
        }
        case "ARC":
            return `${id} ARC center${point(element.center)} r=${round(element.radius ?? 0)}`;
        case "DIMENSION":
            return `${id} DIMENSION ${point(element.start)}→${point(element.end)}`;
        default:
            return `${id} ${element.type}`;
    }
};

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

const countBy = (
    elements: CADElement[],
    key: (element: CADElement) => string,
): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const element of elements) {
        const value = key(element);
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
};

/** 图层出现顺序：先按项目定义的顺序，再补上只在图元里出现的层 */
function orderedLayers(layerCounts: Map<string, number>, meta?: DesignContextMeta): string[] {
    const order: string[] = [];
    for (const layer of meta?.layers ?? []) {
        if (!order.includes(layer.name)) order.push(layer.name);
    }
    for (const name of [...layerCounts.keys()].sort()) {
        if (!order.includes(name)) order.push(name);
    }
    return order;
}

/** 一组图层里隐藏 / 锁定的个数：brief 档只给计数，不给明细 */
function layerState(names: readonly string[], meta?: DesignContextMeta): LayerState {
    let hidden = 0;
    let locked = 0;
    for (const name of names) {
        const info = meta?.layers?.find((layer) => layer.name === name);
        if (info?.visible === false) hidden += 1;
        if (info?.locked) locked += 1;
    }
    return { hidden, locked };
}

function describeLayers(
    layerCounts: Map<string, number>,
    tier: ContextTier,
    meta: DesignContextMeta | undefined,
    order: readonly string[],
): string {
    const limit = MAX_LAYERS[tier];
    const shown = limit > 0 ? order.slice(0, limit) : [];
    const entries = shown.map((name) => {
        const flags: string[] = [];
        const info = meta?.layers?.find((layer) => layer.name === name);
        if (info?.visible === false) flags.push("hidden");
        if (info?.locked) flags.push("locked");
        const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
        return `${name} ×${layerCounts.get(name) ?? 0}${suffix}`;
    });

    if (entries.length === 0) {
        if (order.length === 0) return "Layers: none";
        return `Layers: ${order.slice(0, 6).join(", ")}${order.length > 6 ? " …" : ""}`;
    }
    if (order.length > entries.length) {
        // 被截断的层也要说清是隐藏还是锁定，否则模型会以为剩下的都能画
        const rest = order.slice(entries.length);
        const state = layerState(rest, meta);
        const notes = [
            state.hidden > 0 ? `${state.hidden} 个隐藏` : null,
            state.locked > 0 ? `${state.locked} 个锁定` : null,
        ].filter(Boolean);
        entries.push(
            `…另有 ${rest.length} 个图层${notes.length > 0 ? `（${notes.join("、")}）` : ""}`,
        );
    }
    return `Layers: ${entries.join(", ")}`;
}

function describeSelection(selected: CADElement[], tier: ContextTier): string {
    if (selected.length === 0) {
        return "Selection: none (transform tools need explicit ids when nothing is selected)";
    }
    if (tier === "brief") {
        const ids = selected.slice(0, MAX_SELECTION_IDS).map((element) => element.id);
        return `Selection: ${selected.length} — ids ${ids.join(", ")}${
            selected.length > MAX_SELECTION_IDS
                ? ` …+${selected.length - MAX_SELECTION_IDS} more`
                : ""
        }`;
    }
    const details = selected.slice(0, MAX_DETAILS[tier]).map(describeElement);
    return `Selection: ${selected.length} — ${details.join("; ")}${
        selected.length > details.length ? `; …+${selected.length - details.length} more` : ""
    }`;
}

export function summarizeCanvasContext(
    elements: CADElement[],
    selectedIds: ReadonlySet<string> = new Set(),
    options: CanvasContextOptions = {},
): CanvasContextSummary {
    const tier = options.tier ?? "standard";
    const meta = options.meta;
    if (elements.length === 0) {
        const text = "Canvas summary: empty.";
        return {
            text,
            tier,
            elementCount: 0,
            selectedCount: 0,
            chars: text.length,
            estimatedTokens: estimateTokens(text),
        };
    }

    const typeCounts = countBy(elements, (element) => element.type);
    const layerCounts = countBy(elements, (element) => element.layer || "0");
    const types = [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} ×${count}`)
        .join(", ");

    const bounds = elements.reduce(
        (acc, element) => {
            const box = getElementBoundingBox(element);
            return {
                minX: Math.min(acc.minX, box.minX),
                minY: Math.min(acc.minY, box.minY),
                maxX: Math.max(acc.maxX, box.maxX),
                maxY: Math.max(acc.maxY, box.maxY),
            };
        },
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const boundsText = Number.isFinite(bounds.minX)
        ? `(${round(bounds.minX)},${round(bounds.minY)})→(${round(bounds.maxX)},${round(bounds.maxY)})`
        : "unknown";

    const selected = elements.filter((element) => selectedIds.has(element.id));
    const lines = [`Canvas summary: ${elements.length} elements (${types})`];

    const project = [meta?.projectName, meta?.units ? `units ${meta.units}` : null]
        .filter(Boolean)
        .join(" · ");
    if (project) lines.push(`Project: ${project}`);

    const order = orderedLayers(layerCounts, meta);
    lines.push(describeLayers(layerCounts, tier, meta, order));

    const dimensionCount = typeCounts.get("DIMENSION") ?? 0;
    const drawable = elements.filter((element) =>
        ["LINE", "CIRCLE", "RECTANGLE", "LWPOLYLINE", "ARC"].includes(element.type),
    ).length;
    const blockCount = meta?.blockCount ?? 0;

    if (tier === "brief") {
        // 短指令也要知道图纸的既有事实，否则「再加个标注」会重复画已有的东西
        const state = layerState(order, meta);
        lines.push(
            `Facts: 有标注：${dimensionCount > 0 ? "是" : "否"}` +
                ` · 块引用：${blockCount}` +
                ` · 隐藏图层：${state.hidden} · 锁定图层：${state.locked}`,
        );
    } else {
        if (blockCount > 0) lines.push(`Blocks: ${blockCount} references`);
        lines.push(
            dimensionCount > 0
                ? `Dimensions: ${dimensionCount} annotations`
                : `Dimensions: none for ${drawable} drawable elements`,
        );
        if ((meta?.hiddenCount ?? 0) > 0) {
            lines.push(`Visibility: ${meta?.hiddenCount} elements hidden by isolation`);
        }
        if ((meta?.revision ?? 0) > 0) lines.push(`Revision: ${meta?.revision}`);
    }

    lines.push(`Bounds: ${boundsText}`);
    lines.push(describeSelection(selected, tier));

    const text = lines.join("\n");
    return {
        text,
        tier,
        elementCount: elements.length,
        selectedCount: selected.length,
        chars: text.length,
        estimatedTokens: estimateTokens(text),
    };
}
