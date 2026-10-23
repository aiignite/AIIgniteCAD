/**
 * designReview.ts — 确定性的图纸检查规则
 *
 * AI 不负责"发现"问题，只负责解释与修复；问题清单必须可复现、可定位，
 * 因此全部规则都是纯函数，不依赖模型。严重级别用于区分阻断、警告与提示。
 */

import type { CADElement, Point } from "../types";
import type { BoundingBox } from "./geometry";
import { getElementBoundingBox } from "./geometry";

export type ReviewSeverity = "error" | "warning" | "info";

export type ReviewLocale = "zh" | "en";

export type ReviewIssueCode =
    | "zero-length"
    | "invalid-circle"
    | "degenerate-rectangle"
    | "duplicate"
    | "near-closed-contour"
    | "text-overlap"
    | "missing-dimension"
    | "unorganized-layers"
    | "layer-rule-violation"
    | "empty-convention-layer"
    | "text-height-inconsistent";

export interface ReviewIssue {
    code: ReviewIssueCode;
    severity: ReviewSeverity;
    message: string;
    elementIds: string[];
    bbox?: BoundingBox;
}

/** 项目设计约定中与检查相关的部分；字段缺省表示该项没有约定 */
export interface ReviewConventions {
    units?: string;
    textHeight?: number;
    dimensionPrecision?: number;
    layerRules?: ReadonlyArray<{ name: string; purpose?: string }>;
}

export interface ReviewOptions {
    /** 文本框重叠面积占较小文本框的比例阈值，默认 0.6 */
    textOverlapRatio?: number;
    /** 项目设计约定：约定里的图层与字高会参与确定性检查 */
    conventions?: ReviewConventions;
    /** 问题描述语言，默认中文 */
    locale?: ReviewLocale;
}

const EPSILON = 1e-6;
const NEAR_CLOSED_TOLERANCE = 5;
const TEXT_OVERLAP_RATIO = 0.6;
const MAX_TEXT_ELEMENTS = 400;
const MAX_TEXT_PAIRS = 2000;
const LAYER_HINT_MIN_ELEMENTS = 8;
/** 未显式设置字高时的默认字号，与渲染保持一致 */
const DEFAULT_FONT_SIZE = 12;
/** AI 绘图工具写死的图层，由工具本身决定，不参与图层约定检查 */
const RESERVED_AI_LAYER = "AI_GENERATED";
const SEVERITY_ORDER: Record<ReviewSeverity, number> = { error: 0, warning: 1, info: 2 };

type ReviewMessageSet = {
    zeroLength: (id: string) => string;
    invalidCircle: (id: string) => string;
    degenerateRectangle: (id: string) => string;
    nearClosed: (id: string, gap: number) => string;
    textOverlap: (a: string, b: string) => string;
    duplicate: (count: number, ids: string) => string;
    missingDimension: string;
    unorganizedLayers: (count: number) => string;
    layerNotAllowed: (layer: string, allowed: string) => string;
    emptyLayer: (name: string, purpose: string) => string;
    textHeight: (sizes: string, hint: string) => string;
    sizeHint: (height: number) => string;
    none: string;
    summary: (total: number, error: number, warning: number, info: number) => string;
    fixIntro: string;
    fixOutro: string;
    fixRest: (count: number) => string;
    fixIds: (ids: string) => string;
};

const REVIEW_MESSAGES: Record<ReviewLocale, ReviewMessageSet> = {
    zh: {
        zeroLength: (id) => `直线 ${id} 长度为 0，无法用于后续编辑或导出。`,
        invalidCircle: (id) => `圆 ${id} 的半径必须大于 0。`,
        degenerateRectangle: (id) => `矩形 ${id} 的宽或高为 0。`,
        nearClosed: (id, gap) => `多段线 ${id} 首尾仅差 ${gap}，看起来应当闭合。`,
        textOverlap: (a, b) => `文字「${a}」与「${b}」重叠，可能影响读图。`,
        duplicate: (count, ids) => `${count} 个图元几何完全重合：${ids}。`,
        missingDimension: "图中没有尺寸标注；如需出图，请补充主要轮廓的尺寸。",
        unorganizedLayers: (count) =>
            `${count} 个图元都位于图层 0；建议按轮廓、标注、辅助线拆分图层，便于隐藏与出图。`,
        layerNotAllowed: (layer, allowed) =>
            `图层「${layer}」不在项目约定图层清单内（约定：${allowed}）；请把图元归入约定图层或补充约定。`,
        emptyLayer: (name, purpose) =>
            `约定图层「${name}」${purpose}在图中没有图元，确认是否遗漏。`,
        textHeight: (sizes, hint) => `图中文字字高不统一（${sizes}）；${hint}请统一后再出图。`,
        sizeHint: (height) => `项目约定建议字高 ${height}，`,
        none: "未发现明显问题。",
        summary: (total, error, warning, info) =>
            `发现 ${total} 个问题（error ${error} / warning ${warning} / info ${info}）。`,
        fixIntro: "请检查并修复当前图纸中的以下问题：",
        fixOutro:
            "请先读取相关图元确认现状，再给出修复动作；不要改动无关图元，并在完成后说明修改了哪些内容。",
        fixRest: (count) => `其余 ${count} 条略。`,
        fixIds: (ids) => `（图元：${ids}）`,
    },
    en: {
        zeroLength: (id) => `Line ${id} has zero length and cannot be edited or exported.`,
        invalidCircle: (id) => `Circle ${id} must have a radius greater than 0.`,
        degenerateRectangle: (id) => `Rectangle ${id} has zero width or height.`,
        nearClosed: (id, gap) =>
            `Polyline ${id} is almost closed (gap ${gap}); it probably should be closed.`,
        textOverlap: (a, b) => `Text "${a}" and "${b}" overlap and may be hard to read.`,
        duplicate: (count, ids) => `${count} elements are exactly coincident: ${ids}.`,
        missingDimension:
            "The drawing has no dimensions; add dimensions for the main outlines before plotting.",
        unorganizedLayers: (count) =>
            `${count} elements are all on layer 0; split outlines, dimensions and construction lines into layers so they can be hidden and plotted.`,
        layerNotAllowed: (layer, allowed) =>
            `Layer "${layer}" is not in the project convention list (${allowed}); move the elements to a convention layer or update the conventions.`,
        emptyLayer: (name, purpose) =>
            `Convention layer "${name}"${purpose} has no elements; check whether something is missing.`,
        textHeight: (sizes, hint) =>
            `Text heights are inconsistent (${sizes}); ${hint}unify them before plotting.`,
        sizeHint: (height) => `the project convention recommends ${height}, `,
        none: "No obvious issues found.",
        summary: (total, error, warning, info) =>
            `Found ${total} issues (error ${error} / warning ${warning} / info ${info}).`,
        fixIntro: "Please check and fix the following issues in the current drawing:",
        fixOutro:
            "Read the related elements first, then propose fixes; do not change unrelated elements and summarize what you changed when done.",
        fixRest: (count) => `The remaining ${count} items are omitted.`,
        fixIds: (ids) => ` (elements: ${ids})`,
    },
};

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const round = (value: number): number => Math.round(value * 100) / 100;

const boxOf = (ids: string[], elements: Map<string, CADElement>): BoundingBox | undefined => {
    const boxes = ids
        .map((id) => elements.get(id))
        .filter((element): element is CADElement => Boolean(element))
        .map((element) => getElementBoundingBox(element));
    if (boxes.length === 0) return undefined;
    return {
        minX: Math.min(...boxes.map((box) => Math.min(box.minX, box.maxX))),
        minY: Math.min(...boxes.map((box) => Math.min(box.minY, box.maxY))),
        maxX: Math.max(...boxes.map((box) => Math.max(box.minX, box.maxX))),
        maxY: Math.max(...boxes.map((box) => Math.max(box.minY, box.maxY))),
    };
};

const boxArea = (box: BoundingBox): number =>
    Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY);

/** 交叠面积相对较小文本框的占比；完全分离返回 0 */
function overlapRatio(a: BoundingBox, b: BoundingBox): number {
    const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
    if (width <= 0 || height <= 0) return 0;
    const smaller = Math.min(boxArea(a), boxArea(b));
    if (smaller <= EPSILON) return 0;
    return (width * height) / smaller;
}

/** 同一位置、同样内容的文字由 duplicate 规则处理，避免重复报重叠 */
const sameTextPlacement = (a: CADElement, b: CADElement): boolean =>
    a.text === b.text &&
    Boolean(a.start && b.start) &&
    round(a.start!.x) === round(b.start!.x) &&
    round(a.start!.y) === round(b.start!.y);

/** 几何签名用于找重复图元；只包含参与形状与图层的字段 */
function geometrySignature(element: CADElement): string | null {
    const n = (value: number | undefined): string => round(value ?? 0).toString();
    const p = (point: Point | undefined): string => (point ? `${n(point.x)},${n(point.y)}` : "");
    const layer = element.layer || "0";
    switch (element.type) {
        case "LINE": {
            if (!element.start || !element.end) return null;
            const ends = [p(element.start), p(element.end)].sort().join("|");
            return `LINE:${layer}:${ends}`;
        }
        case "CIRCLE":
            return element.center
                ? `CIRCLE:${layer}:${p(element.center)}:${n(element.radius)}`
                : null;
        case "RECTANGLE": {
            if (!element.start) return null;
            const width = element.width ?? 0;
            const height = element.height ?? 0;
            return `RECT:${layer}:${n(Math.min(element.start.x, element.start.x + width))},${n(
                Math.min(element.start.y, element.start.y + height),
            )}:${n(Math.abs(width))}x${n(Math.abs(height))}`;
        }
        case "LWPOLYLINE": {
            const points = (element.points ?? []).map(p).join("|");
            return `PL:${layer}:${element.closed ? 1 : 0}:${points}`;
        }
        case "ARC":
            return element.center
                ? `ARC:${layer}:${p(element.center)}:${n(element.radius)}:${n(element.startAngle)}:${n(
                      element.endAngle,
                  )}`
                : null;
        case "TEXT":
            return element.start
                ? `TEXT:${layer}:${p(element.start)}:${(element.text ?? "").slice(0, 80)}`
                : null;
        default:
            return null;
    }
}

/** 检查整张图；ids 为空时检查全部图元 */
export function reviewDrawing(
    elements: readonly CADElement[],
    options: ReviewOptions = {},
): ReviewIssue[] {
    const byId = new Map(elements.map((element) => [element.id, element]));
    const issues: ReviewIssue[] = [];
    const overlapThreshold = options.textOverlapRatio ?? TEXT_OVERLAP_RATIO;
    const messages = REVIEW_MESSAGES[options.locale ?? "zh"];

    for (const element of elements) {
        if (element.type === "LINE" && element.start && element.end) {
            if (distance(element.start, element.end) <= EPSILON) {
                issues.push({
                    code: "zero-length",
                    severity: "error",
                    message: messages.zeroLength(element.id),
                    elementIds: [element.id],
                    bbox: boxOf([element.id], byId),
                });
            }
        }
        if (element.type === "CIRCLE" && (element.radius ?? 0) <= EPSILON) {
            issues.push({
                code: "invalid-circle",
                severity: "error",
                message: messages.invalidCircle(element.id),
                elementIds: [element.id],
                bbox: boxOf([element.id], byId),
            });
        }
        if (element.type === "RECTANGLE") {
            const width = Math.abs(element.width ?? 0);
            const height = Math.abs(element.height ?? 0);
            if (width <= EPSILON || height <= EPSILON) {
                issues.push({
                    code: "degenerate-rectangle",
                    severity: "error",
                    message: messages.degenerateRectangle(element.id),
                    elementIds: [element.id],
                    bbox: boxOf([element.id], byId),
                });
            }
        }
        if (element.type === "LWPOLYLINE" && !element.closed && element.points?.length) {
            const first = element.points[0];
            const last = element.points[element.points.length - 1];
            const gap = distance(first, last);
            if (gap > EPSILON && gap <= NEAR_CLOSED_TOLERANCE) {
                issues.push({
                    code: "near-closed-contour",
                    severity: "warning",
                    message: messages.nearClosed(element.id, round(gap)),
                    elementIds: [element.id],
                    bbox: boxOf([element.id], byId),
                });
            }
        }
    }

    // 文字重叠按文本框交叠面积判定，一对文字只报一次
    const texts = elements
        .filter(
            (element) => element.type === "TEXT" && element.start && (element.text ?? "").trim(),
        )
        .slice(0, MAX_TEXT_ELEMENTS)
        .map((element) => ({ element, box: getElementBoundingBox(element) }));
    let comparedPairs = 0;
    outer: for (let i = 0; i < texts.length; i += 1) {
        const a = texts[i];
        for (let j = i + 1; j < texts.length; j += 1) {
            const b = texts[j];
            if (sameTextPlacement(a.element, b.element)) continue;
            if (overlapRatio(a.box, b.box) < overlapThreshold) continue;
            issues.push({
                code: "text-overlap",
                severity: "warning",
                message: messages.textOverlap(
                    (a.element.text ?? "").slice(0, 12),
                    (b.element.text ?? "").slice(0, 12),
                ),
                elementIds: [a.element.id, b.element.id],
                bbox: boxOf([a.element.id, b.element.id], byId),
            });
            comparedPairs += 1;
            if (comparedPairs >= MAX_TEXT_PAIRS) break outer;
        }
    }

    // 重复图元按签名分组，一组只报一次
    const groups = new Map<string, string[]>();
    for (const element of elements) {
        const signature = geometrySignature(element);
        if (!signature) continue;
        const ids = groups.get(signature);
        if (ids) ids.push(element.id);
        else groups.set(signature, [element.id]);
    }
    for (const ids of groups.values()) {
        if (ids.length < 2) continue;
        issues.push({
            code: "duplicate",
            severity: "warning",
            message: messages.duplicate(ids.length, ids.slice(0, 6).join(", ")),
            elementIds: ids,
            bbox: boxOf(ids, byId),
        });
    }

    // 有图形但没有任何尺寸标注时给出提示，不做阻断
    const drawable = elements.filter((element) =>
        ["LINE", "CIRCLE", "RECTANGLE", "LWPOLYLINE", "ARC"].includes(element.type),
    );
    const hasDimension = elements.some((element) => element.type === "DIMENSION");
    if (!hasDimension && drawable.length >= 3) {
        issues.push({
            code: "missing-dimension",
            severity: "info",
            message: messages.missingDimension,
            elementIds: drawable.slice(0, 20).map((element) => element.id),
        });
    }

    // 成图全部堆在图层 0 时给出整理提示，不阻断导出
    if (
        drawable.length >= LAYER_HINT_MIN_ELEMENTS &&
        drawable.every((element) => (element.layer || "0") === "0")
    ) {
        issues.push({
            code: "unorganized-layers",
            severity: "info",
            message: messages.unorganizedLayers(drawable.length),
            elementIds: [],
        });
    }

    issues.push(...reviewConventions(elements, byId, options.conventions, messages));

    return issues.sort(
        (a, b) =>
            SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code),
    );
}

/**
 * 约定相关的检查：图层必须落在约定清单内，约定图层不能空着，字高要统一。
 * 约定来自用户编辑，属于外部输入，这里只取用到的字段并做边界收敛。
 */
function reviewConventions(
    elements: readonly CADElement[],
    byId: Map<string, CADElement>,
    conventions: ReviewConventions | undefined,
    messages: ReviewMessageSet,
): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    if (!conventions) return issues;

    const layerRules = (conventions.layerRules ?? [])
        .filter((rule) => typeof rule?.name === "string" && rule.name.trim().length > 0)
        .map((rule) => ({ name: rule.name.trim(), purpose: rule.purpose?.trim() }));
    if (layerRules.length > 0) {
        const allowed = new Set(layerRules.map((rule) => rule.name));
        const offenders = new Map<string, string[]>();
        for (const element of elements) {
            const layer = element.layer || "0";
            if (layer === RESERVED_AI_LAYER || allowed.has(layer)) continue;
            const ids = offenders.get(layer);
            if (ids) ids.push(element.id);
            else offenders.set(layer, [element.id]);
        }
        const allowedText = layerRules
            .map((rule) => (rule.purpose ? `${rule.name}（${rule.purpose}）` : rule.name))
            .join("、");
        for (const [layer, ids] of offenders) {
            issues.push({
                code: "layer-rule-violation",
                severity: "warning",
                message: messages.layerNotAllowed(layer, allowedText),
                elementIds: ids,
                bbox: boxOf(ids, byId),
            });
        }

        const usedLayers = new Set(elements.map((element) => element.layer || "0"));
        for (const rule of layerRules) {
            if (usedLayers.has(rule.name)) continue;
            issues.push({
                code: "empty-convention-layer",
                severity: "info",
                message: messages.emptyLayer(
                    rule.name,
                    rule.purpose ? `（${rule.purpose}）` : "",
                ),
                elementIds: [],
            });
        }
    }

    // 字高不统一：约定里的建议字高只作为提示，不做单位换算
    const sizes = new Map<number, string[]>();
    for (const element of elements) {
        if (element.type !== "TEXT") continue;
        const size = element.fontSize ?? DEFAULT_FONT_SIZE;
        const ids = sizes.get(size);
        if (ids) ids.push(element.id);
        else sizes.set(size, [element.id]);
    }
    if (sizes.size > 1) {
        let dominantSize = 0;
        let dominantCount = 0;
        for (const [size, ids] of sizes) {
            if (ids.length > dominantCount) {
                dominantCount = ids.length;
                dominantSize = size;
            }
        }
        const outliers = [...sizes.entries()]
            .filter(([size]) => size !== dominantSize)
            .flatMap(([, ids]) => ids);
        const sizeText = [...sizes.keys()].sort((a, b) => a - b).join(" / ");
        issues.push({
            code: "text-height-inconsistent",
            severity: "info",
            message: messages.textHeight(
                sizeText,
                conventions.textHeight
                    ? messages.sizeHint(conventions.textHeight)
                    : "",
            ),
            elementIds: outliers,
        });
    }

    return issues;
}

/** 供工具结果使用的紧凑摘要 */
export function summarizeReview(
    issues: readonly ReviewIssue[],
    locale: ReviewLocale = "zh",
): string {
    const messages = REVIEW_MESSAGES[locale];
    if (issues.length === 0) return messages.none;
    const counts = issues.reduce<Record<string, number>>((acc, issue) => {
        acc[issue.severity] = (acc[issue.severity] ?? 0) + 1;
        return acc;
    }, {});
    return messages.summary(
        issues.length,
        counts.error ?? 0,
        counts.warning ?? 0,
        counts.info ?? 0,
    );
}

const REVIEW_SEVERITY_LABELS_BY_LOCALE: Record<
    ReviewLocale,
    Record<ReviewSeverity, string>
> = {
    zh: {
        error: "错误",
        warning: "警告",
        info: "提示",
    },
    en: {
        error: "Error",
        warning: "Warning",
        info: "Info",
    },
};

const REVIEW_ISSUE_LABELS_BY_LOCALE: Record<
    ReviewLocale,
    Record<ReviewIssueCode, string>
> = {
    zh: {
        "zero-length": "零长度直线",
        "invalid-circle": "无效圆",
        "degenerate-rectangle": "退化矩形",
        duplicate: "重复图元",
        "near-closed-contour": "未闭合轮廓",
        "text-overlap": "文字重叠",
        "missing-dimension": "缺少尺寸标注",
        "unorganized-layers": "图层未整理",
        "layer-rule-violation": "图层未登记",
        "empty-convention-layer": "约定图层为空",
        "text-height-inconsistent": "字高不统一",
    },
    en: {
        "zero-length": "Zero-length line",
        "invalid-circle": "Invalid circle",
        "degenerate-rectangle": "Degenerate rectangle",
        duplicate: "Duplicate elements",
        "near-closed-contour": "Near-closed contour",
        "text-overlap": "Overlapping text",
        "missing-dimension": "Missing dimensions",
        "unorganized-layers": "Unorganized layers",
        "layer-rule-violation": "Layer not in conventions",
        "empty-convention-layer": "Empty convention layer",
        "text-height-inconsistent": "Inconsistent text height",
    },
};

export const REVIEW_SEVERITY_LABELS: Record<ReviewSeverity, string> =
    REVIEW_SEVERITY_LABELS_BY_LOCALE.zh;

export const REVIEW_ISSUE_LABELS: Record<ReviewIssueCode, string> =
    REVIEW_ISSUE_LABELS_BY_LOCALE.zh;

export const reviewSeverityLabel = (severity: ReviewSeverity, locale: ReviewLocale): string =>
    REVIEW_SEVERITY_LABELS_BY_LOCALE[locale][severity];

export const reviewIssueLabel = (code: ReviewIssueCode, locale: ReviewLocale): string =>
    REVIEW_ISSUE_LABELS_BY_LOCALE[locale][code];

/** 忽略与定位的稳定键：同一规则 + 同一组图元视为同一条问题 */
export function reviewIssueKey(issue: ReviewIssue): string {
    return `${issue.code}:${[...issue.elementIds].sort().join("|")}`;
}

/** 把可见问题整理成可直接发给 AI 的修复请求，只携带摘要不携带图元 JSON */
export function buildReviewFixPrompt(
    issues: readonly ReviewIssue[],
    maxItems = 8,
    locale: ReviewLocale = "zh",
): string {
    if (issues.length === 0) return "";
    const messages = REVIEW_MESSAGES[locale];
    const lines = issues.slice(0, maxItems).map((issue) => {
        const ids = issue.elementIds.slice(0, 6).join(", ");
        return `- [${reviewSeverityLabel(issue.severity, locale)}] ${issue.message}${
            ids ? messages.fixIds(ids) : ""
        }`;
    });
    const rest =
        issues.length > maxItems ? `\n- ${messages.fixRest(issues.length - maxItems)}` : "";
    return [messages.fixIntro, ...lines, rest, "", messages.fixOutro]
        .filter((line) => line !== "")
        .join("\n");
}
