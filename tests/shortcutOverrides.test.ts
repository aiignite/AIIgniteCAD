/**
 * shortcutOverrides.test.ts — 可自定义单键键位的解析、冲突与重置
 *
 * lib/shortcuts 的覆盖缓存是模块级的，本文件内的用例按顺序共享状态，
 * 每个用例先 reset 再断言，互不依赖执行环境。
 */

import { describe, expect, it } from "vitest";
import { ToolType } from "../types";
import {
    findShortcutConflict,
    getEffectiveShortcutKey,
    getEffectiveToolKey,
    resetShortcutBindings,
    resolveActionShortcut,
    resolveToolShortcut,
    setShortcutBinding,
} from "../lib/shortcuts";

describe("可自定义单键键位", () => {
    it("默认键位与静态表一致", () => {
        resetShortcutBindings();
        expect(getEffectiveToolKey(ToolType.LINE)).toBe("l");
        expect(resolveToolShortcut("L")).toBe(ToolType.LINE);
        expect(resolveActionShortcut("g")).toBe("group");
    });

    it("重绑后解析走新键，旧键失效", () => {
        resetShortcutBindings();
        setShortcutBinding("tool:CIRCLE", "k");

        expect(getEffectiveToolKey(ToolType.CIRCLE)).toBe("k");
        expect(resolveToolShortcut("k")).toBe(ToolType.CIRCLE);
        expect(resolveToolShortcut("c")).toBeNull();

        resetShortcutBindings();
        expect(getEffectiveToolKey(ToolType.CIRCLE)).toBe("c");
        expect(resolveToolShortcut("c")).toBe(ToolType.CIRCLE);
    });

    it("动作键重绑与清除", () => {
        resetShortcutBindings();
        setShortcutBinding("action:erase", "q");
        expect(resolveActionShortcut("q")).toBe("erase");
        expect(resolveActionShortcut("e")).toBeNull();

        setShortcutBinding("action:erase", null);
        expect(getEffectiveShortcutKey("action:erase")).toBeNull();
        expect(resolveActionShortcut("q")).toBeNull();

        resetShortcutBindings();
        expect(resolveActionShortcut("e")).toBe("erase");
    });

    it("冲突检测排除自身并指出占用者，非法键不参与", () => {
        resetShortcutBindings();
        expect(findShortcutConflict("tool:LINE", "l")).toBeNull();
        expect(findShortcutConflict("tool:CIRCLE", "l")).toBe("tool:LINE");
        expect(findShortcutConflict("tool:CIRCLE", "9")).toBeNull();
        expect(findShortcutConflict("tool:CIRCLE", " enter ")).toBeNull();
    });

    it("非法绑定 id 与非法键被拒绝", () => {
        resetShortcutBindings();
        expect(setShortcutBinding("tool:NOPE", "z")).toBe(false);
        expect(setShortcutBinding("tool:LINE", "enter")).toBe(false);
        expect(getEffectiveToolKey(ToolType.LINE)).toBe("l");
    });
});
