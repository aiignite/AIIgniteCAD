import React from "react";
import type { CandidateView } from "../../lib/skillCandidates";
import { describeSkillReasons } from "../../lib/skillCandidates";

interface SkillCandidateBarProps {
    candidates: CandidateView[];
    isResolving: boolean;
    error: string | null;
    removedCount: number;
    onRemove: (code: string) => void;
    onRestore: () => void;
}

const SkillCandidateBar: React.FC<SkillCandidateBarProps> = ({
    candidates,
    isResolving,
    error,
    removedCount,
    onRemove,
    onRestore,
}) => {
    if (candidates.length === 0 && !isResolving && !error && removedCount === 0) return null;

    return (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-cad-muted">
            <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px] text-cad-primary">
                    auto_awesome
                </span>
                候选技能
            </span>
            {isResolving && <span className="text-cad-muted">匹配中…</span>}
            {error && <span className="text-amber-500">解析失败：{error}</span>}
            {candidates.map((candidate) => (
                <span
                    key={candidate.code}
                    title={`${candidate.description || candidate.name}\n${describeSkillReasons(
                        candidate.reasons,
                    )}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${
                        candidate.pinned
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "border-cad-primary/30 bg-cad-primary/10 text-cad-primary"
                    }`}
                >
                    {candidate.pinned ? (
                        <span className="material-symbols-outlined text-[11px]">push_pin</span>
                    ) : null}
                    <span className="max-w-[10rem] truncate">{candidate.name}</span>
                    <span className="font-mono text-[9px] opacity-70">
                        {Math.round(candidate.score)}
                    </span>
                    {candidate.pinned ? null : (
                        <button
                            onClick={() => onRemove(candidate.code)}
                            className="rounded-full hover:bg-cad-primary/20"
                            title="本轮不注入该技能"
                            aria-label={`移除候选技能 ${candidate.name}`}
                        >
                            <span className="material-symbols-outlined text-[11px]">close</span>
                        </button>
                    )}
                </span>
            ))}
            {removedCount > 0 && (
                <button
                    onClick={onRestore}
                    className="px-1.5 py-0.5 rounded border border-cad-border hover:bg-cad-text/5 hover:text-cad-text"
                    title="恢复被移除的候选技能"
                >
                    恢复 {removedCount} 个
                </button>
            )}
        </div>
    );
};

export default SkillCandidateBar;
