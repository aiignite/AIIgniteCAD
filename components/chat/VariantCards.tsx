import React, { useMemo } from "react";
import type { CADElement } from "../../types";
import type { PlanStatus } from "../../lib/aiPlan";
import { variantToToolCalls, type DesignVariant, type VariantProposal } from "../../lib/aiVariants";
import {
    applyToolCalls,
    createDraft,
    diffElementCounts,
    type ElementChangeCounts,
} from "../../lib/aiAgentLoop";
import type { BlockCatalogEntry } from "../../lib/blockCatalog";
import ElementPreview from "../ElementPreview";

interface VariantCardsProps {
    proposal: VariantProposal;
    status: PlanStatus;
    selectedIndex: number | null;
    elements: CADElement[];
    selectedIds: ReadonlySet<string>;
    blockCatalog?: BlockCatalogEntry[];
    onChoose: (variant: DesignVariant, index: number) => void;
    onDismiss: () => void;
}

interface VariantPreview {
    executable: boolean;
    elements: CADElement[];
    counts: ElementChangeCounts;
    errors: number;
}

const MAX_PREVIEW_ELEMENTS = 120;
const MAX_VISIBLE_STEPS = 4;

/** 几何差分刻度：模型自述的步骤数不代表真实变化，卡片按草稿上的增删改计数 */
const diffLabel = (counts: ElementChangeCounts): string => {
    const parts: string[] = [];
    if (counts.added > 0) parts.push(`新增 ${counts.added}`);
    if (counts.modified > 0) parts.push(`修改 ${counts.modified}`);
    if (counts.removed > 0) parts.push(`移除 ${counts.removed}`);
    return ` · ${parts.length > 0 ? parts.join(" / ") : "无几何变化"}`;
};

const statusLabel = (status: PlanStatus): string =>
    status === "pending"
        ? "待选择"
        : status === "approved"
          ? "已采用"
          : status === "failed"
            ? "未能执行"
            : "已取消";

const VariantCards: React.FC<VariantCardsProps> = ({
    proposal,
    status,
    selectedIndex,
    elements,
    selectedIds,
    blockCatalog,
    onChoose,
    onDismiss,
}) => {
    const previews = useMemo<VariantPreview[]>(
        () =>
            proposal.variants.map((variant) => {
                const calls = variantToToolCalls(variant);
                if (calls.length === 0) {
                    return {
                        executable: false,
                        elements: [],
                        counts: { added: 0, modified: 0, removed: 0 },
                        errors: 0,
                    };
                }
                const outcome = applyToolCalls(
                    calls,
                    createDraft(elements, [...selectedIds], blockCatalog ?? []),
                );
                const changed = new Set<string>();
                for (const result of outcome.results) {
                    for (const id of result.changedIds ?? []) changed.add(id);
                }
                const previewElements = changed.size
                    ? outcome.draft.elements.filter((element) => changed.has(element.id))
                    : outcome.draft.elements;
                return {
                    executable: outcome.draft.actions.length > 0,
                    elements: previewElements.slice(0, MAX_PREVIEW_ELEMENTS),
                    counts: diffElementCounts(elements, outcome.draft.elements),
                    errors: outcome.results.filter((result) => !result.ok).length,
                };
            }),
        [proposal, elements, selectedIds, blockCatalog],
    );

    const pending = status === "pending";

    return (
        <div className="rounded-lg border border-cad-primary/30 bg-cad-primary/5 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-cad-primary">
                    compare_arrows
                </span>
                <span className="text-[11px] font-bold text-cad-text">方案对比</span>
                <span className="ml-auto text-[9px] px-1 rounded bg-cad-text/10 text-cad-muted">
                    {statusLabel(status)}
                </span>
            </div>
            <p className="text-[11px] text-cad-text break-words">{proposal.goal}</p>

            <div className="space-y-2">
                {proposal.variants.map((variant, index) => {
                    const preview = previews[index];
                    const selected = selectedIndex === index;
                    return (
                        <div
                            key={`variant-${index}`}
                            data-variant={index}
                            className={`rounded-md border p-2 space-y-1.5 ${
                                selected
                                    ? "border-emerald-500/60 bg-emerald-500/10"
                                    : "border-cad-border bg-cad-panel"
                            }`}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-semibold text-cad-text min-w-0 truncate">
                                    {index + 1}. {variant.name}
                                </span>
                                {selected && (
                                    <span className="material-symbols-outlined text-[14px] text-emerald-500 shrink-0">
                                        check_circle
                                    </span>
                                )}
                                <span className="ml-auto text-[9px] text-cad-muted shrink-0">
                                    {variant.steps.length} 步{diffLabel(preview.counts)}
                                </span>
                            </div>

                            {variant.summary && (
                                <p className="text-[10px] text-cad-muted break-words">
                                    {variant.summary}
                                </p>
                            )}

                            <ElementPreview
                                elements={preview.elements}
                                ariaLabel={`方案 ${variant.name} 预览`}
                                className="w-full h-24 rounded border border-cad-border bg-[#0b1220]"
                            />

                            <ol className="space-y-0.5">
                                {variant.steps
                                    .slice(0, MAX_VISIBLE_STEPS)
                                    .map((step, stepIndex) => (
                                        <li
                                            key={`step-${stepIndex}`}
                                            className="text-[10px] text-cad-muted truncate"
                                        >
                                            {stepIndex + 1}. {step.title}
                                        </li>
                                    ))}
                                {variant.steps.length > MAX_VISIBLE_STEPS && (
                                    <li className="text-[9px] text-cad-muted/80">
                                        …其余 {variant.steps.length - MAX_VISIBLE_STEPS} 步
                                    </li>
                                )}
                            </ol>

                            {preview.errors > 0 && (
                                <p className="text-[9px] text-amber-600 dark:text-amber-400">
                                    {preview.errors} 个步骤参数不合法，采用前请检查
                                </p>
                            )}

                            {pending && (
                                <button
                                    onClick={() => onChoose(variant, index)}
                                    disabled={!preview.executable}
                                    title={
                                        preview.executable
                                            ? "在草稿上执行该方案并进入预览"
                                            : "该方案没有可执行的写步骤"
                                    }
                                    className="w-full px-2 py-1 rounded text-[10px] bg-cad-primary text-white disabled:opacity-40"
                                >
                                    采用此方案
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {pending ? (
                <div className="flex items-center gap-2">
                    <button
                        onClick={onDismiss}
                        className="px-2 py-1 rounded text-[10px] border border-cad-border text-cad-muted hover:text-cad-text"
                    >
                        都不采用
                    </button>
                    <span className="text-[9px] text-cad-muted">
                        采用后仍会在预览中确认，只占一步撤销
                    </span>
                </div>
            ) : (
                <p className="text-[10px] text-cad-muted">
                    {status === "approved"
                        ? "方案已送入预览；确认后才会写入图纸。"
                        : status === "failed"
                          ? "所选方案未能应用，可能引用了不存在的图元或参数不合法。"
                          : "未采用任何方案，可重新描述需求再试。"}
                </p>
            )}
        </div>
    );
};

export default VariantCards;
