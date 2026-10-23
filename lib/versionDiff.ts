/**
 * versionDiff.ts — 版本快照对比
 *
 * 按图元 ID 判断新增、删除与修改；用于版本面板的变更摘要。
 */

import type { CADElement } from "../types";

export interface VersionDiff {
    added: CADElement[];
    removed: CADElement[];
    modified: Array<{ before: CADElement; after: CADElement }>;
    unchanged: number;
}

const signature = (element: CADElement): string => JSON.stringify(element);

export function diffElementSets(
    base: CADElement[],
    target: CADElement[],
): VersionDiff {
    const before = new Map(base.map((element) => [element.id, element]));
    const after = new Map(target.map((element) => [element.id, element]));

    const added: CADElement[] = [];
    const modified: VersionDiff["modified"] = [];
    let unchanged = 0;

    target.forEach((element) => {
        const previous = before.get(element.id);
        if (!previous) {
            added.push(element);
        } else if (signature(previous) !== signature(element)) {
            modified.push({ before: previous, after: element });
        } else {
            unchanged += 1;
        }
    });

    const removed = base.filter((element) => !after.has(element.id));
    return { added, removed, modified, unchanged };
}

/** 将图元按类型汇总为 "LINE ×2, CIRCLE ×1" 形式，空集合返回 "—" */
export function summarizeElementTypes(elements: CADElement[]): string {
    if (elements.length === 0) return "—";
    const counts = new Map<string, number>();
    elements.forEach((element) => {
        counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
    });
    return [...counts.entries()]
        .map(([type, count]) => `${type} ×${count}`)
        .join(", ");
}
