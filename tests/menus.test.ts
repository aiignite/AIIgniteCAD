import { describe, expect, it } from "vitest";
import { MENUS, buildShortcutSections, collectMenuActions, findMenu } from "../lib/menus";
import { TOOL_SHORTCUTS } from "../lib/shortcuts";
import { ALL_TOOLS } from "../lib/toolCatalog";

describe("菜单模型", () => {
    it("菜单 id 唯一，且每个菜单至少有一条可执行命令", () => {
        const ids = MENUS.map((menu) => menu.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const menu of MENUS) {
            const commands = menu.items.filter((item) => item.kind === "command");
            expect(commands.length, menu.id).toBeGreaterThan(0);
        }
    });

    // 键盘导航用 item id 做全局 ref key，重复 id 会让方向键跳到别的菜单
    it("命令项 id 在整个菜单栏内唯一", () => {
        const itemIds = MENUS.flatMap((menu) =>
            menu.items.filter((item) => item.kind !== "separator").map((item) => item.id),
        );
        expect(new Set(itemIds).size).toBe(itemIds.length);
    });

    it("四个绘图辅助开关各出现一次且归属视图菜单", () => {
        const toggles: string[] = [];
        for (const menu of MENUS) {
            for (const item of menu.items) {
                if (item.kind === "command" && item.toggle) toggles.push(item.toggle);
            }
        }
        expect(toggles.sort()).toEqual(["grid", "ortho", "polar", "snap"]);
        expect(
            findMenu("view")?.items.some(
                (item) => item.kind === "command" && item.toggle === "grid",
            ),
        ).toBe(true);
    });

    it("菜单里的工具命令能在工具目录里找到同名图标", () => {
        const toolActions = collectMenuActions().filter((action) => action.startsWith("activate:"));
        const catalogued = new Set(ALL_TOOLS.map((meta) => `activate:${meta.tool}`));
        for (const action of toolActions) {
            expect(catalogued.has(action), action).toBe(true);
        }
    });
});

describe("快捷键速查表", () => {
    const sections = buildShortcutSections();

    it("按 工具 / 编辑 / 组合键 三个分区给出内容", () => {
        expect(sections.map((section) => section.id)).toEqual(["tools", "edit", "combos"]);
        for (const section of sections) expect(section.rows.length).toBeGreaterThan(0);
    });

    it("工具单键区与单键映射一一对应", () => {
        const rows = sections.find((section) => section.id === "tools")?.rows ?? [];
        expect(rows.map((row) => row.keys).sort()).toEqual(
            TOOL_SHORTCUTS.map((item) => item.key.toUpperCase()).sort(),
        );
    });

    // 单键与组合键分属不同分区，同一条键位显示两次会让人怀疑是两套绑定
    it("同一个键位不会在两个分区里重复出现", () => {
        const keys = sections.flatMap((section) => section.rows.map((row) => row.keys));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("组合键里的 Mod 与功能键位被收进组合键分区", () => {
        const combos = sections.find((section) => section.id === "combos")?.rows ?? [];
        const keys = combos.map((row) => row.keys);
        expect(keys).toContain("Mod+Z");
        expect(keys).toContain("Mod+S");
        expect(keys).toContain("F3");
        expect(keys).toContain("F10");
    });
});
