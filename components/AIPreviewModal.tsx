/**
 * AIPreviewModal.tsx — AI 变更预览
 *
 * 在写入画布前展示结果与差异；确认后由上层一次性提交，
 * 因此整批 AI 操作只占一步撤销。CLEAR 或批量删除需要额外勾选确认。
 */

import React, { useEffect, useMemo, useState } from "react";
import type { AIActionResponse, CADElement, DesignConventions } from "../types";
import { diffElementSets, summarizeElementTypes } from "../lib/versionDiff";
import { AI_GHOST_COLORS } from "../lib/aiGhost";
import { REVIEW_SEVERITY_LABELS } from "../lib/designReview";
import { reviewPreview } from "../lib/previewReview";
import ElementPreview from "./ElementPreview";

const BULK_DELETE_THRESHOLD = 5;
const MAX_REVIEW_ITEMS = 5;

interface AIPreviewModalProps {
    actions: AIActionResponse[];
    beforeElements: CADElement[];
    afterElements: CADElement[];
    /** 项目设计约定；质量门禁会按约定检查图层与字高 */
    conventions?: DesignConventions | null;
    onApply: () => void;
    onCancel: () => void;
}

const describeOperation = (action: AIActionResponse): string => {
    const count = action.elements?.length ?? 0;
    const target = count ? `${count} 个图元` : "选中图元";
    switch (action.operation) {
        case "ADD":
            return `新增 ${count} 个图元`;
        case "CLEAR":
            return "清空整个画布";
        case "DELETE_LAST":
            return "删除最后一个图元";
        case "COPY":
            return `复制 ${target}`;
        case "MOVE":
            return `移动 ${target}`;
        case "ROTATE":
            return `旋转 ${target}`;
        case "MIRROR":
            return `镜像 ${target}`;
        case "SCALE":
            return `缩放 ${target}`;
        case "OFFSET":
            return `偏移 ${target}`;
        case "ARRAY":
            return `阵列 ${target}`;
        case "ALIGN":
            return `对齐 ${target}`;
        case "DISTRIBUTE":
            return `等距分布 ${target}`;
        case "SET_LAYER":
            return `设置 ${target} 的图层`;
        case "DELETE":
            return `删除 ${target}`;
        default:
            return action.operation ?? "变更";
    }
};

export const AIPreviewModal: React.FC<AIPreviewModalProps> = ({
    actions,
    beforeElements,
    afterElements,
    conventions,
    onApply,
    onCancel,
}) => {
    const diff = useMemo(
        () => diffElementSets(beforeElements, afterElements),
        [beforeElements, afterElements],
    );
    const review = useMemo(
        () => reviewPreview(beforeElements, afterElements, conventions ?? undefined),
        [beforeElements, afterElements, conventions],
    );
    const clearsCanvas = actions.some((action) => action.operation === "CLEAR");
    const destructive = clearsCanvas || diff.removed.length >= BULK_DELETE_THRESHOLD;
    const [confirmed, setConfirmed] = useState(!destructive);
    const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
    // 收起为底部工具条，让幽灵层在真实图纸上可见
    const [peek, setPeek] = useState(false);

    const blockedByReview = review.hasErrors && !reviewAcknowledged;
    const canApply = !(destructive && !confirmed) && !blockedByReview;

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") onCancel();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onCancel]);

    const warning = clearsCanvas
        ? `这会清空画布上的全部 ${beforeElements.length} 个图元。`
        : diff.removed.length >= BULK_DELETE_THRESHOLD
            ? `这会删除 ${beforeElements.length} 个图元中的 ${diff.removed.length} 个。`
            : null;

    const proposalCount = diff.added.length + diff.modified.length;
    const removalCount = diff.removed.length + diff.modified.length;

    if (peek) {
        return (
            <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center pointer-events-none">
                <div
                    className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border border-cad-border bg-cad-panel/95 backdrop-blur px-4 py-2.5 shadow-2xl text-xs"
                    role="dialog"
                    aria-label="AI 幽灵预览"
                >
                    <span className="font-bold text-cad-text">AI 幽灵预览</span>
                    <span className="flex items-center gap-1.5 text-cad-muted">
                        <span
                            className="inline-block w-6 border-t-2 border-dashed"
                            style={{ borderColor: AI_GHOST_COLORS.incoming }}
                        />
                        提议 {proposalCount}
                    </span>
                    <span className="flex items-center gap-1.5 text-cad-muted">
                        <span
                            className="inline-block w-6 border-t-2 border-dashed"
                            style={{ borderColor: AI_GHOST_COLORS.outgoing }}
                        />
                        移除 {removalCount}
                    </span>
                    {destructive && !confirmed && (
                        <label className="flex items-center gap-1.5 text-red-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={confirmed}
                                onChange={(event) => setConfirmed(event.target.checked)}
                                aria-label="确认破坏性 AI 变更"
                            />
                            我已知晓风险
                        </label>
                    )}
                    {blockedByReview && (
                        <label className="flex items-center gap-1.5 text-red-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={reviewAcknowledged}
                                onChange={(event) => setReviewAcknowledged(event.target.checked)}
                                aria-label="确认接受检查错误"
                            />
                            检查有 {review.counts.error} 个错误，仍要应用
                        </label>
                    )}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPeek(false)}
                            className="px-3 py-1.5 rounded border border-cad-border text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                        >
                            返回详情
                        </button>
                        <button
                            onClick={onCancel}
                            className="px-3 py-1.5 rounded border border-cad-border text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                        >
                            取消
                        </button>
                        <button
                            onClick={onApply}
                            disabled={!canApply}
                            className="px-4 py-1.5 rounded bg-cad-primary hover:bg-cad-primaryHover disabled:opacity-50 text-white font-bold"
                        >
                            {clearsCanvas ? "清空画布" : "应用变更"}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="AI 变更预览"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onCancel();
            }}
        >
            <div className="bg-cad-panel border border-cad-border rounded-xl shadow-2xl w-[min(980px,95vw)] max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-cad-border">
                    <div>
                        <h2 className="text-base font-bold text-cad-text">AI 变更预览</h2>
                        <p className="text-[11px] text-cad-muted">
                            写入图纸前，请确认以下结果。
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setPeek(true)}
                            className="flex items-center gap-1 px-2 py-1.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                            title="在图纸上查看幽灵预览"
                        >
                            <span className="material-symbols-outlined text-[18px]">visibility</span>
                            在图纸中查看
                        </button>
                        <button
                            onClick={onCancel}
                            className="p-1.5 rounded hover:bg-cad-text/10 text-cad-muted hover:text-cad-text"
                            title="关闭预览"
                            aria-label="关闭 AI 预览"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_300px] overflow-y-auto md:overflow-hidden">
                    <div className="p-4 min-h-0">
                        <ElementPreview
                            elements={afterElements}
                            ariaLabel="AI 结果预览"
                            className="w-full h-72 md:h-full min-h-[288px] rounded-lg border border-cad-border bg-[#0b1220]"
                        />
                        {afterElements.length === 0 && (
                            <p className="-mt-40 relative text-center text-xs text-cad-muted">
                                应用后画布将为空。
                            </p>
                        )}
                    </div>

                    <div className="border-t md:border-t-0 md:border-l border-cad-border p-4 space-y-4 overflow-y-auto">
                        <div>
                            <h3 className="text-[10px] font-bold uppercase text-cad-muted mb-2">
                                计划动作
                            </h3>
                            <ul className="space-y-1.5">
                                {actions.map((action, index) => (
                                    <li
                                        key={`${action.operation}-${index}`}
                                        className="text-xs text-cad-text flex items-start gap-2"
                                    >
                                        <span className="text-cad-primary">›</span>
                                        <span>{describeOperation(action)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="rounded border border-cad-border bg-cad-bg/60 p-3">
                            <div className="text-[10px] font-bold uppercase text-cad-muted mb-2">
                                净变化
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <div>
                                    <div className="text-emerald-500 font-bold text-sm">
                                        +{diff.added.length}
                                    </div>
                                    <div
                                        className="text-[10px] text-cad-muted truncate"
                                        title={summarizeElementTypes(diff.added)}
                                    >
                                        {summarizeElementTypes(diff.added)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-red-400 font-bold text-sm">
                                        −{diff.removed.length}
                                    </div>
                                    <div
                                        className="text-[10px] text-cad-muted truncate"
                                        title={summarizeElementTypes(diff.removed)}
                                    >
                                        {summarizeElementTypes(diff.removed)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-amber-400 font-bold text-sm">
                                        ~{diff.modified.length}
                                    </div>
                                    <div className="text-[10px] text-cad-muted">修改</div>
                                </div>
                            </div>
                            <p className="mt-2 text-[10px] text-cad-muted">
                                应用后共 {afterElements.length} 个图元
                            </p>
                        </div>

                        {review.introduced.length > 0 && (
                            <div
                                className={`rounded border p-3 space-y-2 ${
                                    review.hasErrors
                                        ? "border-red-500/40 bg-red-500/10"
                                        : "border-amber-500/40 bg-amber-500/10"
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase text-cad-muted">
                                        自动检查
                                    </span>
                                    <span className="text-[10px] text-cad-muted">
                                        错误 {review.counts.error} · 警告 {review.counts.warning} · 提示{" "}
                                        {review.counts.info}
                                    </span>
                                </div>
                                <ul className="space-y-1">
                                    {review.introduced
                                        .slice(0, MAX_REVIEW_ITEMS)
                                        .map((issue) => (
                                            <li
                                                key={`${issue.code}-${issue.elementIds.join("-")}`}
                                                className="text-[10px] text-cad-text flex items-start gap-1.5"
                                            >
                                                <span
                                                    className={
                                                        issue.severity === "error"
                                                            ? "text-red-400"
                                                            : issue.severity === "warning"
                                                              ? "text-amber-400"
                                                              : "text-cad-muted"
                                                    }
                                                >
                                                    [{REVIEW_SEVERITY_LABELS[issue.severity]}]
                                                </span>
                                                <span className="break-words">{issue.message}</span>
                                            </li>
                                        ))}
                                </ul>
                                {review.introduced.length > MAX_REVIEW_ITEMS && (
                                    <p className="text-[10px] text-cad-muted">
                                        其余 {review.introduced.length - MAX_REVIEW_ITEMS} 条略。
                                    </p>
                                )}
                                {review.hasErrors && (
                                    <label className="flex items-start gap-2 text-[11px] text-cad-text cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={reviewAcknowledged}
                                            onChange={(event) =>
                                                setReviewAcknowledged(event.target.checked)
                                            }
                                            aria-label="确认接受检查错误"
                                            className="mt-0.5"
                                        />
                                        <span>我已检查以上错误，仍然应用本次变更。</span>
                                    </label>
                                )}
                            </div>
                        )}

                        {warning && (
                            <div className="rounded border border-red-500/40 bg-red-500/10 p-3 space-y-2">
                                <p className="text-[11px] text-red-400">{warning}</p>
                                <label className="flex items-start gap-2 text-[11px] text-cad-text cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={confirmed}
                                        onChange={(event) => setConfirmed(event.target.checked)}
                                        aria-label="确认破坏性 AI 变更"
                                        className="mt-0.5"
                                    />
                                    <span>我明白此操作只能用 Ctrl+Z 撤销。</span>
                                </label>
                            </div>
                        )}
                    </div>
                </div>

                <div className="px-5 py-3 border-t border-cad-border flex items-center justify-between gap-3">
                    <p className="text-[10px] text-cad-muted">
                        一次应用，整批动作只占一步撤销。
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={onCancel}
                            className="px-3 py-1.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                        >
                            取消
                        </button>
                        <button
                            onClick={onApply}
                            disabled={!canApply}
                            className="px-4 py-1.5 rounded bg-cad-primary hover:bg-cad-primaryHover disabled:opacity-50 text-white text-xs font-bold"
                        >
                            {clearsCanvas ? "清空画布" : "应用变更"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AIPreviewModal;
