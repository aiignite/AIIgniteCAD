/**
 * modelResolver.ts — LLM 模型解析链与故障转移候选
 *
 * 解析顺序固定为：显式 modelId → 会话绑定模型 → 助手模型 → 用户默认 →
 * 系统默认（userId=null）→ 任一 active 模型（用户优先）。
 * 助手与会话引用的模型必须校验归属，否则一个助手就能借用其他用户的密钥。
 */

import { LLMModel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

export type ModelResolveReason =
  | "explicit"
  | "session"
  | "assistant"
  | "user_default"
  | "system_default"
  | "any_active";

export type ModelErrorCode =
  | "MODEL_NOT_FOUND"
  | "MODEL_DISABLED"
  | "MODEL_FORBIDDEN"
  | "NO_MODEL_CONFIGURED";

export class ModelResolutionError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelResolutionError";
  }
}

export interface ResolvedModel {
  model: LLMModel;
  reason: ModelResolveReason;
}

export interface ResolveChatModelInput {
  userId: string;
  /** 显式选择的模型行 id */
  modelId?: string | null;
  /** 会话上持久化的模型行 id */
  sessionModelId?: string | null;
  /** 助手配置的模型行 id */
  assistantModelId?: string | null;
  /** 本轮是否需要 function calling */
  requiresTools?: boolean;
}

const owns = (model: LLMModel, userId: string): boolean =>
  model.userId === userId || model.userId === null;

/** 归属校验 + 启用校验；失败抛 ModelResolutionError，由路由转成 SSE error 事件 */
export function assertUsableModel(model: LLMModel, userId: string): LLMModel {
  if (!owns(model, userId)) {
    throw new ModelResolutionError("MODEL_FORBIDDEN", "模型不属于当前用户");
  }
  if (!model.isActive) {
    throw new ModelResolutionError("MODEL_DISABLED", "模型已停用，请在模型面板重新启用");
  }
  return model;
}

export type ModelAccess =
  | { ok: true; model: LLMModel }
  | { ok: false; code: "MODEL_NOT_FOUND" | "MODEL_FORBIDDEN" | "MODEL_DISABLED"; message: string };

/** 表单保存前的归属校验：不抛异常，返回可直接响应的错误码 */
export async function checkModelAccess(modelRowId: string, userId: string): Promise<ModelAccess> {
  const model = await prisma.lLMModel.findFirst({ where: { id: modelRowId } });
  if (!model) {
    return { ok: false, code: "MODEL_NOT_FOUND", message: "模型不存在或已被删除" };
  }
  if (!owns(model, userId)) {
    return { ok: false, code: "MODEL_FORBIDDEN", message: "模型不属于当前用户，不能引用" };
  }
  if (!model.isActive) {
    return { ok: false, code: "MODEL_DISABLED", message: `模型 ${model.name} 已停用，请先启用` };
  }
  return { ok: true, model };
}

async function loadModel(modelRowId: string, userId: string): Promise<LLMModel> {
  const model = await prisma.lLMModel.findFirst({ where: { id: modelRowId } });
  if (!model) {
    throw new ModelResolutionError("MODEL_NOT_FOUND", "模型不存在或已被删除");
  }
  return assertUsableModel(model, userId);
}

export async function resolveChatModel(
  input: ResolveChatModelInput,
): Promise<ResolvedModel> {
  const { userId, modelId, sessionModelId, assistantModelId, requiresTools } = input;

  // 显式与会话级选择必须可用，静默降级会让用户以为在用 A 实际在用 B
  if (modelId) {
    return { model: await loadModel(modelId, userId), reason: "explicit" };
  }
  if (sessionModelId) {
    return { model: await loadModel(sessionModelId, userId), reason: "session" };
  }

  if (assistantModelId) {
    const assistantModel = await prisma.lLMModel
      .findFirst({ where: { id: assistantModelId } })
      .then((model) => (model ? assertUsableModel(model, userId) : null))
      .catch((error) => {
        if (error instanceof ModelResolutionError && error.code === "MODEL_FORBIDDEN") throw error;
        return null;
      });
    if (assistantModel) {
      if (!requiresTools || assistantModel.supportsTools) {
        return { model: assistantModel, reason: "assistant" };
      }
      logger.info("Assistant model lacks tool support, continuing resolve chain", {
        modelId: assistantModel.id,
      });
    }
  }

  const candidate =
    (await pickOne({ userId, isDefault: true, isActive: true }, requiresTools)) ??
    (await pickOne({ userId: null, isDefault: true, isActive: true }, requiresTools)) ??
    (await pickOne({ userId, isActive: true }, requiresTools)) ??
    (await pickOne({ userId: null, isActive: true }, requiresTools)) ??
    (await pickOne({ userId }, requiresTools)) ??
    (await pickOne({ userId: null }, requiresTools));

  if (!candidate) {
    throw new ModelResolutionError(
      "NO_MODEL_CONFIGURED",
      requiresTools
        ? "没有支持工具调用的可用模型，请在模型面板启用一个"
        : "还没有可用模型，请在模型面板添加或启用一个模型",
    );
  }
  return {
    model: candidate.row,
    reason: candidate.row.userId === null ? "system_default" : "user_default",
  };
}

interface Pick {
  row: LLMModel;
}

async function pickOne(
  where: Record<string, unknown>,
  requiresTools?: boolean,
): Promise<Pick | null> {
  const row = await prisma.lLMModel.findFirst({
    where: {
      ...where,
      ...(requiresTools ? { supportsTools: true } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  return row ? { row } : null;
}

/**
 * 故障转移候选：排除已尝试过的模型，优先同 provider（鉴权与参数语义接近），
 * 其次需要工具时只保留 supportsTools 的模型。
 */
export async function getFailoverCandidates(input: {
  userId: string;
  excludeIds: string[];
  preferredProvider?: string;
  requiresTools?: boolean;
  limit?: number;
}): Promise<LLMModel[]> {
  const { userId, excludeIds, preferredProvider, requiresTools, limit = 3 } = input;
  const rows = await prisma.lLMModel.findMany({
    where: {
      OR: [{ userId }, { userId: null }],
      isActive: true,
      ...(requiresTools ? { supportsTools: true } : {}),
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  const sameProvider = preferredProvider
    ? rows.filter((row) => row.provider === preferredProvider)
    : [];
  const others = rows.filter((row) => !preferredProvider || row.provider !== preferredProvider);
  return [...sameProvider, ...others].slice(0, limit);
}
