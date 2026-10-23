/**
 * aiErrors.ts — AI 错误码 → 中文文案与可重试判定
 *
 * 服务端已返回中文 message，这里负责补齐"下一步该做什么"的提示，并决定
 * UI 上是否提供重试入口；未知 code 一律保留原文，避免掩盖真实原因。
 */

export interface AIErrorInfo {
    code: string;
    message: string;
    /** 是否值得原地重试（鉴权/参数类错误重试只会再失败一次） */
    retryable: boolean;
    hint?: string;
}

interface ErrorSpec {
    message: string;
    retryable: boolean;
    hint?: string;
}

const SPECS: Record<string, ErrorSpec> = {
    PROVIDER_AUTH: {
        message: "模型鉴权失败，请检查 API Key 是否正确或已过期",
        retryable: false,
        hint: "到「模型」面板重新填写 API Key 并测试连接",
    },
    PROVIDER_RATE_LIMIT: {
        message: "模型服务限流，已暂停本次请求",
        retryable: true,
        hint: "稍等十几秒后重试，或降低发送频率",
    },
    PROVIDER_BAD_REQUEST: {
        message: "模型拒绝了本次请求，可能是参数或工具不被支持",
        retryable: false,
        hint: "尝试关闭工具调用，或换一条更简短的指令",
    },
    PROVIDER_UNAVAILABLE: {
        message: "模型服务暂时不可用",
        retryable: true,
        hint: "可切换默认模型或稍后重试",
    },
    PROVIDER_TIMEOUT: {
        message: "模型响应超时",
        retryable: true,
        hint: "在模型面板调大超时时间，或减少一次要求的内容",
    },
    PROVIDER_UNSUPPORTED: {
        message: "暂不支持的模型服务商",
        retryable: false,
        hint: "请选择 OpenAI / Anthropic / Google / Ollama",
    },
    PROVIDER_ABORTED: { message: "请求已取消", retryable: false },
    PROVIDER_NO_BODY: { message: "模型服务没有返回内容", retryable: true },
    NETWORK: {
        message: "无法连接模型服务，请检查端点与网络",
        retryable: true,
        hint: "本地模型请确认 Ollama 正在运行",
    },
    MODEL_NOT_FOUND: {
        message: "模型不存在或已被删除",
        retryable: false,
        hint: "在模型面板重新选择模型",
    },
    MODEL_DISABLED: {
        message: "模型已停用",
        retryable: false,
        hint: "在模型面板启用该模型",
    },
    MODEL_FORBIDDEN: {
        message: "模型不属于当前用户，不能引用",
        retryable: false,
        hint: "换成自己注册的模型或系统内置模型",
    },
    NO_MODEL_CONFIGURED: {
        message: "还没有可用的模型",
        retryable: false,
        hint: "先在模型面板注册一个模型并设为默认",
    },
    TOOL_ROUND_LIMIT: {
        message: "工具轮次已达上限",
        retryable: false,
        hint: "先预览当前结果，或在助手设置里调大最大工具轮次",
    },
    INVALID_ENDPOINT: {
        message: "模型端点不安全或被拒绝",
        retryable: false,
        hint: "公网端点需使用 https；内网 HTTP 需服务端开启 AI_ALLOW_PRIVATE_ENDPOINTS，内网域名需加入 AI_ALLOWED_ENDPOINTS",
    },
    RATE_LIMITED: {
        message: "请求过于频繁，请稍后重试",
        retryable: true,
    },
    UNAUTHORIZED: {
        message: "登录状态已失效",
        retryable: false,
        hint: "重新登录后再继续",
    },
    VALIDATION: { message: "请求参数不合法", retryable: false },
    INTERNAL: {
        message: "服务内部错误",
        retryable: true,
        hint: "稍后重试；持续失败请查看服务日志",
    },
    OFFLINE: {
        message: "当前处于离线状态，无法调用模型",
        retryable: true,
        hint: "恢复网络后重试，编辑内容仍保存在本地",
    },
    UNKNOWN: { message: "AI 请求失败", retryable: true },
};

const TOOL_REASONS: Record<string, string> = {
    UNKNOWN_TOOL: "模型调用了不存在的工具",
    TOOL_NOT_ALLOWED: "该工具不在助手或技能允许范围内",
    MALFORMED: "工具调用格式不完整",
    MISSING_ARGUMENT: "工具缺少必填参数",
    BAD_NUMBER: "工具参数不是合法数值",
    BAD_POINT: "坐标参数不合法",
    BAD_POINTS: "点序列不合法（需要 2–200 个点）",
    BAD_TEXT: "文本过长或为空",
    BAD_IDS: "引用了不存在的图元 id",
    NO_TARGET: "没有选中图元，且未提供 ids",
    TOO_MANY_CALLS: "单轮工具调用过多，已截断",
};

export function describeToolRejectReason(reason: string): string {
    return TOOL_REASONS[reason] ?? `工具调用被拒绝（${reason}）`;
}

/** 优先展示服务端原文，缺失时回落到 code 对应文案 */
export function describeAIError(code?: string | null, serverMessage?: string): AIErrorInfo {
    const key = code && SPECS[code] ? code : "UNKNOWN";
    const spec = SPECS[key];
    const message = serverMessage && serverMessage.trim() ? serverMessage.trim() : spec.message;
    return { code: key, message, retryable: spec.retryable, hint: spec.hint };
}

/** HTTP 状态码到错误码：非 SSE 场景（如 401/429 的 JSON 响应）也复用同一套文案 */
export function errorCodeFromStatus(status: number): string {
    if (status === 401 || status === 403) return "UNAUTHORIZED";
    if (status === 429) return "RATE_LIMITED";
    if (status === 400) return "VALIDATION";
    if (status >= 500) return "INTERNAL";
    return "UNKNOWN";
}

/**
 * AI 接口错误：保留服务端 code，UI 才能给出中文文案与"是否可重试"。
 * fetch 被中断时用 AbortError 语义单独判定，不当成失败展示。
 */
export class AIRequestError extends Error {
    readonly info: AIErrorInfo;
    readonly status?: number;
    readonly requestId?: string;

    constructor(
        code: string | null | undefined,
        serverMessage: string | null | undefined,
        options: { status?: number; requestId?: string; retryable?: boolean } = {},
    ) {
        const base = describeAIError(code ?? (options.status ? errorCodeFromStatus(options.status) : null), serverMessage);
        super(base.message);
        this.name = "AIRequestError";
        this.info = {
            ...base,
            retryable: options.retryable ?? base.retryable,
        };
        this.status = options.status;
        this.requestId = options.requestId;
    }
}

export const isAbortError = (error: unknown): boolean =>
    error instanceof Error && error.name === "AbortError";

/** 把任意抛出的异常归一化成可展示的 AI 错误信息（网络失败、401、SSE error 都走这里） */
export function toAIErrorInfo(error: unknown): AIErrorInfo {
    if (isAbortError(error)) {
        return describeAIError("PROVIDER_ABORTED");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return describeAIError("OFFLINE");
    }
    if (error instanceof AIRequestError) return error.info;
    if (error instanceof Error) {
        const withCode = error as Error & { code?: string; status?: number };
        if (withCode.code || withCode.status) {
            return describeAIError(
                withCode.code ?? errorCodeFromStatus(withCode.status as number),
                error.message,
            );
        }
        return describeAIError("NETWORK", error.message);
    }
    return describeAIError("UNKNOWN");
}
