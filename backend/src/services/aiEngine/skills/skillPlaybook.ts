/**
 * skillPlaybook.ts — 技能剧本的结构与解析
 *
 * 技能从"提示词片段"升级为"可执行剧本"：步骤给出执行顺序，检查清单给出
 * 完成条件，requiredContext 声明路由所需的设计信号。所有字段在读取时收窄，
 * 兼容早期只有 promptTemplate 的技能行。
 */

import { Prisma } from "@prisma/client";

export const MAX_SKILL_STEPS = 8;
export const MAX_SKILL_CHECKS = 10;
export const MAX_SKILL_EXAMPLES = 5;
export const MAX_SKILL_CONTEXT_SIGNALS = 5;

export const SKILL_CONTEXT_SIGNALS = [
  "selection",
  "layers",
  "blocks",
  "revision",
  "dimensions",
] as const;

export type SkillContextSignal = (typeof SKILL_CONTEXT_SIGNALS)[number];

export interface SkillStep {
  title: string;
  detail?: string;
  tool?: string;
}

const isSignal = (value: unknown): value is SkillContextSignal =>
  typeof value === "string" &&
  (SKILL_CONTEXT_SIGNALS as readonly string[]).includes(value);

export function parseSkillSteps(value: Prisma.JsonValue | null | undefined): SkillStep[] {
  if (!Array.isArray(value)) return [];
  const steps: SkillStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as { title?: unknown; detail?: unknown; tool?: unknown };
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) continue;
    steps.push({
      title: raw.title.trim().slice(0, 80),
      detail: typeof raw.detail === "string" ? raw.detail.trim().slice(0, 300) : undefined,
      tool: typeof raw.tool === "string" ? raw.tool.slice(0, 64) : undefined,
    });
    if (steps.length >= MAX_SKILL_STEPS) break;
  }
  return steps;
}

export function parseSkillStrings(
  value: Prisma.JsonValue | null | undefined,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, maxLength))
    .slice(0, maxItems);
}

export function parseSkillContextSignals(
  value: Prisma.JsonValue | null | undefined,
): SkillContextSignal[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isSignal))).slice(0, MAX_SKILL_CONTEXT_SIGNALS);
}

/** 序列化为 Prisma Json 字段，空数组写入 null 以减小存储 */
export function toSkillJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  if (Array.isArray(value) && value.length === 0) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}
