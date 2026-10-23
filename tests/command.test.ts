/**
 * command.test.ts — Command 模式与历史栈测试
 *
 * 覆盖命令的执行、撤销、重做、分支截断与历史上限，
 * 并验证快照 reducer 的撤销/重做不再出现"滞后一步"的问题。
 */

import { describe, expect, it } from "vitest";
import { BulkUpdateCommand, CommandHistory } from "../lib/command";
import { canvasReducer, CanvasState } from "../store/canvasStore";
import { CADElement, ToolType } from "../types";

/** 构造一条可辨识的线段元素 */
const line = (id: string, x: number): CADElement => ({
    id,
    type: "LINE",
    start: { x, y: 0 },
    end: { x: x + 10, y: 0 },
    layer: "0",
    color: "#fff",
});

describe("CommandHistory", () => {
    it("执行命令后写入目标状态，并支持撤销", () => {
        const states: CADElement[][] = [];
        const setter = (els: CADElement[]) => states.push(els);
        const initial = [line("a", 0)];
        const next = [line("a", 50)];

        const history = new CommandHistory();
        history.execute(new BulkUpdateCommand(initial, next, setter));

        expect(states.at(-1)).toBe(next);
        expect(history.canUndo).toBe(true);

        expect(history.undo()).toBe(true);
        expect(states.at(-1)).toBe(initial);
    });

    it("撤销后可以重做", () => {
        const states: CADElement[][] = [];
        const setter = (els: CADElement[]) => states.push(els);
        const initial = [line("a", 0)];
        const next = [line("a", 80)];
        const history = new CommandHistory();

        history.execute(new BulkUpdateCommand(initial, next, setter));
        history.undo();
        expect(history.canRedo).toBe(true);

        expect(history.redo()).toBe(true);
        expect(states.at(-1)).toBe(next);
    });

    it("撤销后执行新命令会截断重做分支", () => {
        const states: CADElement[][] = [];
        const setter = (els: CADElement[]) => states.push(els);
        const s0 = [line("a", 0)];
        const s1 = [line("a", 10)];
        const s2 = [line("a", 20)];
        const history = new CommandHistory();

        history.execute(new BulkUpdateCommand(s0, s1, setter));
        history.undo();
        history.execute(new BulkUpdateCommand(s0, s2, setter));

        expect(history.canRedo).toBe(false);
        expect(history.size).toBe(1);
        expect(states.at(-1)).toBe(s2);
    });

    it("超过最大历史长度时丢弃最旧的命令", () => {
        const history = new CommandHistory({ maxHistory: 3 });
        const setter = () => undefined;

        for (let i = 1; i <= 5; i++) {
            history.execute(
                new BulkUpdateCommand([line("a", i - 1)], [line("a", i)], setter),
            );
        }

        expect(history.size).toBe(3);
        history.undo();
        history.undo();
        history.undo();
        // 仅剩 3 条命令，全部撤销后不能再撤销
        expect(history.canUndo).toBe(false);
    });

    it("clear 重置命令栈", () => {
        const history = new CommandHistory();
        history.execute(new BulkUpdateCommand([], [line("a", 0)], () => undefined));

        history.clear();

        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
        expect(history.size).toBe(0);
    });
});

/** 构造用于 reducer 测试的最小状态 */
function createState(): CanvasState {
    const s0 = [line("a", 0)];
    return {
        elements: s0,
        selectedIds: new Set<string>(),
        history: [s0],
        historyIndex: 0,
        historyMode: "snapshot",
        revision: 0,
        activeTool: ToolType.SELECT,
        drawingSettings: {
            units: "mm",
            gridSpacing: 50,
            snapDistance: 10,
            dimScale: 1,
            dimPrecision: 2,
        },
        orthoMode: false,
        polarMode: false,
        snapMode: true,
        gridMode: true,
        hiddenLayers: [],
        lockedLayers: [],
        layerOrder: ["0"],
        layerColors: { "0": "#ffffff" },
        currentLayer: "0",
    };
}

describe("canvasReducer 快照历史", () => {
    it("提交后撤销回到上一帧，再重做回到最新帧", () => {
        const s1 = [line("a", 100)];
        const committed = canvasReducer(createState(), {
            type: "COMMIT",
            elements: s1,
        });

        const undone = canvasReducer(committed, { type: "UNDO" });
        expect(undone.elements).toBe(undone.history[0]);
        expect(undone.historyIndex).toBe(0);

        const redone = canvasReducer(undone, { type: "REDO" });
        expect(redone.elements).toBe(s1);
        expect(redone.historyIndex).toBe(1);
    });

    it("基线状态无法继续撤销", () => {
        const state = canvasReducer(createState(), { type: "UNDO" });
        expect(state.historyIndex).toBe(0);
        expect(state.elements).toBe(state.history[0]);
    });
});

describe("canvasReducer 选择集", () => {
    it("设置、追加与切换选择都不写入历史", () => {
        let state = createState();
        state = canvasReducer(state, { type: "SET_SELECTION", ids: ["a"] });
        expect([...state.selectedIds]).toEqual(["a"]);

        const historyBefore = state.history;
        state = canvasReducer(state, { type: "ADD_SELECTION", ids: ["b"] });
        state = canvasReducer(state, { type: "TOGGLE_SELECTION", id: "a" });

        expect([...state.selectedIds]).toEqual(["b"]);
        expect(state.history).toBe(historyBefore);
        expect(state.historyIndex).toBe(0);
    });

    it("元素被删除后自动剔除失效的选择 ID", () => {
        let state = createState();
        state = canvasReducer(state, { type: "SET_SELECTION", ids: ["a", "ghost"] });
        state = canvasReducer(state, { type: "SET_ELEMENTS", elements: [] });
        expect(state.selectedIds.size).toBe(0);
    });

    it("撤销只恢复图形，保留仍存在的选择", () => {
        const next = [line("a", 100)];
        let state = canvasReducer(createState(), { type: "COMMIT", elements: next });
        state = canvasReducer(state, { type: "SET_SELECTION", ids: ["a"] });
        state = canvasReducer(state, { type: "UNDO" });

        expect(state.elements).toBe(state.history[0]);
        expect(state.selectedIds.has("a")).toBe(true);
    });
});

describe("canvasReducer 图层状态", () => {
    it("隐藏与显示图层可反复切换且不重复累积", () => {
        const hidden = canvasReducer(createState(), {
            type: "SET_LAYER_VISIBILITY",
            layer: "DIM",
            visible: false,
        });
        expect(hidden.hiddenLayers).toEqual(["DIM"]);

        // 重复隐藏同一层不应产生重复项
        const again = canvasReducer(hidden, {
            type: "SET_LAYER_VISIBILITY",
            layer: "DIM",
            visible: false,
        });
        expect(again.hiddenLayers).toEqual(["DIM"]);

        const shown = canvasReducer(again, {
            type: "SET_LAYER_VISIBILITY",
            layer: "DIM",
            visible: true,
        });
        expect(shown.hiddenLayers).toEqual([]);
    });

    it("锁定与解锁图层", () => {
        const locked = canvasReducer(createState(), {
            type: "SET_LAYER_LOCKED",
            layer: "AI_GENERATED",
            locked: true,
        });
        expect(locked.lockedLayers).toEqual(["AI_GENERATED"]);

        const unlocked = canvasReducer(locked, {
            type: "SET_LAYER_LOCKED",
            layer: "AI_GENERATED",
            locked: false,
        });
        expect(unlocked.lockedLayers).toEqual([]);
    });

    it("新建图层不会重复登记，并保存图层颜色", () => {
        const added = canvasReducer(createState(), {
            type: "ADD_LAYER",
            layer: "WALLS",
            color: "#ff0000",
        });
        expect(added.layerOrder).toEqual(["0", "WALLS"]);
        expect(added.layerColors.WALLS).toBe("#ff0000");

        const again = canvasReducer(added, {
            type: "ADD_LAYER",
            layer: "WALLS",
            color: "#00ff00",
        });
        expect(again.layerOrder).toEqual(["0", "WALLS"]);
        // 同名图层只更新颜色，不重复追加
        expect(again.layerColors.WALLS).toBe("#00ff00");
    });

    it("重命名图层时同步更新颜色、隐藏、锁定与当前层", () => {
        const base = canvasReducer(
            canvasReducer(createState(), { type: "ADD_LAYER", layer: "A", color: "#123456" }),
            { type: "SET_CURRENT_LAYER", layer: "A" },
        );
        const hidden = canvasReducer(base, {
            type: "SET_LAYER_VISIBILITY",
            layer: "A",
            visible: false,
        });
        const locked = canvasReducer(hidden, {
            type: "SET_LAYER_LOCKED",
            layer: "A",
            locked: true,
        });

        const renamed = canvasReducer(locked, {
            type: "RENAME_LAYER_META",
            from: "A",
            to: "B",
        });

        expect(renamed.layerOrder).toEqual(["0", "B"]);
        expect(renamed.layerColors.B).toBe("#123456");
        expect(renamed.layerColors.A).toBeUndefined();
        expect(renamed.hiddenLayers).toEqual(["B"]);
        expect(renamed.lockedLayers).toEqual(["B"]);
        expect(renamed.currentLayer).toBe("B");
    });

    it("删除图层时清理元数据并把当前层回退到 0", () => {
        const added = canvasReducer(
            canvasReducer(createState(), { type: "ADD_LAYER", layer: "TEMP", color: "#abcdef" }),
            { type: "SET_CURRENT_LAYER", layer: "TEMP" },
        );
        const hidden = canvasReducer(added, {
            type: "SET_LAYER_VISIBILITY",
            layer: "TEMP",
            visible: false,
        });

        const deleted = canvasReducer(hidden, {
            type: "DELETE_LAYER_META",
            layer: "TEMP",
        });

        expect(deleted.layerOrder).toEqual(["0"]);
        expect(deleted.layerColors.TEMP).toBeUndefined();
        expect(deleted.hiddenLayers).toEqual([]);
        expect(deleted.currentLayer).toBe("0");
    });

    it("按索引重排图层顺序并拒绝越界移动", () => {
        const base = canvasReducer(
            canvasReducer(createState(), { type: "ADD_LAYER", layer: "A", color: "#111111" }),
            { type: "ADD_LAYER", layer: "B", color: "#222222" },
        );

        const moved = canvasReducer(base, { type: "REORDER_LAYER", from: 2, to: 0 });
        expect(moved.layerOrder).toEqual(["B", "0", "A"]);

        const unchanged = canvasReducer(moved, { type: "REORDER_LAYER", from: 0, to: 9 });
        expect(unchanged.layerOrder).toEqual(["B", "0", "A"]);
    });
});
