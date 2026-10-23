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

    for (const element of elements) {
        if (element.type === "LINE" && element.start && element.end) {
            if (distance(element.start, element.end) <= EPSILON) {
                issues.push({
                    code: "zero-length",
                    severity: "error",
                    message: `直线 ${element.id} 长度为 0，无法用于后续编辑或导出。`,
                    elementIds: [element.id],
                    bbox: boxOf([element.id], byId),
                });
            }
        }
        if (element.type === "CIRCLE" && (element.radius ?? 0) <= EPSILON) {
            issues.push({
                code: "invalid-circle",
                severity: "error",
                message: `圆 ${element.id} 的半径必须大于 0。`,
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
                    message: `矩形 ${element.id} 的宽或高为 0。`,
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
                    message: `多段线 ${element.id} 首尾仅差 ${round(gap)}，看起来应当闭合。`,
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
                message: `文字「${(a.element.text ?? "").slice(0, 12)}」与「${(
                    b.element.text ?? ""
                ).slice(0, 12)}」重叠，可能影响读图。`,
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
            message: `${ids.length} 个图元几何完全重合：${ids.slice(0, 6).join(", ")}。`,
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
            message: "图中没有尺寸标注；如需出图，请补充主要轮廓的尺寸。",
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
            message: `${drawable.length} 个图元都位于图层 0；建议按轮廓、标注、辅助线拆分图层，便于隐藏与出图。`,
            elementIds: [],
        });
    }

    issues.push(...reviewConventions(elements, byId, options.conventions));

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
                message: `图层「${layer}」不在项目约定图层清单内（约定：${allowedText}）；请把图元归入约定图层或补充约定。`,
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
                message: `约定图层「${rule.name}」${rule.purpose ? `（${rule.purpose}）` : ""}在图中没有图元，确认是否遗漏。`,
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
            message: `图中文字字高不统一（${sizeText}）；${
                conventions.textHeight ? `项目约定建议字高 ${conventions.textHeight}，` : ""
            }请统一后再出图。`,
            elementIds: outliers,
        });
    }

    return issues;
}

/** 供工具结果使用的紧凑摘要 */
export function summarizeReview(issues: readonly ReviewIssue[]): string {
    if (issues.length === 0) return "未发现明显问题。";
    const counts = issues.reduce<Record<string, number>>((acc, issue) => {
        acc[issue.severity] = (acc[issue.severity] ?? 0) + 1;
        return acc;
    }, {});
    return `发现 ${issues.length} 个问题（error ${counts.error ?? 0} / warning ${
        counts.warning ?? 0
    } / info ${counts.info ?? 0}）。`;
}

export const REVIEW_SEVERITY_LABELS: Record<ReviewSeverity, string> = {
    error: "错误",
    warning: "警告",
    info: "提示",
};

export const REVIEW_ISSUE_LABELS: Record<ReviewIssueCode, string> = {
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
};

/** 忽略与定位的稳定键：同一规则 + 同一组图元视为同一条问题 */
export function reviewIssueKey(issue: ReviewIssue): string {
    return `${issue.code}:${[...issue.elementIds].sort().join("|")}`;
}

/** 把可见问题整理成可直接发给 AI 的修复请求，只携带摘要不携带图元 JSON */
export function buildReviewFixPrompt(issues: readonly ReviewIssue[], maxItems = 8): string {
    if (issues.length === 0) return "";
    const lines = issues.slice(0, maxItems).map((issue) => {
        const ids = issue.elementIds.slice(0, 6).join(", ");
        return `- [${REVIEW_SEVERITY_LABELS[issue.severity]}] ${issue.message}${
            ids ? `（图元：${ids}）` : ""
        }`;
    });
    const rest = issues.length > maxItems ? `\n- 其余 ${issues.length - maxItems} 条略。` : "";
    return [
        "请检查并修复当前图纸中的以下问题：",
        ...lines,
        rest,
        "",
        "请先读取相关图元确认现状，再给出修复动作；不要改动无关图元，并在完成后说明修改了哪些内容。",
    ]
        .filter((line) => line !== "")
        .join("\n");
}
