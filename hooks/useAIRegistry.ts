/**
 * useAIRegistry — 模型 / 助手 / 技能三张注册表的共享状态
 *
 * 面板只做展示与表单，写入统一走这里：失败转成 AIErrorInfo 供界面显示，
 * 成功后按需重拉列表，避免各面板各自维护一份会漂移的副本。
 */

import { useCallback, useEffect, useState } from "react";
import type { AiSkill, Assistant, AssistantInput, LLMModel, LLMModelInput, SkillInput } from "../types";
import { apiService } from "../services/apiService";
import { toAIErrorInfo, type AIErrorInfo } from "../lib/aiErrors";

export interface ModelTestResult {
    ok: boolean;
    latencyMs?: number;
    message?: string;
}

interface RegistryRows {
    models: LLMModel[];
    assistants: Assistant[];
    skills: AiSkill[];
}

/** 三张表一起拉：面板之间共享同一份快照，避免各自刷新导致互看不一致 */
const fetchRegistry = async (): Promise<RegistryRows> => {
    const [models, assistants, skills] = await Promise.all([
        apiService.getLLMModels(),
        apiService.getAssistants(),
        apiService.getSkills(),
    ]);
    return { models: models.models, assistants: assistants.assistants, skills: skills.skills };
};

export interface UseAIRegistryResult {
    models: LLMModel[];
    assistants: Assistant[];
    skills: AiSkill[];
    error: AIErrorInfo | null;
    dismissError: () => void;
    refresh: () => Promise<void>;
    saveModel: (id: string | null, input: LLMModelInput) => Promise<boolean>;
    removeModel: (id: string) => Promise<boolean>;
    markDefaultModel: (id: string) => Promise<boolean>;
    testModel: (id: string) => Promise<ModelTestResult | null>;
    saveAssistant: (id: string | null, input: AssistantInput) => Promise<boolean>;
    removeAssistant: (id: string) => Promise<boolean>;
    saveSkill: (id: string | null, input: SkillInput) => Promise<boolean>;
    toggleSkill: (id: string, isEnabled: boolean) => Promise<boolean>;
    cloneSkill: (id: string) => Promise<boolean>;
    removeSkill: (id: string) => Promise<boolean>;
}

export function useAIRegistry(): UseAIRegistryResult {
    const [rows, setRows] = useState<RegistryRows>({ models: [], assistants: [], skills: [] });
    const [error, setError] = useState<AIErrorInfo | null>(null);

    const applyRows = useCallback((next: RegistryRows) => setRows(next), []);

    useEffect(() => {
        void fetchRegistry().then(applyRows, (loadError: unknown) =>
            setError(toAIErrorInfo(loadError)),
        );
    }, [applyRows]);

    const refresh = useCallback(async () => {
        try {
            applyRows(await fetchRegistry());
        } catch (loadError) {
            setError(toAIErrorInfo(loadError));
        }
    }, [applyRows]);

    const run = useCallback(
        async (action: () => Promise<unknown>): Promise<boolean> => {
            setError(null);
            try {
                await action();
                applyRows(await fetchRegistry());
                return true;
            } catch (actionError) {
                setError(toAIErrorInfo(actionError));
                return false;
            }
        },
        [applyRows],
    );

    return {
        models: rows.models,
        assistants: rows.assistants,
        skills: rows.skills,
        error,
        dismissError: () => setError(null),
        refresh,
        saveModel: (id, input) =>
            run(() =>
                id ? apiService.updateLLMModel(id, input) : apiService.createLLMModel(input),
            ),
        removeModel: (id) => run(() => apiService.deleteLLMModel(id)),
        markDefaultModel: (id) => run(() => apiService.setDefaultLLMModel(id)),
        testModel: async (id) => {
            setError(null);
            try {
                const result = await apiService.testLLMModel(id);
                return { ok: result.ok, latencyMs: result.latencyMs, message: result.message };
            } catch (testError) {
                const info = toAIErrorInfo(testError);
                setError(info);
                return { ok: false, message: info.message };
            }
        },
        saveAssistant: (id, input) =>
            run(() =>
                id ? apiService.updateAssistant(id, input) : apiService.createAssistant(input),
            ),
        removeAssistant: (id) => run(() => apiService.deleteAssistant(id)),
        saveSkill: (id, input) =>
            run(() => (id ? apiService.updateSkill(id, input) : apiService.createSkill(input))),
        toggleSkill: (id, isEnabled) => run(() => apiService.setSkillEnabled(id, isEnabled)),
        cloneSkill: (id) => run(() => apiService.cloneSkill(id)),
        removeSkill: (id) => run(() => apiService.deleteSkill(id)),
    };
}
