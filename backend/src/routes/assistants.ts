/**
 * assistants.ts — 助手 CRUD、工具白名单与技能绑定
 *
 * 助手是 AI 对话的人格与权限容器：system prompt 会真正进入提示词，
 * toolNames 限定本轮可用工具，skills 决定技能优先激活与权重。
 * llmModelId 必须归属当前用户（或系统模型），否则一个助手就能借用他人的 Key。
 */

import { Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { body, param } from "express-validator";
import { prisma } from "../lib/prisma";
import { AuthRequest, authenticate } from "../middleware/auth";
import { logger } from "../lib/logger";
import { hasValidationError } from "../lib/httpValidation";
import { toSafeAssistant } from "../lib/serializers";
import { CAD_TOOL_DEFINITIONS } from "../services/aiEngine/tools";
import { checkModelAccess } from "../services/aiEngine/modelResolver";

const router = Router();

router.use(authenticate);

const TOOL_NAMES = CAD_TOOL_DEFINITIONS.map((tool) => tool.name);

const assistantBody = [
  body("name").isString().withMessage("name must be a string").bail().trim().notEmpty()
    .withMessage("name is required").isLength({ max: 80 }).withMessage("name is too long"),
  body("icon").optional().isString().isLength({ max: 60 }),
  body("description").optional().isString().isLength({ max: 500 }),
  body("color").optional().isString().isLength({ max: 60 }),
  body("category").optional().isString().isLength({ max: 40 }),
  body("prompt").optional({ nullable: true }).isString().withMessage("prompt must be a string").bail()
    .isLength({ max: 8000 }).withMessage("prompt is too long"),
  body("isActive").optional().isBoolean(),
  body("isPublic").optional().isBoolean(),
  body("temperature").optional({ nullable: true }).isFloat({ min: 0, max: 2 }).withMessage("temperature must be between 0 and 2"),
  body("maxTokens").optional({ nullable: true }).isInt({ min: 1, max: 200_000 }).withMessage("maxTokens must be between 1 and 200000"),
  body("maxToolRounds").optional().isInt({ min: 0, max: 12 }).withMessage("maxToolRounds must be between 0 and 12"),
  body("llmModelId").optional({ nullable: true }).isString().isLength({ max: 128 }),
  body("toolNames")
    .optional({ nullable: true })
    .isArray({ max: TOOL_NAMES.length })
    .withMessage("toolNames must be an array of tool names")
    .bail()
    .custom((values: unknown) => {
      const invalid = (values as unknown[]).filter((value) => !TOOL_NAMES.includes(value as string));
      if (invalid.length > 0) {
        throw new Error(`unknown tools: ${invalid.join(", ")}`);
      }
      return true;
    }),
];

const skillBindingBody = [
  body("skills").isArray({ max: 12 }).withMessage("skills must be an array").bail().custom((values: unknown) => {
    for (const value of values as unknown[]) {
      const skillId = (value as { skillId?: unknown })?.skillId;
      if (typeof skillId !== "string" || skillId.length === 0) {
        throw new Error("each binding needs a skillId");
      }
      const weight = (value as { weight?: unknown })?.weight;
      if (weight !== undefined && (typeof weight !== "number" || weight < 0 || weight > 100)) {
        throw new Error("weight must be between 0 and 100");
      }
    }
    return true;
  }),
];

const idParam = param("id").isString().notEmpty();

/** 助手响应统一附带技能 id，前端表单不需要再从嵌套结构里拼装 */
const withSkillIds = <T extends { skills?: Array<{ skillId: string; weight: number }> }>(
  assistant: T,
) => ({
  ...assistant,
  skillIds: (assistant.skills ?? []).map((binding) => binding.skillId),
});

const findOwned = (id: string, userId: string) =>
  prisma.assistant.findFirst({
    where: { id, userId },
    include: { llmModel: true, skills: true },
  });

const jsonField = (value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.DbNull =>
  value === undefined || value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue);

/** 模型归属校验：返回可直接发送的错误响应体，null 表示可用或未指定 */
async function modelError(llmModelId: unknown, userId: string) {
  if (llmModelId === undefined || llmModelId === null || llmModelId === "") return null;
  const access = await checkModelAccess(llmModelId as string, userId);
  if (access.ok) return null;
  return { status: 400, body: { error: access.code, message: access.message, code: access.code } };
}
/** 校验技能可用性并返回可绑定的行；越权或不存在的 id 直接拒绝 */
async function filterBindableSkills(
  bindings: Array<{ skillId: string; weight?: number }>,
  userId: string,
): Promise<{ ok: boolean; message?: string; rows: Array<{ skillId: string; weight: number }> }> {
  const ids = bindings.map((binding) => binding.skillId);
  const rows = await prisma.aiSkill.findMany({
    where: { id: { in: ids }, OR: [{ userId }, { userId: null }] },
    select: { id: true },
  });
  const allowed = new Set(rows.map((row) => row.id));
  const rejected = ids.filter((id) => !allowed.has(id));
  if (rejected.length > 0) {
    return { ok: false, message: `技能不存在或无权绑定：${rejected.join(", ")}`, rows: [] };
  }
  return {
    ok: true,
    rows: bindings.map((binding) => ({
      skillId: binding.skillId,
      weight: typeof binding.weight === "number" ? binding.weight : 50,
    })),
  };
}

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const assistants = await prisma.assistant.findMany({
      where: { userId },
      include: { llmModel: true, skills: { orderBy: { weight: "desc" } } },
      orderBy: { createdAt: "asc" },
    });
    return res.json({
      assistants: assistants.map((assistant) => withSkillIds(toSafeAssistant(assistant))),
    });
  } catch (error) {
    logger.error("Get assistants failed", { userId: req.user!.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to get assistants" });
  }
});

router.get("/:id", idParam, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const assistant = await findOwned(req.params.id, req.user!.id);
    if (!assistant) {
      return res.status(404).json({ error: "Not Found", message: "Assistant not found" });
    }
    return res.json({ assistant: withSkillIds(toSafeAssistant(assistant)) });
  } catch (error) {
    logger.error("Get assistant failed", { assistantId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to get assistant" });
  }
});

router.post("/", assistantBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const {
      name,
      icon,
      description,
      color,
      category,
      prompt,
      isActive,
      isPublic,
      llmModelId,
      temperature,
      maxTokens,
      maxToolRounds,
      toolNames,
      skills,
    } = req.body;

    const invalidModel = await modelError(llmModelId, userId);
    if (invalidModel) return res.status(invalidModel.status).json(invalidModel.body);

    const bindings = await filterBindableSkills(
      Array.isArray(skills) ? skills : [],
      userId,
    );
    if (!bindings.ok) {
      return res.status(400).json({ error: "SKILL_NOT_AVAILABLE", message: bindings.message });
    }

    const assistant = await prisma.assistant.create({
      data: {
        userId,
        name,
        icon: icon || "psychology",
        description: description || "",
        color: color || "text-cad-primary",
        category: category || "General",
        prompt: prompt ?? null,
        isActive: isActive ?? true,
        isPublic: isPublic ?? false,
        llmModelId: llmModelId ?? null,
        temperature: temperature ?? null,
        maxTokens: maxTokens ?? null,
        maxToolRounds: maxToolRounds ?? 4,
        toolNames: jsonField(toolNames),
        ...(bindings.rows.length > 0
          ? { skills: { create: bindings.rows } }
          : {}),
      },
      include: { llmModel: true, skills: true },
    });

    return res.status(201).json({
      message: "Assistant created successfully",
      assistant: withSkillIds(toSafeAssistant(assistant)),
    });
  } catch (error) {
    logger.error("Create assistant failed", { userId: req.user!.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to create assistant" });
  }
});

router.put("/:id", idParam, assistantBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const existing = await findOwned(id, userId);
    if (!existing) {
      return res.status(404).json({ error: "Not Found", message: "Assistant not found" });
    }

    const {
      name,
      icon,
      description,
      color,
      category,
      isActive,
      isPublic,
      llmModelId,
      maxToolRounds,
      skills,
    } = req.body;

    const invalidModel = await modelError(llmModelId, userId);
    if (invalidModel) return res.status(invalidModel.status).json(invalidModel.body);

    const bindings = Array.isArray(skills)
      ? await filterBindableSkills(skills, userId)
      : null;
    if (bindings && !bindings.ok) {
      return res.status(400).json({ error: "SKILL_NOT_AVAILABLE", message: bindings.message });
    }

    await prisma.assistant.update({
      where: { id },
      data: {
        name,
        icon,
        description,
        color,
        category,
        isActive,
        isPublic,
        maxToolRounds,
        // 可空字段只有显式出现时才覆盖，缺省代表沿用原值
        ...("prompt" in req.body ? { prompt: req.body.prompt ?? null } : {}),
        ...("llmModelId" in req.body ? { llmModelId: req.body.llmModelId ?? null } : {}),
        ...("temperature" in req.body ? { temperature: req.body.temperature ?? null } : {}),
        ...("maxTokens" in req.body ? { maxTokens: req.body.maxTokens ?? null } : {}),
        ...("toolNames" in req.body ? { toolNames: jsonField(req.body.toolNames) } : {}),
      },
    });

    if (bindings) {
      await prisma.assistantSkill.deleteMany({ where: { assistantId: id } });
      if (bindings.rows.length > 0) {
        await prisma.assistantSkill.createMany({
          data: bindings.rows.map((row) => ({ ...row, assistantId: id })),
        });
      }
    }

    const updated = await findOwned(id, userId);
    return res.json({
      message: "Assistant updated successfully",
      assistant: updated ? withSkillIds(toSafeAssistant(updated)) : null,
    });
  } catch (error) {
    logger.error("Update assistant failed", { assistantId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to update assistant" });
  }
});

router.get("/:id/skills", idParam, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const assistant = await findOwned(req.params.id, req.user!.id);
    if (!assistant) {
      return res.status(404).json({ error: "Not Found", message: "Assistant not found" });
    }
    const skillIds = assistant.skills.map((binding) => binding.skillId);
    const skills = await prisma.aiSkill.findMany({ where: { id: { in: skillIds } } });
    return res.json({
      skills: skills.map((skill) => ({
        ...skill,
        weight: assistant.skills.find((binding) => binding.skillId === skill.id)?.weight ?? 50,
      })),
    });
  } catch (error) {
    logger.error("Get assistant skills failed", { assistantId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to get skills" });
  }
});

router.put("/:id/skills", idParam, skillBindingBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const assistant = await findOwned(req.params.id, userId);
    if (!assistant) {
      return res.status(404).json({ error: "Not Found", message: "Assistant not found" });
    }

    const bindings = await filterBindableSkills(req.body.skills, userId);
    if (!bindings.ok) {
      return res.status(400).json({ error: "SKILL_NOT_AVAILABLE", message: bindings.message });
    }

    await prisma.$transaction(async (tx) => {
      await tx.assistantSkill.deleteMany({ where: { assistantId: assistant.id } });
      if (bindings.rows.length > 0) {
        await tx.assistantSkill.createMany({
          data: bindings.rows.map((row) => ({ ...row, assistantId: assistant.id })),
        });
      }
    });

    const updated = await findOwned(assistant.id, userId);
    return res.json({
      message: "Assistant skills updated",
      assistant: updated ? withSkillIds(toSafeAssistant(updated)) : null,
    });
  } catch (error) {
    logger.error("Update assistant skills failed", { assistantId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to update skills" });
  }
});

router.delete("/:id", idParam, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const deleted = await prisma.assistant.deleteMany({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (deleted.count === 0) {
      return res.status(404).json({ error: "Not Found", message: "Assistant not found" });
    }
    return res.json({ message: "Assistant deleted successfully" });
  } catch (error) {
    logger.error("Delete assistant failed", { assistantId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete assistant" });
  }
});

export default router;
