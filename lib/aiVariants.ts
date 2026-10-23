/**
 * aiVariants.ts — 多方案提案的解析与执行转换
 *
 * 模型在 variants 模式只返回 propose_variants；每个方案携带与计划相同的
 * 工具+参数步骤。用户选定一个方案后，前端在草稿上执行并走一次预览。
 */

import type { AIToolCall } from "../types";
import { parsePlanProposal, planToToolCalls, type PlanStep } from "./aiPlan";

export const VARIANTS_TOOL_NAME = "propose_variants";
export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 3;
export const MAX_VARIANT_NAME = 60;
export const MAX_VARIANT_SUMMARY = 200;

export interface DesignVariant {
    name: string;
    summary?: string;
    steps: PlanStep[];
}

export interface VariantProposal {
    goal: string;
    variants: DesignVariant[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export function parseVariantProposal(args: unknown): VariantProposal | null {
    if (!isPlainObject(args)) return null;
    const goal = typeof args.goal === "string" ? args.goal.trim().slice(0, 300) : "";
    if (!goal || !Array.isArray(args.variants)) return null;
    if (args.variants.length < MIN_VARIANTS || args.variants.length > MAX_VARIANTS) {
        return null;
    }

    const variants: DesignVariant[] = [];
    const seen = new Set<string>();
    for (const raw of args.variants) {
        if (!isPlainObject(raw)) return null;
        const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_VARIANT_NAME) : "";
        if (!name || seen.has(name)) return null;
        const summary =
            typeof raw.summary === "string" ? raw.summary.trim().slice(0, MAX_VARIANT_SUMMARY) : "";
        // 复用计划步骤解析：标题必填、工具与参数有体积上限
        const plan = parsePlanProposal({ goal: name, steps: raw.steps });
        if (!plan) return null;
        seen.add(name);
        variants.push({
            name,
            ...(summary ? { summary } : {}),
            steps: plan.steps,
        });
    }

    return { goal, variants };
}

/** 方案中的写步骤转换为草稿工具调用；只读/视图/未知工具被过滤 */
export function variantToToolCalls(variant: DesignVariant): AIToolCall[] {
    return planToToolCalls({
        goal: variant.name,
        assumptions: [],
        checks: [],
        risks: [],
        steps: variant.steps,
    });
}

/** 明确要求比较方案时才进入 variants 模式，普通“方案”措辞仍走计划模式 */
export function shouldProposeVariants(message: string): boolean {
    return /(多方案|多个方案|几个方案|备选方案|方案对比|对比方案|不同方案|alternative|variants)/i.test(
        message,
    );
}
