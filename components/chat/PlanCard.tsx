import React, { useState } from "react";
import type { PlanProposal, PlanStatus, PlanStep } from "../../lib/aiPlan";
import { planToToolCalls } from "../../lib/aiPlan";
import { describeToolCall, toolLabel } from "../../lib/aiUi";

interface PlanCardProps {
    proposal: PlanProposal;
    status: PlanStatus;
    onApprove: (proposal: PlanProposal) => void;
    onDismiss: () => void;
}

const PlanStepRow: React.FC<{
    index: number;
    step: PlanStep;
    editable: boolean;
    total: number;
    onChange: (step: PlanStep) => void;
    onMove: (direction: -1 | 1) => void;
    onRemove: () => void;
}> = ({ index, step, editable, total, onChange, onMove, onRemove }) => (
    <li className="rounded-md border border-cad-border/80 bg-cad-bg/40 p-2 space-y-1">
        <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono text-cad-muted shrink-0">{index + 1}.</span>
            {editable ? (
                <input
                    aria-label={`计划步骤 ${index + 1} 标题`}
                    value={step.title}
                    onChange={(event) => onChange({ ...step, title: event.target.value })}
                    className="min-w-0 flex-1 px-1.5 py-0.5 rounded border border-cad-border bg-transparent text-[11px] text-cad-text"
                />
            ) : (
                <span className="min-w-0 flex-1 text-[11px] font-semibold text-cad-text">
                    {step.title}
                </span>
            )}
            {editable && (
                <span className="flex items-center gap-0.5 shrink-0">
                    <button
                        onClick={() => onMove(-1)}
                        disabled={index === 0}
                        title="上移"
                        className="p-0.5 rounded text-cad-muted hover:text-cad-text disabled:opacity-30"
                    >
                        <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                    </button>
                    <button
                        onClick={() => onMove(1)}
                        disabled={index === total - 1}
                        title="下移"
                        className="p-0.5 rounded text-cad-muted hover:text-cad-text disabled:opacity-30"
                    >
                        <span className="material-symbols-outlined text-[14px]">
                            arrow_downward
                        </span>
                    </button>
                    <button
                        onClick={onRemove}
                        title="移除此步骤"
                        className="p-0.5 rounded text-cad-muted hover:text-red-500"
                    >
                        <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                </span>
            )}
        </div>
        {step.detail && (
            <p className="text-[10px] text-cad-muted break-words pl-4">{step.detail}</p>
        )}
        {step.tool && (
            <p className="text-[10px] font-mono text-cad-primary/80 break-words pl-4">
                {toolLabel(step.tool)} ·{" "}
                {describeToolCall({
                    name: step.tool,
                    arguments: step.arguments ?? {},
                })}
            </p>
        )}
    </li>
);

const PlanCard: React.FC<PlanCardProps> = ({ proposal, status, onApprove, onDismiss }) => {
    const [steps, setSteps] = useState<PlanStep[]>(proposal.steps);
    const editable = status === "pending";
    const executable = planToToolCalls({ ...proposal, steps }).length > 0;

    const updateStep = (index: number, next: PlanStep) =>
        setSteps((prev) => prev.map((step, i) => (i === index ? next : step)));

    const moveStep = (index: number, direction: -1 | 1) =>
        setSteps((prev) => {
            const target = index + direction;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });

    return (
        <div className="rounded-lg border border-cad-primary/30 bg-cad-primary/5 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-cad-primary">
                    playlist_play
                </span>
                <span className="text-[11px] font-bold text-cad-text">执行计划</span>
                <span className="ml-auto text-[10px] px-1 rounded bg-cad-text/10 text-cad-muted">
                    {status === "pending"
                        ? "待确认"
                        : status === "approved"
                          ? "已确认"
                          : status === "failed"
                            ? "未能执行"
                            : "已取消"}
                </span>
            </div>

            <p className="text-[11px] text-cad-text break-words">{proposal.goal}</p>

            {proposal.assumptions.length > 0 && (
                <p className="text-[10px] text-cad-muted break-words">
                    假设：{proposal.assumptions.join("；")}
                </p>
            )}

            <ol className="space-y-1">
                {steps.map((step, index) => (
                    <PlanStepRow
                        key={`step-${index}`}
                        index={index}
                        step={step}
                        editable={editable}
                        total={steps.length}
                        onChange={(next) => updateStep(index, next)}
                        onMove={(direction) => moveStep(index, direction)}
                        onRemove={() =>
                            setSteps((prev) => prev.filter((_, item) => item !== index))
                        }
                    />
                ))}
            </ol>

            {proposal.checks.length > 0 && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 break-words">
                    完成后检查：{proposal.checks.join("；")}
                </p>
            )}
            {proposal.risks.length > 0 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 break-words">
                    风险：{proposal.risks.join("；")}
                </p>
            )}

            {editable ? (
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => onApprove({ ...proposal, steps })}
                        disabled={!executable}
                        title={executable ? undefined : "计划中没有可执行的写步骤"}
                        className="px-2.5 py-1 rounded text-[11px] bg-cad-primary text-white disabled:opacity-40"
                    >
                        执行计划
                    </button>
                    <button
                        onClick={onDismiss}
                        className="px-2.5 py-1 rounded text-[11px] border border-cad-border text-cad-muted hover:text-cad-text"
                    >
                        取消
                    </button>
                    <span className="text-[10px] text-cad-muted">
                        执行后仍会在预览中确认，只占一步撤销
                    </span>
                </div>
            ) : (
                <p className="text-[10px] text-cad-muted">
                    {status === "approved"
                        ? "计划已提交执行；请在预览中确认后写入图纸。"
                        : status === "failed"
                          ? "计划步骤未能应用，可能引用了不存在的图元或参数不合法；可重新描述需求再试。"
                          : "计划未执行，可重新描述需求再试。"}
                </p>
            )}
        </div>
    );
};

export default PlanCard;
