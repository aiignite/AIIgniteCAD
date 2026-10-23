/**
 * serializers.ts — 数据出参序列化
 *
 * 统一处理含敏感字段的模型，确保 API 响应中不出现密钥原文。
 */

import { decryptSecret, maskSecret } from "./crypto";

/**
 * 将 LLM 模型记录转换为可安全返回前端的结构
 * 去掉 apiKeyEncrypted，仅保留 hasApiKey 与脱敏预览
 * @param model 数据库中的 LLM 模型记录
 * @returns 安全对象
 */
export function toSafeLLMModel<T extends { apiKeyEncrypted?: string | null }>(model: T) {
    const { apiKeyEncrypted, ...rest } = model;
    let apiKeyPreview = "";
    try {
        apiKeyPreview = maskSecret(decryptSecret(apiKeyEncrypted));
    } catch {
        // 密钥缺失或无法解密时不影响列表展示，仅隐藏预览
        apiKeyPreview = "";
    }
    return {
        ...rest,
        hasApiKey: Boolean(apiKeyEncrypted),
        apiKeyPreview,
    };
}

/**
 * 将助手记录（可能内嵌 llmModel）转换为安全结构
 * @param assistant 助手记录
 * @returns 去掉内嵌模型密钥的助手对象
 */
export function toSafeAssistant<T extends { llmModel?: { apiKeyEncrypted?: string | null } | null }>(
    assistant: T,
) {
    if (!assistant.llmModel) return assistant;
    return {
        ...assistant,
        llmModel: toSafeLLMModel(assistant.llmModel),
    };
}
