/**
 * llm.ts — 模型注册表 CRUD、默认模型、连接测试与用量摘要
 *
 * 模型行携带调用参数（上下文窗口、最大输出、超时、是否支持工具）与价格，
 * 保存时用 urlGuard 校验端点，避免把 SSRF 地址或非法 provider 写进配置。
 * apiKey 只在写入时加密，任何响应都不回传密文。
 */

import { Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { body, matchedData, param } from "express-validator";
import { prisma } from "../lib/prisma";
import { AuthRequest, authenticate } from "../middleware/auth";
import { logger } from "../lib/logger";
import { hasValidationError } from "../lib/httpValidation";
import { encryptSecret } from "../lib/crypto";
import { toSafeLLMModel } from "../lib/serializers";
import { assertSafeLLMEndpoint, UnsafeEndpointError } from "../lib/urlGuard";
import { ProviderError, isKnownProvider, probeProvider } from "../services/aiEngine/providers";
import { summarizeUsage } from "../services/aiEngine/usageAccounting";

const router = Router();

router.use(authenticate);

const PROVIDERS = ["OpenAI", "Anthropic", "Google", "Ollama"];

const modelBody = [
  body("name").isString().withMessage("name must be a string").bail().trim().notEmpty()
    .withMessage("name is required").isLength({ max: 120 }).withMessage("name is too long"),
  body("provider").custom((value: unknown) => {
    if (typeof value !== "string" || !isKnownProvider(value)) {
      throw new Error(`provider must be one of ${PROVIDERS.join(", ")}`);
    }
    return true;
  }),
  body("modelId").isString().withMessage("modelId must be a string").bail().trim().notEmpty()
    .withMessage("modelId is required").isLength({ max: 160 }).withMessage("modelId is too long"),
  body("apiKey").optional().isString().withMessage("apiKey must be a string").isLength({ max: 4096 }),
  body("isActive").optional().isBoolean(),
  body("isDefault").optional().isBoolean(),
  body("supportsTools").optional().isBoolean(),
  body("contextWindow").optional().isInt({ min: 512, max: 10_000_000 }).withMessage("contextWindow must be between 512 and 10000000"),
  body("maxOutputTokens").optional({ nullable: true }).isInt({ min: 1, max: 1_000_000 }).withMessage("maxOutputTokens is out of range"),
  body("temperature").optional({ nullable: true }).isFloat({ min: 0, max: 2 }).withMessage("temperature must be between 0 and 2"),
  body("topP").optional({ nullable: true }).isFloat({ min: 0, max: 1 }).withMessage("topP must be between 0 and 1"),
  body("timeoutSeconds").optional().isInt({ min: 5, max: 600 }).withMessage("timeoutSeconds must be between 5 and 600"),
  body("promptPricePer1k").optional({ nullable: true }).isFloat({ min: 0, max: 1000 }).withMessage("promptPricePer1k is out of range"),
  body("completionPricePer1k").optional({ nullable: true }).isFloat({ min: 0, max: 1000 }).withMessage("completionPricePer1k is out of range"),
  body("configuration").optional().isObject().withMessage("configuration must be an object"),
  body("configuration.apiUrl").optional({ nullable: true }).isString().withMessage("apiUrl must be a string").isLength({ max: 512 }),
];

const idParam = param("id").isString().notEmpty();

/** 去掉 undefined 字段，交给 Prisma 的默认值处理 */
const compact = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

type ModelData = Prisma.LLMModelUncheckedCreateInput & Prisma.LLMModelUncheckedUpdateInput;

function buildData(
  fields: Record<string, any>,
  apiKey?: string,
  baseConfig?: Record<string, unknown>,
): ModelData {
  return compact({
    name: fields.name,
    provider: fields.provider,
    modelId: fields.modelId,
    isActive: fields.isActive,
    supportsTools: fields.supportsTools,
    contextWindow: fields.contextWindow,
    maxOutputTokens: fields.maxOutputTokens ?? null,
    temperature: fields.temperature ?? null,
    topP: fields.topP ?? null,
    timeoutSeconds: fields.timeoutSeconds,
    promptPricePer1k: fields.promptPricePer1k ?? null,
    completionPricePer1k: fields.completionPricePer1k ?? null,
    // 更新时前端可能只提交部分配置，与已存配置合并才不会抹掉 apiUrl
    configuration: { ...(baseConfig ?? {}), ...(fields.configuration ?? {}) },
    ...(typeof apiKey === "string" && apiKey.length > 0 ? { apiKeyEncrypted: encryptSecret(apiKey) } : {}),
  }) as ModelData;
}

/** 端点校验：Ollama 允许本地，其余走 urlGuard 的公网/白名单规则；返回错误信息或 null */
function assertEndpoint(apiUrl: unknown, provider: string): string | null {
  if (apiUrl === undefined || apiUrl === null || apiUrl === "") return null;
  try {
    // assertSafeLLMEndpoint 成功时返回规范化 URL，不能当成错误
    assertSafeLLMEndpoint(String(apiUrl), {
      provider,
      requireHttps: process.env.NODE_ENV === "production",
    });
    return null;
  } catch (error) {
    if (error instanceof UnsafeEndpointError) {
      return error.message;
    }
    throw error;
  }
}

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const models = await prisma.lLMModel.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return res.json({ models: models.map(toSafeLLMModel) });
  } catch (error) {
    logger.error("Get LLM models failed", { userId: req.user!.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to get LLM models" });
  }
});

/** 近 N 天用量摘要，供模型面板显示调用数、失败率与成本 */
router.get("/usage", async (req: AuthRequest, res: Response) => {
  try {
    const days = Math.min(Math.max(Number.parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 180);
    const summary = await summarizeUsage(req.user!.id, days);
    return res.json(summary);
  } catch (error) {
    logger.error("Usage summary failed", { userId: req.user!.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to summarize usage" });
  }
});

router.post("/", modelBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const fields = matchedData(req) as Record<string, any>;
    const endpointError = assertEndpoint(fields.configuration?.apiUrl, fields.provider);
    if (endpointError) {
      return res.status(400).json({ error: "INVALID_ENDPOINT", message: endpointError, code: "INVALID_ENDPOINT" });
    }

    const data = buildData(fields, fields.apiKey);
    const model = await prisma.lLMModel.create({
      data: {
        ...data,
        userId,
        isActive: fields.isActive ?? true,
        isDefault: false,
        supportsTools: fields.supportsTools ?? false,
        contextWindow: fields.contextWindow ?? 128_000,
        timeoutSeconds: fields.timeoutSeconds ?? 120,
      },
    });

    return res.status(201).json({ message: "LLM model created successfully", model: toSafeLLMModel(model) });
  } catch (error) {
    logger.error("Create LLM model failed", { userId: req.user!.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to create LLM model" });
  }
});

router.put("/:id", idParam, modelBody, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const existing = await prisma.lLMModel.findFirst({ where: { id, userId } });
    if (!existing) {
      return res.status(404).json({ error: "Not Found", message: "LLM model not found" });
    }

    const fields = matchedData(req) as Record<string, any>;
    const storedConfig = (existing.configuration ?? {}) as Record<string, unknown>;
    const apiUrl = fields.configuration?.apiUrl ?? storedConfig.apiUrl;
    const endpointError = assertEndpoint(apiUrl, fields.provider);
    if (endpointError) {
      return res.status(400).json({ error: "INVALID_ENDPOINT", message: endpointError, code: "INVALID_ENDPOINT" });
    }

    const data = buildData(fields, fields.apiKey, storedConfig);
    await prisma.lLMModel.update({ where: { id }, data });

    const updated = await prisma.lLMModel.findUnique({ where: { id } });
    return res.json({
      message: "LLM model updated successfully",
      model: updated ? toSafeLLMModel(updated) : null,
    });
  } catch (error) {
    logger.error("Update LLM model failed", { modelId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to update LLM model" });
  }
});

/** 设为默认：同一用户范围内只保留一个默认模型 */
router.post("/:id/default", idParam, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const userId = req.user!.id;
    const model = await prisma.lLMModel.findFirst({ where: { id: req.params.id, userId } });
    if (!model) {
      return res.status(404).json({ error: "Not Found", message: "LLM model not found" });
    }
    if (!model.isActive) {
      return res.status(400).json({
        error: "MODEL_DISABLED",
        message: "模型已停用，请先启用后再设为默认",
        code: "MODEL_DISABLED",
      });
    }

    await prisma.$transaction([
      prisma.lLMModel.updateMany({ where: { userId }, data: { isDefault: false } }),
      prisma.lLMModel.update({ where: { id: model.id }, data: { isDefault: true } }),
    ]);

    return res.json({ message: "Default model updated", model: toSafeLLMModel(model) });
  } catch (error) {
    logger.error("Set default model failed", { modelId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to set default model" });
  }
});

/** 测试连接：最小非流式请求，成功即返回 ok，失败回传可展示的中文原因 */
router.post("/:id/test", idParam, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const model = await prisma.lLMModel.findFirst({
      where: { id: req.params.id, OR: [{ userId: req.user!.id }, { userId: null }] },
    });
    if (!model) {
      return res.status(404).json({ error: "Not Found", message: "LLM model not found" });
    }

    const started = Date.now();
    await probeProvider({ model });
    return res.json({ ok: true, latencyMs: Date.now() - started, model: toSafeLLMModel(model) });
  } catch (error) {
    if (error instanceof ProviderError) {
      return res.status(200).json({ ok: false, code: error.code, message: error.message, retryable: error.retryable });
    }
    logger.error("Test LLM model failed", { modelId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to test LLM model" });
  }
});

router.delete("/:id", idParam, async (req: AuthRequest, res: Response) => {
  if (hasValidationError(req, res)) return;
  try {
    const deleted = await prisma.lLMModel.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    if (deleted.count === 0) {
      return res.status(404).json({ error: "Not Found", message: "LLM model not found" });
    }
    return res.json({ message: "LLM model deleted successfully" });
  } catch (error) {
    logger.error("Delete LLM model failed", { modelId: req.params.id, error });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete LLM model" });
  }
});

export default router;
