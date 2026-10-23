/**
 * designConventions.ts — 项目设计约定的归一化与提示词摘要
 *
 * 约定由用户在前端编辑，属于外部输入：这里做边界校验后再写入 Project.designConventions，
 * 并在组装 AI 提示词时压缩为固定结构，避免把任意 JSON 直接塞给模型。
 */

export interface DesignLayerRule {
  name: string;
  purpose?: string;
}

export interface DesignConventions {
  standard: string;
  units: string;
  textHeight: number;
  dimensionPrecision: number;
  layerRules: DesignLayerRule[];
  notes: string[];
}

export const DESIGN_UNITS = ["mm", "cm", "m", "in", "ft"] as const;
export const DEFAULT_CONVENTIONS: DesignConventions = {
  standard: "",
  units: "mm",
  textHeight: 3.5,
  dimensionPrecision: 2,
  layerRules: [],
  notes: [],
};

const MAX_STANDARD = 120;
const MAX_LAYER_RULES = 24;
const MAX_LAYER_NAME = 64;
const MAX_LAYER_PURPOSE = 120;
const MAX_NOTES = 16;
const MAX_NOTE = 200;
const MIN_TEXT_HEIGHT = 0.1;
const MAX_TEXT_HEIGHT = 10_000;

export type NormalizeConventionsResult =
  | { ok: true; value: DesignConventions | null }
  | { ok: false; message: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 空约定折叠为 null，避免数据库里出现只有默认值的对象 */
const hasContent = (value: DesignConventions): boolean =>
  Boolean(value.standard) ||
  value.units !== DEFAULT_CONVENTIONS.units ||
  value.textHeight !== DEFAULT_CONVENTIONS.textHeight ||
  value.dimensionPrecision !== DEFAULT_CONVENTIONS.dimensionPrecision ||
  value.layerRules.length > 0 ||
  value.notes.length > 0;

export function normalizeDesignConventions(raw: unknown): NormalizeConventionsResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isPlainObject(raw)) return { ok: false, message: "designConventions must be an object" };

  const standard =
    raw.standard === undefined
      ? ""
      : typeof raw.standard === "string"
        ? raw.standard.trim()
        : null;
  if (standard === null || standard.length > MAX_STANDARD) {
    return { ok: false, message: `standard must be at most ${MAX_STANDARD} characters` };
  }

  const units =
    raw.units === undefined
      ? DEFAULT_CONVENTIONS.units
      : typeof raw.units === "string" && (DESIGN_UNITS as readonly string[]).includes(raw.units)
        ? raw.units
        : null;
  if (units === null) return { ok: false, message: "units is not supported" };

  const textHeight = raw.textHeight === undefined ? DEFAULT_CONVENTIONS.textHeight : raw.textHeight;
  if (
    typeof textHeight !== "number" ||
    !Number.isFinite(textHeight) ||
    textHeight < MIN_TEXT_HEIGHT ||
    textHeight > MAX_TEXT_HEIGHT
  ) {
    return {
      ok: false,
      message: `textHeight must be between ${MIN_TEXT_HEIGHT} and ${MAX_TEXT_HEIGHT}`,
    };
  }

  const dimensionPrecision =
    raw.dimensionPrecision === undefined
      ? DEFAULT_CONVENTIONS.dimensionPrecision
      : raw.dimensionPrecision;
  if (
    typeof dimensionPrecision !== "number" ||
    !Number.isInteger(dimensionPrecision) ||
    dimensionPrecision < 0 ||
    dimensionPrecision > 8
  ) {
    return { ok: false, message: "dimensionPrecision must be an integer between 0 and 8" };
  }

  const rawRules = raw.layerRules ?? [];
  if (!Array.isArray(rawRules) || rawRules.length > MAX_LAYER_RULES) {
    return { ok: false, message: `layerRules must be an array of at most ${MAX_LAYER_RULES}` };
  }
  const layerRules: DesignLayerRule[] = [];
  const seenLayers = new Set<string>();
  for (const item of rawRules) {
    if (!isPlainObject(item)) return { ok: false, message: "layerRules item must be an object" };
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || name.length > MAX_LAYER_NAME) {
      return { ok: false, message: `layer name must be 1-${MAX_LAYER_NAME} characters` };
    }
    if (seenLayers.has(name)) {
      return { ok: false, message: `duplicate layer rule: ${name}` };
    }
    const purpose =
      item.purpose === undefined
        ? ""
        : typeof item.purpose === "string"
          ? item.purpose.trim()
          : null;
    if (purpose === null || purpose.length > MAX_LAYER_PURPOSE) {
      return { ok: false, message: "layer purpose is too long" };
    }
    seenLayers.add(name);
    layerRules.push(purpose ? { name, purpose } : { name });
  }

  const rawNotes = raw.notes ?? [];
  if (!Array.isArray(rawNotes) || rawNotes.length > MAX_NOTES) {
    return { ok: false, message: `notes must be an array of at most ${MAX_NOTES}` };
  }
  const notes: string[] = [];
  for (const item of rawNotes) {
    if (typeof item !== "string") return { ok: false, message: "notes item must be a string" };
    const note = item.trim();
    if (!note || note.length > MAX_NOTE) {
      return { ok: false, message: `note must be 1-${MAX_NOTE} characters` };
    }
    notes.push(note);
  }

  const value: DesignConventions = {
    standard,
    units,
    textHeight: Math.round(textHeight * 100) / 100,
    dimensionPrecision,
    layerRules,
    notes,
  };
  return { ok: true, value: hasContent(value) ? value : null };
}

/** 供系统提示词使用的紧凑约定摘要；null 表示没有可注入内容 */
export function formatDesignConventions(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const normalized = normalizeDesignConventions(value);
  if (!normalized.ok || !normalized.value) return null;
  const conventions = normalized.value;
  const lines = ["# 项目设计约定", "本轮设计必须遵守以下项目约定；与用户明确要求冲突时以用户要求为准。"];
  if (conventions.standard) lines.push(`- 制图标准：${conventions.standard}`);
  lines.push(
    `- 单位：${conventions.units}；建议字高：${conventions.textHeight}；尺寸精度：${conventions.dimensionPrecision} 位`,
  );
  if (conventions.layerRules.length > 0) {
    lines.push(
      `- 图层：${conventions.layerRules
        .map((rule) => (rule.purpose ? `${rule.name}（${rule.purpose}）` : rule.name))
        .join("；")}`,
    );
  }
  if (conventions.notes.length > 0) {
    lines.push(`- 备注：${conventions.notes.join("；")}`);
  }
  return lines.join("\n");
}
