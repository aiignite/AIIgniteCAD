/**
 * previewReview.ts — AI 预览的质量门禁
 *
 * 只报告「本次 AI 变更新引入」的确定性检查问题：应用前先跑一遍检查，
 * 与改动前的基线按稳定键对比，避免把图纸原有的问题算到本次变更头上。
 */

import type { CADElement } from "../types";
import {
    reviewDrawing,
    reviewIssueKey,
    type ReviewConventions,
    type ReviewIssue,
    type ReviewSeverity,
} from "./designReview";

export interface PreviewReview {
    /** 相比改动前新增的问题，按 错误 → 警告 → 提示 排序 */
    introduced: ReviewIssue[];
    /** 本次变更顺带解决掉的问题数量 */
    resolved: number;
    counts: Record<ReviewSeverity, number>;
    hasErrors: boolean;
}

const SEVERITY_ORDER: Record<ReviewSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
};

export function reviewPreview(
    before: readonly CADElement[],
    after: readonly CADElement[],
    conventions?: ReviewConventions,
): PreviewReview {
    const beforeKeys = new Set(reviewDrawing(before, { conventions }).map(reviewIssueKey));
    const afterIssues = reviewDrawing(after, { conventions });
    const afterKeys = new Set(afterIssues.map(reviewIssueKey));

    const introduced = afterIssues
        .filter((issue) => !beforeKeys.has(reviewIssueKey(issue)))
        .sort((a, b) => {
            const order = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
            return order !== 0 ? order : a.code.localeCompare(b.code);
        });

    const counts: Record<ReviewSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const issue of introduced) counts[issue.severity] += 1;

    let resolved = 0;
    for (const key of beforeKeys) {
        if (!afterKeys.has(key)) resolved += 1;
    }

    return {
        introduced,
        resolved,
        counts,
        hasErrors: counts.error > 0,
    };
}
