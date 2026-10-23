/**
 * commands.test.ts — 命令注册表测试
 *
 * 覆盖别名解析、参数映射、分步缺失检测、补全与执行副作用。
 */

import { describe, expect, it } from "vitest";
import { ToolType } from "../types";
import type { CADElement } from "../types";
import type { BoundingBox } from "../lib/geometry";
import type { NamedView } from "../lib/namedViews";
import {
    COMMANDS,
    completeCommand,
    executeCommand,
    findCommand,
    getMissingArgs,
    getUsage,
    resolveCommandInput,
} from "../lib/commands/registry";
import type { CommandContext } from "../lib/commands/types";

const line = (id = "el-1"): CADElement => ({
    id,
    type: "LINE",
    start: { x: 10, y: 0 },
    end: { x: 20, y: 0 },
    layer: "0",
    color: "#fff",
});

interface ContextOptions {
    elements?: CADElement[];
    selectedIds?: string[];
    orthoMode?: boolean;
    gridMode?: boolean;
    snapMode?: boolean;
    hiddenLayers?: string[];
    lockedLayers?: string[];
    hiddenObjectIds?: string[];
    layerOrder?: string[];
    confirmBulkDelete?: (ids: string[]) => boolean;
}

function createContext(options: ContextOptions = {}) {
    let elements = options.elements ?? [];
    let selectedIds = new Set(options.selectedIds ?? []);
    let hiddenObjectIds = new Set(options.hiddenObjectIds ?? []);
    let currentLayer = "0";
    const layerOrder = [...(options.layerOrder ?? ["0"])];
    const commits: CADElement[][] = [];
    const selections: string[][] = [];
    const isolations: string[][] = [];
    const zooms: BoundingBox[] = [];
    const namedViews: NamedView[] = [];
    const notifications: string[] = [];
    const tools: ToolType[] = [];
    const addedLayers: string[] = [];
    const toggles: Record<string, boolean> = {};
    let undoCount = 0;
    let redoCount = 0;
    let plotCount = 0;
    let quickSelectCount = 0;

    const ctx: CommandContext = {
        get elements() {
            return elements;
        },
        get selectedIds() {
            return selectedIds;
        },
        get selectedElements() {
            return elements.filter((element) => selectedIds.has(element.id));
        },
        orthoMode: options.orthoMode ?? false,
        gridMode: options.gridMode ?? true,
        snapMode: options.snapMode ?? true,
        get currentLayer() {
            return currentLayer;
        },
        layerOrder,
        hiddenLayers: options.hiddenLayers ?? [],
        lockedLayers: options.lockedLayers ?? [],
        get hiddenObjectIds() {
            return hiddenObjectIds;
        },
        setHiddenObjectIds: (ids) => {
            hiddenObjectIds = new Set(ids);
            isolations.push(ids);
        },
        confirmBulkDelete: options.confirmBulkDelete,
        setActiveTool: (tool) => tools.push(tool),
        setSelection: (ids) => {
            selectedIds = new Set(ids);
            selections.push(ids);
        },
        clearSelection: () => {
            selectedIds = new Set();
        },
        commitAction: (next) => {
            elements = next;
            commits.push(next);
        },
        showNotification: (message) => notifications.push(message),
        setOrthoMode: (value) => {
            toggles.ortho = value;
        },
        setGridMode: (value) => {
            toggles.grid = value;
        },
        setSnapMode: (value) => {
            toggles.snap = value;
        },
        undo: () => {
            undoCount += 1;
        },
        redo: () => {
            redoCount += 1;
        },
        addLayer: (layer) => {
            addedLayers.push(layer);
            if (!layerOrder.includes(layer)) layerOrder.push(layer);
        },
        setCurrentLayer: (layer) => {
            currentLayer = layer;
        },
        openPlot: () => {
            plotCount += 1;
        },
        openQuickSelect: () => {
            quickSelectCount += 1;
        },
        zoomToBounds: (bounds) => {
            zooms.push(bounds);
        },
        currentViewBox: () => ({ x: 0, y: 0, w: 800, h: 600 }),
        saveNamedView: (view) => {
            namedViews.push(view);
            return true;
        },
        restoreNamedView: (name) => namedViews.some((view) => view.name === name),
        listNamedViews: () => namedViews.map((view) => view.name),
    };

    return {
        ctx,
        commits,
        selections,
        isolations,
        zooms,
        namedViews,
        notifications,
        tools,
        addedLayers,
        toggles,
        layerOrder,
        get hiddenObjectIds() {
            return [...hiddenObjectIds];
        },
        get undoCount() {
            return undoCount;
        },
        get redoCount() {
            return redoCount;
        },
        get plotCount() {
            return plotCount;
        },
        get quickSelectCount() {
            return quickSelectCount;
        },
        get currentLayer() {
            return currentLayer;
        },
    };
}

describe("命令解析", () => {
    it("规范名与别名均大小写不敏感", () => {
        expect(findCommand("line")?.name).toBe("LINE");
        expect(findCommand("l")?.name).toBe("LINE");
        expect(findCommand("rec")?.name).toBe("RECTANGLE");
        expect(findCommand("?")?.name).toBe("HELP");
        expect(findCommand("nope")).toBeUndefined();
    });

    it("解析位置参数并应用默认值", () => {
        const parsed = resolveCommandInput("SCALE 1.5");
        expect(parsed?.definition?.name).toBe("SCALE");
        expect(parsed?.values.factor).toBe("1.5");
        expect(parsed?.missing).toEqual([]);

        const offset = resolveCommandInput("O 25");
        expect(offset?.values.distance).toBe("25");

        const array = resolveCommandInput("ARRAY");
        expect(array?.values).toEqual({
            rows: "2",
            columns: "2",
            columnSpacing: "100",
            rowSpacing: "100",
        });
        expect(array?.missing).toEqual([]);
    });

    it("缺少必填参数时给出缺失列表", () => {
        const parsed = resolveCommandInput("SCALE");
        expect(parsed?.missing.map((arg) => arg.name)).toEqual(["factor"]);
        expect(getMissingArgs(findCommand("LAYER")!, [])).toHaveLength(1);
    });

    it("用法文本区分必填与默认参数", () => {
        expect(getUsage(findCommand("SCALE")!)).toBe("SCALE <factor>");
        expect(getUsage(findCommand("OFFSET")!)).toBe("OFFSET [distance=20]");
        expect(getUsage(findCommand("LINE")!)).toBe("LINE");
    });

    it("Tab 补全按名称或别名前缀匹配", () => {
        const names = completeCommand("re").map((definition) => definition.name);
        expect(names).toContain("RECTANGLE");
        expect(names).toContain("REDO");
        expect(completeCommand("li").map((definition) => definition.name)).toEqual(["LINE"]);
        expect(completeCommand("").length).toBe(COMMANDS.length);
    });
});

describe("命令执行", () => {
    it("工具命令切换当前工具并返回提示", () => {
        const h = createContext();
        const outcome = executeCommand("l", h.ctx);

        expect(h.tools).toEqual([ToolType.LINE]);
        expect(outcome.message).toBe("Tool: LINE");
    });

    it("PLOT / PRINT 打开图框打印面板", () => {
        const h = createContext();

        const outcome = executeCommand("print", h.ctx);

        expect(h.plotCount).toBe(1);
        expect(outcome.message).toBe("Plot");
    });

    it("QSELECT 打开快速选择面板", () => {
        const h = createContext();

        const outcome = executeCommand("QS", h.ctx);

        expect(h.quickSelectCount).toBe(1);
        expect(outcome.message).toBe("Quick select");
        expect(h.commits).toHaveLength(0);
    });

    it("未知命令返回错误提示", () => {
        const h = createContext();
        const outcome = executeCommand("WARP 9", h.ctx);

        expect(outcome.error).toBe(true);
        expect(outcome.message).toBe("Unknown command: WARP 9");
        expect(h.commits).toHaveLength(0);
    });

    it("必填参数缺失时不执行并返回用法", () => {
        const h = createContext({ elements: [line()], selectedIds: ["el-1"] });
        const outcome = executeCommand("SCALE", h.ctx);

        expect(outcome.message).toBe("Usage: SCALE <factor>");
        expect(h.commits).toHaveLength(0);
    });

    it("ERASE 删除选中对象并清空选择", () => {
        const h = createContext({ elements: [line()], selectedIds: ["el-1"] });
        const outcome = executeCommand("E", h.ctx);

        expect(h.commits.at(-1)).toEqual([]);
        expect(h.ctx.selectedIds.size).toBe(0);
        expect(outcome.message).toBe("Deleted selected objects");
    });

    it("ERASE 未选中对象时给出提示", () => {
        const h = createContext({ elements: [line()] });
        const outcome = executeCommand("ERASE", h.ctx);

        expect(outcome.error).toBe(true);
        expect(h.commits).toHaveLength(0);
    });

    it("ERASE 批量删除被拒绝时等待对话框确认", () => {
        const h = createContext({
            elements: [line()],
            selectedIds: ["el-1"],
            confirmBulkDelete: () => false,
        });
        const outcome = executeCommand("ERASE", h.ctx);

        expect(outcome.message).toBe("Confirm deletion in the dialog");
        expect(outcome.error).toBeFalsy();
        expect(h.commits).toHaveLength(0);
        expect(h.ctx.selectedIds.size).toBe(1);
    });

    it("ERASE 批量删除获得确认后提交", () => {
        const ids: string[][] = [];
        const h = createContext({
            elements: [line()],
            selectedIds: ["el-1"],
            confirmBulkDelete: (selected) => {
                ids.push(selected);
                return true;
            },
        });
        const outcome = executeCommand("ERASE", h.ctx);

        expect(ids).toEqual([["el-1"]]);
        expect(h.commits).toHaveLength(1);
        expect(outcome.message).toBe("Deleted selected objects");
    });

    it("SCALE 以形心为基点缩放", () => {
        const h = createContext({ elements: [line()], selectedIds: ["el-1"] });
        executeCommand("SCALE 2", h.ctx);

        const scaled = h.commits.at(-1)![0];
        expect(scaled.start).toEqual({ x: 5, y: 0 });
        expect(scaled.end).toEqual({ x: 25, y: 0 });
    });

    it("SCALE 拒绝非正数", () => {
        const h = createContext({ elements: [line()], selectedIds: ["el-1"] });
        const outcome = executeCommand("SCALE 0", h.ctx);

        expect(outcome.error).toBe(true);
        expect(h.commits).toHaveLength(0);
    });

    it("OFFSET 使用默认距离 20", () => {
        const h = createContext({ elements: [line()], selectedIds: ["el-1"] });
        const outcome = executeCommand("OFFSET", h.ctx);

        expect(h.commits).toHaveLength(1);
        expect(h.commits[0].length).toBeGreaterThan(1);
        expect(outcome.message).toBe("Offset by 20");
    });

    it("ARRAY 默认 2×2 并选中新增副本", () => {
        const h = createContext({ elements: [line()], selectedIds: ["el-1"] });
        const outcome = executeCommand("ARRAY", h.ctx);

        // 原图 + 3 个副本
        expect(h.commits.at(-1)).toHaveLength(4);
        expect(h.ctx.selectedIds.size).toBe(3);
        expect(outcome.message).toBe("Array 2×2");
    });

    it("SELECTALL 排除隐藏与锁定图层", () => {
        const hidden = { ...line("hidden"), layer: "HIDDEN" };
        const locked = { ...line("locked"), layer: "LOCKED" };
        const normal = line("normal");
        const h = createContext({
            elements: [hidden, locked, normal],
            hiddenLayers: ["HIDDEN"],
            lockedLayers: ["LOCKED"],
        });

        const outcome = executeCommand("SA", h.ctx);
        expect([...h.ctx.selectedIds]).toEqual(["normal"]);
        expect(outcome.message).toBe("Selected 1 objects");
    });

    it("ISOLATE 只保留选择集，其余图元进入临时隐藏集", () => {
        const h = createContext({
            elements: [line("keep"), line("drop"), { ...line("other"), layer: "DIM" }],
            selectedIds: ["keep"],
            hiddenLayers: ["DIM"],
        });
        const outcome = executeCommand("ISO", h.ctx);

        expect(h.hiddenObjectIds).toEqual(["drop"]);
        expect(outcome.message).toBe("Isolated 1 objects");
        expect(h.commits).toHaveLength(0);
    });

    it("HIDEOBJECTS 叠加隐藏并清空选择集", () => {
        const h = createContext({
            elements: [line("a"), line("b"), line("c")],
            selectedIds: ["a"],
            hiddenObjectIds: ["c"],
        });
        const outcome = executeCommand("HIDE", h.ctx);

        expect(h.hiddenObjectIds).toEqual(["c", "a"]);
        expect(h.ctx.selectedIds.size).toBe(0);
        expect(outcome.message).toBe("Hidden 1 objects");
    });

    it("SHOWALL 清除隐藏集，无隐藏图元时不改状态", () => {
        const hidden = createContext({
            elements: [line("a")],
            selectedIds: ["a"],
            hiddenObjectIds: ["a"],
        });
        expect(executeCommand("SH", hidden.ctx).message).toBe("Showed 1 objects");
        expect(hidden.hiddenObjectIds).toEqual([]);

        const empty = createContext({ elements: [line("a")] });
        expect(executeCommand("SHOWALL", empty.ctx).message).toBe("No hidden objects");
        expect(empty.isolations).toHaveLength(0);
    });

    it("SELECTSIMILAR 只选择当前可显示的同类型图元", () => {
        const circle = { ...line("circle"), type: "CIRCLE" as const };
        const h = createContext({
            elements: [line("a"), circle, line("b"), line("hidden-el")],
            selectedIds: ["a"],
            hiddenObjectIds: ["hidden-el"],
        });
        const outcome = executeCommand("SSI", h.ctx);

        expect([...h.ctx.selectedIds]).toEqual(["a", "b"]);
        expect(outcome.message).toBe("Selected 2 similar objects");

        const multi = createContext({
            elements: [line("a"), circle, line("b"), line("hidden-el")],
            selectedIds: ["a", "circle"],
            hiddenObjectIds: ["hidden-el"],
        });
        expect(executeCommand("SIMILAR", multi.ctx).message).toBe("Selected 3 similar objects");

        const none = createContext({ elements: [line("a")] });
        expect(executeCommand("SSI", none.ctx).error).toBe(true);
    });

    it("SELECTALL 排除被临时隐藏的图元", () => {
        const h = createContext({
            elements: [line("a"), line("b")],
            hiddenObjectIds: ["b"],
        });
        expect(executeCommand("SA", h.ctx).message).toBe("Selected 1 objects");
        expect([...h.ctx.selectedIds]).toEqual(["a"]);
    });

    it("ZOOM E 缩放到可见图元范围，ZOOM S 缩放到选择集", () => {
        const h = createContext({
            elements: [line("a"), line("b")],
            selectedIds: ["b"],
        });
        expect(executeCommand("Z E", h.ctx).message).toBe("Zoom to extents");
        expect(h.zooms).toHaveLength(1);
        expect(h.zooms[0]).toEqual({ minX: 10, minY: 0, maxX: 20, maxY: 0 });

        expect(executeCommand("ZOOM S", h.ctx).message).toBe("Zoom to 1 selected objects");
        expect(h.zooms).toHaveLength(2);

        const empty = createContext({ elements: [line("a")] });
        expect(executeCommand("ZOOM S", empty.ctx).error).toBe(true);
    });

    it("ZOOM W 按两点窗口缩放，缺参数时给出用法", () => {
        const h = createContext({ elements: [line("a")] });
        expect(executeCommand("ZOOM W 0 0 100 50", h.ctx).message).toBe("Zoom to window");
        expect(h.zooms[0]).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });

        const usage = executeCommand("ZOOM W 0", h.ctx);
        expect(usage.error).toBe(true);
        expect(usage.message).toContain("ZOOM W");

        expect(executeCommand("ZOOM", h.ctx).error).toBe(true);
    });

    it("VIEW 保存、列举与恢复命名视图", () => {
        const h = createContext();
        expect(executeCommand("VIEW SAVE 俯视图", h.ctx).message).toBe("Saved view: 俯视图");
        expect(h.namedViews[0].name).toBe("俯视图");
        expect(h.namedViews[0].viewBox).toEqual({ x: 0, y: 0, w: 800, h: 600 });

        expect(executeCommand("VIEW LIST", h.ctx).message).toBe("Named views: 俯视图");
        expect(executeCommand("VIEW RESTORE 俯视图", h.ctx).message).toBe("Restored view: 俯视图");

        const missing = executeCommand("VIEW RESTORE 侧视图", h.ctx);
        expect(missing.error).toBe(true);
        expect(missing.message).toBe("No named view: 侧视图");

        expect(executeCommand("VIEW", h.ctx).error).toBe(true);
    });

    it("LAYER 自动创建图层并切换当前层", () => {
        const h = createContext();
        const outcome = executeCommand("LAYER WALLS", h.ctx);

        expect(h.addedLayers).toEqual(["WALLS"]);
        expect(h.currentLayer).toBe("WALLS");
        expect(outcome.message).toBe("Current layer: WALLS");
    });

    it("ORTHO 切换当前模式", () => {
        const h = createContext({ orthoMode: false });
        const outcome = executeCommand("ORTHO", h.ctx);

        expect(h.toggles.ortho).toBe(true);
        expect(outcome.message).toBe("ORTHO: ON");
    });

    it("UNDO / REDO 调用历史动作", () => {
        const h = createContext();
        executeCommand("U", h.ctx);
        executeCommand("REDO", h.ctx);

        expect(h.undoCount).toBe(1);
        expect(h.redoCount).toBe(1);
    });

    it("HELP 列出命令并支持查询单个命令", () => {
        const h = createContext();
        const list = executeCommand("?", h.ctx);
        expect(list.message).toContain("LINE");
        expect(list.message).toContain("SCALE");

        const usage = executeCommand("HELP SCALE", h.ctx);
        expect(usage.message).toContain("SCALE <factor>");
        expect(usage.message).toContain("Scale the selection");

        const unknown = executeCommand("HELP WARP", h.ctx);
        expect(unknown.error).toBe(true);
    });
});
