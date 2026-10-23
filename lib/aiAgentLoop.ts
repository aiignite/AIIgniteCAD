/**
 * aiAgentLoop.ts — 前端虚拟画布上的工具循环
 *
 * 纯函数：在草稿图元数组上执行模型返回的工具调用，产出回传给模型的 toolResults
 * 与聚合后的动作批次。草稿不与 store 交互，循环结束后整批动作一次性进入预览，
 * 因此多轮工具调用仍然只占一步撤销。
 */

import type { AIActionResponse, AIToolCall, CADElement, Point } from "../types";
import { computeAIActionOutcome } from "./aiActions";
import {
    isReadOnlyTool,
    isViewTool,
    parseTextAIAction,
    toolCallToAction,
    toolCallToViewRequest,
    type AIViewRequest,
} from "./aiTools";
import { executeReadOnlyTool } from "./readOnlyTools";
import { PLAN_TOOL_NAME, parsePlanProposal, type PlanProposal } from "./aiPlan";
import { VARIANTS_TOOL_NAME, parseVariantProposal, type VariantProposal } from "./aiVariants";
import { findBlockEntry, type BlockCatalogEntry, type BlockCatalogResult } from "./blockCatalog";
import type { ReviewConventions } from "./designReview";

export interface AgentToolResult {
    toolCallId: string;
    name: string;
    ok: boolean;
    summary?: string;
    error?: string;
    changedIds?: string[];
}

export interface AgentDraft {
    /** 当前草稿图元（含本轮新增/修改） */
    elements: CADElement[];
    /** 草稿上的选择集，作为省略 ids 时的作用目标 */
    selection: string[];
    /** 累计动作，按执行顺序排列，供预览一次性计算 */
    actions: AIActionResponse[];
    /** 本轮可用块库目录；insert_block / list_blocks 依赖它 */
    blocks?: BlockCatalogEntry[];
    /** 块库读取失败：目录会是空数组，但工具结果必须说「不可用」而不是「没有块」 */
    blocksUnavailable?: boolean;
    /**
     * 本轮已插入的块。insert_block 展开为图元、不产生块引用，
     * 但下一轮的上下文需要知道块已经进去了，否则模型会重复插同一个块。
     */
    blockInsertions: { blockId: string; name: string }[];
    /** 项目设计约定；check_drawing 等确定性检查会读取它 */
    conventions?: ReviewConventions;
}

export interface CanvasStats {
    elementCount: number;
    byType: Record<string, number>;
    selectedCount: number;
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface RoundOutcome {
    draft: AgentDraft;
    results: AgentToolResult[];
    /** 本轮产生的视口请求；视图类工具不写画布，由调用方执行 */
    viewRequests: AIViewRequest[];
    /** 因超出单轮上限而被跳过的调用数 */
    skipped: number;
    /** 模型提出的执行计划；存在时本轮不继续工具循环，等待用户确认 */
    plan?: PlanProposal;
    /** 模型提出的多方案；存在时本轮不继续工具循环，等待用户选择 */
    variants?: VariantProposal;
}

/**
 * 与后端 toolValidator 的单轮上限保持一致。按**尝试过的调用数**计：
 * 失败调用同样占额度，否则模型可以靠反复提交同一组错误参数把一轮跑满。
 */
export const MAX_TOOL_CALLS_PER_ROUND = 20;

/** 连续重复调用的提示：不改变结果，只告诉模型原地重试没有意义 */
const DUPLICATE_HINT = "（与上一条工具调用完全相同，重复执行不会改变结果，请换参数或换做法）";

export function createDraft(
    elements: CADElement[],
    selectedIds: string[] = [],
    blocks: BlockCatalogEntry[] | BlockCatalogResult = [],
    conventions?: ReviewConventions,
): AgentDraft {
    const known = new Set(elements.map((element) => element.id));
    const catalog = Array.isArray(blocks) ? { entries: blocks, ok: true } : blocks;
    return {
        elements,
        selection: selectedIds.filter((id) => known.has(id)),
        actions: [],
        blocks: catalog.entries,
        blocksUnavailable: !catalog.ok,
        blockInsertions: [],
        conventions,
    };
}

const elementBounds = (element: CADElement): Point[] => {
    const points: Point[] = [];
    if (element.start) points.push(element.start);
    if (element.end) points.push(element.end);
    if (element.points) points.push(...element.points);
    if (element.center) {
        const radius = element.radius ?? 0;
        points.push({ x: element.center.x - radius, y: element.center.y - radius });
        points.push({ x: element.center.x + radius, y: element.center.y + radius });
    }
    if (element.type === "RECTANGLE" && element.start) {
        points.push({
            x: element.start.x + (element.width ?? 0),
            y: element.start.y + (element.height ?? 0),
        });
    }
    return points;
};

const round = (value: number): number => Math.round(value * 100) / 100;

export function summarizeCanvas(draft: AgentDraft): CanvasStats {
    const byType: Record<string, number> = {};
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let hasPoint = false;

    for (const element of draft.elements) {
        byType[element.type] = (byType[element.type] ?? 0) + 1;
        for (const point of elementBounds(element)) {
            hasPoint = true;
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
    }

    return {
        elementCount: draft.elements.length,
        byType,
        selectedCount: draft.selection.length,
        bounds: hasPoint
            ? { minX: round(minX), minY: round(minY), maxX: round(maxX), maxY: round(maxY) }
            : null,
    };
}

/** 一次图元变更的分类计数 */
interface ElementDiff {
    changed: string[];
    added: number;
    modified: number;
    removed: number;
}

/**
 * 差分依据对象引用：写操作只重建被命中的图元，未命中的保持同一引用，
 * 因此引用变化即可判定「这个图元被改过」，不需要逐字段比较几何。
 */
const classifyDiff = (before: readonly CADElement[], after: readonly CADElement[]): ElementDiff => {
    const beforeById = new Map(before.map((element) => [element.id, element]));
    const afterById = new Map(after.map((element) => [element.id, element]));
    const changed: string[] = [];
    let added = 0;
    let modified = 0;
    for (const [id, element] of afterById) {
        const previous = beforeById.get(id);
        if (!previous) {
            added += 1;
            changed.push(id);
        } else if (previous !== element) {
            modified += 1;
            changed.push(id);
        }
    }
    let removed = 0;
    for (const id of beforeById.keys()) {
        if (!afterById.has(id)) {
            removed += 1;
            changed.push(id);
        }
    }
    return { changed, added, modified, removed };
};

export interface ElementChangeCounts {
    added: number;
    modified: number;
    removed: number;
}

/** 几何差分计数：方案卡片用它替代模型自述的步骤数，用户能看到真实变化 */
export function diffElementCounts(
    before: readonly CADElement[],
    after: readonly CADElement[],
): ElementChangeCounts {
    const { added, modified, removed } = classifyDiff(before, after);
    return { added, modified, removed };
}

const describeChange = (diff: ElementDiff, total: number): string => {
    const parts: string[] = [];
    if (diff.added > 0) parts.push(`新增 ${diff.added} 个图元`);
    if (diff.modified > 0) parts.push(`修改 ${diff.modified} 个图元`);
    if (diff.removed > 0) parts.push(`删除 ${diff.removed} 个图元`);
    if (parts.length === 0) return "画布未变化";
    return `${parts.join("、")}，画布共 ${total} 个`;
};

const statsSummary = (stats: CanvasStats): string => {
    const types = Object.entries(stats.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type}×${count}`)
        .join("、");
    const bounds = stats.bounds
        ? `[${stats.bounds.minX}, ${stats.bounds.minY}] → [${stats.bounds.maxX}, ${stats.bounds.maxY}]`
        : "无图元";
    return `图元 ${stats.elementCount} 个（${types || "空"}），包围盒 ${bounds}，选中 ${stats.selectedCount} 个`;
};

/** insert_block 成功时记录块身份，供下一轮把「块已经进去了」告诉模型 */
function blockInsertionFromCall(
    call: AIToolCall,
    catalog: BlockCatalogEntry[] | undefined,
): { blockId: string; name: string } | null {
    if (call.name !== "insert_block") return null;
    const blockId = typeof call.arguments.blockId === "string" ? call.arguments.blockId.trim() : "";
    if (!blockId) return null;
    const entry = findBlockEntry(catalog ?? [], blockId);
    return entry ? { blockId: entry.id, name: entry.name } : null;
}

/**
 * 连续两条同工具同参数的调用说明模型在原地打转。
 * 结果照旧返回，只在 toolResult 上追加提示，不额外消耗一轮。
 * 依赖 results 与 calls 一一对应——循环里每条调用恰好产出一个结果。
 */
function annotateDuplicates(calls: AIToolCall[], results: AgentToolResult[]): void {
    for (let index = 1; index < results.length; index += 1) {
        const current = results[index];
        const previous = results[index - 1];
        if (current.name !== previous.name) continue;
        const args = JSON.stringify(calls[index].arguments ?? {});
        if (args !== JSON.stringify(calls[index - 1].arguments ?? {})) continue;
        if (current.error) current.error += DUPLICATE_HINT;
        else current.summary = `${current.summary ?? ""}${DUPLICATE_HINT}`;
    }
}

/**
 * 在草稿上执行一轮工具调用。
 * 只读工具（画布状态、查询、测量、检查）直接回报结果；写工具先转换动作，
 * 再在草稿上计算结果，失败时把原因作为 toolResult 回传，让模型有机会修正
 * 而不是静默丢弃。
 */
export function applyToolCalls(
    calls: AIToolCall[],
    draft: AgentDraft,
    roundIndex = 0,
): RoundOutcome {
    const results: AgentToolResult[] = [];
    const viewRequests: AIViewRequest[] = [];
    let current = draft;
    let skipped = 0;
    let plan: PlanProposal | undefined;
    let variants: VariantProposal | undefined;

    for (const [index, call] of calls.entries()) {
        const toolCallId = call.id || `r${roundIndex}-call-${index}`;

        if (index >= MAX_TOOL_CALLS_PER_ROUND) {
            skipped += 1;
            results.push({
                toolCallId,
                name: call.name,
                ok: false,
                error: "本轮工具调用已达上限，请在下一轮继续",
            });
            continue;
        }

        if (call.name === PLAN_TOOL_NAME) {
            const proposal = parsePlanProposal(call.arguments);
            if (!proposal) {
                results.push({
                    toolCallId,
                    name: call.name,
                    ok: false,
                    error: "计划缺少 goal 或有效步骤",
                });
                continue;
            }
            plan ??= proposal;
            results.push({
                toolCallId,
                name: call.name,
                ok: true,
                summary: `计划：${proposal.goal}（${proposal.steps.length} 步）`,
            });
            continue;
        }

        if (call.name === VARIANTS_TOOL_NAME) {
            const proposal = parseVariantProposal(call.arguments);
            if (!proposal) {
                results.push({
                    toolCallId,
                    name: call.name,
                    ok: false,
                    error: "多方案需要 goal 与 2–3 个合法方案",
                });
                continue;
            }
            variants ??= proposal;
            results.push({
                toolCallId,
                name: call.name,
                ok: true,
                summary: `方案：${proposal.goal}（${proposal.variants.length} 个方案）`,
            });
            continue;
        }

        if (isReadOnlyTool(call.name)) {
            const outcome = executeReadOnlyTool(
                call,
                current,
                statsSummary(summarizeCanvas(current)),
            );
            results.push({
                toolCallId,
                name: call.name,
                ok: outcome.ok,
                summary: outcome.summary,
                error: outcome.error,
            });
            continue;
        }

        // 视图类工具只移动视口：不写画布、不进预览，也不占撤销步骤
        if (isViewTool(call.name)) {
            const request = toolCallToViewRequest(call, {
                elements: current.elements,
                selectedIds: current.selection,
            });
            if (!request) {
                results.push({
                    toolCallId,
                    name: call.name,
                    ok: false,
                    error:
                        call.arguments.ids !== undefined
                            ? "zoom_to_selection.ids 引用了画布上不存在的图元"
                            : "zoom_to_selection 没有可缩放的图元（请提供 ids 或先选中图元）",
                });
                continue;
            }
            viewRequests.push(request);
            results.push({
                toolCallId,
                name: call.name,
                ok: true,
                summary: request.summary,
            });
            continue;
        }

        const converted = toolCallToAction(call, {
            elements: current.elements,
            selectedIds: current.selection,
            blockCatalog: current.blocks,
            blocksUnavailable: current.blocksUnavailable,
        });
        // 失败原因由工具层给出具体字段名：通用文案只会让模型重复提交同样的错误
        if (converted.error) {
            results.push({ toolCallId, name: call.name, ok: false, error: converted.error });
            continue;
        }
        const action = converted.action;

        const before = current.elements;
        const selected = before.filter((element) => current.selection.includes(element.id));
        const outcome = computeAIActionOutcome(
            action.operation,
            action.elements,
            action.params,
            before,
            selected,
        );
        if (!outcome) {
            results.push({
                toolCallId,
                name: call.name,
                ok: false,
                error: `${action.operation} 无法应用到当前画布`,
            });
            continue;
        }

        const diff = classifyDiff(before, outcome.elements);
        const inserted = blockInsertionFromCall(call, current.blocks);
        current = {
            ...current,
            elements: outcome.elements,
            selection: outcome.selection ?? current.selection,
            actions: [...current.actions, action],
            blockInsertions: inserted
                ? [...current.blockInsertions, inserted]
                : current.blockInsertions,
        };
        results.push({
            toolCallId,
            name: call.name,
            ok: true,
            summary: describeChange(diff, outcome.elements.length),
            changedIds: diff.changed.slice(0, 50),
        });
    }

    annotateDuplicates(calls, results);

    return { draft: current, results, viewRequests, skipped, plan, variants };
}

/**
 * 文本 JSON 降级路径：模型不支持 Function Calling 时，正文里可能仍是旧版指令。
 * 解析不到合法 operation 时返回空数组，让调用方按"本轮无改动"处理。
 */
export function fallbackActionsFromText(text: string): AIActionResponse[] {
    const action = parseTextAIAction(text);
    return action?.operation ? [action] : [];
}
