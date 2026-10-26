/**
 * projectDocument.ts — 统一文档模型
 *
 * 图纸的唯一事实源：图元、图层、绘图设置、块引用与设计约定保存在同一份
 * 版本化文档里。日常保存、版本快照、离线同步与 AI 工具都基于这份结构，
 * 不再分别拼装图元数组。
 *
 * 所有外部输入（IndexedDB 旧存档、服务端响应、离线队列载荷）都必须经过
 * normalizeProjectDocument 收敛：缺失字段补默认值，非法条目被拒绝或降级，
 * 保证任何来源的文档都能被加载链路安全消费。
 */

import type {
    BlockReference,
    CADElement,
    DesignConventions,
    DrawingSettings,
    Layer,
    Point,
    ProjectFile,
    SnapType,
    UnitType,
} from "../types";
import { SnapType as SnapTypeEnum, DEFAULT_SNAP_TYPES } from "../types";
import { collectLayers, type LayerSnapshotInput } from "./versionSnapshot";

/** 文档结构版本：结构不兼容变更时递增，加载链路按版本迁移 */
export const PROJECT_DOCUMENT_VERSION = 1;

export interface ProjectDocument {
    schemaVersion: number;
    id: string;
    name: string;
    description?: string;
    lastModified: string;
    elements: CADElement[];
    layers: Layer[];
    drawingSettings: DrawingSettings;
    blockReferences?: BlockReference[];
    designConventions?: DesignConventions | null;
    thumbnail?: string;
    userId?: string;
    /** 离线创建后服务端 id 回填时保持不变，用于识别"同一张图纸" */
    chatKey?: string;
}

export const DEFAULT_LAYER_COLOR = "#e6edf3";
export const DEFAULT_LAYER_ORDER = ["0", "AI_GENERATED", "DIM"];
export const DEFAULT_LAYER_COLORS: Record<string, string> = {
    "0": "#e6edf3",
    AI_GENERATED: "#137fec",
    DIM: "#4ade80",
};

const UNIT_TYPES: UnitType[] = ["mm", "cm", "m", "in", "ft"];
const LINE_TYPES: Layer["lineType"][] = [
    "CONTINUOUS",
    "DASHED",
    "DOTTED",
    "DASHDOT",
];
const SNAP_TYPE_VALUES = new Set<string>(Object.values(SnapTypeEnum));

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** 服务端 Decimal 字段序列化为字符串，这里统一按"数值或可解析字符串"处理 */
const toFiniteNumber = (value: unknown, fallback: number): number => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

const toUnit = (value: unknown, fallback: UnitType): UnitType =>
    typeof value === "string" && (UNIT_TYPES as string[]).includes(value)
        ? (value as UnitType)
        : fallback;

/** 坐标点：x/y 必须是有限数值，否则视为缺失 */
const toPoint = (value: unknown): Point | null => {
    if (!isRecord(value)) return null;
    const x = toFiniteNumber(value.x, Number.NaN);
    const y = toFiniteNumber(value.y, Number.NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

export function createDefaultDrawingSettings(): DrawingSettings {
    // 与画布初始状态保持一致，避免新建图纸后设置被悄悄改写
    return {
        units: "mm",
        gridSpacing: 50,
        snapDistance: 10,
        dimScale: 1.0,
        dimPrecision: 2,
    };
}

export function createDefaultLayers(): Layer[] {
    return DEFAULT_LAYER_ORDER.map((name) => ({
        id: `layer-${name}`,
        name,
        color: DEFAULT_LAYER_COLORS[name] ?? DEFAULT_LAYER_COLOR,
        isVisible: true,
        isLocked: false,
        lineType: "CONTINUOUS" as const,
    }));
}

export function normalizeDrawingSettings(raw: unknown): DrawingSettings {
    const base = createDefaultDrawingSettings();
    if (!isRecord(raw)) return base;

    const settings: DrawingSettings = {
        units: toUnit(raw.units, base.units),
        gridSpacing: toFiniteNumber(raw.gridSpacing, base.gridSpacing),
        snapDistance: toFiniteNumber(raw.snapDistance, base.snapDistance),
        dimScale: toFiniteNumber(raw.dimScale, base.dimScale),
        dimPrecision: Math.min(
            8,
            Math.max(0, Math.round(toFiniteNumber(raw.dimPrecision, base.dimPrecision))),
        ),
    };

    if (Array.isArray(raw.enabledSnapTypes)) {
        const snapTypes = raw.enabledSnapTypes.filter(
            (value): value is SnapType =>
                typeof value === "string" && SNAP_TYPE_VALUES.has(value),
        );
        // 空数组或全非法时回落到默认捕捉集，避免把所有捕捉关掉
        settings.enabledSnapTypes =
            snapTypes.length > 0 ? snapTypes : [...DEFAULT_SNAP_TYPES];
    } else {
        // 缺省同样显式落地：setDrawingSettings 是合并语义，不写就会继承上一张图的设置
        settings.enabledSnapTypes = [...DEFAULT_SNAP_TYPES];
    }

    return settings;
}

export function normalizeLayer(raw: unknown): Layer | null {
    if (!isRecord(raw)) return null;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return null;

    const layer: Layer = {
        id: typeof raw.id === "string" && raw.id ? raw.id : `layer-${name}`,
        name,
        color:
            typeof raw.color === "string" && raw.color
                ? raw.color
                : DEFAULT_LAYER_COLOR,
        isVisible: raw.isVisible !== false,
        isLocked: raw.isLocked === true,
        lineType: LINE_TYPES.includes(raw.lineType as Layer["lineType"])
            ? (raw.lineType as Layer["lineType"])
            : "CONTINUOUS",
    };

    if (typeof raw.lineWeight === "number" && Number.isFinite(raw.lineWeight)) {
        layer.lineWeight = raw.lineWeight;
    }
    return layer;
}

export function normalizeLayers(raw: unknown): Layer[] {
    if (!Array.isArray(raw)) return createDefaultLayers();

    const layers: Layer[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        const layer = normalizeLayer(entry);
        if (!layer || seen.has(layer.name)) continue;
        seen.add(layer.name);
        layers.push(layer);
    }
    // 图纸至少要有可用图层：空数组按默认图层集处理
    return layers.length > 0 ? layers : createDefaultLayers();
}

/**
 * 图元规范化：保留原始几何字段，仅拒绝缺 id/type 或 id 重复的条目。
 * 重复 id 会让增量同步的 upsert 目标不明确，必须在入口处拦下。
 */
export function normalizeElements(raw: unknown): CADElement[] {
    if (!Array.isArray(raw)) return [];

    const elements: CADElement[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        if (!isRecord(entry)) continue;
        const id = typeof entry.id === "string" ? entry.id : "";
        const type = typeof entry.type === "string" ? entry.type : "";
        if (!id || !type || seen.has(id)) continue;
        seen.add(id);
        elements.push(entry as unknown as CADElement);
    }
    return elements;
}

export function normalizeBlockReferences(raw: unknown): BlockReference[] {
    if (!Array.isArray(raw)) return [];

    const references: BlockReference[] = [];
    for (const entry of raw) {
        if (!isRecord(entry)) continue;
        const id = typeof entry.id === "string" ? entry.id : "";
        const blockDefinitionId =
            typeof entry.blockDefinitionId === "string"
                ? entry.blockDefinitionId
                : "";
        const insertionPoint = toPoint(entry.insertionPoint);
        if (!id || !blockDefinitionId || !insertionPoint) continue;

        references.push({
            id,
            blockDefinitionId,
            layer: typeof entry.layer === "string" ? entry.layer : "0",
            insertionPoint,
            rotation: toFiniteNumber(entry.rotation, 0),
            scaleX: toFiniteNumber(entry.scaleX, 1),
            scaleY: toFiniteNumber(entry.scaleY, 1),
            ...(isRecord(entry.properties)
                ? { properties: entry.properties as Record<string, unknown> }
                : {}),
            ...(typeof entry.color === "string" ? { color: entry.color } : {}),
        });
    }
    return references;
}

/** 由画布图层状态生成文档图层：与版本快照共用汇总规则 */
export function layersFromLayerSnapshot(
    elements: CADElement[],
    layerState: LayerSnapshotInput,
): Layer[] {
    return collectLayers(elements, layerState);
}

/** 由文档图层还原画布图层状态，供加载与版本恢复使用 */
export function layerSnapshotFromLayers(layers: Layer[]): LayerSnapshotInput {
    return {
        layerOrder: layers.map((layer) => layer.name),
        layerColors: Object.fromEntries(
            layers.map((layer) => [layer.name, layer.color]),
        ),
        hiddenLayers: layers.filter((layer) => !layer.isVisible).map((l) => l.name),
        lockedLayers: layers.filter((layer) => layer.isLocked).map((l) => l.name),
    };
}

/** ProjectFile（列表/同步载体）→ 文档；图层与设置缺失时补默认值 */
export function documentFromProjectFile(file: ProjectFile): ProjectDocument {
    return {
        schemaVersion: PROJECT_DOCUMENT_VERSION,
        id: file.id,
        name: file.name,
        description: file.description,
        lastModified: file.lastModified || new Date().toISOString(),
        elements: normalizeElements(file.elements),
        layers: normalizeLayers(file.layers),
        drawingSettings: normalizeDrawingSettings(file.drawingSettings),
        blockReferences: normalizeBlockReferences(file.blockReferences),
        designConventions: file.designConventions ?? null,
        thumbnail: file.thumbnail,
        userId: file.userId,
        chatKey: file.chatKey,
    };
}

/** 文档 → ProjectFile：供文件列表、撤销基线与同步队列复用同一载体 */
export function projectFileFromDocument(doc: ProjectDocument): ProjectFile {
    return {
        id: doc.id,
        name: doc.name,
        description: doc.description,
        lastModified: doc.lastModified,
        elements: doc.elements,
        layers: doc.layers,
        drawingSettings: doc.drawingSettings,
        blockReferences: doc.blockReferences,
        designConventions: doc.designConventions ?? null,
        thumbnail: doc.thumbnail,
        userId: doc.userId,
        chatKey: doc.chatKey,
        elementCount: doc.elements.length,
    };
}

/**
 * 任意来源的原始数据 → 可信文档。
 * 旧存档没有 schemaVersion / layers / drawingSettings 时按默认值迁移；
 * 无法识别 id 的记录返回 null，由调用方决定忽略或报错。
 */
export function normalizeProjectDocument(raw: unknown): ProjectDocument | null {
    if (!isRecord(raw)) return null;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!id) return null;

    return {
        schemaVersion: Math.round(toFiniteNumber(raw.schemaVersion, PROJECT_DOCUMENT_VERSION)),
        id,
        name:
            typeof raw.name === "string" && raw.name
                ? raw.name
                : "Untitled Drawing",
        description:
            typeof raw.description === "string" ? raw.description : undefined,
        lastModified:
            typeof raw.lastModified === "string"
                ? raw.lastModified
                : new Date().toISOString(),
        elements: normalizeElements(raw.elements),
        layers: normalizeLayers(raw.layers),
        drawingSettings: normalizeDrawingSettings(raw.drawingSettings),
        blockReferences: normalizeBlockReferences(raw.blockReferences),
        // 设计约定是注入 AI 提示词的元数据：结构不完整时由消费方兜底，
        // 这里保留原值不做强制改写，避免把用户填过的备注清空
        designConventions: isRecord(raw.designConventions)
            ? (raw.designConventions as unknown as DesignConventions)
            : null,
        thumbnail: typeof raw.thumbnail === "string" ? raw.thumbnail : undefined,
        userId: typeof raw.userId === "string" ? raw.userId : undefined,
        chatKey: typeof raw.chatKey === "string" ? raw.chatKey : undefined,
    };
}
