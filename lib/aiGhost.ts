/**
 * aiGhost.ts — AI 预览在真实画布上的幽灵层计划
 *
 * 弹窗缩略图看不出结果落在图纸何处，因此把差异换算成"现状将消失"与"提议结果"两组图元，
 * 交给画布渲染层叠加。纯计算，不写 store，确认后仍走一次 commitAction。
 */

import type { CADElement } from "../types";
import { diffElementSets } from "./versionDiff";

export interface AIGhostPlan {
    /** 现状中会被删除或替换的图元 id，真实图层不再绘制它们 */
    outgoingIds: Set<string>;
    /** 现状中将被删除或替换的图元（红色虚线） */
    outgoing: CADElement[];
    /** 新增图元与修改后的结果（紫色虚线） */
    incoming: CADElement[];
}

export function planAIGhostPreview(before: CADElement[], after: CADElement[]): AIGhostPlan {
    const diff = diffElementSets(before, after);
    const modifiedBefore = diff.modified.map((entry) => entry.before);
    const modifiedAfter = diff.modified.map((entry) => entry.after);
    const outgoing = [...diff.removed, ...modifiedBefore];

    return {
        outgoingIds: new Set(outgoing.map((element) => element.id)),
        outgoing,
        incoming: [...diff.added, ...modifiedAfter],
    };
}

/** 幽灵层视觉语言：紫色=提议结果，红色=将被移除，与选中黄、预选浅蓝区分 */
export const AI_GHOST_COLORS = {
    incoming: "#a78bfa",
    outgoing: "#f87171",
} as const;
