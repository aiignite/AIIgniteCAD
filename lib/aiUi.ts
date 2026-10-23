/**
 * aiUi.ts — Agent 展示层的纯格式化逻辑
 *
 * 不依赖 React：把工具名、参数、用量与成本转成可读文案，
 * 供聊天时间线与用量面板复用，也便于在 Node 测试中直接断言。
 */

import type { AIToolCall } from "../types";

/** 与后端 tools.ts 的工具名一一对应 */
const TOOL_LABELS: Record<string, string> = {
    draw_line: "绘制直线",
    draw_polyline: "绘制多段线",
    draw_rectangle: "绘制矩形",
    draw_circle: "绘制圆",
    draw_text: "插入文字",
    draw_arc: "绘制圆弧",
    draw_dimension: "线性标注",
    clear_canvas: "清空画布",
    delete_last: "删除最后图元",
    move_elements: "移动",
    rotate_elements: "旋转",
    copy_elements: "复制",
    mirror_elements: "镜像",
    scale_elements: "缩放",
    offset_elements: "偏移",
    array_elements: "阵列",
    align_elements: "对齐",
    distribute_elements: "等距分布",
    dimension_chain: "连续标注",
    assign_layer: "设置图层",
    delete_elements: "删除图元",
    get_canvas_info: "读取画布状态",
    zoom_to_selection: "缩放到选择集",
    query_elements: "查询图元",
    measure_geometry: "测量几何",
    check_drawing: "检查图纸",
};

export function toolLabel(name: string): string {
    return TOOL_LABELS[name] ?? name;
}

const numberArg = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

/** 去掉无意义的小数尾零，避免 "5000.00" 这类噪声 */
export function fmtNumber(value: number): string {
    if (Number.isInteger(value)) return String(value);
    const rounded = Math.round(value * 1000) / 1000;
    return String(rounded);
}

const pointText = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const x = numberArg(raw.x);
    const y = numberArg(raw.y);
    return x === null || y === null ? null : `${fmtNumber(x)},${fmtNumber(y)}`;
};

const idText = (value: unknown): string | null => {
    if (!Array.isArray(value) || value.length === 0) return null;
    const ids = value.filter((item): item is string => typeof item === "string");
    if (ids.length === 0) return null;
    return ids.length > 3 ? `${ids.length} 个图元` : `#${ids.join(" #")}`;
};

const pairText = (args: Record<string, unknown>): string | null => {
    const x1 = numberArg(args.x1);
    const y1 = numberArg(args.y1);
    const x2 = numberArg(args.x2);
    const y2 = numberArg(args.y2);
    return x1 === null || y1 === null || x2 === null || y2 === null
        ? null
        : `(${fmtNumber(x1)},${fmtNumber(y1)}) → (${fmtNumber(x2)},${fmtNumber(y2)})`;
};

/** 生成一句工具参数摘要，未知参数按 key=value 兜底，避免时间线出现空白条目 */
export function describeToolCall(call: Pick<AIToolCall, "name" | "arguments">): string {
    const args = call.arguments ?? {};
    const parts: string[] = [];

    const push = (label: string, value: unknown): void => {
        const n = numberArg(value);
        if (n !== null) parts.push(`${label} ${fmtNumber(n)}`);
    };

    switch (call.name) {
        case "draw_line":
        case "draw_dimension": {
            const span = pairText(args);
            if (span) parts.push(span);
            push("偏移", args.offset);
            break;
        }
        case "draw_polyline": {
            const points = Array.isArray(args.points) ? args.points : [];
            const first = pointText(points[0]);
            const last = pointText(points[points.length - 1]);
            if (points.length > 0) {
                parts.push(`${points.length} 个点${first && last ? ` (${first} → ${last})` : ""}`);
            }
            if (args.closed === true) parts.push("闭合");
            break;
        }
        case "draw_rectangle": {
            const x = numberArg(args.x);
            const y = numberArg(args.y);
            if (x !== null && y !== null) parts.push(`(${fmtNumber(x)},${fmtNumber(y)})`);
            const w = numberArg(args.width);
            const h = numberArg(args.height);
            if (w !== null && h !== null) parts.push(`${fmtNumber(w)}×${fmtNumber(h)}`);
            break;
        }
        case "draw_circle": {
            const cx = numberArg(args.cx);
            const cy = numberArg(args.cy);
            if (cx !== null && cy !== null) parts.push(`(${fmtNumber(cx)},${fmtNumber(cy)})`);
            push("半径", args.radius);
            break;
        }
        case "draw_arc": {
            const cx = numberArg(args.cx);
            const cy = numberArg(args.cy);
            if (cx !== null && cy !== null) parts.push(`(${fmtNumber(cx)},${fmtNumber(cy)})`);
            push("半径", args.radius);
            const start = numberArg(args.startAngle);
            const end = numberArg(args.endAngle);
            if (start !== null && end !== null) {
                parts.push(`${fmtNumber(start)}°→${fmtNumber(end)}°`);
            }
            break;
        }
        case "draw_text": {
            const x = numberArg(args.x);
            const y = numberArg(args.y);
            if (x !== null && y !== null) parts.push(`(${fmtNumber(x)},${fmtNumber(y)})`);
            if (typeof args.text === "string") {
                parts.push(args.text.length > 24 ? `${args.text.slice(0, 24)}…` : args.text);
            }
            push("字号", args.fontSize);
            break;
        }
        case "move_elements":
        case "copy_elements": {
            const dx = numberArg(args.dx);
            const dy = numberArg(args.dy);
            if (dx !== null && dy !== null) parts.push(`Δ ${fmtNumber(dx)}, ${fmtNumber(dy)}`);
            break;
        }
        case "rotate_elements":
            push("角度", args.angle);
            break;
        case "mirror_elements": {
            const p1 = pointText(args.p1);
            const p2 = pointText(args.p2);
            if (p1 && p2) parts.push(`轴 ${p1} → ${p2}`);
            break;
        }
        case "scale_elements": {
            push("倍率", args.factor);
            const center = pointText(args.center);
            if (center) parts.push(`基点 ${center}`);
            break;
        }
        case "offset_elements":
            push("距离", args.distance);
            break;
        case "array_elements": {
            const rows = numberArg(args.rows);
            const columns = numberArg(args.columns);
            if (rows !== null && columns !== null)
                parts.push(`${fmtNumber(rows)}×${fmtNumber(columns)}`);
            push("行距", args.rowSpacing);
            push("列距", args.columnSpacing);
            break;
        }
        case "align_elements": {
            const labels: Record<string, string> = {
                left: "左对齐",
                right: "右对齐",
                top: "顶对齐",
                bottom: "底对齐",
                centerX: "水平居中",
                centerY: "垂直居中",
            };
            if (typeof args.mode === "string") parts.push(labels[args.mode] ?? args.mode);
            break;
        }
        case "distribute_elements": {
            parts.push(args.axis === "vertical" ? "垂直等距" : "水平等距");
            break;
        }
        case "dimension_chain": {
            const points = Array.isArray(args.points) ? args.points : [];
            if (points.length >= 2) parts.push(`${points.length - 1} 段连续标注`);
            push("偏移", args.textOffset);
            break;
        }
        case "assign_layer":
            if (typeof args.layer === "string") parts.push(`→ ${args.layer}`);
            break;
        case "delete_elements":
            break;
        case "get_canvas_info":
            break;
        case "query_elements": {
            const list = (value: unknown): string[] =>
                Array.isArray(value)
                    ? value.filter((item): item is string => typeof item === "string")
                    : [];
            const types = list(args.types);
            const layers = list(args.layers);
            if (types.length > 0) parts.push(`类型 ${types.join("/")}`);
            if (layers.length > 0) parts.push(`图层 ${layers.join("/")}`);
            if (typeof args.text === "string" && args.text) {
                parts.push(args.text.length > 20 ? `${args.text.slice(0, 20)}…` : args.text);
            }
            push("最多", args.limit);
            break;
        }
        case "measure_geometry": {
            const kindLabels: Record<string, string> = {
                distance: "两点距离",
                length: "总长度",
                area: "面积",
                bbox: "包围盒",
            };
            if (typeof args.kind === "string") parts.push(kindLabels[args.kind] ?? args.kind);
            const p1 = pointText(args.p1);
            const p2 = pointText(args.p2);
            if (p1 && p2) parts.push(`${p1} → ${p2}`);
            break;
        }
        case "check_drawing":
            break;
        default: {
            for (const [key, value] of Object.entries(args).slice(0, 4)) {
                const n = numberArg(value);
                if (n !== null) parts.push(`${key} ${fmtNumber(n)}`);
                else if (typeof value === "string" || typeof value === "boolean") {
                    parts.push(`${key} ${value}`);
                }
            }
        }
    }

    const ids = idText(args.ids);
    if (ids) parts.unshift(ids);
    if (parts.length === 0) return toolLabel(call.name);
    return `${toolLabel(call.name)} · ${parts.join(" · ")}`;
}

export function formatTokens(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    if (value < 1000) return String(value);
    return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)}k`;
}

export function formatCostUsd(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    if (value === 0) return "$0";
    if (value < 0.0001) return "<$0.0001";
    if (value < 1) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
}

export function formatLatency(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return `${(value * 100).toFixed(1)}%`;
}

/** 会话列表时间：今天内显示时分，更早显示日期 */
export function formatSessionTime(input: string | number | Date): string {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    if (sameDay) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
}
