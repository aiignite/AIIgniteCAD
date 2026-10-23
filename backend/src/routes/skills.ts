/**
 * skills.ts — 技能管理（系统技能只读，自建技能可增删改）
 *
 * 系统技能由 builtinSkills 种子写入，用户只能克隆后修改；
 * toolNames / keywords / selectionTypes 都参与服务端路由打分，因此这里做同样的
 * 长度与取值校验，避免一个坏技能把提示词预算吃光或让工具白名单失效。
 */

import { Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { body, matchedData, param } from "express-validator";
import { prisma } from "../lib/prisma";
import { AuthRequest, authenticate } from "../middleware/auth";
import { skillRateLimit } from "../middleware/rateLimit";
import { logger } from "../lib/logger";
import { hasValidationError } from "../lib/httpValidation";
import { metrics } from "../lib/metrics";
import { CAD_TOOL_DEFINITIONS } from "../services/aiEngine/tools";
import {
  MAX_SKILL_CHECKS,
  MAX_SKILL_CONTEXT_SIGNALS,
  MAX_SKILL_EXAMPLES,
  MAX_SKILL_STEPS,
  SKILL_CONTEXT_SIGNALS,
  parseSkillContextSignals,
  parseSkillSteps,
  parseSkillStrings,
  toSkillJson,
  type SkillContextSignal,
} from "../services/aiEngine/skills/skillPlaybook";
import { ensureSystemSkills, loadEnabledSkills } from "../services/aiEngine/skills/skillService";
import { resolveCandidates } from "../services/aiEngine/skills/skillRouter";

const router = Router();

router.use(authenticate);
// 限流放在鉴权之后，才能按用户而不是 IP 计数；统计接口会扫描消息表，因此读写同限
router.use(skillRateLimit());

const TOOL_NAMES = CAD_TOOL_DEFINITIONS.map((tool) => tool.name);
const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;

const serialize = (row: {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  promptTemplate: string;
  toolNames: Prisma.JsonValue;
  keywords: Prisma.JsonValue;
  selectionTypes: Prisma.JsonValue;
  steps?: Prisma.JsonValue | null;
  checks?: Prisma.JsonValue | null;
  examples?: Prisma.JsonValue | null;
  requiredContext?: Prisma.JsonValue | null;
  negativeKeywords?: Prisma.JsonValue | null;
  version?: number;
  priority: number;
  isEnabled: boolean;
  isSystem: boolean;
  userId: string | null;
  updatedAt?: Date;
}) => {
  const strings = (value: Prisma.JsonValue): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    promptTemplate: row.promptTemplate,
    toolNames: strings(row.toolNames),
    selectionTypes: strings(row.selectionTypes),
    keywords: strings(row.keywords),
    steps: parseSkillSteps(row.steps),
    checks: parseSkillStrings(row.checks, MAX_SKILL_CHECKS, 200),
    examples: parseSkillStrings(row.examples, MAX_SKILL_EXAMPLES, 240),
    requiredContext: parseSkillContextSignals(row.requiredContext),
    negativeKeywords: parseSkillStrings(row.negativeKeywords, 16, 32),
    version: row.version ?? 1,
    priority: row.priority,
    isEnabled: row.isEnabled,
    isSystem: row.isSystem,
    userId: row.userId,
    updatedAt: row.updatedAt,
  };
};

/**
 * 这里的条数与长度上限对应前端 lib/skillValidation.ts 的 SKILL_LIMITS。
 * 两端不共享包，改任何一边都必须同步另一边，否则编辑器放行的技能会在服务端 400。
 */
const skillBody = [
  body("name").isString().withMessage("name must be a string").bail().trim().notEmpty()
    .withMessage("name is required").isLength({ max: 80 }).withMessage("name is too long"),
  body("description").optional().isString().isLength({ max: 300 }),
  body("category").optional().isString().isLength({ max: 40 }),
  body("code").optional().matches(CODE_PATTERN).withMessage("code must match ^[a-z0-9][a-z0-9_-]{2,63}$"),
  body("promptTemplate")
    .isString()
    .withMessage("promptTemplate must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("promptTemplate is required")
    .isLength({ max: 4000 })
    .withMessage("promptTemplate must be at most 4000 characters"),
  body("toolNames")
    .optional()
    .isArray({ max: TOOL_NAMES.length })
    .withMessage("toolNames must be an array of tool names")
    .bail()
    .custom((values: unknown) => {
      const invalid = (values as unknown[]).filter((value) => !TOOL_NAMES.includes(value as string));
      if (invalid.length > 0) throw new Error(`unknown tools: ${invalid.join(", ")}`);
      return true;
    }),
  body("keywords").optional().isArray({ max: 24 }).withMessage("keywords must be an array").bail()
    .custom((values: unknown) => {
      for (const value of values as unknown[]) {
        if (typeof value !== "string" || value.trim().length === 0 || value.length > 32) {
          throw new Error("keywords must be non-empty strings of at most 32 characters");
        }
      }
      return true;
    }),
  body("selectionTypes")
    .optional()
    .isArray({ max: 16 })
    .withMessage("selectionTypes must be an array")
    .bail()
    .custom((values: unknown) => {
      for (const value of values as unknown[]) {
        if (typeof value !== "string" || value.trim().length === 0 || value.length > 32) {
          throw new Error("selectionTypes must be non-empty strings of at most 32 characters");
        }
      }
      return true;
    }),
  body("priority").optional().isInt({ min: 0, max: 200 }).withMessage("priority must be between 0 and 200"),
  body("steps")
    .optional()
    .isArray({ max: MAX_SKILL_STEPS })
    .withMessage(`steps must be an array of at most ${MAX_SKILL_STEPS} items`)
    .bail()
    .custom((values: unknown) => {
      for (const value of values as unknown[]) {
        const item = value as { title?: unknown; detail?: unknown; tool?: unknown };
        if (!item || typeof item !== "object" || typeof item.title !== "string") {
          throw new Error("each step needs a title");
        }
        if (item.title.length > 80) throw new Error("step title is too long");
        if (item.detail !== undefined && (typeof item.detail !== "string" || item.detail.length > 300)) {
          throw new Error("step detail must be at most 300 characters");
        }
        if (item.tool !== undefined && (typeof item.tool !== "string" || item.tool.length > 64)) {
          throw new Error("step tool must be at most 64 characters");
        }
        // 步骤引用的工具必须是真实存在的工具名，否则模型会照着不存在的工具名编造流程
        if (typeof item.tool === "string" && item.tool.trim().length > 0) {
          const tool = item.tool.trim();
          if (!TOOL_NAMES.includes(tool)) throw new Error(`unknown step tool: ${tool}`);
        }
      }
      return true;
    }),
  body("checks")
    .optional()
    .isArray({ max: MAX_SKILL_CHECKS })
    .withMessage(`checks must be an array of at most ${MAX_SKILL_CHECKS} items`)
    .bail()
    .custom((values: unknown) => {
      for (const value of values as unknown[]) {
        if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
          throw new Error("checks must be non-empty strings of at most 200 characters");
        }
      }
      return true;
    }),
  body("examples")
    .optional()
    .isArray({ max: MAX_SKILL_EXAMPLES })
    .withMessage(`examples must be an array of at most ${MAX_SKILL_EXAMPLES} items`)
    .bail()
    .custom((values: unknown) => {
      for (const value of values as unknown[]) {
        if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
          throw new Error("examples must be non-empty strings of at most 240 characters");
        }
      }
      return true;
    }),
  body("requiredContext")
    .optional()
    .isArray({ max: MAX_SKILL_CONTEXT_SIGNALS })
    .withMessage("requiredContext must be an array")
    .bail()
    .custom((values: unknown) => {
      for (const value of values as unknown[]) {
        if (!(SKILL_CONTEXT_SIGNALS as readonly unknown[]).includes(value)) {
          throw new Error(`unknown context signal: ${String(value)}`);
        }
      }
      return true;
    }),
  body("negativeKeywords").optional().isArray({ max: 16 }).bail().custom((values: unknown) => {
    for (const value of values as unknown[]) {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > 32) {
        throw new Error("negativeKeywords must be non-empty strings of at most 32 characters");
      }
    }
    return true;
  }),
  body("isEnabled").optional().isBoolean(),
];

const idParam = param("id").isString().notEmpty();

/**
 * 候选解析与 actual 激活共用同一套打分，前端只负责展示与选择；
 * 这样「推荐看到的技能」和「本轮真正注入的技能」不会出现两套规则。
 */
const resolveValidation = [
  body("message").optional().isString().isLength({ max: 32000 }),
  body("assistantId").optional({ nullable: true }).isString().isLength({ max: 128 }),
  body("pinnedSkillCodes").optional().isArray({ max: 5 }),
  body("pinnedSkillCodes.*").optional().isString().isLength({ max: 64 }),
  body("recentSkillCodes").optional().isArray({ max: 8 }),
  body("recentSkillCodes.*").optional().isString().isLength({ max: 64 }),
  body("historyTexts").optional().isArray({ max: 3 }),
  body("historyTexts.*").optional().isString().isLength({ max: 4000 }),
  body("selectionTypes").optional().isArray({ max: 32 }),
  body("selectionTypes.*").optional().isString().isLength({ max: 32 }),
  body("contextSignals").optional().isArray({ max: MAX_SKILL_CONTEXT_SIGNALS }),
  body("contextSignals.*")
    .optional()
    .custom((value: unknown) => (SKILL_CONTEXT_SIGNALS as readonly unknown[]).includes(value)),
];

const jsonList = (values: unknown): Prisma.InputJsonValue =>
  (Array.isArray(values) ? values : []) as unknown as Prisma.InputJsonValue;

/** 当前用户可写的技能行；系统技能只读，他人技能按不存在处理避免探测 id */
async function findEditable(id: string, userId: string, res: Response) {
  const row = await prisma.aiSkill.findFirst({ where: { id } });
  if (!row || (row.userId !== null && row.userId !== userId)) {
    res.status(404).json({ error: "Not Found", message: "Skill not found" });
    return null;
  }
  if (row.isSystem) {
    res
      .status(403)
      .json({ error: "READ_ONLY", message: "系统技能只读，请先克隆为自建技能", code: "READ_ONLY" });
    return null;
  }
  return row;
}

router.post("/resolve", resolveValidation, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    await ensureSystemSkills().catch((error) => logger.warn("Seed system skills failed", { error }));
    const [skills, assistant] = await Promise.all([
      loadEnabledSkills(userId),
      req.body.assistantId
        ? prisma.assistant.findFirst({
            where: { id: String(req.body.assistantId), userId },
            include: { skills: true },
          })
        : Promise.resolve(null),
    ]);
    const bindings =
      assistant?.skills.map((binding) => ({
        skillId: binding.skillId,
        weight: binding.weight,
      })) ?? [];
    const strings = (value: unknown, max: number): string[] =>
      (Array.isArray(value) ? value : [])
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, max);
    const contextSignals = strings(req.body.contextSignals, MAX_SKILL_CONTEXT_SIGNALS).filter(
      (value): value is SkillContextSignal =>
        (SKILL_CONTEXT_SIGNALS as readonly string[]).includes(value),
    );

    const candidates = resolveCandidates(
      {
        skills,
        message: String(req.body.message ?? ""),
        selectionTypes: strings(req.body.selectionTypes, 32),
        pinnedSkillCodes: strings(req.body.pinnedSkillCodes, 5),
        recentSkillCodes: strings(req.body.recentSkillCodes, 8),
        historyTexts: strings(req.body.historyTexts, 3),
        contextSignals,
        bindings,
      },
      8,
    );

    return res.json({
      matchedSkills: candidates.map((skill) => ({
        code: skill.code,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        score: skill.score,
        reasons: skill.reasons,
        tools: skill.toolNames ?? [],
        version: skill.version,
      })),
    });
  } catch (error) {
    logger.error("Resolve skills failed", { userId: req.user!.id, error });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to resolve skills",
    });
  }
});

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    await ensureSystemSkills().catch((error) => logger.warn("Seed system skills failed", { error }));
    const rows = await prisma.aiSkill.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      orderBy: [{ isSystem: "desc" }, { priority: "asc" }, { name: "asc" }],
    });
    return res.json({ skills: rows.map(serialize) });
  } catch (error) {
    logger.error("List skills failed", { userId: req.user!.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to list skills" });
  }
});

/**
 * 技能有用率与采纳率：
 * - 有用率来自助手消息上的用户反馈（up/down），未评价的消息不参与统计；
 * - 采纳率来自回合回执（applied/discarded），回执写在用户消息上。
 */
router.get("/stats", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const parsedDays = Number(req.query.days);
    const days = Number.isFinite(parsedDays)
      ? Math.min(365, Math.max(1, Math.trunc(parsedDays)))
      : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.chatMessage.findMany({
      where: {
        senderType: "ai",
        createdAt: { gte: since },
        session: { userId },
      },
      select: { metadata: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const outcomeRows = await prisma.chatMessage.findMany({
      where: {
        senderType: "user",
        createdAt: { gte: since },
        session: { userId },
      },
      select: { metadata: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const bySkill = new Map<string, { up: number; down: number; applied: number; discarded: number }>();
    const ensure = (code: string) => {
      const existing = bySkill.get(code);
      if (existing) return existing;
      const created = { up: 0, down: 0, applied: 0, discarded: 0 };
      bySkill.set(code, created);
      return created;
    };

    let rated = 0;
    for (const row of rows) {
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const feedback =
        metadata.feedback && typeof metadata.feedback === "object"
          ? (metadata.feedback as Record<string, unknown>)
          : null;
      const rating = feedback?.rating;
      if (rating !== "up" && rating !== "down") continue;
      rated += 1;

      const codes = Array.isArray(metadata.feedbackSkillCodes)
        ? (metadata.feedbackSkillCodes as unknown[]).filter(
            (code): code is string => typeof code === "string" && code.length > 0,
          )
        : [];
      for (const code of codes) {
        const entry = ensure(code);
        if (rating === "up") entry.up += 1;
        else entry.down += 1;
      }
    }

    let decided = 0;
    for (const row of outcomeRows) {
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const outcome = metadata.outcome;
      if (outcome !== "applied" && outcome !== "discarded") continue;
      decided += 1;

      const codes = Array.isArray(metadata.skillCodes)
        ? (metadata.skillCodes as unknown[]).filter(
            (code): code is string => typeof code === "string" && code.length > 0,
          )
        : [];
      for (const code of codes) {
        const entry = ensure(code);
        if (outcome === "applied") entry.applied += 1;
        else entry.discarded += 1;
      }
    }

    const skills = [...bySkill.entries()]
      .map(([code, counts]) => {
        const total = counts.up + counts.down;
        const decidedCount = counts.applied + counts.discarded;
        return {
          code,
          up: counts.up,
          down: counts.down,
          total,
          helpfulRate: total > 0 ? Math.round((counts.up / total) * 100) / 100 : 0,
          applied: counts.applied,
          discarded: counts.discarded,
          adoptionRate:
            decidedCount > 0 ? Math.round((counts.applied / decidedCount) * 100) / 100 : 0,
        };
      })
      .sort((a, b) => b.total + b.applied + b.discarded - (a.total + a.applied + a.discarded));

    return res.json({ days, rated, decided, skills });
  } catch (error) {
    logger.error("Skill stats failed", { userId: req.user!.id, error });
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "Failed to load skill stats" });
  }
});

router.post("/", skillBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const fields = matchedData(req) as Record<string, any>;
    const code =
      typeof fields.code === "string" && fields.code
        ? fields.code
        : `user-${userId.slice(0, 8)}-${Date.now().toString(36)}`;

    const clash = await prisma.aiSkill.findUnique({ where: { code } });
    if (clash) {
      return res.status(409).json({ error: "CODE_TAKEN", message: "技能代码已存在", code: "CODE_TAKEN" });
    }

    const created = await prisma.aiSkill.create({
      data: {
        userId,
        code,
        name: fields.name,
        description: fields.description ?? "",
        category: fields.category ?? "Custom",
        promptTemplate: fields.promptTemplate,
        toolNames: fields.toolNames === undefined ? Prisma.DbNull : jsonList(fields.toolNames),
        keywords: jsonList(fields.keywords ?? []),
        selectionTypes: jsonList(fields.selectionTypes ?? []),
        steps: toSkillJson(fields.steps),
        checks: toSkillJson(fields.checks),
        examples: toSkillJson(fields.examples),
        requiredContext: toSkillJson(fields.requiredContext),
        negativeKeywords: toSkillJson(fields.negativeKeywords),
        priority: fields.priority ?? 50,
        isEnabled: fields.isEnabled ?? true,
        isSystem: false,
      },
    });

    metrics.increment("ai.skills_created");
    return res.status(201).json({ message: "Skill created", skill: serialize(created) });
  } catch (error) {
    logger.error("Create skill failed", { userId: req.user!.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to create skill" });
  }
});

router.put("/:id", idParam, skillBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const existing = await findEditable(req.params.id, req.user!.id, res);
    if (!existing) return;

    const fields = matchedData(req) as Record<string, any>;
    const updated = await prisma.aiSkill.update({
      where: { id: existing.id },
      data: {
        name: fields.name,
        description: fields.description,
        category: fields.category,
        promptTemplate: fields.promptTemplate,
        priority: fields.priority,
        isEnabled: fields.isEnabled,
        version: { increment: 1 },
        ...(fields.toolNames !== undefined ? { toolNames: jsonList(fields.toolNames) } : {}),
        ...(fields.keywords !== undefined ? { keywords: jsonList(fields.keywords) } : {}),
        ...(fields.selectionTypes !== undefined ? { selectionTypes: jsonList(fields.selectionTypes) } : {}),
        ...(fields.steps !== undefined ? { steps: toSkillJson(fields.steps) } : {}),
        ...(fields.checks !== undefined ? { checks: toSkillJson(fields.checks) } : {}),
        ...(fields.examples !== undefined ? { examples: toSkillJson(fields.examples) } : {}),
        ...(fields.requiredContext !== undefined
          ? { requiredContext: toSkillJson(fields.requiredContext) }
          : {}),
        ...(fields.negativeKeywords !== undefined
          ? { negativeKeywords: toSkillJson(fields.negativeKeywords) }
          : {}),
      },
    });

    return res.json({ message: "Skill updated", skill: serialize(updated) });
  } catch (error) {
    logger.error("Update skill failed", { skillId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to update skill" });
  }
});

router.patch("/:id/enabled", idParam, body("isEnabled").isBoolean().withMessage("isEnabled must be a boolean"), async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const existing = await findEditable(req.params.id, req.user!.id, res);
    if (!existing) return;

    const updated = await prisma.aiSkill.update({
      where: { id: existing.id },
      data: { isEnabled: req.body.isEnabled },
    });
    return res.json({ message: "Skill state updated", skill: serialize(updated) });
  } catch (error) {
    logger.error("Toggle skill failed", { skillId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to toggle skill" });
  }
});

/** 克隆系统技能：得到一份可编辑的自建技能，代码加后缀避免冲突 */
router.post("/:id/clone", idParam, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const source = await prisma.aiSkill.findFirst({
      where: { id: req.params.id, OR: [{ userId }, { userId: null }] },
    });
    if (!source) {
      return res.status(404).json({ error: "Not Found", message: "Skill not found" });
    }

    const base = `${source.code}-copy`.slice(0, 60);
    let code = base.slice(0, 64);
    for (let suffix = 2; suffix < 50; suffix += 1) {
      const exists = await prisma.aiSkill.findUnique({ where: { code } });
      if (!exists) break;
      code = `${base}-${suffix}`.slice(0, 64);
    }

    const created = await prisma.aiSkill.create({
      data: {
        userId,
        code,
        name: `${source.name} 副本`.slice(0, 80),
        description: source.description,
        category: source.category,
        promptTemplate: source.promptTemplate,
        toolNames: source.toolNames === null ? Prisma.DbNull : (source.toolNames as Prisma.InputJsonValue),
        keywords: (source.keywords ?? []) as Prisma.InputJsonValue,
        selectionTypes: (source.selectionTypes ?? []) as Prisma.InputJsonValue,
        steps: source.steps === null ? Prisma.DbNull : (source.steps as Prisma.InputJsonValue),
        checks: source.checks === null ? Prisma.DbNull : (source.checks as Prisma.InputJsonValue),
        examples: source.examples === null ? Prisma.DbNull : (source.examples as Prisma.InputJsonValue),
        requiredContext:
          source.requiredContext === null
            ? Prisma.DbNull
            : (source.requiredContext as Prisma.InputJsonValue),
        negativeKeywords:
          source.negativeKeywords === null
            ? Prisma.DbNull
            : (source.negativeKeywords as Prisma.InputJsonValue),
        version: source.version,
        priority: source.priority,
        isEnabled: true,
        isSystem: false,
      },
    });

    metrics.increment("ai.skills_cloned");
    return res.status(201).json({ message: "Skill cloned", skill: serialize(created) });
  } catch (error) {
    logger.error("Clone skill failed", { skillId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to clone skill" });
  }
});

router.delete("/:id", idParam, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const existing = await findEditable(req.params.id, req.user!.id, res);
    if (!existing) return;
    await prisma.$transaction([
      prisma.assistantSkill.deleteMany({ where: { skillId: existing.id } }),
      prisma.aiSkill.delete({ where: { id: existing.id } }),
    ]);
    return res.json({ message: "Skill deleted" });
  } catch (error) {
    logger.error("Delete skill failed", { skillId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete skill" });
  }
});

export default router;
