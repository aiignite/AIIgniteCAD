/**
 * aiPlan.ts — 计划模式的数据结构、触发条件与执行转换
 *
 * 模型在计划模式下只允许调用只读工具与 propose_plan。计划里的写步骤必须
 * 带真实工具名与参数；用户确认后由前端按步骤执行，仍走一次预览与单步撤销。
 */

import type { AIToolCall } from "../types";
import { isAIToolName, isReadOnlyTool, isViewTool } from "./aiTools";

export const PLAN_TOOL_NAME = "propose_plan";
export const MAX_PLAN_STEPS = 12;
export const MAX_PLAN_LIST = 8;

export interface PlanStep {
    title: string;
    detail?: string;
    tool?: string;
    arguments?: Record<string, unknown>;
}

export interface PlanProposal {
    goal: string;
    assumptions: string[];
    steps: PlanStep[];
    checks: string[];
    risks: string[];
}

export type PlanStatus = "pending" | "approved" | "dismissed" | "failed";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number): string =>
    typeof value === "string" ? value.trim().slice(0, max) : "";

const textList = (value: unknown, maxItems: number, maxLength: number): string[] =>
    Array.isArray(value)
        ? value
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim().slice(0, maxLength))
              .filter(Boolean)
              .slice(0, maxItems)
        : [];

export function parsePlanProposal(args: unknown): PlanProposal | null {
    if (!isPlainObject(args)) return null;
    const goal = text(args.goal, 300);
    if (!goal || !Array.isArray(args.steps) || args.steps.length === 0) return null;

    const steps: PlanStep[] = [];
    for (const raw of args.steps.slice(0, MAX_PLAN_STEPS)) {
        if (!isPlainObject(raw)) continue;
        const title = text(raw.title, 120);
        if (!title) continue;
        const tool = text(raw.tool, 64);
        const step: PlanStep = { title };
        const detail = text(raw.detail, 300);
        if (detail) step.detail = detail;
        if (tool) step.tool = tool;
        if (isPlainObject(raw.arguments)) {
            const serialized = JSON.stringify(raw.arguments);
            if (serialized.length <= 5000) step.arguments = raw.arguments;
        }
        steps.push(step);
    }
    if (steps.length === 0) return null;

    return {
        goal,
        assumptions: textList(args.assumptions, MAX_PLAN_LIST, 200),
        steps,
        checks: textList(args.checks, MAX_PLAN_LIST, 200),
        risks: textList(args.risks, MAX_PLAN_LIST, 200),
    };
}

/** 计划中的写步骤转换为草稿上的工具调用；只读/视图步骤不参与落图 */
export function planToToolCalls(plan: PlanProposal): AIToolCall[] {
    return plan.steps.flatMap((step, index) => {
        if (!step.tool || !isAIToolName(step.tool)) return [];
        if (isReadOnlyTool(step.tool) || isViewTool(step.tool)) return [];
        return [
            {
                id: `plan-${index}-${step.tool}`,
                name: step.tool,
                arguments: step.arguments ?? {},
            },
        ];
    });
}

const OPERATION_PATTERNS = [
    /(画|绘制|生成|添加|创建|插入)/,
    /(移动|旋转|复制|镜像|缩放|偏移|阵列|对齐|分布|删除|修改)/,
    /(标注|尺寸|文字)/,
    /(检查|测量|分析|优化|整理)/,
];

/**
 * 复杂请求才进入计划模式：显式规划、跨 3 类操作，或大图上的整理任务。
 * 单步绘图/编辑仍走直接执行，避免多一次确认。
 */
export function shouldProposePlan(
    message: string,
    input: { elementCount: number; selectedCount: number },
): boolean {
    const content = message.trim();
    if (!content) return false;
    if (/(规划|计划|方案|布局|帮我设计|设计一个|设计一下|排布方案)/.test(content)) {
        return true;
    }
    const operations = OPERATION_PATTERNS.filter((pattern) => pattern.test(content)).length;
    if (operations >= 3) return true;
    return (
        input.elementCount >= 80 &&
        input.selectedCount >= 3 &&
        /(整理|优化|布局|排布|调整)/.test(content)
    );
}
