/**
 * skillService.ts — 技能装载与内置技能幂等写入
 *
 * 内置技能随代码版本演进，因此在首次需要时 upsert 到 ai_skills；
 * 更新只覆盖系统技能自身字段，保留用户的启停偏好与克隆出来的自建技能。
 */

import { AiSkill, Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { logger } from "../../../lib/logger";
import { metrics } from "../../../lib/metrics";
import { BUILTIN_SKILLS } from "./builtinSkills";
import {
  parseSkillContextSignals,
  parseSkillSteps,
  parseSkillStrings,
  type SkillContextSignal,
  type SkillStep,
} from "./skillPlaybook";

/** 技能路由使用的扁平结构，避免把 Prisma Json 字段带进打分逻辑 */
export interface SkillCandidate {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  promptTemplate: string;
  toolNames: string[] | null;
  keywords: string[];
  selectionTypes: string[];
  priority: number;
  isSystem: boolean;
  steps: SkillStep[];
  checks: string[];
  examples: string[];
  requiredContext: SkillContextSignal[];
  negativeKeywords: string[];
  version: number;
}

const stringList = (value: Prisma.JsonValue | null | undefined): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
};

export function toSkillCandidate(row: AiSkill): SkillCandidate {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    promptTemplate: row.promptTemplate,
    toolNames: row.toolNames === null || row.toolNames === undefined
      ? null
      : stringList(row.toolNames as Prisma.JsonValue),
    keywords: stringList(row.keywords as Prisma.JsonValue),
    selectionTypes: stringList(row.selectionTypes as Prisma.JsonValue),
    priority: row.priority,
    isSystem: row.isSystem,
    steps: parseSkillSteps(row.steps),
    checks: parseSkillStrings(row.checks, 10, 200),
    examples: parseSkillStrings(row.examples, 5, 240),
    requiredContext: parseSkillContextSignals(row.requiredContext),
    negativeKeywords: parseSkillStrings(row.negativeKeywords, 16, 32),
    version: row.version,
  };
}

/** upsert 节流窗口：避免每个请求都写库 */
const ENSURE_TTL_MS = 10 * 60_000;
let lastEnsuredAt = 0;
let inflight: Promise<number> | null = null;

export async function ensureSystemSkills(force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - lastEnsuredAt < ENSURE_TTL_MS) return 0;
  if (inflight) return inflight;

  inflight = (async () => {
    let touched = 0;
    for (const seed of BUILTIN_SKILLS) {
      const data = {
        name: seed.name,
        description: seed.description,
        category: seed.category,
        promptTemplate: seed.promptTemplate,
        toolNames: seed.toolNames as unknown as Prisma.InputJsonValue,
        keywords: seed.keywords as unknown as Prisma.InputJsonValue,
        selectionTypes: seed.selectionTypes as unknown as Prisma.InputJsonValue,
        steps: seed.steps as unknown as Prisma.InputJsonValue,
        checks: seed.checks as unknown as Prisma.InputJsonValue,
        examples: seed.examples as unknown as Prisma.InputJsonValue,
        requiredContext: seed.requiredContext as unknown as Prisma.InputJsonValue,
        negativeKeywords: seed.negativeKeywords as unknown as Prisma.InputJsonValue,
        priority: seed.priority,
        isSystem: true,
        userId: null,
      };
      await prisma.aiSkill.upsert({
        where: { code: seed.code },
        create: { ...data, code: seed.code, isEnabled: true },
        // 不覆盖 isEnabled：用户关掉的内置技能应保持关闭
        update: data,
      });
      touched += 1;
    }
    lastEnsuredAt = now;
    metrics.increment("ai.skills_seeded", touched);
    logger.info("System skills ensured", { count: touched });
    return touched;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** 当前用户可见的启用技能：系统技能 + 自建技能 */
export async function loadEnabledSkills(userId: string): Promise<SkillCandidate[]> {
  const rows = await prisma.aiSkill.findMany({
    where: {
      isEnabled: true,
      OR: [{ userId: null }, { userId }],
    },
  });
  return rows.map(toSkillCandidate);
}
