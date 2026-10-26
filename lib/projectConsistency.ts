/**
 * projectConsistency.ts — 跨图纸一致性检查
 *
 * 单张图的检查在 designReview.ts；这里只看「项目里多张图纸之间是否自相矛盾」：
 * 单位、字高、精度、制图标准与约定图层清单不一致，重名图纸、空图纸、约定缺失。
 *
 * 全部规则是纯函数，只吃清单级事实（名称、图元数、设计约定），
 * 不需要加载图元正文——因此可以在图纸列表上直接跑，不产生额外请求。
 */

import type { ReviewLocale, ReviewSeverity } from "./designReview";

/** 一致性检查只需要约定里可比较的字段 */
export interface DrawingConventionsFacts {
    units?: string;
    textHeight?: number;
    dimensionPrecision?: number;
    standard?: string;
    layerRules?: ReadonlyArray<{ name: string; purpose?: string }>;
}

export interface DrawingFacts {
    id: string;
    name: string;
    elementCount: number;
    /** 未设置设计约定时为 null / undefined */
    conventions?: DrawingConventionsFacts | null;
}

export type ConsistencyCode =
    | "duplicate-name"
    | "empty-drawing"
    | "conventions-missing"
    | "units-mismatch"
    | "text-height-mismatch"
    | "dimension-precision-mismatch"
    | "standard-mismatch"
    | "layer-rules-mismatch";

export interface ConsistencyIssue {
    code: ConsistencyCode;
    severity: ReviewSeverity;
    message: string;
    /** 涉及的图纸 id，用于定位 */
    drawingIds: string[];
}

type MessageSet = {
    duplicateName: (name: string, count: number) => string;
    emptyDrawing: (names: string) => string;
    conventionsMissing: (names: string, total: number) => string;
    unitsMismatch: (values: string) => string;
    textHeightMismatch: (values: string) => string;
    precisionMismatch: (values: string) => string;
    standardMismatch: (values: string) => string;
    layerRulesMismatch: (missing: string) => string;
    none: string;
    summary: (total: number, warning: number, info: number) => string;
    maxNameList: number;
};

const MESSAGES: Record<ReviewLocale, MessageSet> = {
    zh: {
        duplicateName: (name, count) => `${count} 张图纸都叫「${name}」，容易混淆。`,
        emptyDrawing: (names) => `${names} 没有图元，可能是占位图纸或误建。`,
        conventionsMissing: (names, total) =>
            `${total} 张图纸中 ${names} 没有设置设计约定，跨图纸检查无法覆盖它们。`,
        unitsMismatch: (values) => `图纸单位不一致（${values}），跨图复制会得到错误尺寸。`,
        textHeightMismatch: (values) => `约定字高不一致（${values}），出图后文字大小会不统一。`,
        precisionMismatch: (values) => `约定尺寸精度不一致（${values}），标注小数位会不统一。`,
        standardMismatch: (values) => `制图标准不一致（${values}），请确认是否有意为之。`,
        layerRulesMismatch: (missing) =>
            `约定图层清单不一致，这些图层只在部分图纸里登记：${missing}。`,
        none: "各图纸约定一致，未发现跨图纸问题。",
        summary: (total, warning, info) =>
            `跨图纸检查发现 ${total} 个问题（警告 ${warning} / 提示 ${info}）。`,
        maxNameList: 4,
    },
    en: {
        duplicateName: (name, count) => `${count} drawings share the name "${name}".`,
        emptyDrawing: (names) => `${names} has no elements; it may be a placeholder drawing.`,
        conventionsMissing: (names, total) =>
            `${names} of ${total} drawings have no design conventions, so cross-drawing checks skip them.`,
        unitsMismatch: (values) =>
            `Drawing units differ (${values}); copying between drawings will scale incorrectly.`,
        textHeightMismatch: (values) =>
            `Convention text heights differ (${values}); plots will have inconsistent text sizes.`,
        precisionMismatch: (values) => `Dimension precision differs (${values}).`,
        standardMismatch: (values) => `Drafting standards differ (${values}).`,
        layerRulesMismatch: (missing) =>
            `Convention layer lists differ; these layers are only registered in some drawings: ${missing}.`,
        none: "Drawings are consistent; no cross-drawing issues found.",
        summary: (total, warning, info) =>
            `Cross-drawing check found ${total} issues (${warning} warnings / ${info} info).`,
        maxNameList: 4,
    },
};

const nameList = (names: readonly string[], max: number, locale: ReviewLocale = "zh"): string => {
    const separator = locale === "zh" ? "、" : ", ";
    const shown = names.slice(0, max).join(separator);
    return names.length > max
        ? locale === "zh"
            ? `${shown} 等 ${names.length} 张`
            : `${shown} (+${names.length - max} more)`
        : shown;
};

const uniqueSorted = (values: readonly (string | number)[]): (string | number)[] =>
    [...new Set(values)].sort((a, b) =>
        typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)),
    );

/** 只比较「显式设置过」的字段：没设置不等于不一致 */
function collectField<K extends keyof DrawingConventionsFacts>(
    drawings: readonly DrawingFacts[],
    field: K,
): { values: unknown[]; drawings: DrawingFacts[] } {
    const values: unknown[] = [];
    const owners: DrawingFacts[] = [];
    for (const drawing of drawings) {
        const value = drawing.conventions?.[field];
        if (value === undefined || value === null) continue;
        values.push(value);
        owners.push(drawing);
    }
    return { values, drawings: owners };
}

export function checkProjectConsistency(
    drawings: readonly DrawingFacts[],
    locale: ReviewLocale = "zh",
): ConsistencyIssue[] {
    const messages = MESSAGES[locale];
    const issues: ConsistencyIssue[] = [];
    // 单张图纸不存在「跨图纸」问题
    if (drawings.length < 2) return issues;

    // 重名
    const byName = new Map<string, DrawingFacts[]>();
    for (const drawing of drawings) {
        const name = drawing.name.trim() || drawing.id;
        const group = byName.get(name);
        if (group) group.push(drawing);
        else byName.set(name, [drawing]);
    }
    for (const [name, group] of byName) {
        if (group.length < 2) continue;
        issues.push({
            code: "duplicate-name",
            severity: "warning",
            message: messages.duplicateName(name, group.length),
            drawingIds: group.map((drawing) => drawing.id),
        });
    }

    // 空图纸
    const empty = drawings.filter((drawing) => drawing.elementCount === 0);
    if (empty.length > 0) {
        issues.push({
            code: "empty-drawing",
            severity: "info",
            message: messages.emptyDrawing(
                nameList(
                    empty.map((drawing) => drawing.name),
                    messages.maxNameList,
                    locale,
                ),
            ),
            drawingIds: empty.map((drawing) => drawing.id),
        });
    }

    // 约定缺失：部分有、部分没有时才有意义
    const withoutConventions = drawings.filter((drawing) => !drawing.conventions);
    if (withoutConventions.length > 0 && withoutConventions.length < drawings.length) {
        issues.push({
            code: "conventions-missing",
            severity: "info",
            message: messages.conventionsMissing(
                nameList(
                    withoutConventions.map((drawing) => drawing.name),
                    messages.maxNameList,
                    locale,
                ),
                drawings.length,
            ),
            drawingIds: withoutConventions.map((drawing) => drawing.id),
        });
    }

    const withConventions = drawings.filter((drawing) => Boolean(drawing.conventions));
    if (withConventions.length < 2) return issues;

    const compare = (
        field: keyof DrawingConventionsFacts,
        code: ConsistencyCode,
        severity: ReviewSeverity,
        render: (values: string) => string,
    ) => {
        const collected = collectField(withConventions, field);
        if (collected.values.length < 2) return;
        const unique = uniqueSorted(collected.values as (string | number)[]);
        if (unique.length < 2) return;
        issues.push({
            code,
            severity,
            message: render(unique.map((value) => String(value)).join(" / ")),
            drawingIds: collected.drawings.map((drawing) => drawing.id),
        });
    };

    compare("units", "units-mismatch", "warning", messages.unitsMismatch);
    compare("textHeight", "text-height-mismatch", "warning", messages.textHeightMismatch);
    compare(
        "dimensionPrecision",
        "dimension-precision-mismatch",
        "info",
        messages.precisionMismatch,
    );
    compare("standard", "standard-mismatch", "info", messages.standardMismatch);

    // 图层清单：只报「只在部分图纸里登记」的层，比整体集合不同更好定位
    const layerOwners = new Map<string, Set<string>>();
    for (const drawing of withConventions) {
        for (const rule of drawing.conventions?.layerRules ?? []) {
            const name = rule.name?.trim();
            if (!name) continue;
            const owners = layerOwners.get(name);
            if (owners) owners.add(drawing.id);
            else layerOwners.set(name, new Set([drawing.id]));
        }
    }
    if (layerOwners.size > 0) {
        const partial = [...layerOwners.entries()]
            .filter(([, owners]) => owners.size < withConventions.length)
            .map(([name]) => name)
            .sort();
        if (partial.length > 0) {
            issues.push({
                code: "layer-rules-mismatch",
                severity: "warning",
                message: messages.layerRulesMismatch(
                    partial.length > 6
                        ? `${partial.slice(0, 6).join("、")} 等 ${partial.length} 个`
                        : partial.join("、"),
                ),
                drawingIds: withConventions.map((drawing) => drawing.id),
            });
        }
    }

    const order: Record<ReviewSeverity, number> = { error: 0, warning: 1, info: 2 };
    return issues.sort(
        (a, b) =>
            order[a.severity] - order[b.severity] || a.code.localeCompare(b.code),
    );
}

const CONSISTENCY_LABELS: Record<ConsistencyCode, Record<ReviewLocale, string>> = {
    "duplicate-name": { zh: "图纸重名", en: "Duplicate drawing name" },
    "empty-drawing": { zh: "空图纸", en: "Empty drawing" },
    "conventions-missing": { zh: "约定缺失", en: "Missing conventions" },
    "units-mismatch": { zh: "单位不一致", en: "Units differ" },
    "text-height-mismatch": { zh: "字高不一致", en: "Text heights differ" },
    "dimension-precision-mismatch": { zh: "精度不一致", en: "Precision differs" },
    "standard-mismatch": { zh: "制图标准不一致", en: "Standards differ" },
    "layer-rules-mismatch": { zh: "约定图层不一致", en: "Convention layers differ" },
};

export const consistencyIssueLabel = (code: ConsistencyCode, locale: ReviewLocale): string =>
    CONSISTENCY_LABELS[code][locale];

export function summarizeConsistency(
    issues: readonly ConsistencyIssue[],
    locale: ReviewLocale = "zh",
): string {
    const messages = MESSAGES[locale];
    if (issues.length === 0) return messages.none;
    const warning = issues.filter((issue) => issue.severity === "warning").length;
    const info = issues.filter((issue) => issue.severity === "info").length;
    return messages.summary(issues.length, warning, info);
}
