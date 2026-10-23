/**
 * llmChat.ts — AI 对话编排（模型解析 → 会话落库 → 技能路由 → 流式生成 → 记账）
 *
 * 本文件只做编排与 SSE 契约，具体逻辑在 services/aiEngine 下：
 * provider 差异收敛在 providers/，提示词装配在 promptComposer，工具参数校验在
 * toolValidator，历史窗口与摘要在 contextManager，用量台账在 usageAccounting。
 *
 * 幂等：客户端为每个用户轮生成 turnId，消息以 (sessionId, clientMessageId) 唯一。
 * phase="tool_results" 的续轮不再插入用户消息，因此重放同一个请求不会产生
 * 重复历史或重复计费。
 */

import { RequestHandler, Router, Response } from "express";
import { body, validationResult } from "express-validator";
import { randomUUID } from "crypto";
import { LLMModel, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest, authenticate } from "../middleware/auth";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { formatDesignConventions } from "../lib/designConventions";
import { formatVersionMemory } from "../lib/versionMemory";
import { trackSseStream } from "../middleware/observability";
import {
  CAD_TOOL_DEFINITIONS,
  PLAN_TOOL_NAME,
  PROPOSE_VARIANTS_TOOL_NAME,
  READ_ONLY_TOOL_NAMES,
  ToolCallPayload,
  WRITE_TOOL_NAMES,
  selectToolDefinitions,
} from "../services/aiEngine/tools";
import { validateToolCalls } from "../services/aiEngine/toolValidator";
import {
  ModelResolutionError,
  getFailoverCandidates,
  resolveChatModel,
} from "../services/aiEngine/modelResolver";
import {
  ProviderError,
  ProviderMessage,
  ProviderResult,
  ProviderTurn,
  streamWithProvider,
} from "../services/aiEngine/providers";
import {
  CanvasContextSnapshot,
  composeSystemPrompt,
  describeToolResult,
} from "../services/aiEngine/promptComposer";
import { buildConversationWindow, type HistoryMessage } from "../services/aiEngine/contextManager";
import {
  computeCost,
  recordAiCallLog,
  resolveUsage,
} from "../services/aiEngine/usageAccounting";
import {
  activateSkills,
  resolveAllowedTools,
} from "../services/aiEngine/skills/skillRouter";
import type { SkillContextSignal } from "../services/aiEngine/skills/skillPlaybook";
import { ensureSystemSkills, loadEnabledSkills } from "../services/aiEngine/skills/skillService";

const HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const ABSOLUTE_MAX_ROUNDS = 12;
const MAX_TOOL_RESULTS_PER_TURN = 40;

export type SseEventName =
  | "trace_start"
  | "context"
  | "skill_activated"
  | "content"
  | "tool_call"
  | "tool_rejected"
  | "model_fallback"
  | "usage"
  | "done"
  | "error";

/**
 * 事件同时带 `event` 判别字段与旧字段名（content / toolCall / error / done），
 * 老前端只读 `data:` 里的 JSON，因此可以先升级服务端再升级前端。
 */
function sendEvent(res: Response, name: SseEventName, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify({ event: name, ...payload })}\n\n`);
  res.flush?.();
}

const chatRequestValidation = [
  body("phase")
    .optional()
    .isIn(["user_turn", "tool_results"])
    .withMessage("phase must be user_turn or tool_results"),
  body("message")
    .bail()
    .if((_value, { req }) => req.body?.phase !== "tool_results")
    .exists()
    .withMessage("message is required")
    .bail()
    .isString()
    .withMessage("message must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("message is required")
    .isLength({ max: 32000 })
    .withMessage("message must be at most 32000 characters"),
  body("turnId").optional().isString().isLength({ max: 128 }).withMessage("turnId is too long"),
  body("round").optional().isInt({ min: 0, max: ABSOLUTE_MAX_ROUNDS }).withMessage("round is out of range"),
  // 前端用 null 表示“未选择”，optional() 只跳过 undefined，必须显式允许 null
  body("sessionId").optional({ nullable: true }).isString().withMessage("sessionId must be a string").isLength({ max: 128 }),
  body("projectId").optional({ nullable: true }).isString().withMessage("projectId must be a string").isLength({ max: 128 }),
  body("assistantId").optional({ nullable: true }).isString().withMessage("assistantId must be a string").isLength({ max: 128 }),
  body("modelId").optional({ nullable: true }).isString().withMessage("modelId must be a string").isLength({ max: 128 }),
  body("enableTools").optional().isBoolean().withMessage("enableTools must be a boolean"),
  body("planMode").optional().isBoolean().withMessage("planMode must be a boolean"),
  body("variantMode").optional().isBoolean().withMessage("variantMode must be a boolean"),
  body("pinnedSkillCodes")
    .optional()
    .isArray({ max: 5 })
    .withMessage("pinnedSkillCodes must be an array of at most 5 codes"),
  body("pinnedSkillCodes.*").optional().isString().isLength({ max: 64 }),
  body("recommendedSkillCodes")
    .optional()
    .isArray({ max: 5 })
    .withMessage("recommendedSkillCodes must be an array of at most 5 codes"),
  body("recommendedSkillCodes.*").optional().isString().isLength({ max: 64 }),
  body("canvasContext").optional().isObject(),
  body("canvasContext.elementCount").optional().isInt({ min: 0, max: 1_000_000 }),
  body("canvasContext.selectedIds").optional().isArray({ max: 200 }),
  body("canvasContext.selectedIds.*").optional().isString().isLength({ max: 128 }),
  body("canvasContext.selectionTypes").optional().isArray({ max: 32 }),
  body("canvasContext.text").optional().isString().isLength({ max: 8000 }),
  body("canvasContext.projectName").optional().isString().isLength({ max: 200 }),
  body("canvasContext.layerNames").optional().isArray({ max: 64 }),
  body("canvasContext.layerNames.*").optional().isString().isLength({ max: 64 }),
  body("canvasContext.blockCount").optional().isInt({ min: 0, max: 100_000 }),
  body("canvasContext.revision").optional().isInt({ min: 0, max: 10_000_000 }),
  body("canvasContext.hiddenCount").optional().isInt({ min: 0, max: 1_000_000 }),
  body("canvasContext.hasDimensions").optional().isBoolean(),
  body("canvasContext.bounds").optional().isObject(),
  body("canvasContext.bounds.minX").optional().isFloat({ min: -1e7, max: 1e7 }),
  body("canvasContext.bounds.minY").optional().isFloat({ min: -1e7, max: 1e7 }),
  body("canvasContext.bounds.maxX").optional().isFloat({ min: -1e7, max: 1e7 }),
  body("canvasContext.bounds.maxY").optional().isFloat({ min: -1e7, max: 1e7 }),
  body("toolResults")
    .optional()
    .isArray({ min: 1, max: MAX_TOOL_RESULTS_PER_TURN })
    .withMessage("toolResults must be a non-empty array"),
  body("toolResults.*.toolCallId").optional().isString().isLength({ max: 128 }),
  body("toolResults.*.name").optional().isString().isLength({ max: 64 }),
  body("toolResults.*.ok").optional().isBoolean(),
  body("toolResults.*.summary").optional().isString().isLength({ max: 2000 }),
  body("toolResults.*.error").optional().isString().isLength({ max: 500 }),
];

interface ToolResultInput {
  toolCallId: string;
  name: string;
  ok: boolean;
  summary?: string;
  error?: string;
  changedIds?: string[];
}

interface CanvasContextInput extends CanvasContextSnapshot {
  selectedIds?: string[];
}

interface TurnRequest {
  phase: "user_turn" | "tool_results";
  turnId: string;
  round: number;
  message: string;
  sessionId: string | null;
  projectId: string | null;
  assistantId: string | null;
  modelId: string | null;
  enableTools: boolean;
  planMode: boolean;
  variantMode: boolean;
  pinnedSkillCodes: string[];
  recommendedSkillCodes: string[];
  canvasContext: CanvasContextInput | null;
  toolResults: ToolResultInput[];
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** 把画布上下文折算成技能路由可用的设计信号 */
function deriveContextSignals(
  canvas: CanvasContextInput | null,
): SkillContextSignal[] {
  if (!canvas) return [];
  const signals: SkillContextSignal[] = [];
  if ((canvas.selectedIds?.length ?? 0) > 0) signals.push("selection");
  if ((canvas.layerNames ?? []).some((name) => name && name !== "0")) signals.push("layers");
  if ((canvas.blockCount ?? 0) > 0) signals.push("blocks");
  if ((canvas.revision ?? 0) > 0) signals.push("revision");
  if (canvas.hasDimensions) signals.push("dimensions");
  return signals;
}

const clampString = (value: unknown, max: number): string => {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
};

function parseTurnRequest(body: any): TurnRequest {
  const canvas = body.canvasContext && typeof body.canvasContext === "object" ? body.canvasContext : null;
  const rawResults = Array.isArray(body.toolResults) ? body.toolResults : [];
  return {
    phase: body.phase === "tool_results" ? "tool_results" : "user_turn",
    turnId: clampString(body.turnId, 128) || randomUUID(),
    round: Number.isInteger(body.round) && body.round >= 0 ? body.round : 0,
    message: clampString(body.message, 32000).trim(),
    sessionId: clampString(body.sessionId, 128) || null,
    projectId: clampString(body.projectId, 128) || null,
    assistantId: clampString(body.assistantId, 128) || null,
    modelId: clampString(body.modelId, 128) || null,
    enableTools: body.enableTools === true,
    planMode: body.planMode === true,
    variantMode: body.variantMode === true,
    pinnedSkillCodes: asStringArray(body.pinnedSkillCodes).slice(0, 5),
    recommendedSkillCodes: asStringArray(body.recommendedSkillCodes).slice(0, 5),
    canvasContext: canvas
      ? {
          text: clampString(canvas.text, 8000) || undefined,
          elementCount: Number.isInteger(canvas.elementCount) ? canvas.elementCount : undefined,
          selectedIds: asStringArray(canvas.selectedIds).slice(0, 200),
          selectionTypes: asStringArray(canvas.selectionTypes).slice(0, 32),
          units: clampString(canvas.units, 16) || undefined,
          projectName: clampString(canvas.projectName, 200) || undefined,
          layerNames: asStringArray(canvas.layerNames).slice(0, 64).map((name) => name.slice(0, 64)),
          blockCount: Number.isInteger(canvas.blockCount) ? canvas.blockCount : undefined,
          revision: Number.isInteger(canvas.revision) ? canvas.revision : undefined,
          hiddenCount: Number.isInteger(canvas.hiddenCount) ? canvas.hiddenCount : undefined,
          hasDimensions: canvas.hasDimensions === true,
          bounds:
            canvas.bounds && typeof canvas.bounds === "object"
              ? {
                  minX: Number(canvas.bounds.minX) || 0,
                  minY: Number(canvas.bounds.minY) || 0,
                  maxX: Number(canvas.bounds.maxX) || 0,
                  maxY: Number(canvas.bounds.maxY) || 0,
                }
              : undefined,
        }
      : null,
    toolResults: rawResults.slice(0, MAX_TOOL_RESULTS_PER_TURN).map((raw: any) => ({
      toolCallId: clampString(raw?.toolCallId, 128),
      name: clampString(raw?.name, 64),
      ok: raw?.ok === true,
      summary: clampString(raw?.summary, 2000) || undefined,
      error: clampString(raw?.error, 500) || undefined,
      changedIds: asStringArray(raw?.changedIds).slice(0, 200),
    })),
  };
}

interface SessionRow {
  id: string;
  projectId: string | null;
  title: string | null;
  modelId: string | null;
}

const sessionSelect = { id: true, projectId: true, title: true, modelId: true };

/** 会话归属校验 + 惰性创建；没有项目也没有会话时返回 null（本轮不落库） */
async function ensureSession(turn: TurnRequest, userId: string): Promise<SessionRow | null> {
  if (turn.sessionId) {
    return prisma.chatSession.findFirst({
      where: { id: turn.sessionId, userId },
      select: sessionSelect,
    });
  }
  if (!turn.projectId) return null;

  const owned = await prisma.project.findFirst({
    where: { id: turn.projectId, userId },
    select: { id: true },
  });
  if (!owned) return null;

  const existing = await prisma.chatSession.findFirst({
    where: { userId, projectId: turn.projectId },
    orderBy: { updatedAt: "desc" },
    select: sessionSelect,
  });
  if (existing) return existing;

  return prisma.chatSession.create({
    data: { userId, projectId: turn.projectId, title: turn.message.slice(0, 60) || null },
    select: sessionSelect,
  });
}

async function persistMessage(args: {
  sessionId: string;
  clientMessageId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallPayload[] | null;
  toolCallId?: string | null;
  toolName?: string | null;
  traceId: string;
  modelRowId?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  status?: string;
  /** 行序时间戳；缺省由数据库默认值决定 */
  createdAt?: Date;
}): Promise<{ id: string }> {
  const senderType = args.role === "user" ? "user" : "ai";
  const messageType = args.role === "user" ? "text" : args.toolCalls || args.toolCallId ? "action" : "text";
  const toolCalls = args.toolCalls
    ? (args.toolCalls as unknown as Prisma.InputJsonValue)
    : Prisma.DbNull;
  const data = {
    senderType,
    messageType,
    content: args.content,
    role: args.role,
    toolCalls,
    toolCallId: args.toolCallId ?? null,
    toolName: args.toolName ?? null,
    traceId: args.traceId,
    modelRowId: args.modelRowId ?? null,
    promptTokens: args.promptTokens ?? null,
    completionTokens: args.completionTokens ?? null,
    status: args.status ?? "complete",
    ...(args.createdAt ? { createdAt: args.createdAt } : {}),
  };

  return prisma.chatMessage.upsert({
    where: {
      sessionId_clientMessageId: {
        sessionId: args.sessionId,
        clientMessageId: args.clientMessageId,
      },
    },
    create: { sessionId: args.sessionId, clientMessageId: args.clientMessageId, ...data },
    update: data,
  });
}

/** 历史消息 → provider 消息（assistant 的 toolCalls 从 JSON 还原） */
function toProviderMessages(rows: HistoryMessage[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  // provider 要求每条 tool 消息都能在前一条 assistant 的 tool_calls 里配对；
  // 早期版本把被拒调用排在助手消息之前，这类脏数据在此跳过而不是让整次请求 400。
  let openCallIds = new Set<string>();
  for (const row of rows) {
    if (row.role === "tool") {
      const toolCallId = row.toolCallId ?? "";
      if (!toolCallId || !openCallIds.has(toolCallId)) continue;
      openCallIds.delete(toolCallId);
      messages.push({
        role: "tool",
        content: row.content,
        toolCallId,
        toolName: row.toolName ?? undefined,
      });
      continue;
    }
    if (row.role === "assistant") {
      const calls = Array.isArray(row.toolCalls)
        ? (row.toolCalls as unknown as ToolCallPayload[])
        : undefined;
      openCallIds = new Set((calls ?? []).map((call) => call.id));
      messages.push({
        role: "assistant",
        content: row.content,
        toolCalls: calls && calls.length > 0 ? calls : undefined,
      });
      continue;
    }
    openCallIds = new Set();
    messages.push({ role: "user", content: row.content });
  }
  return messages;
}

const MAX_REJECTED_ARGUMENT_CHARS = 1000;

/** 被拒调用的原始参数按字符预算收纳，超长只留标记，避免助手消息膨胀 */
function boundedArguments(args: Record<string, unknown>): Record<string, unknown> {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    return {};
  }
  return text.length <= MAX_REJECTED_ARGUMENT_CHARS ? args : { truncated: true };
}

/** 工具执行结果 → 回传给模型的 JSON 文本（也用作 tool 消息正文） */
const toolResultText = (result: ToolResultInput): string =>
  describeToolResult({
    toolName: result.name,
    ok: result.ok,
    summary: result.summary,
    error: result.error,
    changedIds: result.changedIds,
  });

/** 无会话的旧版单次调用路径：本轮输入直接进消息列表，不依赖落库 */
function currentTurnMessages(turn: TurnRequest): ProviderMessage[] {
  if (turn.phase === "user_turn") return [{ role: "user", content: turn.message }];
  const body = turn.toolResults.map(toolResultText).join("\n");
  return [{ role: "user", content: `工具执行结果：\n${body}` }];
}

const assistantToolNames = (toolNames: unknown): string[] | null => {
  if (!Array.isArray(toolNames)) return null;
  const names = toolNames.filter((name): name is string => typeof name === "string");
  return names.length > 0 ? names : null;
};

export function createLlmChatRouter(rateLimiter: RequestHandler): Router {
  const router = Router();

  router.use(authenticate);
  router.use(rateLimiter);

  router.post("/chat", chatRequestValidation, async (req: AuthRequest, res: Response) => {
    const validationErrors = validationResult(req);
    if (!validationErrors.isEmpty()) {
      return res.status(400).json({
        error: "Validation Error",
        message: validationErrors.array()[0].msg,
        code: "VALIDATION",
        requestId: req.requestId,
      });
    }

    const userId = req.user!.id;
    const turn = parseTurnRequest(req.body);
    if (turn.phase === "tool_results" && turn.toolResults.length === 0) {
      return res.status(400).json({
        error: "Validation Error",
        message: "toolResults must be a non-empty array",
        code: "VALIDATION",
        requestId: req.requestId,
      });
    }
    const traceId = req.requestId ?? randomUUID();
    const startedAt = Date.now();
    // 同一请求内落库的多行会落在同一毫秒，而主键是随机 uuid，
    // 按 (createdAt, id) 排序时 tool 消息可能被排到它的 assistant 之前，
    // provider 的 tool_call 配对要求随之失效，因此为每行给出行序时间戳。
    let rowSequence = 0;
    const nextRowAt = () => new Date(startedAt + rowSequence++);

    // 首字节之前保持普通 JSON 错误响应，之后只能走 SSE error 事件
    let headersSent = false;
    let tracker: ReturnType<typeof trackSseStream> | null = null;
    let failureRecorded = false;
    let providerName: string | undefined;
    let heartbeat: NodeJS.Timeout | null = null;

    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    req.once("close", onClose);

    const fail = (code: string, message: string, statusCode = 500, retryable = false) => {
      if (!headersSent) {
        res.status(statusCode).json({ error: code, message, code, requestId: req.requestId });
        return;
      }
      failureRecorded = true;
      metrics.increment("ai.failures");
      sendEvent(res, "error", { error: message, code, retryable, requestId: req.requestId });
      res.end();
    };

    try {
      // 1) 助手（含技能绑定）
      const assistant = turn.assistantId
        ? await prisma.assistant.findFirst({
            where: { id: turn.assistantId, userId },
            include: { skills: true },
          })
        : null;
      if (turn.assistantId && !assistant) {
        return fail("ASSISTANT_NOT_FOUND", "助手不存在或无权访问", 404);
      }

      // 2) 会话
      const session = await ensureSession(turn, userId);
      if ((turn.sessionId || turn.projectId) && !session) {
        return fail("SESSION_NOT_FOUND", "会话不存在或不属于当前用户", 404);
      }

      // 项目设计约定与版本记忆：按 projectId 重新校验归属后注入
      const memoryProjectId = session?.projectId ?? turn.projectId;
      const [designConventionsText, versionRows] = memoryProjectId
        ? await Promise.all([
            prisma.project
              .findFirst({
                where: { id: memoryProjectId, userId },
                select: { designConventions: true },
              })
              .then((project) => formatDesignConventions(project?.designConventions))
              .catch(() => null),
            prisma.projectVersion
              .findMany({
                where: { projectId: memoryProjectId },
                orderBy: { versionNumber: "desc" },
                take: 5,
                select: {
                  versionNumber: true,
                  elementCount: true,
                  commitMessage: true,
                  changeSummary: true,
                  createdAt: true,
                },
              })
              .catch(() => []),
          ])
        : [null, []];
      const versionMemoryText = formatVersionMemory(versionRows);

      // 3) 模型解析（校验归属，禁用即拒绝）
      const sessionModelId = session?.modelId ?? null;

      let model: LLMModel;
      try {
        const resolved = await resolveChatModel({
          userId,
          modelId: turn.modelId,
          sessionModelId,
          assistantModelId: assistant?.llmModelId ?? null,
          requiresTools: turn.enableTools || assistant !== null,
        });
        model = resolved.model;
      } catch (error) {
        if (error instanceof ModelResolutionError) {
          return fail(error.code, error.message, 400);
        }
        throw error;
      }
      providerName = model.provider;

      // 4) 轮次上限
      const maxRounds = assistant?.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
      if (turn.phase === "tool_results" && turn.round >= maxRounds) {
        return fail(
          "TOOL_ROUND_LIMIT",
          `本轮工具循环已达上限（${maxRounds} 轮），请预览当前结果或直接提出新要求`,
          400,
        );
      }

      // 5) SSE 头与心跳
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      headersSent = true;
      tracker = trackSseStream(res, { requestId: traceId, provider: model.provider });
      metrics.increment("ai.requests");
      heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(": ping\n\n");
      }, HEARTBEAT_MS);
      heartbeat.unref?.();

      sendEvent(res, "trace_start", {
        traceId,
        sessionId: session?.id ?? null,
        turnId: turn.turnId,
        round: turn.round,
        provider: model.provider,
        modelRowId: model.id,
        modelId: model.modelId,
      });

      // 6) 幂等落库本轮输入
      if (session) {
        if (turn.phase === "user_turn") {
          await persistMessage({
            sessionId: session.id,
            clientMessageId: turn.turnId,
            role: "user",
            content: turn.message,
            traceId,
            createdAt: nextRowAt(),
          });
        } else {
          for (const result of turn.toolResults) {
            if (!result.toolCallId) continue;
            await persistMessage({
              sessionId: session.id,
              // 续轮回传的是上一轮 assistant 提议的结果，工具行必须归到那一轮，
              // 否则历史回放会把已执行的工具显示成"待执行"
              clientMessageId: `${turn.turnId}:r${Math.max(0, turn.round - 1)}:tool:${result.toolCallId}`,
              role: "tool",
              content: toolResultText(result),
              toolCallId: result.toolCallId,
              toolName: result.name || null,
              traceId,
              status: result.ok ? "complete" : "rejected",
              createdAt: nextRowAt(),
            });
          }
        }
        await prisma.chatSession
          .update({
            where: { id: session.id },
            data: {
              lastMessageAt: new Date(),
              ...(assistant && turn.round === 0 ? { assistantId: assistant.id } : {}),
              ...(turn.round === 0 && !session.title ? { title: turn.message.slice(0, 60) } : {}),
              ...(turn.modelId && turn.modelId !== session.modelId ? { modelId: turn.modelId } : {}),
            },
          })
          .catch((error) => logger.warn("Failed to touch session", { sessionId: session.id, error }));
      }

      // 7) 技能路由
      await ensureSystemSkills().catch((error) =>
        logger.warn("Failed to ensure system skills", { error }),
      );
      const skills = await loadEnabledSkills(userId).catch(() => []);
      const bindings =
        assistant?.skills.map((binding) => ({ skillId: binding.skillId, weight: binding.weight })) ?? [];
      const [recentSkillCodes, historyTexts] = session
        ? await Promise.all([
            prisma.aiCallLog
              .findMany({
                where: { sessionId: session.id },
                orderBy: { createdAt: "desc" },
                take: 2,
                select: { skillCodes: true },
              })
              .then((rows) => rows.flatMap((row) => asStringArray(row.skillCodes)))
              .catch(() => [] as string[]),
            // 旧→新；排除本轮刚落库的用户消息（createdAt 从 startedAt 起排），
            // 否则当前消息会挤掉一条真正的历史
            prisma.chatMessage
              .findMany({
                where: {
                  sessionId: session.id,
                  senderType: "user",
                  createdAt: { lt: new Date(startedAt) },
                },
                orderBy: { createdAt: "desc" },
                take: 3,
                select: { content: true },
              })
              .then((rows) => rows.map((row) => row.content).reverse())
              .catch(() => [] as string[]),
          ])
        : ([[], []] as [string[], string[]]);

      const activated = activateSkills({
        skills,
        message: turn.message,
        selectionTypes: turn.canvasContext?.selectionTypes ?? [],
        contextSignals: deriveContextSignals(turn.canvasContext),
        pinnedSkillCodes: turn.pinnedSkillCodes,
        recommendedSkillCodes: turn.recommendedSkillCodes,
        bindings,
        recentSkillCodes,
        historyTexts,
      });

      const assistantWhitelist = assistantWhitelistOf(assistant?.toolNames);
      const skillAllowedTools = resolveAllowedTools(
        activated,
        assistantWhitelist,
        CAD_TOOL_DEFINITIONS.map((tool) => tool.name),
      );
      // 计划 / 多方案模式只允许先读后提案，写工具在用户确认后才重新开放
      const variantMode = turn.variantMode && !turn.planMode && model.supportsTools;
      const planMode = turn.planMode && model.supportsTools;
      const wantsTools =
        planMode || variantMode
          ? true
          : (turn.enableTools || assistant !== null || activated.length > 0) &&
            model.supportsTools &&
            selectToolDefinitions(skillAllowedTools).length > 0;
      const allowedTools = variantMode
        ? [...READ_ONLY_TOOL_NAMES, PROPOSE_VARIANTS_TOOL_NAME]
        : planMode
          ? [...READ_ONLY_TOOL_NAMES, PLAN_TOOL_NAME]
          : wantsTools
            ? skillAllowedTools
            : [];
      // 计划 / 多方案的步骤是「引用」写工具而不是本轮调用它们，
      // 因此单独下发可引用清单；助手的工具白名单同样约束该清单。
      const referenceableTools =
        planMode || variantMode
          ? WRITE_TOOL_NAMES.filter(
              (name) => !assistantWhitelist || assistantWhitelist.includes(name),
            )
          : [];

      for (const skill of activated) {
        sendEvent(res, "skill_activated", {
          code: skill.code,
          name: skill.name,
          score: skill.score,
          reasons: skill.reasons,
          category: skill.category,
          tools: skill.toolNames,
        });
      }

      // 8) 历史窗口 + 系统提示词
      const window = session
        ? await buildConversationWindow({ sessionId: session.id })
        : { messages: [], summary: null, droppedCount: 0, usedChars: 0 };

      const historyMessages = session
        ? toProviderMessages(window.messages)
        : currentTurnMessages(turn);
      const systemPrompt = composeSystemPrompt({
        assistantPrompt: assistant?.prompt ?? null,
        assistantName: assistant?.name ?? null,
        activatedSkills: activated,
        allowedTools,
        referenceableTools,
        canvasContext: turn.canvasContext,
        historySummary: window.summary,
        round: turn.round,
        toolsEnabled: wantsTools,
        planMode,
        variantMode,
        designConventions: designConventionsText,
        versionMemory: versionMemoryText,
      });

      const contextChars =
        systemPrompt.length +
        historyMessages.reduce((total, message) => total + message.content.length, 0);

      metrics.observe("ai.context_chars", contextChars);
      sendEvent(res, "context", {
        chars: contextChars,
        historyMessages: historyMessages.length,
        dropped: window.droppedCount,
        hasSummary: Boolean(window.summary),
        toolsEnabled: wantsTools,
        allowedTools,
        skillCodes: activated.map((skill) => skill.code),
        hasDesignConventions: Boolean(designConventionsText),
        versionMemoryCount: versionRows.length,
        // 轮次上限由服务端下发：前端自行写死会和这里的校验漂移，第 N+1 轮必然 400
        maxRounds: Math.min(maxRounds, ABSOLUTE_MAX_ROUNDS),
        mode: variantMode ? "variants" : planMode ? "plan" : "direct",
      });

      const providerTurn: ProviderTurn = {
        systemPrompt,
        messages: historyMessages,
        allowedTools: wantsTools ? allowedTools : null,
        temperature: assistant?.temperature ?? model.temperature ?? undefined,
        topP: model.topP ?? undefined,
        maxOutputTokens: assistant?.maxTokens ?? model.maxOutputTokens ?? undefined,
      };

      // 9) 生成（首 token 前允许故障转移）
      const triedIds = [model.id];
      let emittedContent = false;
      let attemptModel: LLMModel = model;
      let result: ProviderResult | null = null;
      let fallbackCandidates: LLMModel[] = [];

      for (;;) {
        if (abort.signal.aborted) {
          tracker?.fail("client aborted");
          failureRecorded = true;
          metrics.increment("ai.aborted");
          await recordAiCallLog({
            traceId,
            userId,
            projectId: session?.projectId ?? null,
            sessionId: session?.id ?? null,
            assistantId: assistant?.id ?? null,
            provider: attemptModel.provider,
            modelRowId: attemptModel.id,
            modelId: attemptModel.modelId,
            status: "cancelled",
            errorCode: "CLIENT_ABORTED",
            round: turn.round,
            usage: resolveUsage({}, { promptChars: contextChars, completionChars: 0 }),
            latencyMs: Date.now() - startedAt,
            skillCodes: activated.map((skill) => skill.code),
          });
          res.end();
          return;
        }

        try {
          result = await streamWithProvider({
            model: attemptModel,
            turn: providerTurn,
            allowedTools: providerTurn.allowedTools,
            signal: abort.signal,
            handlers: {
              onContent: (text) => {
                emittedContent = true;
                sendEvent(res, "content", { content: text });
              },
            },
          });
          break;
        } catch (error) {
          const providerError = asProviderError(error);
          logger.warn("LLM provider attempt failed", {
            requestId: traceId,
            provider: attemptModel.provider,
            modelRowId: attemptModel.id,
            code: providerError.code,
            failover: providerError.failoverEligible && !emittedContent,
          });

          if (providerError.code === "PROVIDER_ABORTED") {
            tracker?.fail("client aborted");
            failureRecorded = true;
            metrics.increment("ai.aborted");
            res.end();
            return;
          }

          const canFailover =
            providerError.failoverEligible && !emittedContent && !abort.signal.aborted;
          if (canFailover) {
            if (fallbackCandidates.length === 0) {
              fallbackCandidates = await getFailoverCandidates({
                userId,
                excludeIds: triedIds,
                preferredProvider: attemptModel.provider,
                requiresTools: wantsTools,
              }).catch(() => [] as LLMModel[]);
            }
            const next = fallbackCandidates.find((candidate) => !triedIds.includes(candidate.id));
            if (next) {
              triedIds.push(next.id);
              fallbackCandidates = fallbackCandidates.filter((candidate) => candidate.id !== next.id);
              attemptModel = next;
              providerName = next.provider;
              sendEvent(res, "model_fallback", {
                from: triedIds[triedIds.length - 2],
                to: next.id,
                provider: next.provider,
                modelId: next.modelId,
                reason: providerError.code,
                message: `主模型暂不可用，已切换到 ${next.name}`,
              });
              metrics.increment("ai.failovers");
              continue;
            }
          }

          tracker?.fail(providerError.message);
          failureRecorded = true;
          await recordAiCallLog({
            traceId,
            userId,
            projectId: session?.projectId ?? null,
            sessionId: session?.id ?? null,
            assistantId: assistant?.id ?? null,
            provider: attemptModel.provider,
            modelRowId: attemptModel.id,
            modelId: attemptModel.modelId,
            status: "error",
            errorCode: providerError.code,
            round: turn.round,
            usage: resolveUsage({}, { promptChars: contextChars, completionChars: 0 }),
            latencyMs: Date.now() - startedAt,
            skillCodes: activated.map((skill) => skill.code),
          });
          sendEvent(res, "error", {
            error: providerError.message,
            code: providerError.code,
            retryable: providerError.retryable,
            requestId: traceId,
          });
          res.end();
          return;
        }
      }

      // 10) 工具校验与下发
      const validation = validateToolCalls(result.toolCalls, {
        allowedNames: wantsTools ? allowedTools : [],
        selectedIds: turn.canvasContext?.selectedIds ?? [],
      });

      for (const call of validation.accepted) {
        metrics.increment("ai.tool_calls");
        sendEvent(res, "tool_call", { toolCall: call });
      }
      for (const rejected of validation.rejected) {
        metrics.increment("ai.tool_rejected");
        sendEvent(res, "tool_rejected", {
          toolCallId: rejected.id,
          name: rejected.name,
          reason: rejected.reason,
          error: rejected.message,
          // 兼容旧字段：拒绝也带 toolCall，但前端按 event 判别处理
          toolCall: { id: rejected.id, name: rejected.name, arguments: {} },
        });
      }

      // 11) 助手消息落库
      // 助手行收录模型本轮发起的全部调用（含被拒），被拒的 tool 消息排在它之后，
      // 历史回放才能满足 provider 的 tool_call / tool 配对要求。
      const usage = resolveUsage(result.usage, {
        promptChars: contextChars,
        completionChars: result.content.length,
      });
      const modelCalls: ToolCallPayload[] = [
        ...validation.accepted,
        ...validation.rejected.map((rejected) => ({
          id: rejected.id,
          name: rejected.name,
          arguments: boundedArguments(rejected.arguments),
        })),
      ];
      let assistantMessageId: string | null = null;
      if (session) {
        const row = await persistMessage({
          sessionId: session.id,
          clientMessageId: `${turn.turnId}:r${turn.round}:assistant`,
          role: "assistant",
          content: result.content,
          toolCalls: modelCalls.length > 0 ? modelCalls : null,
          traceId,
          modelRowId: attemptModel.id,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          status: "complete",
          createdAt: nextRowAt(),
        });
        assistantMessageId = row.id;

        for (const rejected of validation.rejected) {
          await persistMessage({
            sessionId: session.id,
            clientMessageId: `${turn.turnId}:r${turn.round}:tool:${rejected.id}`,
            role: "tool",
            content: describeToolResult({
              toolName: rejected.name,
              ok: false,
              error: rejected.message,
            }),
            toolCallId: rejected.id,
            toolName: rejected.name,
            traceId,
            modelRowId: attemptModel.id,
            status: "rejected",
            createdAt: nextRowAt(),
          }).catch((error) => logger.warn("Failed to persist rejection", { error }));
        }
      }

      const cost = computeCost(attemptModel, usage);
      sendEvent(res, "usage", {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        reported: usage.reported,
        costUsd: cost,
        provider: attemptModel.provider,
        modelRowId: attemptModel.id,
        modelId: attemptModel.modelId,
      });

      await recordAiCallLog({
        traceId,
        userId,
        projectId: session?.projectId ?? null,
        sessionId: session?.id ?? null,
        assistantId: assistant?.id ?? null,
        provider: attemptModel.provider,
        modelRowId: attemptModel.id,
        modelId: attemptModel.modelId,
        status: "ok",
        round: turn.round,
        usage,
        latencyMs: Date.now() - startedAt,
        toolCallCount: validation.accepted.length,
        skillCodes: activated.map((skill) => skill.code),
      });

      sendEvent(res, "done", {
        done: true,
        traceId,
        sessionId: session?.id ?? null,
        messageId: assistantMessageId,
        turnId: turn.turnId,
        round: turn.round,
        finishReason: result.finishReason ?? (validation.accepted.length > 0 ? "tool_use" : "stop"),
        nextPhase: validation.accepted.length > 0 ? "tool_results" : null,
      });

      tracker.complete();
      res.end();
    } catch (error) {
      logger.error("LLM chat failed", { requestId: traceId, provider: providerName, error });
      if (!failureRecorded) {
        failureRecorded = true;
        metrics.increment("ai.failures");
      }
      tracker?.fail(error instanceof Error ? error.message : "unknown error");
      if (!headersSent) {
        res.status(500).json({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Failed to get response",
          code: "INTERNAL",
          requestId: req.requestId,
        });
      } else if (!res.writableEnded) {
        sendEvent(res, "error", {
          error: error instanceof Error ? error.message : "Unknown error",
          code: "INTERNAL",
          retryable: true,
          requestId: traceId,
        });
        res.end();
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      req.removeListener("close", onClose);
      if (headersSent) {
        logger.info("LLM chat finished", {
          requestId: traceId,
          provider: providerName,
          durationMs: Date.now() - startedAt,
          outcome: failureRecorded ? "failed" : "completed",
          phase: turn.phase,
          round: turn.round,
        });
      }
    }
  });

  return router;
}

const assistantWhitelistOf = (toolNames: unknown): string[] | null => assistantToolNames(toolNames);

function asProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError(
    "NETWORK",
    error instanceof Error ? error.message : "模型调用失败",
    true,
    true,
  );
}
