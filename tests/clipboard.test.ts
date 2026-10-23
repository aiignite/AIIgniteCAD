/**
 * clipboard.test.ts — 图元剪贴板与副本独立性测试
 */

import { describe, expect, it } from "vitest";
import type { CADElement } from "../types";
import { elementClipboard } from "../store/clipboard";
import { copyElements } from "../lib/transform";

const line = (id: string, groupId?: string): CADElement => ({
    id,
    type: "LINE",
    layer: "0",
    color: "#fff",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    ...(groupId ? { groupId } : {}),
});

describe("图元剪贴板", () => {
    it("写入后读回内容一致", () => {
        elementClipboard.write([line("a"), line("b")]);

        expect(elementClipboard.read().map((el) => el.id)).toEqual(["a", "b"]);
        expect(elementClipboard.size).toBe(2);
    });

    it("读出的是副本，外部修改不影响已复制内容", () => {
        const source = line("a");
        elementClipboard.write([source]);

        const buffer = elementClipboard.read();
        buffer[0].id = "changed";

        expect(elementClipboard.read()[0].id).toBe("a");
    });

    it("清空后没有内容", () => {
        elementClipboard.write([line("a")]);
        elementClipboard.clear();

        expect(elementClipboard.read()).toEqual([]);
    });

    it("粘贴步进逐次递增，重新复制后归零", () => {
        elementClipboard.write([line("a")]);

        expect(elementClipboard.nextPasteStep()).toBe(1);
        expect(elementClipboard.nextPasteStep()).toBe(2);

        elementClipboard.write([line("a")]);
        expect(elementClipboard.nextPasteStep()).toBe(1);

        elementClipboard.clear();
        expect(elementClipboard.nextPasteStep()).toBe(1);
    });
});

describe("复制出的副本", () => {
    it("重新生成 id 且脱离原组合，可逐个单独选中", () => {
        const copies = copyElements([line("a", "grp-1"), line("b", "grp-1")], { x: 5, y: 5 });

        expect(copies.map((el) => el.id)).not.toContain("a");
        expect(copies[0].groupId).toBeUndefined();
        expect(copies[1].groupId).toBeUndefined();
    });
});
