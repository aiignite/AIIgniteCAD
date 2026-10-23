/**
 * namedViews.ts — 命名视图的本地存储
 *
 * 按图纸 id 分组存 localStorage：视图状态不进画布 store，
 * 也不会污染撤销历史与版本快照。
 */

import { isNamedView, upsertNamedView, type NamedView } from "../lib/namedViews";

const KEY_PREFIX = "aiignite.cad.named-views.";

const storageKey = (fileId: string): string => `${KEY_PREFIX}${fileId || "untitled"}`;

const storage = (): Storage | null => {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
};

/** 读取某张图纸的命名视图；存储不可用或数据损坏时返回空列表 */
export function loadNamedViews(fileId: string): NamedView[] {
    const store = storage();
    if (!store) return [];
    try {
        const raw = store.getItem(storageKey(fileId));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isNamedView);
    } catch {
        return [];
    }
}

/** 新增或覆盖同名视图 */
export function saveNamedView(fileId: string, view: NamedView): void {
    const store = storage();
    if (!store) return;
    try {
        store.setItem(storageKey(fileId), JSON.stringify(upsertNamedView(loadNamedViews(fileId), view)));
    } catch {
        // 隐私模式或配额已满时静默降级：本次会话内视图仍可恢复
    }
}

/** 删除命名视图，返回是否确实删除了一条 */
export function deleteNamedView(fileId: string, name: string): boolean {
    const store = storage();
    if (!store) return false;
    const views = loadNamedViews(fileId);
    const remaining = views.filter((item) => item.name !== name);
    if (remaining.length === views.length) return false;
    try {
        store.setItem(storageKey(fileId), JSON.stringify(remaining));
    } catch {
        return false;
    }
    return true;
}
