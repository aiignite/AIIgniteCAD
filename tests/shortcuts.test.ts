/**
 * 单键快捷键映射
 */

import { describe, expect, it } from "vitest";
import { ToolType } from "../types";
import {
    ACTION_SHORTCUTS,
    TOOL_SHORTCUTS,
    resolveActionShortcut,
    resolveToolShortcut,
} from "../lib/shortcuts";

describe("resolveToolShortcut", () => {
    it("按 AutoCAD 键位映射画布工具", () => {
        expect(resolveToolShortcut("l")).toBe(ToolType.LINE);
        expect(resolveToolShortcut("C")).toBe(ToolType.CIRCLE);
        expect(resolveToolShortcut("r")).toBe(ToolType.RECTANGLE);
        expect(resolveToolShortcut("a")).toBe(ToolType.ARC);
        expect(resolveToolShortcut("t")).toBe(ToolType.TEXT);
        expect(resolveToolShortcut("h")).toBe(ToolType.HATCH);
        expect(resolveToolShortcut("d")).toBe(ToolType.DIMENSION);
        expect(resolveToolShortcut("o")).toBe(ToolType.OFFSET);
        expect(resolveToolShortcut("m")).toBe(ToolType.SELECT);
    });

    it("未登记的键不匹配工具", () => {
        expect(resolveToolShortcut("z")).toBeNull();
        expect(resolveToolShortcut("F3")).toBeNull();
        expect(resolveToolShortcut("Enter")).toBeNull();
    });

    it("工具键与动作键互不重叠", () => {
        const toolKeys = TOOL_SHORTCUTS.map((item) => item.key);
        expect(toolKeys.some((key) => key in ACTION_SHORTCUTS)).toBe(false);
    });
});

describe("resolveActionShortcut", () => {
    it("E / G / X 映射到编辑动作", () => {
        expect(resolveActionShortcut("e")).toBe("erase");
        expect(resolveActionShortcut("G")).toBe("group");
        expect(resolveActionShortcut("x")).toBe("ungroup");
    });

    it("未登记的键不匹配动作", () => {
        expect(resolveActionShortcut("k")).toBeNull();
    });
});
