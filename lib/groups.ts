/**
 * groups.ts — 图元组合（聚集 / 解散）
 *
 * 组合只写入 groupId 标记，不改动图元几何；
 * 命中与框选按整组处理，使组合后的对象可整体移动，也可解散回独立图元。
 */

import type { CADElement } from "../types";

/** 组合 id 前缀，便于与普通图元 id 区分 */
export const GROUP_ID_PREFIX = "grp-";

const createGroupId = (): string =>
    `${GROUP_ID_PREFIX}${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;

/** 图元是否已参与组合 */
export const isGrouped = (element: CADElement): boolean => Boolean(element.groupId);

/**
 * 取图元所属组合的成员 id。
 * 未组合时返回自身；组合成员缺失时也退回自身，避免选中不存在的图元。
 */
export function selectionUnit(elements: CADElement[], elementId: string): string[] {
    const target = elements.find((element) => element.id === elementId);
    const groupId = target?.groupId;
    if (!groupId) return [elementId];
    const members = elements.filter((element) => element.groupId === groupId);
    return members.length > 0 ? members.map((element) => element.id) : [elementId];
}

/** 把一批 id 展开为各自所属组合的完整成员 */
export function expandToGroups(elements: CADElement[], ids: string[]): string[] {
    const result = new Set<string>();
    ids.forEach((id) => selectionUnit(elements, id).forEach((member) => result.add(member)));
    return [...result];
}

/** 把选中的图元聚为一个组合；少于两个图元时不处理 */
export function groupElements(
    elements: CADElement[],
    selectedIds: ReadonlySet<string>,
): CADElement[] {
    const members = elements.filter((element) => selectedIds.has(element.id));
    if (members.length < 2) return elements;

    const groupId = createGroupId();
    const memberIds = new Set(members.map((element) => element.id));
    return elements.map((element) =>
        memberIds.has(element.id) ? { ...element, groupId } : element,
    );
}

/** 解散选中图元所在的组合；未组合的图元保持原样 */
export function ungroupElements(
    elements: CADElement[],
    selectedIds: ReadonlySet<string>,
): CADElement[] {
    const groupIds = new Set(
        elements
            .filter((element) => selectedIds.has(element.id))
            .map((element) => element.groupId)
            .filter((groupId): groupId is string => Boolean(groupId)),
    );
    if (groupIds.size === 0) return elements;

    return elements.map((element) => {
        if (!element.groupId || !groupIds.has(element.groupId)) return element;
        const next = { ...element };
        delete next.groupId;
        return next;
    });
}
