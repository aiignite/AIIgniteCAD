/**
 * collaboration.ts — 协作同步的纯函数
 *
 * 采用「全员可写 + 最后写入胜」的实验性模型：本地每次提交后与上次广播的
 * 快照做差集，只发送变化的图元；远端补丁按 id 覆盖合并，不进入本地撤销栈。
 */

import { CADElement } from "../types";

/** 一次同步携带的图元增改与删除 */
export interface ElementPatch {
    upserts: CADElement[];
    deletes: string[];
}

export const EMPTY_PATCH: ElementPatch = { upserts: [], deletes: [] };

/** 单次补丁的图元上限，防止恶意或异常客户端撑爆房间 */
export const MAX_PATCH_ELEMENTS = 2000;

/** 房间状态快照的图元上限，与单次补丁上限一致 */
export const MAX_STATE_ELEMENTS = MAX_PATCH_ELEMENTS;

/** 加入房间时回传的图纸快照；超出上限时截断并标记 */
export interface ElementSnapshot {
    elements: CADElement[];
    truncated: boolean;
}

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 只有服务端已分配 UUID 的项目才能加入协作房间；离线项目同步后再启用 */
export function isCollaborationProjectId(value: unknown): value is string {
    return typeof value === "string" && UUID_PATTERN.test(value);
}

/** 判断补丁是否有实际内容，避免空包往返 */
export function isEmptyPatch(patch: ElementPatch): boolean {
    return patch.upserts.length === 0 && patch.deletes.length === 0;
}

/**
 * 对比两次图元数组，求出新增 / 修改 / 删除。
 * 引用相同的图元直接跳过，拖拽过程中只有被改动的元素会进补丁。
 */
export function diffElementPatches(
    previous: readonly CADElement[],
    next: readonly CADElement[],
): ElementPatch {
    const previousById = new Map(previous.map((el) => [el.id, el]));
    const upserts: CADElement[] = [];

    for (const el of next) {
        if (previousById.get(el.id) !== el) upserts.push(el);
    }

    const nextIds = new Set(next.map((el) => el.id));
    const deletes = previous.filter((el) => !nextIds.has(el.id)).map((el) => el.id);

    return { upserts, deletes };
}

/**
 * 把远端补丁合并到本地图元。
 * 覆盖 id 相同者、追加新 id、移除被删除的 id；本地独有且补丁未提及的图元保留。
 */
export function applyElementPatches(
    elements: readonly CADElement[],
    patch: ElementPatch,
): CADElement[] {
    const deleted = new Set(patch.deletes);
    const upsertById = new Map(patch.upserts.map((el) => [el.id, el]));
    const merged: CADElement[] = [];
    const seen = new Set<string>();

    for (const el of elements) {
        if (deleted.has(el.id)) continue;
        const replacement = upsertById.get(el.id);
        merged.push(replacement ?? el);
        seen.add(el.id);
    }

    for (const el of patch.upserts) {
        if (seen.has(el.id) || deleted.has(el.id)) continue;
        merged.push(el);
        seen.add(el.id);
    }

    return merged;
}

/** 传输层边界校验：形状不合法或超限的补丁整包丢弃 */
export function parseElementPatch(value: unknown): ElementPatch | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as { upserts?: unknown; deletes?: unknown };
    if (!Array.isArray(candidate.upserts) || !Array.isArray(candidate.deletes)) {
        return null;
    }
    if (
        candidate.upserts.length > MAX_PATCH_ELEMENTS ||
        candidate.deletes.length > MAX_PATCH_ELEMENTS
    ) {
        return null;
    }

    const upserts: CADElement[] = [];
    for (const item of candidate.upserts) {
        if (!item || typeof item !== "object") return null;
        const el = item as Partial<CADElement>;
        if (typeof el.id !== "string" || typeof el.type !== "string") return null;
        upserts.push(el as CADElement);
    }

    const deletes: string[] = [];
    for (const item of candidate.deletes) {
        if (typeof item !== "string") return null;
        deletes.push(item);
    }

    return { upserts, deletes };
}

/** 光标位置校验：只接受有限数值，过滤 NaN / Infinity */
export function parseCursor(value: unknown): { x: number; y: number } | null {
    if (!value || typeof value !== "object") return null;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

/**
 * 截断房间快照到上限。
 * 加入房间时一次性传输整张超大图纸会撑爆房间，截断后由 truncated 标记提示。
 */
export function capElementSnapshot(
    elements: readonly CADElement[],
    limit = MAX_STATE_ELEMENTS,
): ElementSnapshot {
    if (elements.length <= limit) {
        return { elements: [...elements], truncated: false };
    }
    return { elements: elements.slice(0, limit), truncated: true };
}

/**
 * 合并房间快照：只覆盖同 id、追加新 id，**不删除**本地独有图元。
 * 新加入者的本地可能还有尚未广播的编辑，直接以远端为准会丢数据。
 */
export function applyElementSnapshot(
    elements: readonly CADElement[],
    snapshot: readonly CADElement[],
): CADElement[] {
    return applyElementPatches(elements, { upserts: [...snapshot], deletes: [] });
}

/**
 * 广播「基线 → 当前」的差异，并返回新的基线。
 *
 * 只有补丁真正发出时才推进基线：断线期间 send 返回 false，基线保持不动，
 * 重连后的下一次 flush 才能把这些修改补发出去。无差异时直接推进基线。
 */
export function broadcastPendingChanges(
    baseline: readonly CADElement[],
    next: readonly CADElement[],
    send: (patch: ElementPatch) => boolean,
): readonly CADElement[] {
    const patch = diffElementPatches(baseline, next);
    if (isEmptyPatch(patch)) return next;
    return send(patch) ? next : baseline;
}

/** 传输层边界校验：只接受形状合法、数量不超限的图元数组 */
export function parseElementList(value: unknown): CADElement[] | null {
    if (!Array.isArray(value)) return null;
    if (value.length > MAX_STATE_ELEMENTS) return null;

    const elements: CADElement[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") return null;
        const el = item as Partial<CADElement>;
        if (typeof el.id !== "string" || typeof el.type !== "string") return null;
        elements.push(el as CADElement);
    }
    return elements;
}
