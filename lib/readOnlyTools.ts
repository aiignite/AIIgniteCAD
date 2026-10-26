/**
 * readOnlyTools.ts — 只读设计工具的本地执行
 *
 * 这些工具不修改草稿，只把查询、测量与检查结果回报给模型。
 * 结果会被序列化进 toolResult，因此按字符预算裁剪，避免后端截断产生非法 JSON。
 */

import type { AIToolCall, Point } from "../types";
import type { AgentDraft } from "./aiAgentLoop";
import { queryElements } from "./elementQuery";
import { measureGeometry, type MeasureKind } from "./measurement";
import { reviewDrawing, summarizeReview } from "./designReview";
import { checkProjectConsistency, summarizeConsistency } from "./projectConsistency";
import { searchBlockCatalog } from "./blockCatalog";

export interface ReadOnlyOutcome {
    ok: boolean;
    summary?: string;
    error?: string;
}

const SUMMARY_BUDGET = 1800;

const asStrings = (value: unknown): string[] | undefined =>
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string").slice(0, 32)
        : undefined;

const asPoint = (value: unknown): Point | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as { x?: unknown; y?: unknown };
    return Number.isFinite(raw.x) && Number.isFinite(raw.y)
        ? { x: Number(raw.x), y: Number(raw.y) }
        : undefined;
};

const asBounds = (value: unknown) => {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Record<string, unknown>;
    const numbers = ["minX", "minY", "maxX", "maxY"].map((key) => raw[key]);
    if (!numbers.every((item) => typeof item === "number" && Number.isFinite(item))) {
        return undefined;
    }
    return {
        minX: Math.min(numbers[0] as number, numbers[2] as number),
        minY: Math.min(numbers[1] as number, numbers[3] as number),
        maxX: Math.max(numbers[0] as number, numbers[2] as number),
        maxY: Math.max(numbers[1] as number, numbers[3] as number),
    };
};

/**
 * 逐项裁剪数组直到 JSON 落入预算，保证回传内容是合法 JSON
 */
function serializeCapped(
    payload: Record<string, unknown>,
    arrayKey: "elements" | "issues" | "blocks",
    maxChars = SUMMARY_BUDGET,
): string {
    let text = JSON.stringify(payload);
    const items = Array.isArray(payload[arrayKey]) ? [...(payload[arrayKey] as unknown[])] : [];
    while (text.length > maxChars && items.length > 0) {
        items.pop();
        payload = { ...payload, [arrayKey]: items, returned: items.length, truncated: true };
        text = JSON.stringify(payload);
    }
    return text;
}

/**
 * 定长结果也要受预算约束：超预算时裁剪长字符串字段，
 * 不能截断 JSON 原文，否则回传给模型的 toolResult 会变成非法 JSON。
 */
function serializeBounded(payload: object, maxChars = SUMMARY_BUDGET): string {
    const text = JSON.stringify(payload);
    if (text.length <= maxChars) return text;
    const trimmed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        trimmed[key] =
            typeof value === "string" && value.length > 200 ? `${value.slice(0, 200)}…` : value;
    }
    return JSON.stringify(trimmed);
}

export function executeReadOnlyTool(
    call: AIToolCall,
    draft: AgentDraft,
    canvasInfoSummary: string,
): ReadOnlyOutcome {
    const args = (call.arguments ?? {}) as Record<string, unknown>;

    if (call.name === "get_canvas_info") {
        return {
            ok: true,
            summary:
                canvasInfoSummary.length > SUMMARY_BUDGET
                    ? `${canvasInfoSummary.slice(0, SUMMARY_BUDGET - 1)}…`
                    : canvasInfoSummary,
        };
    }

    if (call.name === "query_elements") {
        const result = queryElements(draft.elements, {
            types: asStrings(args.types),
            layers: asStrings(args.layers),
            bounds: asBounds(args.bounds),
            text: typeof args.text === "string" ? args.text.slice(0, 200) : undefined,
            limit: Number.isFinite(args.limit) ? Math.min(20, Math.max(1, Number(args.limit))) : 8,
        });
        return {
            ok: true,
            summary: serializeCapped({ ...result }, "elements"),
        };
    }

    if (call.name === "measure_geometry") {
        const kind = typeof args.kind === "string" ? (args.kind as MeasureKind) : "bbox";
        const result = measureGeometry(draft.elements, draft.selection, {
            kind,
            ids: asStrings(args.ids),
            p1: asPoint(args.p1),
            p2: asPoint(args.p2),
        });
        return result.ok
            ? { ok: true, summary: serializeBounded(result) }
            : { ok: false, error: result.error ?? "测量失败" };
    }

    if (call.name === "check_drawing") {
        // scope=project：跨图纸一致性（单位 / 字高 / 精度 / 标准 / 约定图层清单）
        if (args.scope === "project") {
            if (!draft.projectDrawings || draft.projectDrawings.length === 0) {
                return {
                    ok: false,
                    error:
                        "项目图纸清单当前不可用（未登录或列表未加载），只能检查当前图纸；请去掉 scope=project 重试",
                };
            }
            const issues = checkProjectConsistency(draft.projectDrawings);
            return {
                ok: true,
                summary: serializeCapped(
                    {
                        scope: "project",
                        drawings: draft.projectDrawings.length,
                        summary: summarizeConsistency(issues),
                        count: issues.length,
                        returned: Math.min(issues.length, 20),
                        issues: issues.slice(0, 20),
                    },
                    "issues",
                ),
            };
        }
        const issues = reviewDrawing(draft.elements, { conventions: draft.conventions });
        return {
            ok: true,
            summary: serializeCapped(
                {
                    summary: summarizeReview(issues),
                    count: issues.length,
                    returned: Math.min(issues.length, 20),
                    issues: issues.slice(0, 20),
                },
                "issues",
            ),
        };
    }

    if (call.name === "list_blocks") {
        // 读不到块库时回报失败，不能返回 total: 0：
        // 模型会把「0 个块」当成事实上的空库，转而凭空重画库里已有的符号
        if (draft.blocksUnavailable) {
            return {
                ok: false,
                error: "块库当前不可用（读取失败），不是空库；请告诉用户稍后重试，本轮先用绘图工具完成",
            };
        }
        const result = searchBlockCatalog(draft.blocks ?? [], {
            keyword: typeof args.keyword === "string" ? args.keyword.slice(0, 64) : undefined,
            limit: Number.isFinite(args.limit) ? Number(args.limit) : 8,
        });
        return {
            ok: true,
            summary: serializeCapped(
                {
                    total: result.total,
                    returned: result.blocks.length,
                    blocks: result.blocks,
                },
                "blocks",
            ),
        };
    }

    return { ok: false, error: `未知的只读工具 ${call.name}` };
}
