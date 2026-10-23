/**
 * toolValidator.ts — 模型工具调用的服务端参数校验
 *
 * 模型输出属于不可信输入：非法坐标会让前端产生 NaN 图元，超大数组会卡住画布。
 * 这里在把 toolCall 下发给前端之前完成白名单、范围与容量校验，并剥离 schema
 * 之外的字段。校验失败不中断整轮，只把该调用记为 rejected 并回传给模型自纠错。
 */

import {
  CAD_TOOL_DEFINITIONS,
  PLAN_TOOL_DEFINITION,
  PROPOSE_VARIANTS_TOOL_DEFINITION,
  ToolCallPayload,
  ToolParameterSchema,
} from "./tools";

export const MAX_COORD_ABS = 1e7;
export const MAX_POINTS = 200;
export const MIN_POINTS = 2;
export const MAX_IDS = 200;
export const MAX_TEXT_CHARS = 500;
export const MAX_TOOL_CALLS_PER_TURN = 20;
export const MAX_FILTER_ITEMS = 16;
export const MAX_FILTER_CHARS = 64;
export const MAX_QUERY_LIMIT = 50;
export const MAX_PLAN_STEPS = 12;
export const MAX_PLAN_LIST_ITEMS = 8;
export const MAX_PLAN_GOAL_CHARS = 300;
export const MAX_PLAN_STEP_ARGS_CHARS = 5000;
export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 3;
export const MAX_VARIANT_NAME_CHARS = 60;
export const MAX_VARIANT_SUMMARY_CHARS = 200;

export type ToolRejectReason =
  | "UNKNOWN_TOOL"
  | "TOOL_NOT_ALLOWED"
  | "MALFORMED"
  | "MISSING_ARGUMENT"
  | "BAD_NUMBER"
  | "BAD_POINT"
  | "BAD_POINTS"
  | "BAD_TEXT"
  | "BAD_IDS"
  | "BAD_FILTER"
  | "BAD_ENUM"
  | "NO_TARGET"
  | "TOO_MANY_CALLS";

export type ToolValidationResult =
  | { ok: true; call: ToolCallPayload }
  | { ok: false; reason: ToolRejectReason; message: string; toolName?: string };

interface NumberRule {
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  integer?: boolean;
  nonZero?: boolean;
}

const COORD: NumberRule = { min: -MAX_COORD_ABS, max: MAX_COORD_ABS };
const POSITIVE: NumberRule = { exclusiveMin: 0, max: MAX_COORD_ABS };
const OFFSET: NumberRule = { min: -MAX_COORD_ABS, max: MAX_COORD_ABS, nonZero: true };
const ANGLE: NumberRule = { min: -3600, max: 3600 };
const SPACING: NumberRule = { min: -MAX_COORD_ABS, max: MAX_COORD_ABS };
const COUNT: NumberRule = { min: 1, max: 50, integer: true };

/** 工具参数范围表；未列出的 number 参数按坐标范围处理 */
const NUMBER_RULES: Record<string, Record<string, NumberRule>> = {
  draw_line: { x1: COORD, y1: COORD, x2: COORD, y2: COORD },
  draw_rectangle: { x: COORD, y: COORD, width: OFFSET, height: OFFSET },
  draw_circle: { cx: COORD, cy: COORD, radius: POSITIVE },
  draw_text: { x: COORD, y: COORD, fontSize: { min: 1, max: 200 } },
  draw_arc: {
    cx: COORD,
    cy: COORD,
    radius: POSITIVE,
    startAngle: ANGLE,
    endAngle: ANGLE,
  },
  draw_dimension: { x1: COORD, y1: COORD, x2: COORD, y2: COORD, textOffset: SPACING },
  move_elements: { dx: COORD, dy: COORD },
  copy_elements: { dx: COORD, dy: COORD },
  rotate_elements: { angle: ANGLE },
  scale_elements: { factor: { min: 0.01, max: 100 } },
  offset_elements: { distance: OFFSET },
  array_elements: {
    rows: COUNT,
    columns: COUNT,
    rowSpacing: SPACING,
    columnSpacing: SPACING,
  },
  query_elements: { limit: { min: 1, max: MAX_QUERY_LIMIT, integer: true } },
  dimension_chain: { textOffset: SPACING },
  list_blocks: { limit: { min: 1, max: MAX_QUERY_LIMIT, integer: true } },
  insert_block: {
    x: COORD,
    y: COORD,
    scale: { min: 0.01, max: 100 },
    rotation: ANGLE,
  },
  insert_block_by_name: {
    x: COORD,
    y: COORD,
    scale: { min: 0.01, max: 100 },
    rotation: ANGLE,
  },
};

const MEASURE_KINDS = new Set(["distance", "length", "area", "bbox"]);
const ALIGN_MODES = new Set(["left", "right", "top", "bottom", "centerX", "centerY"]);
const DISTRIBUTE_AXES = new Set(["horizontal", "vertical"]);

/** 需要作用对象（ids 或当前选择集）的编辑类工具 */
const TARGET_TOOLS = new Set([
  "move_elements",
  "rotate_elements",
  "copy_elements",
  "mirror_elements",
  "scale_elements",
  "offset_elements",
  "array_elements",
  "align_elements",
  "distribute_elements",
  "assign_layer",
  "delete_elements",
  "save_selection_as_block",
  // 视图类工具同样需要目标：没有对象可缩放时直接拒绝
  "zoom_to_selection",
]);

const POINT_TOOLS = new Set(["draw_polyline"]);
const definitions = new Map(
  [...CAD_TOOL_DEFINITIONS, PLAN_TOOL_DEFINITION, PROPOSE_VARIANTS_TOOL_DEFINITION].map(
    (tool) => [tool.name, tool],
  ),
);
const CAD_TOOL_NAMES = new Set(CAD_TOOL_DEFINITIONS.map((tool) => tool.name));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const checkNumber = (value: unknown, rule: NumberRule): boolean => {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (rule.nonZero && Math.trunc(value) === 0) return false;
  if (rule.min !== undefined && value < rule.min) return false;
  if (rule.max !== undefined && value > rule.max) return false;
  if (rule.exclusiveMin !== undefined && value <= rule.exclusiveMin) return false;
  if (rule.exclusiveMax !== undefined && value >= rule.exclusiveMax) return false;
  return true;
};

const checkPoint = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length >= 2 && checkNumber(value[0], COORD) && checkNumber(value[1], COORD);
  }
  if (!isPlainObject(value)) return false;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return checkNumber(x, COORD) && checkNumber(y, COORD);
};

const checkPointList = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  if (value.length < MIN_POINTS || value.length > MAX_POINTS) return false;
  return value.every(checkPoint);
};

const normalizeIds = (value: unknown): string[] | null | "invalid" => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDS) return "invalid";
  const ids = value.filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0 && id.length <= 128,
  );
  return ids.length === value.length ? ids.map((id) => id.trim()) : "invalid";
};

const normalizeFilterList = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length > MAX_FILTER_ITEMS) return null;
  const items = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0 && item.length <= MAX_FILTER_CHARS,
  );
  return items.length === value.length ? items.map((item) => item.trim()) : null;
};

/** 允许模型把边界写反，统一规范成 min ≤ max */
const normalizeBounds = (
  value: unknown,
): { minX: number; minY: number; maxX: number; maxY: number } | null => {
  if (!isPlainObject(value)) return null;
  const keys = ["minX", "minY", "maxX", "maxY"] as const;
  if (!keys.every((key) => checkNumber(value[key], COORD))) return null;
  const [minX, minY, maxX, maxY] = keys.map((key) => value[key] as number);
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  };
};

const normalizePlanStringList = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length > MAX_PLAN_LIST_ITEMS) return null;
  const items = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0 && item.trim().length <= 200,
  );
  return items.length === value.length ? items.map((item) => item.trim()) : null;
};

interface PlanStepPayload {
  title: string;
  detail?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

const normalizePlanSteps = (value: unknown): PlanStepPayload[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAN_STEPS) return null;
  const steps: PlanStepPayload[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title || title.length > 120) return null;
    const detail =
      item.detail === undefined
        ? undefined
        : typeof item.detail === "string" && item.detail.trim().length <= 300
          ? item.detail.trim()
          : null;
    if (detail === null) return null;
    const tool =
      item.tool === undefined
        ? undefined
        : typeof item.tool === "string" && CAD_TOOL_NAMES.has(item.tool)
          ? item.tool
          : null;
    if (tool === null) return null;
    if (item.arguments !== undefined && !isPlainObject(item.arguments)) return null;
    if (isPlainObject(item.arguments)) {
      try {
        if (JSON.stringify(item.arguments).length > MAX_PLAN_STEP_ARGS_CHARS) return null;
      } catch {
        return null;
      }
    }
    // 计划里的写步骤必须像真实工具调用一样通过参数校验，
    // 否则越界坐标或非法枚举会在用户确认后才被前端丢弃。
    // 作用对象不在此处要求：计划步骤在用户确认时按当前选择集解析。
    let stepArguments: Record<string, unknown> | undefined;
    if (tool && isPlainObject(item.arguments)) {
      const checked = validateToolCall(
        { name: tool, arguments: item.arguments },
        { requireTarget: false },
      );
      if (!checked.ok) return null;
      stepArguments = checked.call.arguments;
    }
    steps.push({
      title,
      ...(detail ? { detail } : {}),
      ...(tool ? { tool } : {}),
      ...(stepArguments ? { arguments: stepArguments } : {}),
    });
  }
  return steps;
};

interface VariantPayload {
  name: string;
  summary?: string;
  steps: PlanStepPayload[];
}

const normalizeVariants = (value: unknown): VariantPayload[] | null => {
  if (!Array.isArray(value) || value.length < MIN_VARIANTS || value.length > MAX_VARIANTS) {
    return null;
  }
  const variants: VariantPayload[] = [];
  const seenNames = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || name.length > MAX_VARIANT_NAME_CHARS || seenNames.has(name)) return null;
    const summary =
      item.summary === undefined
        ? undefined
        : typeof item.summary === "string" && item.summary.trim().length <= MAX_VARIANT_SUMMARY_CHARS
          ? item.summary.trim()
          : null;
    if (summary === null) return null;
    const steps = normalizePlanSteps(item.steps);
    if (!steps) return null;
    seenNames.add(name);
    variants.push({ name, ...(summary ? { summary } : {}), steps });
  }
  return variants;
};

/** 声明了哪些属性（用于剥离 schema 外的字段） */
const declaredProperties = (schema: ToolParameterSchema): Set<string> =>
  new Set(Object.keys(schema.properties ?? {}));
export interface ValidateToolCallOptions {
  /** 允许的工具名；缺省表示全部已注册工具 */
  allowedNames?: readonly string[];
  /** 本轮调用方已有的选择集，用于替代省略的 ids */
  selectedIds?: readonly string[];
  /**
   * 是否要求编辑类工具给出作用对象；缺省为 true。
   * 计划与多方案里的写步骤在用户确认时才落到当前选择集，
   * 因此校验计划步骤时关闭该要求，否则「移动选中图元」这类步骤会被整份拒绝。
   */
  requireTarget?: boolean;
}

export function validateToolCall(
  raw: unknown,
  options: ValidateToolCallOptions = {},
): ToolValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "MALFORMED", message: "工具调用结构不合法" };
  }

  const candidate = raw as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const definition = definitions.get(name);
  if (!definition) {
    return {
      ok: false,
      reason: "UNKNOWN_TOOL",
      message: `未知工具 ${name || "(空)"}`,
      toolName: name || undefined,
    };
  }

  const allowed = options.allowedNames;
  if (allowed && !allowed.includes(name)) {
    return {
      ok: false,
      reason: "TOOL_NOT_ALLOWED",
      message: `当前助手或技能未启用工具 ${name}`,
      toolName: name,
    };
  }

  const args = isPlainObject(candidate.arguments)
    ? candidate.arguments
    : candidate.arguments === undefined || candidate.arguments === null
      ? {}
      : null;
  if (!args) {
    return {
      ok: false,
      reason: "MALFORMED",
      message: `${name} 的参数不是对象`,
      toolName: name,
    };
  }

  const declared = declaredProperties(definition.parameters);
  const required = definition.parameters.required ?? [];
  const rules = NUMBER_RULES[name] ?? {};
  const clean: Record<string, unknown> = {};

  for (const key of required) {
    if (args[key] === undefined) {
      return {
        ok: false,
        reason: "MISSING_ARGUMENT",
        message: `${name} 缺少必填参数 ${key}`,
        toolName: name,
      };
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (!declared.has(key)) continue;
    const rule = rules[key];
    if (rule) {
      if (!checkNumber(value, rule)) {
        return {
          ok: false,
          reason: "BAD_NUMBER",
          message: `${name}.${key} 超出允许范围`,
          toolName: name,
        };
      }
      // 模型常把行列数输出成 3.0 / 3.9，取整而不是拒绝
      const coerced = rule.integer ? Math.trunc(value as number) : (value as number);
      if (
        rule.integer &&
        ((rule.min !== undefined && coerced < rule.min) ||
          (rule.max !== undefined && coerced > rule.max))
      ) {
        return {
          ok: false,
          reason: "BAD_NUMBER",
          message: `${name}.${key} 取整后超出允许范围`,
          toolName: name,
        };
      }
      clean[key] = coerced;
      continue;
    }
    if (key === "points") {
      if (!checkPointList(value)) {
        return {
          ok: false,
          reason: "BAD_POINTS",
          message: `${name}.points 需要 ${MIN_POINTS}–${MAX_POINTS} 个合法坐标`,
          toolName: name,
        };
      }
      clean[key] = (value as unknown[]).map(normalizePoint);
      continue;
    }
    if (key === "center" || key === "p1" || key === "p2") {
      if (value !== undefined && !checkPoint(value)) {
        return {
          ok: false,
          reason: "BAD_POINT",
          message: `${name}.${key} 不是合法坐标`,
          toolName: name,
        };
      }
      if (value !== undefined) clean[key] = normalizePoint(value);
      continue;
    }
    if (key === "goal") {
      if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_PLAN_GOAL_CHARS) {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: `goal 长度需在 1–${MAX_PLAN_GOAL_CHARS} 之间`,
          toolName: name,
        };
      }
      clean[key] = value.trim();
      continue;
    }
    if (key === "steps") {
      const steps = normalizePlanSteps(value);
      if (!steps) {
        return {
          ok: false,
          reason: "BAD_FILTER",
          message: `steps 需要 1–${MAX_PLAN_STEPS} 个合法步骤`,
          toolName: name,
        };
      }
      clean[key] = steps;
      continue;
    }
    if (key === "variants") {
      const variants = normalizeVariants(value);
      if (!variants) {
        return {
          ok: false,
          reason: "BAD_FILTER",
          message: `variants 需要 ${MIN_VARIANTS}–${MAX_VARIANTS} 个名称唯一且步骤合法的方案`,
          toolName: name,
        };
      }
      clean[key] = variants;
      continue;
    }
    if (key === "assumptions" || key === "checks" || key === "risks") {
      const list = normalizePlanStringList(value);
      if (!list) {
        return {
          ok: false,
          reason: "BAD_FILTER",
          message: `${key} 需要最多 ${MAX_PLAN_LIST_ITEMS} 个非空字符串`,
          toolName: name,
        };
      }
      if (list.length > 0) clean[key] = list;
      continue;
    }
    if (key === "kind") {
      if (typeof value !== "string" || !MEASURE_KINDS.has(value)) {
        return {
          ok: false,
          reason: "BAD_ENUM",
          message: `${name}.kind 仅支持 distance / length / area / bbox`,
          toolName: name,
        };
      }
      clean[key] = value;
      continue;
    }
    if (key === "mode" || key === "axis") {
      const allowed = key === "mode" ? ALIGN_MODES : DISTRIBUTE_AXES;
      if (typeof value !== "string" || !allowed.has(value)) {
        return {
          ok: false,
          reason: "BAD_ENUM",
          message: `${name}.${key} 仅支持 ${[...allowed].join(" / ")}`,
          toolName: name,
        };
      }
      clean[key] = value;
      continue;
    }
    if (key === "layer") {
      if (typeof value !== "string") {
        return { ok: false, reason: "BAD_TEXT", message: "图层名必须是字符串", toolName: name };
      }
      const layer = value.trim();
      if (!layer || layer.length > 64) {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: "图层名长度需在 1–64 之间",
          toolName: name,
        };
      }
      clean[key] = layer;
      continue;
    }
    if (key === "blockId") {
      if (typeof value !== "string") {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: "blockId 必须是字符串",
          toolName: name,
        };
      }
      const blockId = value.trim();
      if (!blockId || blockId.length > 128) {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: "blockId 长度需在 1–128 之间",
          toolName: name,
        };
      }
      clean[key] = blockId;
      continue;
    }
    if (key === "name") {
      if (typeof value !== "string") {
        return { ok: false, reason: "BAD_TEXT", message: "name 必须是字符串", toolName: name };
      }
      const blockName = value.trim();
      if (!blockName || blockName.length > 80) {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: "name 长度需在 1–80 之间",
          toolName: name,
        };
      }
      clean[key] = blockName;
      continue;
    }
    if (key === "description") {
      if (typeof value !== "string" || value.length > 300) {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: "description 最多 300 个字符",
          toolName: name,
        };
      }
      const description = value.trim();
      if (description) clean[key] = description;
      continue;
    }
    if (key === "message") {
      if (typeof value !== "string" || value.length > 200) {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: "message 最多 200 个字符",
          toolName: name,
        };
      }
      const versionMessage = value.trim();
      if (versionMessage) clean[key] = versionMessage;
      continue;
    }
    if (key === "basePoint") {
      if (!checkPoint(value)) {
        return {
          ok: false,
          reason: "BAD_POINT",
          message: "basePoint 不是合法坐标",
          toolName: name,
        };
      }
      clean[key] = normalizePoint(value);
      continue;
    }
    if (key === "keyword") {
      if (typeof value !== "string") {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: "keyword 必须是字符串",
          toolName: name,
        };
      }
      const keyword = value.trim();
      if (keyword.length > MAX_FILTER_CHARS) {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: `keyword 最多 ${MAX_FILTER_CHARS} 个字符`,
          toolName: name,
        };
      }
      if (keyword) clean[key] = keyword;
      continue;
    }
    if (key === "types" || key === "layers") {
      const list = normalizeFilterList(value);
      if (!list) {
        return {
          ok: false,
          reason: "BAD_FILTER",
          message: `${name}.${key} 需要最多 ${MAX_FILTER_ITEMS} 个非空字符串`,
          toolName: name,
        };
      }
      if (list.length > 0) clean[key] = list;
      continue;
    }
    if (key === "bounds") {
      const bounds = normalizeBounds(value);
      if (!bounds) {
        return {
          ok: false,
          reason: "BAD_FILTER",
          message: `${name}.bounds 需要 minX/minY/maxX/maxY 四个有限数值`,
          toolName: name,
        };
      }
      clean[key] = bounds;
      continue;
    }
    if (key === "text") {
      if (typeof value !== "string") {
        return { ok: false, reason: "BAD_TEXT", message: "文本必须是字符串", toolName: name };
      }
      const text = value.trim();
      // query_elements 的 text 是可选的子串过滤，空串视为未提供
      const optionalText = name === "query_elements";
      if ((!text && !optionalText) || text.length > MAX_TEXT_CHARS) {
        return {
          ok: false,
          reason: "BAD_TEXT",
          message: `文本长度需在 1–${MAX_TEXT_CHARS} 之间`,
          toolName: name,
        };
      }
      if (text) clean[key] = text;
      continue;
    }
    if (key === "ids") {
      const ids = normalizeIds(value);
      if (ids === "invalid") {
        return {
          ok: false,
          reason: "BAD_IDS",
          message: `ids 需要 1–${MAX_IDS} 个字符串 id`,
          toolName: name,
        };
      }
      if (ids) clean[key] = ids;
      continue;
    }
    if (key === "closed") {
      clean[key] = value === true || value === "true" || value === 1;
      continue;
    }
    clean[key] = value;
  }

  // 编辑类工具必须明确作用域：ids 或当前选择集，二者皆空时不再隐式作用于全图
  if (options.requireTarget !== false && TARGET_TOOLS.has(name) && !clean.ids) {
    const selection = (options.selectedIds ?? []).filter((id) => typeof id === "string");
    if (selection.length === 0) {
      return {
        ok: false,
        reason: "NO_TARGET",
        message: `${name} 需要 ids 或当前选择集，未选择任何图元`,
        toolName: name,
      };
    }
    if (selection.length <= MAX_IDS) clean.ids = selection.slice(0, MAX_IDS);
  }

  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : `call_${name}`;
  return { ok: true, call: { id, name, arguments: clean } };
}

const normalizePoint = (value: unknown): { x: number; y: number } => {
  if (Array.isArray(value)) {
    return { x: Number(value[0]), y: Number(value[1]) };
  }
  const object = value as { x?: unknown; y?: unknown };
  return { x: Number(object.x), y: Number(object.y) };
};

export interface ValidatedToolCalls {
  accepted: ToolCallPayload[];
  /**
   * 被拒调用保留模型原始参数：助手消息要如实收录本轮发起的全部 tool_call，
   * 后续 tool 消息才能与之一一配对。
   */
  rejected: Array<{
    id: string;
    name: string;
    reason: ToolRejectReason;
    message: string;
    arguments: Record<string, unknown>;
  }>;
}

export function validateToolCalls(
  calls: readonly unknown[],
  options: ValidateToolCallOptions = {},
): ValidatedToolCalls {
  const accepted: ToolCallPayload[] = [];
  const rejected: ValidatedToolCalls["rejected"] = [];

  for (const [index, raw] of calls.entries()) {
    const name = isPlainObject(raw) && typeof raw.name === "string" ? raw.name : "";
    const id = isPlainObject(raw) && typeof raw.id === "string" && raw.id ? raw.id : `call_${index}`;
    const rawArguments =
      isPlainObject(raw) && isPlainObject(raw.arguments)
        ? (raw.arguments as Record<string, unknown>)
        : {};
    if (index >= MAX_TOOL_CALLS_PER_TURN) {
      rejected.push({
        id,
        name,
        reason: "TOO_MANY_CALLS",
        message: `单轮最多 ${MAX_TOOL_CALLS_PER_TURN} 次工具调用`,
        arguments: rawArguments,
      });
      continue;
    }
    const result = validateToolCall(raw, options);
    if (result.ok) {
      accepted.push(result.call);
      continue;
    }
    rejected.push({
      id,
      name: result.toolName ?? name,
      reason: result.reason,
      message: result.message,
      arguments: rawArguments,
    });
  }

  return { accepted, rejected };
}

/** 供前端与测试复用的工具名清单 */
export const ALL_TOOL_NAMES: readonly string[] = CAD_TOOL_DEFINITIONS.map((tool) => tool.name);
export const TARGET_TOOL_NAMES: readonly string[] = [...TARGET_TOOLS];
export const POLYLINE_TOOL_NAMES: readonly string[] = [...POINT_TOOLS];
