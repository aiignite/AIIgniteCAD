/**
 * aiTools.ts — AI 工具调用与文本 JSON 降级的共享转换层
 *
 * 纯函数模块：不依赖 React / 浏览器 API，可在 Node 测试中直接运行。
 * 工具名与后端 `backend/src/services/aiEngine/tools.ts` 中的定义保持一致。
 */

import { AIActionResponse, AIToolCall, CADElement, Point } from "../types";
import { getElementBoundingBox, type BoundingBox } from "./geometry";
import { unionBounds } from "./viewport";
import { ALIGN_MODES, DISTRIBUTE_AXES } from "./designOps";
import { expandBlockAt, findBlockEntry, type BlockCatalogEntry } from "./blockCatalog";

const AI_LAYER = "AI_GENERATED";
const AI_COLOR = "#137fec";
const DEFAULT_TEXT_SIZE = 12;
const DEFAULT_DIM_OFFSET = 40;

export const SUPPORTED_AI_TOOL_NAMES = [
    "draw_line",
    "draw_polyline",
    "draw_rectangle",
    "draw_circle",
    "draw_text",
    "clear_canvas",
    "delete_last",
    "move_elements",
    "rotate_elements",
    "copy_elements",
    "mirror_elements",
    "draw_arc",
    "draw_dimension",
    "scale_elements",
    "offset_elements",
    "array_elements",
    "get_canvas_info",
    "zoom_to_selection",
    "query_elements",
    "measure_geometry",
    "check_drawing",
    "align_elements",
    "distribute_elements",
    "dimension_chain",
    "assign_layer",
    "delete_elements",
    "list_blocks",
    "insert_block",
] as const;

export type AIToolName = (typeof SUPPORTED_AI_TOOL_NAMES)[number];

/** 需要作用目标的工具：省略 ids 时使用调用方选择集，仍为空则拒绝 */
export const TARGET_TOOL_NAMES = [
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
] as const;

/** 只读工具不产生画布动作，由 Agent 循环直接计算结果 */
export const READ_ONLY_TOOL_NAMES = [
    "get_canvas_info",
    "query_elements",
    "measure_geometry",
    "check_drawing",
    "list_blocks",
] as const;

/**
 * 视图类工具：只改变视口，不写画布。
 * 与只读工具的区别是它们会产生副作用（移动视口），因此不进入 AI 变更预览。
 */
export const VIEW_TOOL_NAMES = ["zoom_to_selection"] as const;

const TARGET_TOOLS = new Set<string>(TARGET_TOOL_NAMES);
const READ_ONLY_TOOLS = new Set<string>(READ_ONLY_TOOL_NAMES);
const VIEW_TOOLS = new Set<string>(VIEW_TOOL_NAMES);

export const isTargetTool = (name: string): boolean => TARGET_TOOLS.has(name);
export const isReadOnlyTool = (name: string): boolean => READ_ONLY_TOOLS.has(name);
export const isViewTool = (name: string): boolean => VIEW_TOOLS.has(name);

export function isAIToolName(name: string): name is AIToolName {
    return (SUPPORTED_AI_TOOL_NAMES as readonly string[]).includes(name);
}

const createElementId = (): string =>
    `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const numberArg = (value: unknown): number | null => {
    const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return typeof num === "number" && Number.isFinite(num) ? num : null;
};

const pointArg = (value: unknown): Point | null => {
    if (Array.isArray(value) && value.length >= 2) {
        const x = numberArg(value[0]);
        const y = numberArg(value[1]);
        return x === null || y === null ? null : { x, y };
    }
    if (value && typeof value === "object") {
        const x = numberArg((value as { x?: unknown }).x);
        const y = numberArg((value as { y?: unknown }).y);
        return x === null || y === null ? null : { x, y };
    }
    return null;
};

const pointsArg = (value: unknown): Point[] | null => {
    if (!Array.isArray(value)) return null;
    const points = value.map(pointArg).filter((point): point is Point => point !== null);
    return points.length === value.length && points.length >= 2 ? points : null;
};

const idListArg = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    const ids = value.filter((id): id is string => typeof id === "string" && id.length > 0);
    return ids.length > 0 ? ids : null;
};

/**
 * 解析作用目标。显式 ids 必须全部命中当前图元；省略 ids 时只使用调用方传入的
 * 选择集，两者都为空则返回空数组，由上层拒绝该调用（不再默认"全部图元"）。
 */
const resolveTargets = (
    ids: unknown,
    elements: CADElement[],
    selectedIds: string[],
): CADElement[] | null => {
    const byId = new Map(elements.map((element) => [element.id, element]));
    const explicit = idListArg(ids);
    if (!explicit) {
        return selectedIds
            .map((id) => byId.get(id))
            .filter((element): element is CADElement => Boolean(element));
    }
    const targets = explicit
        .map((id) => byId.get(id))
        .filter((element): element is CADElement => Boolean(element));
    return targets.length === explicit.length ? targets : null;
};

const createElement = (
    partial: Omit<CADElement, "id" | "layer" | "color"> & { layer?: string; color?: string },
): CADElement => ({
    id: createElementId(),
    layer: AI_LAYER,
    color: AI_COLOR,
    ...partial,
});

export interface ToolCallConversionOptions {
    /** 当前画布图元，用于把 ids 解析成真实图元 */
    elements?: CADElement[];
    /** 省略 ids 时的目标来源；不再回退到全部图元 */
    selectedIds?: string[];
    /** 本轮可用的块库目录；insert_block 从目录中解析块定义 */
    blockCatalog?: readonly BlockCatalogEntry[];
    /** 块库读取失败；insert_block 据此区分「不可用」与「没有这个块」 */
    blocksUnavailable?: boolean;
}

/**
 * 单个工具调用的转换结果：成功带 action，失败带 error。
 * 失败必须点名具体字段——模型只能依据 toolResult 修正参数，
 * 「参数不合法」这种不指向任何输入的说法只会让它重复提交同样的错误。
 * 用可选字段而非判别联合：本仓库前端 tsconfig 未开 strict，
 * 按 `ok` 字面量收窄会失效，调用方反而拿不到类型。
 */
export interface ToolCallResult {
    action?: AIActionResponse;
    error?: string;
}

const succeeded = (action: AIActionResponse): ToolCallResult => ({ action });
const failed = (error: string): ToolCallResult => ({ error });

interface NumberSpec {
    min?: number;
    max?: number;
    exclusiveMin?: number;
    nonZero?: boolean;
    integer?: boolean;
}

/** 取值范围与后端 toolValidator 的 NUMBER_RULES 对齐，两端不另立标准 */
const MAX_COORD_ABS = 1e7;
const COORD: NumberSpec = { min: -MAX_COORD_ABS, max: MAX_COORD_ABS };
const POSITIVE: NumberSpec = { exclusiveMin: 0, max: MAX_COORD_ABS };
const OFFSET: NumberSpec = { min: -MAX_COORD_ABS, max: MAX_COORD_ABS, nonZero: true };
const SPACING: NumberSpec = { min: -MAX_COORD_ABS, max: MAX_COORD_ABS };
const ANGLE: NumberSpec = { min: -3600, max: 3600 };
const COUNT: NumberSpec = { min: 1, max: 50, integer: true };
const SCALE_FACTOR: NumberSpec = { min: 0.01, max: 100 };
const TEXT_SIZE: NumberSpec = { min: 1, max: 200 };
const MAX_POINTS = 200;
const MAX_TEXT_CHARS = 500;
const MAX_LAYER_CHARS = 64;
const MAX_BLOCK_ID_CHARS = 128;

type NumberRead = { values: Record<string, number>; error: null } | { values: null; error: string };

/** 按声明顺序读取数字参数，第一个非法字段即返回错误 */
const readNumbers = (
    tool: string,
    args: Record<string, unknown>,
    specs: Record<string, NumberSpec>,
): NumberRead => {
    const values: Record<string, number> = {};
    for (const [key, spec] of Object.entries(specs)) {
        let value = numberArg(args[key]);
        if (value === null) return { values: null, error: `${tool}.${key} 缺失或不是数字` };
        if (spec.integer) value = Math.trunc(value);
        if (spec.min !== undefined && value < spec.min) {
            return { values: null, error: `${tool}.${key} 不能小于 ${spec.min}` };
        }
        if (spec.max !== undefined && value > spec.max) {
            return { values: null, error: `${tool}.${key} 不能大于 ${spec.max}` };
        }
        if (spec.exclusiveMin !== undefined && value <= spec.exclusiveMin) {
            return { values: null, error: `${tool}.${key} 必须大于 ${spec.exclusiveMin}` };
        }
        if (spec.nonZero && value === 0) {
            return { values: null, error: `${tool}.${key} 不能为 0` };
        }
        values[key] = value;
    }
    return { values, error: null };
};

type OptionalRead = { value: number; error: null } | { value: null; error: string };

/** 可选数字参数：未给出时用默认值，给出了就必须合法 */
const readOptionalNumber = (
    tool: string,
    args: Record<string, unknown>,
    key: string,
    fallback: number,
    spec: NumberSpec = {},
): OptionalRead => {
    if (args[key] === undefined || args[key] === null) return { value: fallback, error: null };
    const parsed = readNumbers(tool, args, { [key]: spec });
    return parsed.error
        ? { value: null, error: parsed.error }
        : { value: parsed.values[key], error: null };
};

/** 作用目标类工具的两类失败：ids 不存在与没有目标 */
const badIds = (tool: string): ToolCallResult => failed(`${tool}.ids 引用了画布上不存在的图元`);
const noTargets = (tool: string): ToolCallResult =>
    failed(`${tool} 没有可作用的图元（请提供 ids 或先选中图元）`);

/** 点列参数：与后端一致，要求 2–200 个合法坐标 */
const readPoints = (tool: string, value: unknown): Point[] | null => {
    const points = pointsArg(value);
    return points === null || points.length > MAX_POINTS ? null : points;
};

const pointsError = (tool: string): ToolCallResult =>
    failed(`${tool}.points 需要 2–${MAX_POINTS} 个合法坐标`);

/** 可选坐标参数：未给出时返回 undefined，给出了就必须合法 */
const readOptionalPoint = (
    tool: string,
    value: unknown,
): { point?: Point; error: string | null } => {
    if (value === undefined || value === null) return { error: null };
    const point = pointArg(value);
    return point ? { point, error: null } : { error: `${tool}.center 不是合法坐标` };
};

/** 枚举参数：把允许值回写给模型，否则它只能猜 */
const readEnum = <T extends string>(
    tool: string,
    key: string,
    value: unknown,
    allowed: readonly T[],
): { item?: T; error: string | null } => {
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
        return { item: value as T, error: null };
    }
    return { error: `${tool}.${key} 需为 ${allowed.join(" / ")}` };
};

/** 文本参数：非空且长度受限 */
const readText = (
    tool: string,
    key: string,
    value: unknown,
): { text: string; error: string | null } => {
    if (typeof value !== "string") return { text: "", error: `${tool}.${key} 必须是字符串` };
    const text = value.trim();
    if (!text || text.length > MAX_TEXT_CHARS) {
        return { text: "", error: `${tool}.${key} 长度需在 1–${MAX_TEXT_CHARS} 之间` };
    }
    return { text, error: null };
};

/**
 * 把模型返回的单个工具调用转换为现有 AIActionResponse 流程可消费的动作。
 * 参数非法时返回带字段名的失败原因，由调用方回传给模型。
 */
export function toolCallToAction(
    call: AIToolCall,
    options: ToolCallConversionOptions = {},
): ToolCallResult {
    const args = call.arguments ?? {};
    const currentElements = options.elements ?? [];
    const selectedIds = options.selectedIds ?? [];

    switch (call.name) {
        case "draw_line": {
            const parsed = readNumbers("draw_line", args, {
                x1: COORD,
                y1: COORD,
                x2: COORD,
                y2: COORD,
            });
            if (parsed.error) return failed(parsed.error);
            const { x1, y1, x2, y2 } = parsed.values;
            return succeeded({
                message: "Line added.",
                operation: "ADD",
                elements: [
                    createElement({
                        type: "LINE",
                        start: { x: x1, y: y1 },
                        end: { x: x2, y: y2 },
                    }),
                ],
            });
        }

        case "draw_polyline": {
            const points = readPoints("draw_polyline", args.points);
            if (!points) return pointsError("draw_polyline");
            return succeeded({
                message: "Polyline added.",
                operation: "ADD",
                elements: [
                    createElement({
                        type: "LWPOLYLINE",
                        points,
                        closed: args.closed === true,
                    }),
                ],
            });
        }

        case "draw_rectangle": {
            const parsed = readNumbers("draw_rectangle", args, {
                x: COORD,
                y: COORD,
                width: OFFSET,
                height: OFFSET,
            });
            if (parsed.error) return failed(parsed.error);
            const { x, y, width, height } = parsed.values;
            return succeeded({
                message: "Rectangle added.",
                operation: "ADD",
                elements: [
                    createElement({
                        type: "RECTANGLE",
                        start: { x, y },
                        width,
                        height,
                    }),
                ],
            });
        }

        case "draw_circle": {
            const parsed = readNumbers("draw_circle", args, {
                cx: COORD,
                cy: COORD,
                radius: POSITIVE,
            });
            if (parsed.error) return failed(parsed.error);
            const { cx, cy, radius } = parsed.values;
            return succeeded({
                message: "Circle added.",
                operation: "ADD",
                elements: [
                    createElement({
                        type: "CIRCLE",
                        center: { x: cx, y: cy },
                        radius,
                    }),
                ],
            });
        }

        case "draw_text": {
            const parsed = readNumbers("draw_text", args, { x: COORD, y: COORD });
            if (parsed.error) return failed(parsed.error);
            const { x, y } = parsed.values;
            const text = readText("draw_text", "text", args.text);
            if (text.error) return failed(text.error);
            const size = readOptionalNumber(
                "draw_text",
                args,
                "fontSize",
                DEFAULT_TEXT_SIZE,
                TEXT_SIZE,
            );
            if (size.error) return failed(size.error);
            return succeeded({
                message: "Text added.",
                operation: "ADD",
                elements: [
                    createElement({
                        type: "TEXT",
                        start: { x, y },
                        text: text.text,
                        fontSize: size.value,
                    }),
                ],
            });
        }

        case "draw_arc": {
            const parsed = readNumbers("draw_arc", args, {
                cx: COORD,
                cy: COORD,
                radius: POSITIVE,
                startAngle: ANGLE,
                endAngle: ANGLE,
            });
            if (parsed.error) return failed(parsed.error);
            const { cx, cy, radius, startAngle, endAngle } = parsed.values;
            if (startAngle === endAngle) {
                return failed("draw_arc.startAngle 与 endAngle 不能相同，否则弧长为 0");
            }
            return succeeded({
                message: "Arc added.",
                operation: "ADD",
                elements: [
                    createElement({
                        type: "ARC",
                        center: { x: cx, y: cy },
                        radius,
                        startAngle,
                        endAngle,
                        // 工具约定角度自 +X 起沿屏幕顺时针扫描
                        clockwise: true,
                    }),
                ],
            });
        }

        case "insert_block": {
            const blockId =
                typeof args.blockId === "string" && args.blockId.trim().length <= MAX_BLOCK_ID_CHARS
                    ? args.blockId.trim()
                    : "";
            if (!blockId)
                return failed(`insert_block.blockId 长度需在 1–${MAX_BLOCK_ID_CHARS} 之间`);
            const parsed = readNumbers("insert_block", args, { x: COORD, y: COORD });
            if (parsed.error) return failed(parsed.error);
            const { x, y } = parsed.values;
            const entry = findBlockEntry(options.blockCatalog ?? [], blockId);
            if (!entry) {
                // 空目录有两种成因：块库读不到，或者确实没有匹配的块。
                // 只说「不在块库中」会让模型反复换 blockId，而正确做法是改走绘图工具或稍后重试。
                if (options.blocksUnavailable) {
                    return failed(
                        "insert_block 块库当前不可用（读取失败），不是空库；请先用绘图工具完成，或稍后重试",
                    );
                }
                return failed(
                    `insert_block.blockId "${blockId}" 不在块库中，请先用 list_blocks 查询`,
                );
            }
            const scale = readOptionalNumber("insert_block", args, "scale", 1, SCALE_FACTOR);
            if (scale.error) return failed(scale.error);
            const rotation = readOptionalNumber("insert_block", args, "rotation", 0, ANGLE);
            if (rotation.error) return failed(rotation.error);
            const elements = expandBlockAt(entry, {
                x,
                y,
                scale: scale.value,
                rotation: rotation.value,
            });
            if (elements.length === 0) {
                return failed(`insert_block 块 "${entry.name}" 没有可插入的图元`);
            }
            return succeeded({
                message: `Inserted block "${entry.name}".`,
                operation: "ADD",
                elements,
            });
        }

        case "draw_dimension": {
            const parsed = readNumbers("draw_dimension", args, {
                x1: COORD,
                y1: COORD,
                x2: COORD,
                y2: COORD,
            });
            if (parsed.error) return failed(parsed.error);
            const { x1, y1, x2, y2 } = parsed.values;
            const span = Math.hypot(x2 - x1, y2 - y1);
            if (span === 0) return failed("draw_dimension 的两个测量点重合，无法标注");
            const offset = readOptionalNumber(
                "draw_dimension",
                args,
                "textOffset",
                DEFAULT_DIM_OFFSET,
                SPACING,
            );
            if (offset.error) return failed(offset.error);
            // 标注线沿测量线的法向偏移，第三点决定标注高度
            const normal = { x: -(y2 - y1) / span, y: (x2 - x1) / span };
            return succeeded({
                message: "Dimension added.",
                operation: "ADD",
                elements: [
                    createElement({
                        type: "DIMENSION",
                        layer: "DIM",
                        start: { x: x1, y: y1 },
                        end: { x: x2, y: y2 },
                        offsetPoint: {
                            x: (x1 + x2) / 2 + normal.x * offset.value,
                            y: (y1 + y2) / 2 + normal.y * offset.value,
                        },
                    }),
                ],
            });
        }

        case "dimension_chain": {
            const points = readPoints("dimension_chain", args.points);
            if (!points) return pointsError("dimension_chain");
            const offset = readOptionalNumber(
                "dimension_chain",
                args,
                "textOffset",
                DEFAULT_DIM_OFFSET,
                SPACING,
            );
            if (offset.error) return failed(offset.error);
            const dimensions: CADElement[] = [];
            for (let index = 1; index < points.length; index += 1) {
                const start = points[index - 1];
                const end = points[index];
                const span = Math.hypot(end.x - start.x, end.y - start.y);
                if (span === 0) continue;
                const normal = { x: -(end.y - start.y) / span, y: (end.x - start.x) / span };
                dimensions.push(
                    createElement({
                        type: "DIMENSION",
                        layer: "DIM",
                        start,
                        end,
                        offsetPoint: {
                            x: (start.x + end.x) / 2 + normal.x * offset.value,
                            y: (start.y + end.y) / 2 + normal.y * offset.value,
                        },
                    }),
                );
            }
            if (dimensions.length === 0) {
                return failed("dimension_chain.points 相邻点全部重合，没有可生成的标注");
            }
            return succeeded({
                message: `${dimensions.length} chained dimensions added.`,
                operation: "ADD",
                elements: dimensions,
            });
        }

        case "clear_canvas":
            return succeeded({ message: "Canvas cleared.", operation: "CLEAR" });

        case "delete_last":
            return succeeded({ message: "Last element deleted.", operation: "DELETE_LAST" });

        case "move_elements": {
            const parsed = readNumbers("move_elements", args, { dx: COORD, dy: COORD });
            if (parsed.error) return failed(parsed.error);
            const { dx, dy } = parsed.values;
            if (dx === 0 && dy === 0) return failed("move_elements.dx / dy 不能同时为 0");
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("move_elements");
            if (targets.length === 0) return noTargets("move_elements");
            return succeeded({
                message: "Elements moved.",
                operation: "MOVE",
                elements: targets,
                params: { dx, dy },
            });
        }

        case "rotate_elements": {
            const parsed = readNumbers("rotate_elements", args, { angle: ANGLE });
            if (parsed.error) return failed(parsed.error);
            const center = readOptionalPoint("rotate_elements", args.center);
            if (center.error) return failed(center.error);
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("rotate_elements");
            if (targets.length === 0) return noTargets("rotate_elements");
            return succeeded({
                message: "Elements rotated.",
                operation: "ROTATE",
                elements: targets,
                params: {
                    angle: parsed.values.angle,
                    ...(center.point ? { center: center.point } : {}),
                },
            });
        }

        case "copy_elements": {
            const parsed = readNumbers("copy_elements", args, { dx: COORD, dy: COORD });
            if (parsed.error) return failed(parsed.error);
            const { dx, dy } = parsed.values;
            if (dx === 0 && dy === 0) {
                return failed("copy_elements.dx / dy 不能同时为 0，否则副本与原图重合");
            }
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("copy_elements");
            if (targets.length === 0) return noTargets("copy_elements");
            return succeeded({
                message: "Elements copied.",
                operation: "COPY",
                elements: targets,
                params: { dx, dy },
            });
        }

        case "mirror_elements": {
            const p1 = pointArg(args.p1);
            const p2 = pointArg(args.p2);
            if (!p1) return failed("mirror_elements.p1 不是合法坐标");
            if (!p2) return failed("mirror_elements.p2 不是合法坐标");
            if (p1.x === p2.x && p1.y === p2.y) {
                return failed("mirror_elements.p1 与 p2 重合，无法确定镜像轴");
            }
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("mirror_elements");
            if (targets.length === 0) return noTargets("mirror_elements");
            return succeeded({
                message: "Elements mirrored.",
                operation: "MIRROR",
                elements: targets,
                params: { p1, p2 },
            });
        }

        case "scale_elements": {
            // factor 是工具定义里的名字，scale 作为历史别名继续接受
            const aliased = { factor: args.factor ?? args.scale };
            const parsed = readNumbers("scale_elements", aliased, { factor: SCALE_FACTOR });
            if (parsed.error) return failed(parsed.error);
            const center = readOptionalPoint("scale_elements", args.center);
            if (center.error) return failed(center.error);
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("scale_elements");
            if (targets.length === 0) return noTargets("scale_elements");
            return succeeded({
                message: "Elements scaled.",
                operation: "SCALE",
                elements: targets,
                params: {
                    factor: parsed.values.factor,
                    ...(center.point ? { center: center.point } : {}),
                },
            });
        }

        case "offset_elements": {
            const parsed = readNumbers("offset_elements", args, { distance: OFFSET });
            if (parsed.error) return failed(parsed.error);
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("offset_elements");
            if (targets.length === 0) return noTargets("offset_elements");
            return succeeded({
                message: "Elements offset.",
                operation: "OFFSET",
                elements: targets,
                params: { distance: parsed.values.distance },
            });
        }

        case "array_elements": {
            const parsed = readNumbers("array_elements", args, {
                rows: COUNT,
                columns: COUNT,
                rowSpacing: SPACING,
                columnSpacing: SPACING,
            });
            if (parsed.error) return failed(parsed.error);
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("array_elements");
            if (targets.length === 0) return noTargets("array_elements");
            return succeeded({
                message: "Rectangular array created.",
                operation: "ARRAY",
                elements: targets,
                params: {
                    rows: parsed.values.rows,
                    columns: parsed.values.columns,
                    rowSpacing: parsed.values.rowSpacing,
                    columnSpacing: parsed.values.columnSpacing,
                },
            });
        }

        case "align_elements": {
            const mode = readEnum("align_elements", "mode", args.mode, ALIGN_MODES);
            if (mode.error) return failed(mode.error);
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("align_elements");
            if (targets.length < 2) {
                return failed("align_elements 至少需要 2 个图元（请提供 ids 或先选中图元）");
            }
            return succeeded({
                message: "Elements aligned.",
                operation: "ALIGN",
                elements: targets,
                params: { mode: mode.item },
            });
        }

        case "distribute_elements": {
            const axis = readEnum("distribute_elements", "axis", args.axis, DISTRIBUTE_AXES);
            if (axis.error) return failed(axis.error);
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("distribute_elements");
            if (targets.length < 3) {
                return failed("distribute_elements 至少需要 3 个图元（请提供 ids 或先选中图元）");
            }
            return succeeded({
                message: "Elements distributed.",
                operation: "DISTRIBUTE",
                elements: targets,
                params: { axis: axis.item },
            });
        }

        case "assign_layer": {
            const raw = typeof args.layer === "string" ? args.layer.trim() : "";
            if (!raw || raw.length > MAX_LAYER_CHARS) {
                return failed(`assign_layer.layer 长度需在 1–${MAX_LAYER_CHARS} 之间`);
            }
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("assign_layer");
            if (targets.length === 0) return noTargets("assign_layer");
            return succeeded({
                message: `Layer changed to ${raw}.`,
                operation: "SET_LAYER",
                elements: targets,
                params: { layer: raw },
            });
        }

        case "delete_elements": {
            const targets = resolveTargets(args.ids, currentElements, selectedIds);
            if (targets === null) return badIds("delete_elements");
            if (targets.length === 0) return noTargets("delete_elements");
            return succeeded({
                message: "Elements deleted.",
                operation: "DELETE",
                elements: targets,
            });
        }

        default:
            return failed(`${call.name} 不能转换为画布动作`);
    }
}

/**
 * 视图类工具的结果：只描述"视口要移到哪"，由调用方执行。
 * 不进入 AIActionResponse，因为视图变化不写画布、也不需要预览确认。
 */
export interface AIViewRequest {
    /** 目标包围盒 */
    bounds: BoundingBox;
    /** 回传给模型的说明 */
    summary: string;
}

/**
 * 把视图类工具调用转换为视口请求。
 * 没有可作用的目标（未选中图元 / ids 不存在）时返回 null。
 */
export function toolCallToViewRequest(
    call: AIToolCall,
    options: ToolCallConversionOptions = {},
): AIViewRequest | null {
    if (!isViewTool(call.name)) return null;

    const args = call.arguments ?? {};
    const targets = resolveTargets(args.ids, options.elements ?? [], options.selectedIds ?? []);
    if (targets === null || targets.length === 0) return null;

    const bounds = unionBounds(targets.map(getElementBoundingBox));
    if (!bounds) return null;

    return { bounds, summary: `缩放到 ${targets.length} 个图元` };
}

/* ─── 文本 JSON 降级路径 ───────────────────────────────────── */

/** 从可能包含 Markdown/说明文字的响应中提取第一个完整 JSON 对象 */
export function extractJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
        } else if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

/** 兼容模型返回的各种字段命名，将原始对象规范化为 CADElement */
export function normalizeAIElement(raw: unknown): CADElement {
    const source = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
    // 部分模型会返回嵌套的 properties，将其拍平到顶层
    const rawData =
        source.properties && typeof source.properties === "object"
            ? { ...source, ...source.properties }
            : source;

    const normalized: CADElement = {
        ...rawData,
        id: rawData.id || createElementId(),
        color: rawData.color || rawData.fill || rawData.stroke || AI_COLOR,
        layer: rawData.layer || AI_LAYER,
        type: typeof rawData.type === "string" ? rawData.type.toUpperCase() : rawData.type,
    };

    if (normalized.type === "RECTANGLE") {
        if (!normalized.start && rawData.x !== undefined && rawData.y !== undefined) {
            normalized.start = { x: Number(rawData.x), y: Number(rawData.y) };
        }
        if (normalized.start && normalized.end && normalized.width === undefined) {
            normalized.width = normalized.end.x - normalized.start.x;
            normalized.height = normalized.end.y - normalized.start.y;
        }
    }

    if (normalized.type === "LINE") {
        if (!normalized.start && rawData.x1 !== undefined) {
            normalized.start = { x: Number(rawData.x1), y: Number(rawData.y1) };
        }
        if (!normalized.end && rawData.x2 !== undefined) {
            normalized.end = { x: Number(rawData.x2), y: Number(rawData.y2) };
        }
    }

    if (normalized.type === "CIRCLE") {
        if (!normalized.center && rawData.cx !== undefined) {
            normalized.center = { x: Number(rawData.cx), y: Number(rawData.cy) };
        }
        if (normalized.center && normalized.radius === undefined) {
            const endPt = normalized.end || rawData.point;
            if (endPt) {
                normalized.radius = Math.sqrt(
                    Math.pow(endPt.x - normalized.center.x, 2) +
                        Math.pow(endPt.y - normalized.center.y, 2),
                );
            }
        }
    }

    return normalized;
}

const TEXT_OPERATIONS = new Set([
    "ADD",
    "CLEAR",
    "DELETE_LAST",
    "ROTATE",
    "MIRROR",
    "COPY",
    "MOVE",
    "SCALE",
    "OFFSET",
    "ARRAY",
    "ALIGN",
    "DISTRIBUTE",
    "SET_LAYER",
    "DELETE",
]);

/** 解析文本中的 CAD JSON 指令（工具调用不可用时的降级路径） */
export function parseTextAIAction(content: string): AIActionResponse | null {
    const json = extractJsonObject(content);
    if (!json) return null;

    let parsed: any;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }

    const operation = typeof parsed?.operation === "string" ? parsed.operation.toUpperCase() : null;
    if (!operation || operation === "NONE" || !TEXT_OPERATIONS.has(operation)) return null;

    const elements = Array.isArray(parsed.elements)
        ? parsed.elements.map(normalizeAIElement)
        : undefined;

    return {
        message: typeof parsed.message === "string" ? parsed.message : "",
        operation: operation as AIActionResponse["operation"],
        elements,
        params: parsed.params ?? parsed.parameters,
    };
}
