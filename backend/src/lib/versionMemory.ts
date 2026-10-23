/**
 * versionMemory.ts — 版本变更摘要与 AI 版本记忆
 *
 * 版本快照保存完整图元列表；这里比较 id 与轻量几何签名，生成可展示、可注入提示词的
 * 摘要。签名只取形状相关字段，不做深比较，避免大图纸上的快照比对开销失控。
 */

export interface VersionChangeSummary {
  added: number;
  removed: number;
  modified: number;
  addedByType: Record<string, number>;
  removedByType: Record<string, number>;
  modifiedByType: Record<string, number>;
  layersTouched: string[];
}

interface SnapshotElement {
  id: string;
  type: string;
  layer: string;
  signature: string;
}

export interface VersionMemoryRow {
  versionNumber: number;
  elementCount: number;
  commitMessage?: string | null;
  changeSummary?: unknown;
  createdAt?: Date | string | null;
}

const MAX_LAYERS = 8;
const MAX_MEMORY_VERSIONS = 5;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: unknown): string => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return String(Math.round(n * 1000) / 1000);
};

const point = (value: unknown): string => {
  if (!isPlainObject(value)) return "";
  return `${num(value.x)},${num(value.y)}`;
};

/** 轻量几何签名：只覆盖形状相关字段，用于识别"同一图元被改过" */
const geometrySignature = (element: Record<string, unknown>): string => {
  switch (element.type) {
    case "LINE":
      return `LINE:${point(element.start)}->${point(element.end)}`;
    case "CIRCLE":
      return `CIRCLE:${point(element.center)}:${num(element.radius)}`;
    case "ARC":
      return `ARC:${point(element.center)}:${num(element.radius)}:${num(element.startAngle)}:${num(
        element.endAngle,
      )}`;
    case "RECTANGLE":
      return `RECT:${point(element.start)}:${num(element.width)}:${num(element.height)}`;
    case "TEXT":
      return `TEXT:${point(element.start)}:${num(element.fontSize)}:${String(element.text ?? "")}`;
    case "LWPOLYLINE": {
      const points = Array.isArray(element.points) ? element.points : [];
      const head = points.slice(0, 32).map(point).join(" ");
      return `LWP:${element.closed ? 1 : 0}:${points.length}:${head}`;
    }
    default:
      return `${String(element.type ?? "UNKNOWN")}`;
  }
};

const elementsOf = (snapshot: unknown): SnapshotElement[] => {
  const raw = Array.isArray(snapshot)
    ? snapshot
    : isPlainObject(snapshot) && Array.isArray(snapshot.elements)
      ? snapshot.elements
      : [];
  const elements: SnapshotElement[] = [];
  for (const item of raw) {
    if (!isPlainObject(item) || typeof item.id !== "string" || !item.id) continue;
    elements.push({
      id: item.id,
      type: typeof item.type === "string" && item.type ? item.type : "UNKNOWN",
      layer: typeof item.layer === "string" && item.layer ? item.layer : "0",
      signature: geometrySignature(item),
    });
  }
  return elements;
};

const countByType = (elements: SnapshotElement[]): Record<string, number> =>
  elements.reduce<Record<string, number>>((acc, element) => {
    acc[element.type] = (acc[element.type] ?? 0) + 1;
    return acc;
  }, {});

/** previous 为空表示首个版本 */
export function summarizeVersionChange(
  previousSnapshot: unknown,
  nextSnapshot: unknown,
): VersionChangeSummary {
  const previous = elementsOf(previousSnapshot);
  const next = elementsOf(nextSnapshot);
  const previousById = new Map(previous.map((element) => [element.id, element]));
  const nextIds = new Set(next.map((element) => element.id));
  const added = next.filter((element) => !previousById.has(element.id));
  const removed = previous.filter((element) => !nextIds.has(element.id));
  const modified = next.filter((element) => {
    const before = previousById.get(element.id);
    return before !== undefined && before.signature !== element.signature;
  });
  const layers = new Set<string>();
  for (const element of [...added, ...removed, ...modified]) {
    if (layers.size >= MAX_LAYERS) break;
    layers.add(element.layer);
  }
  return {
    added: added.length,
    removed: removed.length,
    modified: modified.length,
    addedByType: countByType(added),
    removedByType: countByType(removed),
    modifiedByType: countByType(modified),
    layersTouched: [...layers],
  };
}

const typeSummary = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => `${type}×${count}`)
    .join("、");

const asSummary = (value: unknown): VersionChangeSummary | null => {
  if (!isPlainObject(value)) return null;
  const added = typeof value.added === "number" && value.added >= 0 ? value.added : null;
  const removed = typeof value.removed === "number" && value.removed >= 0 ? value.removed : null;
  if (added === null || removed === null) return null;
  const counts = (raw: unknown): Record<string, number> =>
    isPlainObject(raw)
      ? Object.fromEntries(
          Object.entries(raw).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === "number" && entry[1] > 0,
          ),
        )
      : {};
  return {
    added,
    removed,
    // 旧版本摘要没有 modified 字段，按 0 处理
    modified: typeof value.modified === "number" && value.modified >= 0 ? value.modified : 0,
    addedByType: counts(value.addedByType),
    removedByType: counts(value.removedByType),
    modifiedByType: counts(value.modifiedByType),
    layersTouched: Array.isArray(value.layersTouched)
      ? value.layersTouched.filter((layer): layer is string => typeof layer === "string").slice(0, 8)
      : [],
  };
};

/** 供系统提示词使用的版本记忆；没有版本时返回 null */
export function formatVersionMemory(versions: readonly VersionMemoryRow[]): string | null {
  if (versions.length === 0) return null;
  const lines = ["# 版本记忆", "最近保存的版本与变更（最新在前），可作为延续设计的依据。"];
  for (const version of versions.slice(0, MAX_MEMORY_VERSIONS)) {
    const date =
      version.createdAt instanceof Date
        ? version.createdAt.toISOString().slice(0, 10)
        : typeof version.createdAt === "string"
          ? version.createdAt.slice(0, 10)
          : "";
    const parts = [`- v${version.versionNumber}${date ? `（${date}）` : ""}`];
    const summary = asSummary(version.changeSummary);
    if (summary) {
      parts.push(`：+${summary.added} / -${summary.removed} / ~${summary.modified}`);
      const addedTypes = typeSummary(summary.addedByType);
      if (addedTypes) parts.push(`；新增 ${addedTypes}`);
      const removedTypes = typeSummary(summary.removedByType);
      if (removedTypes) parts.push(`；删除 ${removedTypes}`);
      const modifiedTypes = typeSummary(summary.modifiedByType);
      if (modifiedTypes) parts.push(`；修改 ${modifiedTypes}`);
      if (summary.layersTouched.length > 0) {
        parts.push(`；涉及图层 ${summary.layersTouched.join(", ")}`);
      }
    } else {
      parts.push(`：${version.elementCount} 个图元`);
    }
    if (version.commitMessage) parts.push(`；备注：${version.commitMessage.slice(0, 80)}`);
    lines.push(parts.join(""));
  }
  return lines.join("\n");
}
