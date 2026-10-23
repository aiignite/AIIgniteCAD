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
import { reviewSeverityLabel } from "../lib/designReview";
import { reviewPreview } from "../lib/previewReview";
import ElementPreview from "./ElementPreview";
import { useI18n, type Translate } from "../lib/i18n";

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

const describeOperation = (action: AIActionResponse, t: Translate): string => {
    const count = action.elements?.length ?? 0;
    const target = count
        ? t("preview.target", { count })
        : t("preview.selectedTarget");
    switch (action.operation) {
        case "ADD":
            return t("preview.add", { count });
        case "CLEAR":
            return t("preview.clear");
        case "DELETE_LAST":
            return t("preview.deleteLast");
        case "COPY":
            return t("preview.copy", { target });
        case "MOVE":
            return t("preview.move", { target });
        case "ROTATE":
            return t("preview.rotate", { target });
        case "MIRROR":
            return t("preview.mirror", { target });
        case "SCALE":
            return t("preview.scale", { target });
        case "OFFSET":
            return t("preview.offset", { target });
        case "ARRAY":
            return t("preview.array", { target });
        case "ALIGN":
            return t("preview.align", { target });
        case "DISTRIBUTE":
            return t("preview.distribute", { target });
        case "SET_LAYER":
            return t("preview.setLayer", { target });
        case "DELETE":
            return t("preview.delete", { target });
        case "SAVE_BLOCK":
            return t("preview.saveBlock", {
                name: action.params?.blockName ?? t("preview.untitledBlock"),
                count,
            });
        case "SAVE_VERSION":
            return action.params?.versionMessage
                ? t("preview.saveVersionMessage", { message: action.params.versionMessage })
                : t("preview.saveVersion");
        default:
            return action.operation ?? t("preview.change");
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
    const { t, locale } = useI18n();
    const diff = useMemo(
        () => diffElementSets(beforeElements, afterElements),
        [beforeElements, afterElements],
    );
    const review = useMemo(
        () => reviewPreview(beforeElements, afterElements, conventions ?? undefined, locale),
        [beforeElements, afterElements, conventions, locale],
    );
    const clearsCanvas = actions.some((action) => action.operation === "CLEAR");
    const destructive = clearsCanvas || diff.removed.length >= BULK_DELETE_THRESHOLD;
    const sideEffects = actions.filter(
        (action) =>
            action.operation === "SAVE_BLOCK" || action.operation === "SAVE_VERSION",
    );
    const hasCanvasChanges =
        diff.added.length + diff.removed.length + diff.modified.length > 0;
    const canApplyWithoutChanges = sideEffects.length > 0;
    const [confirmed, setConfirmed] = useState(!destructive);
    const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
    // 收起为底部工具条，让幽灵层在真实图纸上可见
    const [peek, setPeek] = useState(false);

    const blockedByReview = review.hasErrors && !reviewAcknowledged;
    const canApply =
        (hasCanvasChanges || canApplyWithoutChanges) &&
        !(destructive && !confirmed) &&
        !blockedByReview;

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") onCancel();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onCancel]);

    const warning = clearsCanvas
        ? t("preview.warningClear", { count: beforeElements.length })
        : diff.removed.length >= BULK_DELETE_THRESHOLD
            ? t("preview.warningDelete", {
                  total: beforeElements.length,
                  removed: diff.removed.length,
              })
            : null;

    const proposalCount = diff.added.length + diff.modified.length;
    const removalCount = diff.removed.length + diff.modified.length;

    if (peek) {
        return (
            <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center pointer-events-none">
                <div
                    className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border border-cad-border bg-cad-panel/95 backdrop-blur px-4 py-2.5 shadow-2xl text-xs"
                    role="dialog"
                    aria-label={t("preview.ghost")}
                >
                    <span className="font-bold text-cad-text">{t("preview.ghost")}</span>
                    <span className="flex items-center gap-1.5 text-cad-muted">
                        <span
                            className="inline-block w-6 border-t-2 border-dashed"
                            style={{ borderColor: AI_GHOST_COLORS.incoming }}
                        />
                        {t("preview.proposed", { count: proposalCount })}
                    </span>
                    <span className="flex items-center gap-1.5 text-cad-muted">
                        <span
                            className="inline-block w-6 border-t-2 border-dashed"
                            style={{ borderColor: AI_GHOST_COLORS.outgoing }}
                        />
                        {t("preview.removedCount", { count: removalCount })}
                    </span>
                    {destructive && !confirmed && (
                        <label className="flex items-center gap-1.5 text-red-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={confirmed}
                                onChange={(event) => setConfirmed(event.target.checked)}
                                aria-label={t("preview.riskConfirm")}
                            />
                            {t("preview.riskAck")}
                        </label>
                    )}
                    {blockedByReview && (
                        <label className="flex items-center gap-1.5 text-red-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={reviewAcknowledged}
                                onChange={(event) => setReviewAcknowledged(event.target.checked)}
                                aria-label={t("preview.reviewConfirm")}
                            />
                            {t("preview.reviewAckShort", { count: review.counts.error })}
                        </label>
                    )}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPeek(false)}
                            className="px-3 py-1.5 rounded border border-cad-border text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                        >
                            {t("preview.back")}
                        </button>
                        <button
                            onClick={onCancel}
                            className="px-3 py-1.5 rounded border border-cad-border text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                        >
                            {t("common.cancel")}
                        </button>
                        <button
                            onClick={onApply}
                            disabled={!canApply}
                            className="px-4 py-1.5 rounded bg-cad-primary hover:bg-cad-primaryHover disabled:opacity-50 text-white font-bold"
                        >
                            {clearsCanvas
                                ? t("preview.clearCanvas")
                                : hasCanvasChanges
                                  ? t("preview.apply")
                                  : t("preview.applyAndSave")}
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
            aria-label={t("preview.aria")}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onCancel();
            }}
        >
            <div className="bg-cad-panel border border-cad-border rounded-xl shadow-2xl w-[min(980px,95vw)] max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-cad-border">
                    <div>
                        <h2 className="text-base font-bold text-cad-text">
                            {t("preview.title")}
                        </h2>
                        <p className="text-[11px] text-cad-muted">
                            {t("preview.subtitle")}
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        {hasCanvasChanges && (
                            <button
                                onClick={() => setPeek(true)}
                                className="flex items-center gap-1 px-2 py-1.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                                title={t("preview.viewGhost")}
                            >
                                <span className="material-symbols-outlined text-[18px]">visibility</span>
                                {t("preview.viewOnCanvas")}
                            </button>
                        )}
                        <button
                            onClick={onCancel}
                            className="p-1.5 rounded hover:bg-cad-text/10 text-cad-muted hover:text-cad-text"
                            title={t("preview.close")}
                            aria-label={t("preview.closeAria")}
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_300px] overflow-y-auto md:overflow-hidden">
                    <div className="p-4 min-h-0">
                        <ElementPreview
                            elements={afterElements}
                            ariaLabel={t("preview.resultAria")}
                            className="w-full h-72 md:h-full min-h-[288px] rounded-lg border border-cad-border bg-[#0b1220]"
                        />
                        {afterElements.length === 0 && (
                            <p className="-mt-40 relative text-center text-xs text-cad-muted">
                                {t("preview.empty")}
                            </p>
                        )}
                    </div>

                    <div className="border-t md:border-t-0 md:border-l border-cad-border p-4 space-y-4 overflow-y-auto">
                        <div>
                            <h3 className="text-[10px] font-bold uppercase text-cad-muted mb-2">
                                {t("preview.planned")}
                            </h3>
                            <ul className="space-y-1.5">
                                {actions.map((action, index) => (
                                    <li
                                        key={`${action.operation}-${index}`}
                                        className="text-xs text-cad-text flex items-start gap-2"
                                    >
                                        <span className="text-cad-primary">›</span>
                                        <span>{describeOperation(action, t)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {sideEffects.length > 0 && (
                            <div className="rounded border border-cad-primary/40 bg-cad-primary/5 p-3">
                                <div className="text-[10px] font-bold uppercase text-cad-muted mb-2">
                                    {t("preview.sideEffects")}
                                </div>
                                <ul className="space-y-1.5">
                                    {sideEffects.map((action, index) => (
                                        <li
                                            key={`${action.operation}-side-${index}`}
                                            className="text-xs text-cad-text flex items-start gap-2"
                                        >
                                            <span className="text-cad-primary">›</span>
                                            <span>{describeOperation(action, t)}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-2 text-[10px] text-cad-muted">
                                    {t("preview.sideEffectsNote")}
                                </p>
                            </div>
                        )}

                        <div className="rounded border border-cad-border bg-cad-bg/60 p-3">
                            <div className="text-[10px] font-bold uppercase text-cad-muted mb-2">
                                {t("preview.netChange")}
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
                                    <div className="text-[10px] text-cad-muted">
                                        {t("preview.modified")}
                                    </div>
                                </div>
                            </div>
                            <p className="mt-2 text-[10px] text-cad-muted">
                                {t("preview.totalAfter", { count: afterElements.length })}
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
                                        {t("preview.autoReview")}
                                    </span>
                                    <span className="text-[10px] text-cad-muted">
                                        {t("preview.reviewCounts", {
                                            error: review.counts.error,
                                            warning: review.counts.warning,
                                            info: review.counts.info,
                                        })}
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
                                                    [{reviewSeverityLabel(issue.severity, locale)}]
                                                </span>
                                                <span className="break-words">{issue.message}</span>
                                            </li>
                                        ))}
                                </ul>
                                {review.introduced.length > MAX_REVIEW_ITEMS && (
                                    <p className="text-[10px] text-cad-muted">
                                        {t("preview.reviewRest", {
                                            count: review.introduced.length - MAX_REVIEW_ITEMS,
                                        })}
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
                                            aria-label={t("preview.reviewConfirm")}
                                            className="mt-0.5"
                                        />
                                        <span>{t("preview.reviewAck")}</span>
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
                                        aria-label={t("preview.riskConfirm")}
                                        className="mt-0.5"
                                    />
                                    <span>{t("preview.destructiveAck")}</span>
                                </label>
                            </div>
                        )}
                    </div>
                </div>

                <div className="px-5 py-3 border-t border-cad-border flex items-center justify-between gap-3">
                    <p className="text-[10px] text-cad-muted">
                        {t("preview.singleUndo")}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={onCancel}
                            className="px-3 py-1.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                        >
                            {t("common.cancel")}
                        </button>
                        <button
                            onClick={onApply}
                            disabled={!canApply}
                            className="px-4 py-1.5 rounded bg-cad-primary hover:bg-cad-primaryHover disabled:opacity-50 text-white text-xs font-bold"
                        >
                            {clearsCanvas
                                ? t("preview.clearCanvas")
                                : hasCanvasChanges
                                  ? t("preview.apply")
                                  : t("preview.applyAndSave")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AIPreviewModal;
