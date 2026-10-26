import React, { useMemo, useState } from "react";
import type { CADElement, DesignConventions } from "../types";
import {
    buildReviewFixPrompt,
    reviewDrawing,
    reviewIssueKey,
    reviewIssueLabel,
    reviewSeverityLabel,
    type ReviewIssue,
    type ReviewSeverity,
} from "../lib/designReview";
import {
    checkProjectConsistency,
    consistencyIssueLabel,
    summarizeConsistency,
    type DrawingFacts,
} from "../lib/projectConsistency";
import { useI18n } from "../lib/i18n";

interface DrawingReviewPanelProps {
    elements: CADElement[];
    /** 项目设计约定；约定里的图层与字高会参与检查 */
    conventions?: DesignConventions | null;
    /** 项目内全部图纸的清单级事实；提供后可切换到「项目一致性」范围 */
    drawings?: DrawingFacts[];
    /** 当前图纸 id：项目范围里用于标记当前图纸 */
    activeDrawingId?: string;
    /** 选中问题相关图元并缩放到包围盒 */
    onLocate: (issue: ReviewIssue) => void;
    /** 带着问题摘要切到对话面板；第二个参数是建议预选的图元 */
    onAskAI: (prompt: string, ids: string[]) => void;
}

type SeverityFilter = "all" | ReviewSeverity;
type ReviewScope = "drawing" | "project";

const SEVERITY_STYLES: Record<ReviewSeverity, string> = {
    error: "bg-red-500/10 text-red-500 border-red-500/30",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    info: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
};

const FILTERS: SeverityFilter[] = ["all", "error", "warning", "info"];

const DrawingReviewPanel: React.FC<DrawingReviewPanelProps> = ({
    elements,
    conventions,
    drawings,
    activeDrawingId,
    onLocate,
    onAskAI,
}) => {
    const { t, locale } = useI18n();
    const issues = useMemo(
        () => reviewDrawing(elements, { conventions: conventions ?? undefined, locale }),
        [elements, conventions, locale],
    );
    const [scope, setScope] = useState<ReviewScope>("drawing");
    const projectIssues = useMemo(
        () =>
            scope === "project" && drawings
                ? checkProjectConsistency(drawings, locale)
                : [],
        [scope, drawings, locale],
    );
    const projectMode = scope === "project";
    const [filter, setFilter] = useState<SeverityFilter>("all");
    const [ignored, setIgnored] = useState<Set<string>>(new Set());

    /** 图纸变化后已消失的问题不再占用忽略集合 */
    const activeIgnored = useMemo(() => {
        const keys = new Set(issues.map(reviewIssueKey));
        return new Set([...ignored].filter((key) => keys.has(key)));
    }, [ignored, issues]);

    const counts = useMemo(
        () =>
            issues.reduce<Record<ReviewSeverity, number>>(
                (acc, issue) => {
                    acc[issue.severity] += 1;
                    return acc;
                },
                { error: 0, warning: 0, info: 0 },
            ),
        [issues],
    );

    const visible = useMemo(
        () =>
            issues.filter(
                (issue) =>
                    !activeIgnored.has(reviewIssueKey(issue)) &&
                    (filter === "all" || issue.severity === filter),
            ),
        [issues, activeIgnored, filter],
    );

    const ignoredCount = activeIgnored.size;

    const handleAskAI = () => {
        if (visible.length === 0) return;
        const ids = [...new Set(visible.flatMap((issue) => issue.elementIds))].slice(0, 50);
        onAskAI(buildReviewFixPrompt(visible, 8, locale), ids);
    };

    const handleIgnore = (issue: ReviewIssue) => {
        const key = reviewIssueKey(issue);
        setIgnored((prev) => new Set(prev).add(key));
    };

    const activeCount = projectMode ? projectIssues.length : issues.length;
    const filterCounts = useMemo(() => {
        if (!projectMode) return counts;
        return projectIssues.reduce<Record<ReviewSeverity, number>>(
            (acc, issue) => {
                acc[issue.severity] += 1;
                return acc;
            },
            { error: 0, warning: 0, info: 0 },
        );
    }, [projectMode, projectIssues, counts]);
    const visibleProject = useMemo(
        () =>
            projectIssues.filter((issue) => filter === "all" || issue.severity === filter),
        [projectIssues, filter],
    );
    const drawingNameOf = (id: string): string =>
        drawings?.find((drawing) => drawing.id === id)?.name ?? id;

    return (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="px-3 py-2 border-b border-cad-border bg-cad-panel space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-cad-text flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[18px] text-cad-primary">
                            fact_check
                        </span>
                         {t("review.title")}
                    </h3>
                    <span className="text-[10px] text-cad-muted">
                        {activeCount === 0
                            ? t("review.noIssues")
                            : t("review.issueCount", { count: activeCount })}
                    </span>
                </div>
                <p className="text-[11px] text-cad-muted">
                    {projectMode ? t("review.projectDescription") : t("review.description")}
                </p>
                {drawings && drawings.length > 1 && (
                    <div className="flex items-center gap-1">
                        {(["drawing", "project"] as ReviewScope[]).map((value) => (
                            <button
                                key={value}
                                onClick={() => setScope(value)}
                                aria-pressed={scope === value}
                                className={`px-2 py-0.5 rounded-full border text-[10px] transition-colors ${
                                    scope === value
                                        ? "border-cad-primary text-cad-primary bg-cad-primary/10"
                                        : "border-cad-border text-cad-muted hover:text-cad-text"
                                }`}
                            >
                                {value === "drawing"
                                    ? t("review.scopeDrawing")
                                    : t("review.scopeProject", { count: drawings.length })}
                            </button>
                        ))}
                    </div>
                )}
                {!projectMode && conventions && (
                    <p className="text-[11px] text-cad-primary">
                        {t("review.conventionsApplied")}
                    </p>
                )}
                <div className="flex flex-wrap items-center gap-1">
                    {FILTERS.map((value) => {
                        const item = {
                            value,
                            label:
                                value === "all"
                                    ? t("review.all")
                                    : reviewSeverityLabel(value, locale),
                        };
                        const count =
                            item.value === "all" ? activeCount : filterCounts[item.value];
                        return (
                            <button
                                key={item.value}
                                onClick={() => setFilter(item.value)}
                                className={`px-2 py-0.5 rounded-full border text-[10px] transition-colors ${
                                    filter === item.value
                                        ? "border-cad-primary text-cad-primary bg-cad-primary/10"
                                        : "border-cad-border text-cad-muted hover:text-cad-text"
                                }`}
                            >
                                {item.label} {count}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {projectMode ? (
                    projectIssues.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
                            <span className="material-symbols-outlined text-[32px] text-emerald-500">
                                task_alt
                            </span>
                            <p className="text-xs font-semibold text-cad-text">
                                {t("review.projectEmpty")}
                            </p>
                            <p className="text-[11px] text-cad-muted">
                                {t("review.projectEmptyDetail")}
                            </p>
                        </div>
                    ) : (
                        visibleProject.map((issue) => (
                            <div
                                key={`${issue.code}-${issue.drawingIds.join("-")}`}
                                data-consistency-issue={issue.code}
                                className="rounded-lg border border-cad-border bg-cad-panel p-2 space-y-1"
                            >
                                <div className="flex items-center gap-1.5">
                                    <span
                                        className={`shrink-0 px-1 py-px rounded border text-[10px] ${SEVERITY_STYLES[issue.severity]}`}
                                    >
                                        {reviewSeverityLabel(issue.severity, locale)}
                                    </span>
                                    <span className="min-w-0 flex-1 text-[11px] font-semibold text-cad-text">
                                        {consistencyIssueLabel(issue.code, locale)}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-cad-muted">
                                        {t("review.issueDrawings", { count: issue.drawingIds.length })}
                                    </span>
                                </div>
                                <p className="text-[11px] text-cad-muted break-words">
                                    {issue.message}
                                </p>
                                <p className="text-[10px] text-cad-muted/80 break-words">
                                    {issue.drawingIds
                                        .slice(0, 4)
                                        .map((id) =>
                                            `${drawingNameOf(id)}${id === activeDrawingId ? "（当前）" : ""}`,
                                        )
                                        .join("、")}
                                    {issue.drawingIds.length > 4 && ` +${issue.drawingIds.length - 4}`}
                                </p>
                            </div>
                        ))
                    )
                ) : visible.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
                        <span className="material-symbols-outlined text-[32px] text-emerald-500">
                            {issues.length === 0 ? "task_alt" : "filter_alt_off"}
                        </span>
                        <p className="text-xs font-semibold text-cad-text">
                            {issues.length === 0
                                ? t("review.empty")
                                : t("review.filteredEmpty")}
                        </p>
                        <p className="text-[11px] text-cad-muted">
                            {issues.length === 0
                                ? t("review.emptyDetail")
                                : t("review.emptyFilteredDetail")}
                        </p>
                    </div>
                ) : (
                    visible.map((issue) => {
                        const key = reviewIssueKey(issue);
                        const hasTargets = issue.elementIds.length > 0;
                        return (
                            <div
                                key={key}
                                data-review-issue={issue.code}
                                className="rounded-lg border border-cad-border bg-cad-panel p-2 space-y-1"
                            >
                                <div className="flex items-center gap-1.5">
                                    <span
                                        className={`shrink-0 px-1 py-px rounded border text-[10px] ${SEVERITY_STYLES[issue.severity]}`}
                                    >
                                        {reviewSeverityLabel(issue.severity, locale)}
                                    </span>
                                    <span className="min-w-0 flex-1 text-[11px] font-semibold text-cad-text">
                                        {reviewIssueLabel(issue.code, locale)}
                                    </span>
                                    <button
                                        onClick={() => onLocate(issue)}
                                        disabled={!hasTargets}
                                        title={
                                            hasTargets
                                                ? t("review.locate")
                                                : t("review.globalHint")
                                        }
                                        className="p-0.5 rounded text-cad-muted hover:text-cad-primary disabled:opacity-30"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            my_location
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => handleIgnore(issue)}
                                        title={t("review.ignore")}
                                        className="p-0.5 rounded text-cad-muted hover:text-cad-text"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            visibility_off
                                        </span>
                                    </button>
                                </div>
                                <p className="text-[11px] text-cad-muted break-words">
                                    {issue.message}
                                </p>
                                {hasTargets && (
                                    <p className="text-[11px] font-mono text-cad-muted/80 truncate">
                                        {issue.elementIds.slice(0, 6).join(", ")}
                                        {issue.elementIds.length > 6 &&
                                            ` +${issue.elementIds.length - 6}`}
                                    </p>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            <div className="border-t border-cad-border bg-cad-panel p-2 space-y-1.5">
                {projectMode ? (
                    <button
                        onClick={() =>
                            void navigator.clipboard.writeText(
                                [
                                    summarizeConsistency(projectIssues, locale),
                                    ...projectIssues.map(
                                        (issue) =>
                                            `- [${reviewSeverityLabel(issue.severity, locale)}] ${consistencyIssueLabel(
                                                issue.code,
                                                locale,
                                            )}：${issue.message}`,
                                    ),
                                ].join("\n"),
                            )
                        }
                        disabled={projectIssues.length === 0}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-cad-border text-[11px] font-semibold text-cad-text disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        {t("review.copyConsistency")}
                    </button>
                ) : (
                    <button
                        onClick={handleAskAI}
                        disabled={visible.length === 0}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-cad-primary text-white text-[11px] font-semibold disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                        {t("review.askAI")}
                    </button>
                )}
                <div className="flex items-center justify-between text-[10px] text-cad-muted">
                    <span>
                        {projectMode ? t("review.projectPrivacy") : t("review.aiPrivacy")}
                    </span>
                    {!projectMode && ignoredCount > 0 && (
                        <button
                            onClick={() => setIgnored(new Set())}
                            className="text-cad-primary hover:underline"
                        >
                            {t("review.restoreIgnored", { count: ignoredCount })}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DrawingReviewPanel;
