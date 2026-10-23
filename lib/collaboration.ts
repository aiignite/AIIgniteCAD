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
