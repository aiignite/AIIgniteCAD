/**
 * namedViews.ts — 命名视图的纯逻辑
 *
 * 命名视图是图纸的视图状态：保存视口矩形与名称，
 * 不属于画布图元，因此不进撤销历史，也不参与版本快照。
 */

import type { ViewBox } from "./viewport";

export interface NamedView {
    name: string;
    viewBox: ViewBox;
}

/** 校验外部读入的命名视图结构 */
export function isNamedView(value: unknown): value is NamedView {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { name?: unknown; viewBox?: unknown };
    if (typeof candidate.name !== "string" || !candidate.name) return false;
    const box = candidate.viewBox as Partial<ViewBox> | undefined;
    if (!box) return false;
    return (
        Number.isFinite(box.x) &&
        Number.isFinite(box.y) &&
        Number.isFinite(box.w) &&
        Number.isFinite(box.h) &&
        (box.w as number) > 0 &&
        (box.h as number) > 0
    );
}

/** 新增或覆盖同名视图，保持原有顺序 */
export function upsertNamedView(views: NamedView[], view: NamedView): NamedView[] {
    return [...views.filter((item) => item.name !== view.name), { name: view.name, viewBox: { ...view.viewBox } }];
}

/** 删除指定视图；不存在时返回原列表 */
export function removeNamedView(views: NamedView[], name: string): NamedView[] {
    return views.filter((item) => item.name !== name);
}

/** 视图名去空白并限制长度，避免空名或超长名污染存储 */
export function normalizeViewName(raw: string): string {
    return raw.trim().slice(0, 64);
}
