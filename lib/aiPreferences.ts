/**
 * aiPreferences.ts — AI 偏好的本地存储边界
 *
 * 只负责「默认模型」这一项偏好的读写：跟随助手时不落具体模型 id，
 * 由会话侧决定用哪个模型。存储不可用（隐私模式 / SSR）时静默退化为默认值。
 * 与 lib/aiWindowGeometry.ts 一致，读写函数接受注入的 storage 以便未来单测。
 */

export const AI_PREFERENCES_STORAGE_KEY = "cad_ai_default_model_v1";

/** 下拉框里「跟随助手」的哨兵值：不覆盖助手绑定的模型 */
export const FOLLOW_ASSISTANT_VALUE = "follow";

export interface AIPreferences {
    /** null 表示跟随助手绑定的模型 */
    defaultModelId: string | null;
}

export const DEFAULT_AI_PREFERENCES: AIPreferences = { defaultModelId: null };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
        return null;
    }
}

function normalizeModelId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === FOLLOW_ASSISTANT_VALUE) return null;
    return trimmed;
}

/** 存档结构可能被旧版本或手工改动破坏，任何异常都退回默认偏好 */
function isPreferredShape(value: unknown): value is { defaultModelId?: unknown } {
    return Boolean(value) && typeof value === "object";
}

export function readAIPreferences(storage: StorageLike | null = defaultStorage()): AIPreferences {
    if (!storage) return { ...DEFAULT_AI_PREFERENCES };
    try {
        const raw = storage.getItem(AI_PREFERENCES_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_AI_PREFERENCES };
        const parsed: unknown = JSON.parse(raw);
        if (!isPreferredShape(parsed)) return { ...DEFAULT_AI_PREFERENCES };
        return { defaultModelId: normalizeModelId(parsed.defaultModelId) };
    } catch {
        return { ...DEFAULT_AI_PREFERENCES };
    }
}

/** 写失败不影响本会话生效的偏好，返回 false 让调用方可提示 */
export function writeAIPreferences(
    preferences: AIPreferences,
    storage: StorageLike | null = defaultStorage(),
): boolean {
    if (!storage) return false;
    try {
        const next: AIPreferences = {
            defaultModelId: normalizeModelId(preferences.defaultModelId),
        };
        storage.setItem(AI_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
        return true;
    } catch {
        return false;
    }
}

/** 下拉框取值 → 偏好对象：跟随助手与空串都表示不覆盖 */
export function preferencesFromSelect(value: string): AIPreferences {
    return { defaultModelId: normalizeModelId(value) };
}

export function selectValueFromPreferences(preferences: AIPreferences): string {
    return preferences.defaultModelId ?? FOLLOW_ASSISTANT_VALUE;
}
