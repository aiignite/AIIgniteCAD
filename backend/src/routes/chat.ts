/**
 * chat.ts — 会话与消息管理
 *
 * 会话是 AI 对话的持久化容器：写入前先校验项目/助手/模型归属，避免用一个
 * 会话借用他人资源。模型轮次的消息由 llmChat 以 (sessionId, clientMessageId)
 * 幂等 upsert，这里的手工消息接口只服务旧前端与非模型消息。
 */

import { Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { body, matchedData, param, query } from "express-validator";
import { prisma } from "../lib/prisma";
import { AuthRequest, authenticate } from "../middleware/auth";
import { chatRateLimit } from "../middleware/rateLimit";
import { logger } from "../lib/logger";
import { hasValidationError } from "../lib/httpValidation";
import { metrics } from "../lib/metrics";
import { compactSession } from "../services/aiEngine/contextManager";
import { checkModelAccess } from "../services/aiEngine/modelResolver";

const router = Router();

router.use(authenticate);
// 限流放在鉴权之后，才能按用户而不是 IP 计数
router.use(chatRateLimit());

const MAX_MESSAGE_CHARS = 32_000;
const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_MESSAGE_LIMIT = 500;

const sessionSelect = {
  id: true,
  projectId: true,
  userId: true,
  title: true,
  assistantId: true,
  modelId: true,
  contextSummaryUpToId: true,
  contextUpdatedAt: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChatSessionSelect;

const messageSelect = {
  id: true,
  sessionId: true,
  senderType: true,
  messageType: true,
  content: true,
  metadata: true,
  role: true,
  clientMessageId: true,
  toolCallId: true,
  toolName: true,
  toolCalls: true,
  promptTokens: true,
  completionTokens: true,
  status: true,
  createdAt: true,
} satisfies Prisma.ChatMessageSelect;

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const parseCursor = (value: unknown): Date | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 摘要正文可能上千字，列表只回长度，详情按需再取 */
const withSummaryMeta = <T extends { contextSummaryUpToId: string | null }>(
  row: T,
  summary: string | null,
) => ({
  ...row,
  hasSummary: summary !== null && summary.length > 0,
  summaryChars: summary?.length ?? 0,
});

const sessionNotFoundError = (res: Response) => {
  res.status(404).json({ error: "Not Found", message: "Chat session not found" });
};

const findOwnedSession = (sessionId: string, userId: string) =>
  prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, projectId: true, modelId: true, assistantId: true },
  });

/** 助手必须归属当前用户；null/undefined 表示沿用原值或清空 */
async function assistantError(assistantId: unknown, userId: string) {
  if (assistantId === undefined || assistantId === null || assistantId === "") return null;
  const found = await prisma.assistant.findFirst({
    where: { id: assistantId as string, userId },
    select: { id: true },
  });
  if (found) return null;
  return {
    status: 400,
    body: { error: "ASSISTANT_NOT_FOUND", message: "助手不存在或无权访问", code: "ASSISTANT_NOT_FOUND" },
  };
}

async function modelError(modelId: unknown, userId: string) {
  if (modelId === undefined || modelId === null || modelId === "") return null;
  const access = await checkModelAccess(modelId as string, userId);
  if (access.ok) return null;
  return { status: 400, body: { error: access.code, message: access.message, code: access.code } };
}

const createBody = [
  body("projectId").isString().withMessage("projectId must be a string").bail().trim().notEmpty()
    .withMessage("projectId is required").isLength({ max: 128 }),
  body("title").optional({ nullable: true }).isString().isLength({ max: 200 }).withMessage("title is too long"),
  body("assistantId").optional({ nullable: true }).isString().isLength({ max: 128 }),
  body("modelId").optional({ nullable: true }).isString().isLength({ max: 128 }),
];

const patchBody = [
  param("sessionId").isString().notEmpty(),
  body("title").optional({ nullable: true }).isString().withMessage("title must be a string").bail()
    .isLength({ max: 200 }).withMessage("title is too long"),
  body("assistantId").optional({ nullable: true }).isString().isLength({ max: 128 }),
  body("modelId").optional({ nullable: true }).isString().isLength({ max: 128 }),
];

const messageBody = [
  param("sessionId").isString().notEmpty(),
  body("senderType").isIn(["user", "ai"]).withMessage("senderType must be user or ai"),
  body("messageType").optional().isIn(["text", "action"]).withMessage("messageType must be text or action"),
  body("content").isString().withMessage("content must be a string").bail().trim().notEmpty()
    .withMessage("content is required").isLength({ max: MAX_MESSAGE_CHARS })
    .withMessage(`content must be at most ${MAX_MESSAGE_CHARS} characters`),
  body("clientMessageId").optional().isString().isLength({ max: 128 }),
  body("metadata").optional().isObject().withMessage("metadata must be an object"),
];

const pageQuery = [
  param("projectId").isString().notEmpty(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100"),
  query("before").optional().isISO8601().withMessage("before must be an ISO timestamp"),
];

const messageQuery = [
  param("sessionId").isString().notEmpty(),
  query("limit").optional().isInt({ min: 1, max: 1_000 }).withMessage("limit must be between 1 and 1000"),
  query("before").optional().isISO8601().withMessage("before must be an ISO timestamp"),
];

const outcomeBody = [
  param("turnId").isString().notEmpty().isLength({ max: 128 }),
  body("sessionId").isString().withMessage("sessionId must be a string").bail().trim().notEmpty(),
  body("outcome").isIn(["applied", "discarded"]).withMessage("outcome must be applied or discarded"),
  body("reason").optional().isString().isLength({ max: 500 }),
  body("changedIds").optional().isArray({ max: 200 }).withMessage("changedIds must be an array"),
  body("changedIds.*").optional().isString().isLength({ max: 128 }),
  body("skillCodes").optional().isArray({ max: 8 }).withMessage("skillCodes must be an array"),
  body("skillCodes.*").optional().isString().trim().isLength({ max: 64 }),
];

const feedbackBody = [
  param("turnId").isString().notEmpty().isLength({ max: 128 }),
  body("sessionId").isString().withMessage("sessionId must be a string").bail().trim().notEmpty(),
  body("rating").isIn(["up", "down"]).withMessage("rating must be up or down"),
  body("reason").optional().isString().trim().isLength({ max: 200 }),
  body("skillCodes").optional().isArray({ max: 8 }).withMessage("skillCodes must be an array"),
  body("skillCodes.*").optional().isString().trim().isLength({ max: 64 }),
];

router.get("/sessions/:projectId", pageQuery, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const { projectId } = req.params;
    const limit = clampInt(req.query.limit, DEFAULT_PAGE_LIMIT, 1, 100);
    const before = parseCursor(req.query.before);

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId, isDeleted: false },
      select: { id: true },
    });
    if (!project) {
      return res.status(404).json({ error: "Not Found", message: "Project not found" });
    }

    const rows = await prisma.chatSession.findMany({
      where: { projectId, userId, ...(before ? { updatedAt: { lt: before } } : {}) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { ...sessionSelect, contextSummary: true, _count: { select: { messages: true } } },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return res.json({
      sessions: page.map((row) => ({
        ...withSummaryMeta(row, row.contextSummary),
        contextSummary: undefined,
      })),
      hasMore,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].updatedAt.toISOString() : null,
    });
  } catch (error) {
    logger.error("List chat sessions failed", { projectId: req.params.projectId, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to get chat sessions" });
  }
});

router.post("/sessions", createBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const fields = matchedData(req) as Record<string, any>;

    const project = await prisma.project.findFirst({
      where: { id: fields.projectId, userId, isDeleted: false },
      select: { id: true },
    });
    if (!project) {
      return res.status(404).json({ error: "Not Found", message: "Project not found" });
    }

    const invalidAssistant = await assistantError(fields.assistantId, userId);
    if (invalidAssistant) return res.status(invalidAssistant.status).json(invalidAssistant.body);
    const invalidModel = await modelError(fields.modelId, userId);
    if (invalidModel) return res.status(invalidModel.status).json(invalidModel.body);

    const session = await prisma.chatSession.create({
      data: {
        projectId: fields.projectId,
        userId,
        title: fields.title ?? null,
        assistantId: fields.assistantId ?? null,
        modelId: fields.modelId ?? null,
      },
      select: sessionSelect,
    });

    return res.status(201).json({
      message: "Chat session created successfully",
      session,
    });
  } catch (error) {
    logger.error("Create chat session failed", { userId: req.user!.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to get chat session" });
  }
});

/** 会话详情：包含摘要正文，供前端恢复上下文面板 */
router.get("/sessions/:projectId/active", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const session = await prisma.chatSession.findFirst({
      where: { projectId: req.params.projectId, userId },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      select: { ...sessionSelect, contextSummary: true },
    });
    if (!session) return res.json({ session: null });
    return res.json({ session: withSummaryMeta(session, session.contextSummary) });
  } catch (error) {
    logger.error("Get active session failed", { projectId: req.params.projectId, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to get chat session" });
  }
});

router.patch(
  "/sessions/:sessionId",
  patchBody,
  async (req: AuthRequest, res: Response) => {
    if (hasValidationError(req, res)) return;
    try {
      const userId = req.user!.id;
      const { sessionId } = req.params;
      const existing = await findOwnedSession(sessionId, userId);
      if (!existing) {
        sessionNotFoundError(res);
        return;
      }

      const fields = matchedData(req) as Record<string, any>;
      const invalidAssistant = await assistantError(fields.assistantId, userId);
      if (invalidAssistant) return res.status(invalidAssistant.status).json(invalidAssistant.body);
      const invalidModel = await modelError(fields.modelId, userId);
      if (invalidModel) return res.status(invalidModel.status).json(invalidModel.body);

      const updated = await prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          ...("title" in req.body ? { title: req.body.title ?? null } : {}),
          ...("assistantId" in req.body ? { assistantId: req.body.assistantId ?? null } : {}),
          ...("modelId" in req.body ? { modelId: req.body.modelId ?? null } : {}),
        },
        select: sessionSelect,
      });
      return res.json({ message: "Chat session updated", session: updated });
    } catch (error) {
      logger.error("Update chat session failed", { sessionId: req.params.sessionId, error });
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update chat session" });
    }
  },
);

router.get("/sessions/:sessionId/messages", messageQuery, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const { sessionId } = req.params;
    const session = await findOwnedSession(sessionId, userId);
    if (!session) {
      sessionNotFoundError(res);
      return;
    }

    const limit = clampInt(req.query.limit, DEFAULT_MESSAGE_LIMIT, 1, 1_000);
    const before = parseCursor(req.query.before);

    const rows = await prisma.chatMessage.findMany({
      where: { sessionId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: messageSelect,
    });

    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();
    return res.json({
      messages,
      hasMore,
      nextCursor: hasMore && messages.length > 0 ? messages[0].createdAt.toISOString() : null,
      sessionId,
      projectId: session.projectId,
    });
  } catch (error) {
    logger.error("Get messages failed", { sessionId: req.params.sessionId, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to get chat messages" });
  }
});

router.post("/sessions/:sessionId/messages", messageBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const { sessionId } = req.params;
    const session = await findOwnedSession(sessionId, userId);
    if (!session) {
      sessionNotFoundError(res);
      return;
    }

    const fields = matchedData(req) as Record<string, any>;
    const senderType: string = fields.senderType;
    const data = {
      sessionId,
      senderType,
      messageType: fields.messageType ?? "text",
      content: fields.content,
      role: senderType === "ai" ? "assistant" : "user",
      metadata:
        fields.metadata === undefined
          ? Prisma.DbNull
          : (fields.metadata as unknown as Prisma.InputJsonValue),
    };

    const chatMessage =
      typeof fields.clientMessageId === "string" && fields.clientMessageId
        ? await prisma.chatMessage.upsert({
            where: {
              sessionId_clientMessageId: { sessionId, clientMessageId: fields.clientMessageId },
            },
            create: { ...data, clientMessageId: fields.clientMessageId },
            update: { content: data.content, metadata: data.metadata },
          })
        : await prisma.chatMessage.create({ data });

    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { lastMessageAt: new Date() },
    });

    return res.status(201).json({
      message: "Message added successfully",
      chatMessage: { ...chatMessage, toolCalls: undefined },
    });
  } catch (error) {
    logger.error("Add message failed", { sessionId: req.params.sessionId, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to add chat message" });
  }
});

/** 手动折叠历史：把全部消息压成确定性摘要并推进水位线 */
router.post("/sessions/:sessionId/compact", param("sessionId").isString().notEmpty(), async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const { sessionId } = req.params;
    const session = await findOwnedSession(sessionId, userId);
    if (!session) {
      sessionNotFoundError(res);
      return;
    }

    const result = await compactSession(sessionId);
    return res.json({
      message: "Session compacted",
      sessionId,
      droppedCount: result.droppedCount,
      summary: result.summary,
      summaryChars: result.summary.length,
    });
  } catch (error) {
    logger.error("Compact session failed", { sessionId: req.params.sessionId, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to compact session" });
  }
});

/**
 * 轮次结果回执：预览弹窗确认后写 applied，放弃写 discarded。
 * 只更新该轮用户消息的 metadata，缺失行（无会话的降级路径）返回 recorded:false。
 */
router.post("/turns/:turnId/outcome", outcomeBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const { turnId } = req.params;
    const fields = matchedData(req) as Record<string, any>;
    const session = await findOwnedSession(fields.sessionId, userId);
    if (!session) {
      sessionNotFoundError(res);
      return;
    }

    const row = await prisma.chatMessage.findUnique({
      where: {
        sessionId_clientMessageId: { sessionId: session.id, clientMessageId: turnId },
      },
      select: { id: true, metadata: true },
    });
    if (!row) {
      return res.json({ message: "Turn not persisted, outcome skipped", recorded: false });
    }

    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const skillCodes = Array.isArray(fields.skillCodes)
      ? [...new Set((fields.skillCodes as string[]).filter(Boolean))].slice(0, 8)
      : [];
    const nextMetadata = {
      ...metadata,
      outcome: fields.outcome,
      outcomeAt: new Date().toISOString(),
      ...(typeof fields.reason === "string" ? { outcomeReason: fields.reason } : {}),
      ...(Array.isArray(fields.changedIds) ? { changedIds: fields.changedIds } : {}),
      ...(skillCodes.length > 0 ? { skillCodes } : {}),
    };

    await prisma.chatMessage.update({
      where: { id: row.id },
      data: { metadata: nextMetadata as unknown as Prisma.InputJsonValue },
    });
    metrics.increment(`ai.turns_${fields.outcome}`);

    return res.json({ message: "Outcome recorded", recorded: true, sessionId: session.id, turnId });
  } catch (error) {
    logger.error("Record turn outcome failed", { turnId: req.params.turnId, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to record outcome" });
  }
});

/**
 * 回答反馈：把 up/down（可带原因）写到本轮最后一条助手消息的 metadata，
 * 同时记录当轮激活的技能，供技能面板统计「有用率」。
 */
router.post("/turns/:turnId/feedback", feedbackBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const { turnId } = req.params;
    const fields = matchedData(req) as Record<string, any>;
    const session = await findOwnedSession(fields.sessionId, userId);
    if (!session) {
      sessionNotFoundError(res);
      return;
    }

    const row = await prisma.chatMessage.findFirst({
      where: {
        sessionId: session.id,
        senderType: "ai",
        clientMessageId: { startsWith: `${turnId}:` },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, metadata: true },
    });
    if (!row) {
      return res.json({ message: "Turn not persisted, feedback skipped", recorded: false });
    }

    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const skillCodes = Array.isArray(fields.skillCodes)
      ? [...new Set((fields.skillCodes as string[]).filter(Boolean))].slice(0, 8)
      : [];
    const nextMetadata = {
      ...metadata,
      feedback: {
        rating: fields.rating,
        ...(typeof fields.reason === "string" && fields.reason ? { reason: fields.reason } : {}),
        at: new Date().toISOString(),
      },
      // 覆盖而不是按需写入：改评时不带 skillCodes 时也要清掉旧的技能归属，
      // 否则同一条消息会被重复计入有用率
      feedbackSkillCodes: skillCodes,
    };

    await prisma.chatMessage.update({
      where: { id: row.id },
      data: { metadata: nextMetadata as unknown as Prisma.InputJsonValue },
    });
    metrics.increment(`ai.feedback_${fields.rating}`);

    return res.json({ message: "Feedback recorded", recorded: true, messageId: row.id });
  } catch (error) {
    logger.error("Record feedback failed", { turnId: req.params.turnId, error });
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "Failed to record feedback" });
  }
});

router.delete("/sessions/:sessionId", param("sessionId").isString().notEmpty(), async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const deleted = await prisma.chatSession.deleteMany({
      where: { id: req.params.sessionId, userId: req.user!.id },
    });
    if (deleted.count === 0) {
      return res.status(404).json({ error: "Not Found", message: "Chat session not found" });
    }
    return res.json({ message: "Chat session deleted successfully" });
  } catch (error) {
    logger.error("Delete chat session failed", { sessionId: req.params.sessionId, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete chat session" });
  }
});

export default router;
