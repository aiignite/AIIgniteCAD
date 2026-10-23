/**
 * useSkillCandidates — 输入阶段的技能候选编排
 *
 * 防抖调用 /skills/resolve，返回与回合激活同一套打分的候选项；
 * 用户移除的候选不会随本轮回合下发，固定技能由 SkillPinMenu 单独管理。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiSkill, AiSkillCandidate, Assistant, SkillContextSignal } from "../types";
import { apiService } from "../services/apiService";
import {
    MAX_VISIBLE_CANDIDATES,
    candidateSignature,
    mergeVisibleCandidates,
    type CandidateView,
} from "../lib/skillCandidates";

export interface UseSkillCandidatesOptions {
    /** AI 浮窗关闭时暂停解析，避免隐藏面板持续打接口 */
    enabled: boolean;
    message: string;
    assistant: Assistant | null;
    skills: AiSkill[];
    pinnedSkillCodes: string[];
    recentSkillCodes: string[];
    historyTexts: string[];
    selectionTypes: string[];
    contextSignals: SkillContextSignal[];
    conversationId?: string | null;
    debounceMs?: number;
}

export interface UseSkillCandidatesResult {
    candidates: CandidateView[];
    isResolving: boolean;
    error: string | null;
    removedCodes: string[];
    /** 当前候选中被移除的数量，用于显示「恢复」 */
    removedCount: number;
    /** 随本轮回合下发的候选：不含固定技能（固定走 pinnedSkillCodes） */
    recommendedSkillCodes: string[];
    removeCandidate: (code: string) => void;
    restoreCandidates: () => void;
    reset: () => void;
}

const DEFAULT_DEBOUNCE = 450;

export function useSkillCandidates(options: UseSkillCandidatesOptions): UseSkillCandidatesResult {
    const {
        enabled,
        message,
        assistant,
        skills,
        pinnedSkillCodes,
        recentSkillCodes,
        historyTexts,
        selectionTypes,
        contextSignals,
        conversationId,
        debounceMs = DEFAULT_DEBOUNCE,
    } = options;

    const [resolved, setResolved] = useState<AiSkillCandidate[]>([]);
    const [isResolving, setIsResolving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [removedCodes, setRemovedCodes] = useState<string[]>([]);

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSignatureRef = useRef("");
    const requestSeqRef = useRef(0);

    const selectionKey = selectionTypes.join(",");
    const contextKey = contextSignals.join(",");
    const pinnedKey = pinnedSkillCodes.join(",");
    const recentKey = recentSkillCodes.join(",");
    const historyKey = historyTexts.join("|");
    const canResolve = enabled && (message.trim().length >= 2 || pinnedSkillCodes.length > 0);

    useEffect(() => {
        if (!enabled) {
            if (timerRef.current) clearTimeout(timerRef.current);
            return;
        }

        const trimmed = message.trim();
        const signature = `${candidateSignature({
            message,
            assistantId: assistant?.id,
            pinnedSkillCodes,
            recentSkillCodes,
            historyTexts,
        })}§${selectionKey}§${contextKey}§${conversationId ?? ""}`;

        // 输入太短且没有固定技能时没有解析价值；候选在渲染期按 canResolve 隐藏
        if (trimmed.length < 2 && pinnedSkillCodes.length === 0) {
            lastSignatureRef.current = signature;
            return;
        }
        if (signature === lastSignatureRef.current) return;

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            const seq = requestSeqRef.current + 1;
            requestSeqRef.current = seq;
            setIsResolving(true);
            setError(null);
            apiService
                .resolveSkills({
                    message: trimmed,
                    assistantId: assistant?.id ?? null,
                    selectionTypes,
                    contextSignals,
                    pinnedSkillCodes,
                    recentSkillCodes,
                    historyTexts,
                })
                .then(({ matchedSkills }) => {
                    if (requestSeqRef.current !== seq) return;
                    setResolved(Array.isArray(matchedSkills) ? matchedSkills : []);
                    lastSignatureRef.current = signature;
                })
                .catch((resolveError: unknown) => {
                    if (requestSeqRef.current !== seq) return;
                    setError(resolveError instanceof Error ? resolveError.message : "技能解析失败");
                })
                .finally(() => {
                    if (requestSeqRef.current === seq) setIsResolving(false);
                });
        }, debounceMs);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [
        enabled,
        message,
        assistant?.id,
        assistant,
        pinnedSkillCodes,
        pinnedKey,
        recentSkillCodes,
        recentKey,
        historyTexts,
        historyKey,
        selectionTypes,
        selectionKey,
        contextSignals,
        contextKey,
        conversationId,
        debounceMs,
    ]);

    const merged = useMemo(
        () =>
            mergeVisibleCandidates(canResolve ? resolved : [], pinnedSkillCodes, skills, {
                max: MAX_VISIBLE_CANDIDATES,
            }),
        [canResolve, resolved, pinnedSkillCodes, skills],
    );

    const removedSet = useMemo(() => new Set(removedCodes), [removedCodes]);
    const candidates = useMemo(
        () => merged.filter((candidate) => !removedSet.has(candidate.code)),
        [merged, removedSet],
    );
    const removedCount = useMemo(
        () => merged.filter((candidate) => removedSet.has(candidate.code)).length,
        [merged, removedSet],
    );

    const recommendedSkillCodes = useMemo(
        () =>
            candidates
                .filter((candidate) => !candidate.pinned)
                .map((candidate) => candidate.code)
                .slice(0, MAX_VISIBLE_CANDIDATES),
        [candidates],
    );

    const removeCandidate = useCallback((code: string) => {
        setRemovedCodes((prev) => (prev.includes(code) ? prev : [...prev, code]));
    }, []);

    const restoreCandidates = useCallback(() => setRemovedCodes([]), []);

    const reset = useCallback(() => {
        setRemovedCodes([]);
        setResolved([]);
        setError(null);
        lastSignatureRef.current = "";
    }, []);

    return {
        candidates,
        isResolving: isResolving && canResolve,
        error: canResolve ? error : null,
        removedCodes,
        removedCount,
        recommendedSkillCodes,
        removeCandidate,
        restoreCandidates,
        reset,
    };
}
