/**
 * clipboard.ts — 图元剪贴板
 *
 * 剪贴板内容是瞬态的，不进撤销历史，也不随文档持久化；
 * 粘贴时重新生成 id，保证副本与原图互相独立。
 */

import type { CADElement } from "../types";

let buffer: CADElement[] = [];
/** 连续粘贴的步进次数：逐次错开，避免副本完全重叠；重新复制时归零 */
let pasteStep = 0;

export const elementClipboard = {
    /** 写入剪贴板；保存副本，避免外部修改影响已复制内容 */
    write(elements: CADElement[]): void {
        buffer = elements.map((element) => ({ ...element }));
        pasteStep = 0;
    },

    /** 读取剪贴板内容 */
    read(): CADElement[] {
        return buffer.map((element) => ({ ...element }));
    },

    clear(): void {
        buffer = [];
        pasteStep = 0;
    },

    get size(): number {
        return buffer.length;
    },

    /** 取下一次粘贴的步进序号：首次为 1，连续粘贴逐次递增 */
    nextPasteStep(): number {
        pasteStep += 1;
        return pasteStep;
    },
};
