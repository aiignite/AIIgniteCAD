/**
 * planReview.ts — 计划预检（约定 ↔ 计划联动）
 *
 * 计划确认前，按当前选择集把写步骤逐步在草稿上模拟执行，
 * 再用与预览门禁相同的确定性检查对比改动前后，得出「这份计划会引入哪些问题」，
 * 并按 changedIds 把问题归因到具体步骤。
 *
 * 只模拟、不落图：预检不会写画布，也不会占用撤销步。
 */

import type { CADElement } from "../types";
import type { BlockCatalogResult } from "./blockCatalog";
import { applyToolCalls, createDraft, type AgentDraft } from "./aiAgentLoop";
import type { PlanProposal } from "./aiPlan";
import { isAIToolName, isReadOnlyTool, isViewTool } from "./aiTools";
import { reviewPreview } from "./previewReview";
import type {
    ReviewConventions,
    ReviewIssue,
    ReviewLocale,
    ReviewSeverity,
} from "./designReview";
import { reviewIssueKey } from "./designReview";

export type PlanStepKind = "write" | "readonly" | "view" | "no-tool" | "unknown-tool";

export interface PlanStepReview {
    index: number;
    title: string;
    tool?: string;
    kind: PlanStepKind;
    /** 该步骤实际改动的图元 id */
    changedIds: string[];
    /** 该步骤引入的问题（按 changedIds 归因） */
    introduced: ReviewIssue[];
    error?: string;
}

export interface PlanPreflight {
    steps: PlanStepReview[];
    /** 整份计划引入的问题，按 错误 → 警告 → 提示 排序 */
    introduced: ReviewIssue[];
    /** 顺带解决的问题数量 */
    resolved: number;
    counts: Record<ReviewSeverity, number>;
    hasErrors: boolean;
    /** 去重后的受影响图元数量 */
    changedCount: number;
    /** 成功模拟的写步骤数 */
    writtenSteps: number;
    /** 模拟失败的写步骤数 */
    failedSteps: number;
}

export interface PlanPreflightInput {
    elements: CADElement[];
    selectedIds?: readonly string[];
    blocks?: BlockCatalogResult;
    conventions?: ReviewConventions;
    proposal: PlanProposal;
    locale?: ReviewLocale;
}

const EMPTY_CATALOG: BlockCatalogResult = { entries: [], ok: true };

/**
 * 计划步骤分类。只读与视图步骤不写画布，预检时跳过但不计为失败，
 * 否则「先检查再修改」这类计划会被误报成有失败步骤。
 */
export function planStepKind(tool: string | undefined): PlanStepKind {
    if (!tool) return "no-tool";
    if (isReadOnlyTool(tool)) return "readonly";
    if (isViewTool(tool)) return "view";
    if (!isAIToolName(tool)) return "unknown-tool";
    return "write";
}

/** 问题归因：与步骤改动图元有交集才算这一步引入的 */
function attributeIssues(
    issues: readonly ReviewIssue[],
    changedIds: ReadonlySet<string>,
): ReviewIssue[] {
    if (changedIds.size === 0) return [];
    return issues.filter((issue) =>
        issue.elementIds.some((id) => changedIds.has(id)),
    );
}

export function preflightPlan(input: PlanPreflightInput): PlanPreflight {
    const {
        elements,
        selectedIds = [],
        blocks = EMPTY_CATALOG,
        conventions,
        proposal,
        locale = "zh",
    } = input;

    let draft: AgentDraft = createDraft(elements, [...selectedIds], blocks, conventions);
    const steps: PlanStepReview[] = [];
    const allChanged = new Set<string>();
    let writtenSteps = 0;
    let failedSteps = 0;

    for (const [index, step] of proposal.steps.entries()) {
        const kind = planStepKind(step.tool);
        if (kind !== "write") {
            steps.push({
                index,
                title: step.title,
                tool: step.tool,
                kind,
                changedIds: [],
                introduced: [],
                error: kind === "unknown-tool" ? `未知工具 ${step.tool}` : undefined,
            });
            if (kind === "unknown-tool") failedSteps += 1;
            continue;
        }

        // 每一步单独应用：中间草稿既保留前序结果，又能拿到这一步自己的 changedIds
        const outcome = applyToolCalls(
            [
                {
                    id: `preflight-${index}-${step.tool}`,
                    name: step.tool!,
                    arguments: step.arguments ?? {},
                },
            ],
            draft,
        );
        const result = outcome.results[0];
        draft = outcome.draft;
        const changedIds = result?.changedIds ?? [];
        for (const id of changedIds) allChanged.add(id);
        if (result?.ok) writtenSteps += 1;
        else failedSteps += 1;
        steps.push({
            index,
            title: step.title,
            tool: step.tool,
            kind,
            changedIds,
            introduced: [],
            error: result?.ok ? undefined : result?.error ?? "无法应用到当前画布",
        });
    }

    const review = reviewPreview(elements, draft.elements, conventions, locale);

    // 归因只做一次集合求交；同一个问题只算在最先引入它的步骤上
    const attributed = new Set<string>();
    for (const step of steps) {
        if (step.kind !== "write" || step.changedIds.length === 0) continue;
        step.introduced = attributeIssues(review.introduced, new Set(step.changedIds)).filter(
            (issue) => {
                const key = reviewIssueKey(issue);
                if (attributed.has(key)) return false;
                attributed.add(key);
                return true;
            },
        );
    }

    return {
        steps,
        introduced: review.introduced,
        resolved: review.resolved,
        counts: review.counts,
        hasErrors: review.hasErrors,
        changedCount: allChanged.size,
        writtenSteps,
        failedSteps,
    };
}

/** 计划卡上的一行摘要 */
export function summarizePreflight(
    preflight: PlanPreflight,
    locale: ReviewLocale = "zh",
): string {
    const { counts } = preflight;
    if (preflight.introduced.length === 0) {
        return locale === "zh"
            ? `预检通过：改动 ${preflight.changedCount} 个图元，未引入检查问题`
            : `Preflight passed: ${preflight.changedCount} elements changed, no new issues`;
    }
    const parts = [
        counts.error > 0 ? (locale === "zh" ? `错误 ${counts.error}` : `errors ${counts.error}`) : null,
        counts.warning > 0
            ? locale === "zh"
                ? `警告 ${counts.warning}`
                : `warnings ${counts.warning}`
            : null,
        counts.info > 0 ? (locale === "zh" ? `提示 ${counts.info}` : `info ${counts.info}`) : null,
    ].filter(Boolean);
    return locale === "zh"
        ? `预检：将引入 ${parts.join(" / ")}（改动 ${preflight.changedCount} 个图元）`
        : `Preflight: introduces ${parts.join(" / ")} (${preflight.changedCount} elements changed)`;
}
