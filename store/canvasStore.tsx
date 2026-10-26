/**
 * canvasStore.tsx — CAD 画布状态管理
 * 使用 React Context + useReducer 管理 CAD 相关全局状态
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef, useState, ReactNode } from "react";
import { ToolType, CADElement, DrawingSettings } from "../types";
import { BulkUpdateCommand, CommandHistory, type CommandHistoryEntry } from "../lib/command";
import { reconcileElement } from "../services/advancedShapesService";

/* ─── State ─────────────────────────────────────────────────── */

/** 历史记录实现方式：command 为增量命令栈，snapshot 为旧的整图快照 */
export type HistoryMode = "command" | "snapshot";

/** 撤销历史概览：供顶栏按钮禁用态与历史下拉列表消费 */
export interface HistoryOverview {
  canUndo: boolean;
  canRedo: boolean;
  /** 历史条目（旧→新）；snapshot 模式下条目无增删改统计 */
  entries: CommandHistoryEntry[];
  /** 当前所处位置，对应 entries 的 index；command 模式 -1 表示初始状态 */
  currentIndex: number;
}

/**
 * 历史模式回退开关。
 * 默认使用 Command 模式；如需回退到快照实现，设置 VITE_HISTORY_MODE=snapshot 后重启开发服务器。
 */
const DEFAULT_HISTORY_MODE: HistoryMode =
  import.meta.env.VITE_HISTORY_MODE === "snapshot" ? "snapshot" : "command";


export interface CanvasState {
  elements: CADElement[];
  /** 当前选择集：独立于图元数据，不进入撤销历史与自动保存 */
  selectedIds: ReadonlySet<string>;
  history: CADElement[][];
  historyIndex: number;
  /** 当前使用的历史记录实现，便于调试与回退 */
  historyMode: HistoryMode;
  /** 自上次加载/新建以来的提交次数，用于按 N 次提交自动创建版本 */
  revision: number;
  activeTool: ToolType;
  drawingSettings: DrawingSettings;
  orthoMode: boolean;
  polarMode: boolean;
  snapMode: boolean;
  gridMode: boolean;
  /** 已隐藏的图层名：不渲染、不参与命中测试与捕捉 */
  hiddenLayers: string[];
  /** 已锁定的图层名：正常渲染与捕捉，但不可选中/编辑 */
  lockedLayers: string[];
  /** 显式创建的图层顺序；未在此列出的元素图层会自动追加显示 */
  layerOrder: string[];
  /** 图层颜色映射，作为该层新绘图元的默认颜色 */
  layerColors: Record<string, string>;
  /** 当前绘图层：新建图元默认写入该层 */
  currentLayer: string;
}

/** 初始示例图形，作为快照历史的基线状态 */
const INITIAL_ELEMENTS: CADElement[] = [
  {
    id: "init-1",
    type: "LINE",
    start: { x: 100, y: 100 },
    end: { x: 700, y: 100 },
    layer: "0",
    color: "#8b949e",
  },
  {
    id: "init-2",
    type: "LINE",
    start: { x: 700, y: 100 },
    end: { x: 700, y: 500 },
    layer: "0",
    color: "#8b949e",
  },
  {
    id: "init-3",
    type: "LINE",
    start: { x: 700, y: 500 },
    end: { x: 100, y: 500 },
    layer: "0",
    color: "#8b949e",
  },
  {
    id: "init-4",
    type: "LINE",
    start: { x: 100, y: 500 },
    end: { x: 100, y: 100 },
    layer: "0",
    color: "#8b949e",
  },
];

const initialState: CanvasState = {
  elements: INITIAL_ELEMENTS,
  selectedIds: new Set(),
  // 快照模式以初始图形为基线，保证第一次绘制也能撤销
  history: [INITIAL_ELEMENTS],
  historyIndex: 0,
  historyMode: DEFAULT_HISTORY_MODE,
  revision: 0,
  activeTool: ToolType.SELECT,
  drawingSettings: {
    units: "mm",
    gridSpacing: 50,
    snapDistance: 10,
    dimScale: 1.0,
    dimPrecision: 2,
  },
  orthoMode: false,
  polarMode: false,
  snapMode: true,
  gridMode: true,
  hiddenLayers: [],
  lockedLayers: [],
  layerOrder: ["0", "AI_GENERATED", "DIM"],
  layerColors: {
    "0": "#e6edf3",
    AI_GENERATED: "#137fec",
    DIM: "#4ade80",
  },
  currentLayer: "0",
};

/* ─── Actions ──────────────────────────────────────────────── */

export type CanvasAction =
  | { type: "SET_ELEMENTS"; elements: CADElement[] }
  | { type: "ADD_ELEMENT"; element: CADElement }
  | { type: "UPDATE_ELEMENT"; element: CADElement }
  | { type: "BULK_UPDATE"; elements: CADElement[] }
  | { type: "COMMIT"; elements: CADElement[] }
  | { type: "SET_SELECTION"; ids: string[] }
  | { type: "ADD_SELECTION"; ids: string[] }
  | { type: "TOGGLE_SELECTION"; id: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_TOOL"; tool: ToolType }
  | { type: "SET_DRAWING_SETTINGS"; settings: Partial<DrawingSettings> }
  | { type: "SET_ORTHO_MODE"; value: boolean }
  | { type: "SET_POLAR_MODE"; value: boolean }
  | { type: "SET_SNAP_MODE"; value: boolean }
  | { type: "SET_GRID_MODE"; value: boolean }
  | { type: "SET_LAYER_VISIBILITY"; layer: string; visible: boolean }
  | { type: "SET_LAYER_LOCKED"; layer: string; locked: boolean }
  | { type: "ADD_LAYER"; layer: string; color: string }
  | { type: "SET_LAYER_COLOR"; layer: string; color: string }
  | { type: "SET_CURRENT_LAYER"; layer: string }
  | { type: "REORDER_LAYER"; from: number; to: number }
  | {
      type: "LOAD_LAYER_STATE";
      layerOrder: string[];
      layerColors: Record<string, string>;
      hiddenLayers: string[];
      lockedLayers: string[];
    }
  | { type: "NOTE_COMMIT" }
  /** 仅更新图层元数据；元素上的 layer 字段重命名由调用方作为可撤销命令提交 */
  | { type: "RENAME_LAYER_META"; from: string; to: string }
  /** 删除图层元数据；调用方需先把该层元素迁移到 "0" */
  | { type: "DELETE_LAYER_META"; layer: string }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "LOAD_HISTORY"; history: CADElement[][]; index: number }
  | { type: "RESET" };

/* ─── Reducer ──────────────────────────────────────────────── */

const MAX_HISTORY = 50;

/** 移除已不存在的图元 ID，元素未变时返回原集合以保持引用稳定 */
function pruneSelection(
  selectedIds: ReadonlySet<string>,
  elements: CADElement[],
): ReadonlySet<string> {
  if (selectedIds.size === 0) return selectedIds;
  const existing = new Set(elements.map((el) => el.id));
  let changed = false;
  const next = new Set<string>();
  selectedIds.forEach((id) => {
    if (existing.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : selectedIds;
}

/** 图层隐藏或锁定时，移除该层图元的选择，避免对不可见图元执行变换 */
function deselectLayer(
  selectedIds: ReadonlySet<string>,
  elements: CADElement[],
  layer: string,
): ReadonlySet<string> {
  if (selectedIds.size === 0) return selectedIds;
  const next = new Set(selectedIds);
  elements.forEach((el) => {
    if ((el.layer || "0") === layer) next.delete(el.id);
  });
  return next.size === selectedIds.size ? selectedIds : next;
}

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "SET_ELEMENTS":
      return {
        ...state,
        elements: action.elements,
        selectedIds: pruneSelection(state.selectedIds, action.elements),
      };

    case "ADD_ELEMENT": {
      const newElements = [...state.elements, action.element];
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(newElements);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return {
        ...state,
        elements: newElements,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        revision: state.revision + 1,
      };
    }

    case "UPDATE_ELEMENT": {
      const newElements = state.elements.map((el) =>
        el.id === action.element.id ? action.element : el
      );
      return { ...state, elements: newElements };
    }

    case "BULK_UPDATE": {
      const updates = new Map(action.elements.map((e) => [e.id, e]));
      const newElements = state.elements.map((el) =>
        updates.has(el.id) ? updates.get(el.id)! : el
      );
      return { ...state, elements: newElements };
    }

    case "COMMIT": {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(action.elements);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return {
        ...state,
        elements: action.elements,
        selectedIds: pruneSelection(state.selectedIds, action.elements),
        history: newHistory,
        historyIndex: newHistory.length - 1,
        revision: state.revision + 1,
      };
    }

    case "NOTE_COMMIT":
      return { ...state, revision: state.revision + 1 };

    case "SET_SELECTION":
      return { ...state, selectedIds: new Set(action.ids) };

    case "ADD_SELECTION": {
      if (action.ids.length === 0) return state;
      return { ...state, selectedIds: new Set([...state.selectedIds, ...action.ids]) };
    }

    case "TOGGLE_SELECTION": {
      const next = new Set(state.selectedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedIds: next };
    }

    case "CLEAR_SELECTION":
      return state.selectedIds.size === 0 ? state : { ...state, selectedIds: new Set() };

    case "UNDO": {
      // historyIndex 指向当前图形，只有存在更早的快照时才可撤销
      if (state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      const elements = state.history[newIndex];
      return {
        ...state,
        elements,
        selectedIds: pruneSelection(state.selectedIds, elements),
        historyIndex: newIndex,
      };
    }

    case "REDO": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      const elements = state.history[newIndex];
      return {
        ...state,
        elements,
        selectedIds: pruneSelection(state.selectedIds, elements),
        historyIndex: newIndex,
      };
    }

    case "SET_TOOL":
      return { ...state, activeTool: action.tool };

    case "SET_DRAWING_SETTINGS":
      return { ...state, drawingSettings: { ...state.drawingSettings, ...action.settings } };

    case "SET_ORTHO_MODE":
      // 正交与极轴互斥：同时开启时后开的生效，避免两套约束互相覆盖
      return {
        ...state,
        orthoMode: action.value,
        polarMode: action.value ? false : state.polarMode,
      };

    case "SET_POLAR_MODE":
      return {
        ...state,
        polarMode: action.value,
        orthoMode: action.value ? false : state.orthoMode,
      };

    case "SET_SNAP_MODE":
      return { ...state, snapMode: action.value };

    case "SET_GRID_MODE":
      return { ...state, gridMode: action.value };

    case "SET_LAYER_VISIBILITY": {
      const hiddenLayers = action.visible
        ? state.hiddenLayers.filter(name => name !== action.layer)
        : Array.from(new Set([...state.hiddenLayers, action.layer]));
      return {
        ...state,
        hiddenLayers,
        selectedIds: action.visible
          ? state.selectedIds
          : deselectLayer(state.selectedIds, state.elements, action.layer),
      };
    }

    case "SET_LAYER_LOCKED": {
      const lockedLayers = action.locked
        ? Array.from(new Set([...state.lockedLayers, action.layer]))
        : state.lockedLayers.filter(name => name !== action.layer);
      return {
        ...state,
        lockedLayers,
        selectedIds: action.locked
          ? deselectLayer(state.selectedIds, state.elements, action.layer)
          : state.selectedIds,
      };
    }

    case "ADD_LAYER": {
      const layerOrder = state.layerOrder.includes(action.layer)
        ? state.layerOrder
        : [...state.layerOrder, action.layer];
      return {
        ...state,
        layerOrder,
        layerColors: { ...state.layerColors, [action.layer]: action.color },
      };
    }

    case "SET_LAYER_COLOR":
      return {
        ...state,
        layerColors: { ...state.layerColors, [action.layer]: action.color },
      };

    case "SET_CURRENT_LAYER":
      return { ...state, currentLayer: action.layer };

    case "REORDER_LAYER": {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= state.layerOrder.length || to >= state.layerOrder.length) {
        return state;
      }
      const layerOrder = [...state.layerOrder];
      const [moved] = layerOrder.splice(from, 1);
      layerOrder.splice(to, 0, moved);
      return { ...state, layerOrder };
    }

    case "RENAME_LAYER_META": {
      const { from, to } = action;
      if (from === to) return state;
      const layerColors = { ...state.layerColors };
      if (from in layerColors) {
        layerColors[to] = layerColors[from];
        delete layerColors[from];
      }
      return {
        ...state,
        layerOrder: state.layerOrder.map(name => (name === from ? to : name)),
        layerColors,
        hiddenLayers: state.hiddenLayers.map(name => (name === from ? to : name)),
        lockedLayers: state.lockedLayers.map(name => (name === from ? to : name)),
        currentLayer: state.currentLayer === from ? to : state.currentLayer,
      };
    }

    case "DELETE_LAYER_META": {
      const layerColors = { ...state.layerColors };
      delete layerColors[action.layer];
      return {
        ...state,
        layerOrder: state.layerOrder.filter(name => name !== action.layer),
        layerColors,
        hiddenLayers: state.hiddenLayers.filter(name => name !== action.layer),
        lockedLayers: state.lockedLayers.filter(name => name !== action.layer),
        currentLayer: state.currentLayer === action.layer ? "0" : state.currentLayer,
      };
    }

    case "LOAD_HISTORY":
      return {
        ...state,
        history: action.history,
        historyIndex: action.index,
        revision: 0,
        selectedIds: pruneSelection(state.selectedIds, action.history[action.index] ?? []),
      };

    case "LOAD_LAYER_STATE": {
      const layerOrder = action.layerOrder.length > 0 ? action.layerOrder : ["0"];
      return {
        ...state,
        layerOrder,
        layerColors: action.layerColors,
        hiddenLayers: action.hiddenLayers,
        lockedLayers: action.lockedLayers,
        currentLayer: layerOrder.includes(state.currentLayer) ? state.currentLayer : "0",
      };
    }

    case "RESET":
      return { ...initialState, selectedIds: new Set() };

    default:
      return state;
  }
}

/* ─── Context ───────────────────────────────────────────────── */

interface CanvasContextValue {
  state: CanvasState;
  dispatch: React.Dispatch<CanvasAction>;
  /** 当前选择集（只读） */
  selectedIds: ReadonlySet<string>;
  // Convenience methods
  addElement: (el: CADElement) => void;
  updateElement: (el: CADElement) => void;
  bulkUpdate: (elements: CADElement[]) => void;
  commitAction: (elements: CADElement[]) => void;
  /** 以当前元素状态提交一步历史，用于属性编辑等延迟提交场景 */
  commitCurrent: () => void;
  /** 读取最新元素引用，供连续应用多个动作时避免闭包拿到旧数组 */
  getElements: () => CADElement[];
  setElements: (elements: CADElement[]) => void;
  /** 合并远端协作补丁：覆盖撤销基线，不产生本地撤销步骤 */
  applyRemoteElements: (elements: CADElement[]) => void;
  /** 用给定 ID 替换选择集 */
  setSelection: (ids: string[]) => void;
  /** 向选择集追加 ID */
  addToSelection: (ids: string[]) => void;
  /** 切换单个图元的选择状态 */
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  /** 选中所有可见且未锁定的图元 */
  selectAll: () => void;
  setActiveTool: (tool: ToolType) => void;
  setDrawingSettings: (settings: Partial<DrawingSettings>) => void;
  /** 设置图层可见性；隐藏后该层元素不渲染、不可选、不可捕捉 */
  setLayerVisibility: (layer: string, visible: boolean) => void;
  /** 设置图层锁定；锁定后该层元素仍渲染与捕捉，但不可选中/编辑 */
  setLayerLocked: (layer: string, locked: boolean) => void;
  /** 新建图层；同名图层仅更新颜色 */
  addLayer: (layer: string, color: string) => void;
  /** 重命名图层；该层元素的 layer 字段改写会作为一次可撤销命令提交 */
  renameLayer: (from: string, to: string) => void;
  /** 删除图层；该层元素迁移到 "0" 层 */
  deleteLayer: (layer: string) => void;
  /** 修改图层颜色，作为该层新绘图元的默认颜色 */
  setLayerColor: (layer: string, color: string) => void;
  /** 设置当前绘图层 */
  setCurrentLayer: (layer: string) => void;
  /** 在图层顺序中上移/下移一位 */
  moveLayer: (layer: string, direction: -1 | 1) => void;
  /** 整体替换图层元数据，用于恢复版本快照 */
  loadLayerState: (state: {
    layerOrder: string[];
    layerColors: Record<string, string>;
    hiddenLayers: string[];
    lockedLayers: string[];
  }) => void;
  undo: () => void;
  redo: () => void;
  /** 撤销历史概览（只读派生值），两种历史模式下都可用 */
  historyOverview: HistoryOverview;
  /** 跳转到历史栈的任意位置，批量撤销/重做合并为一次交互 */
  jumpTo: (index: number) => void;
  loadHistory: (history: CADElement[][], index: number) => void;
  resetCanvas: () => void;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

/* ─── Provider ──────────────────────────────────────────────── */

export function CanvasProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(canvasReducer, initialState);

  /** 当前元素的最新引用，供事件回调读取，避免闭包拿到旧数组 */
  const elementsRef = useRef<CADElement[]>(state.elements);
  /** 最近一次提交（或被撤销/重做恢复）的图形，作为下一条命令的撤销目标 */
  const lastCommittedRef = useRef<CADElement[]>(state.elements);
  /** 增量命令栈；仅在 command 模式下使用 */
  const commandHistoryRef = useRef<CommandHistory | null>(null);
  /** command 模式的历史概览；命令栈只在事件回调中读写，这里同步给渲染层 */
  const [commandOverview, setCommandOverview] = useState<HistoryOverview>({
    canUndo: false,
    canRedo: false,
    entries: [],
    currentIndex: -1,
  });

  /** 把命令栈状态同步到概览（只能在事件回调中调用，渲染期不允许读 ref） */
  const syncCommandOverview = useCallback(() => {
    const history = commandHistoryRef.current;
    if (!history) {
      setCommandOverview({ canUndo: false, canRedo: false, entries: [], currentIndex: -1 });
      return;
    }
    setCommandOverview({
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      entries: history.getEntries(),
      currentIndex: history.currentIndex,
    });
  }, []);

  useEffect(() => {
    elementsRef.current = state.elements;
  }, [state.elements]);

  /**
   * 命令写回函数：同时刷新撤销基线与当前元素引用。
   * execute / undo / redo 都由命令调用它，保证 lastCommittedRef 始终指向命令栈顶部状态。
   */
  const applyElements = useCallback((elements: CADElement[]) => {
    lastCommittedRef.current = elements;
    elementsRef.current = elements;
    dispatch({ type: "SET_ELEMENTS", elements });
  }, []);

  /** 懒创建命令栈，避免在渲染期间产生副作用 */
  const getCommandHistory = useCallback(() => {
    if (!commandHistoryRef.current) {
      commandHistoryRef.current = new CommandHistory({ maxHistory: MAX_HISTORY });
    }
    return commandHistoryRef.current;
  }, []);

  /**
   * 提交一次图形变更。
   * command 模式记录一条 BulkUpdateCommand（撤销目标为上次提交的快照）；
   * snapshot 模式沿用整图快照历史，作为回退方案。
   */
  const commitAction = useCallback(
    (elements: CADElement[]) => {
      if (state.historyMode === "snapshot") {
        // 引用未变化说明没有实际修改，避免重复快照挤占历史
        if (lastCommittedRef.current === elements) return;
        dispatch({ type: "COMMIT", elements });
        lastCommittedRef.current = elements;
        elementsRef.current = elements;
        return;
      }

      const before = lastCommittedRef.current;
      // 引用未变化说明没有实际修改，不必占用一步撤销
      if (before === elements) return;
      getCommandHistory().execute(
        new BulkUpdateCommand(before, elements, applyElements),
      );
      // 命令栈的 applyElements 也会被撤销/重做复用，因此提交计数在这里单独记录
      dispatch({ type: "NOTE_COMMIT" });
      syncCommandOverview();
    },
    [state.historyMode, applyElements, getCommandHistory, syncCommandOverview],
  );

  const addElement = useCallback(
    (el: CADElement) => {
      if (state.historyMode === "command") {
        // 新增图元同样作为一次可撤销的提交
        commitAction([...elementsRef.current, el]);
        return;
      }
      dispatch({ type: "ADD_ELEMENT", element: el });
    },
    [state.historyMode, commitAction],
  );

  const updateElement = useCallback(
    (el: CADElement) => {
      const previous = elementsRef.current.find((item) => item.id === el.id);
      // 参数化图元（椭圆 / 齿轮 / 螺旋 / 弹簧）修改参数或移动中心后，
      // 同步派生轮廓，保证属性面板、渲染与命中测试使用同一份几何
      const next = previous ? reconcileElement(previous, el) : el;
      elementsRef.current = elementsRef.current.map((item) => (item.id === next.id ? next : item));
      dispatch({ type: "UPDATE_ELEMENT", element: next });
    },
    []
  );

  const bulkUpdate = useCallback(
    (updates: CADElement[]) => {
      const byId = new Map(updates.map((el) => [el.id, el]));
      elementsRef.current = elementsRef.current.map((el) => byId.get(el.id) ?? el);
      dispatch({ type: "BULK_UPDATE", elements: updates });
    },
    []
  );

  const setElements = useCallback(
    (next: CADElement[]) => {
      elementsRef.current = next;
      dispatch({ type: "SET_ELEMENTS", elements: next });
    },
    []
  );

  /**
   * 远端变更直接成为新的撤销基线：
   * 否则下一次本地提交的撤销目标会退回远端修改前的状态，导致远端图元一并被撤销。
   */
  const applyRemoteElements = useCallback((next: CADElement[]) => {
    lastCommittedRef.current = next;
    elementsRef.current = next;
    dispatch({ type: "SET_ELEMENTS", elements: next });
  }, []);

  /** 使用当前元素引用提交一步历史；属性面板停止输入后调用 */
  const commitCurrent = useCallback(() => {
    commitAction(elementsRef.current);
  }, [commitAction]);

  const getElements = useCallback(() => elementsRef.current, []);

  const setSelection = useCallback(
    (ids: string[]) => dispatch({ type: "SET_SELECTION", ids }),
    [],
  );

  const addToSelection = useCallback(
    (ids: string[]) => dispatch({ type: "ADD_SELECTION", ids }),
    [],
  );

  const toggleSelection = useCallback(
    (id: string) => dispatch({ type: "TOGGLE_SELECTION", id }),
    [],
  );

  const clearSelection = useCallback(
    () => dispatch({ type: "CLEAR_SELECTION" }),
    [],
  );

  const selectAll = useCallback(() => {
    const ids = elementsRef.current
      .filter((el) => {
        const layer = el.layer || "0";
        return !state.hiddenLayers.includes(layer) && !state.lockedLayers.includes(layer);
      })
      .map((el) => el.id);
    dispatch({ type: "SET_SELECTION", ids });
  }, [state.hiddenLayers, state.lockedLayers]);

  const setActiveTool = useCallback(
    (tool: ToolType) => dispatch({ type: "SET_TOOL", tool }),
    []
  );

  const setDrawingSettings = useCallback(
    (settings: Partial<DrawingSettings>) =>
      dispatch({ type: "SET_DRAWING_SETTINGS", settings }),
    []
  );

  const setLayerVisibility = useCallback(
    (layer: string, visible: boolean) =>
      dispatch({ type: "SET_LAYER_VISIBILITY", layer, visible }),
    [],
  );

  const setLayerLocked = useCallback(
    (layer: string, locked: boolean) =>
      dispatch({ type: "SET_LAYER_LOCKED", layer, locked }),
    [],
  );

  /** 新建图层；空名忽略，同名时只更新颜色 */
  const addLayer = useCallback((layer: string, color: string) => {
    const name = layer.trim();
    if (!name) return;
    dispatch({ type: "ADD_LAYER", layer: name, color });
  }, []);

  /** 重命名图层：元素层字段的改写通过 commitAction 写入历史，"0" 层不可改名 */
  const renameLayer = useCallback(
    (from: string, to: string) => {
      const name = to.trim();
      if (!name || name === from || from === "0") return;
      // 目标名称已存在时不覆盖，避免两个图层意外合并
      if (state.layerOrder.includes(name) || elementsRef.current.some(el => el.layer === name)) {
        return;
      }
      if (elementsRef.current.some(el => el.layer === from)) {
        commitAction(
          elementsRef.current.map(el => (el.layer === from ? { ...el, layer: name } : el)),
        );
      }
      dispatch({ type: "RENAME_LAYER_META", from, to: name });
    },
    [state.layerOrder, commitAction],
  );

  /** 删除图层：该层元素迁移到 "0"，元素迁移作为可撤销命令提交 */
  const deleteLayer = useCallback(
    (layer: string) => {
      if (layer === "0") return;
      if (elementsRef.current.some(el => el.layer === layer)) {
        commitAction(
          elementsRef.current.map(el => (el.layer === layer ? { ...el, layer: "0" } : el)),
        );
      }
      dispatch({ type: "DELETE_LAYER_META", layer });
    },
    [commitAction],
  );

  const setLayerColor = useCallback(
    (layer: string, color: string) => dispatch({ type: "SET_LAYER_COLOR", layer, color }),
    [],
  );

  const setCurrentLayer = useCallback(
    (layer: string) => dispatch({ type: "SET_CURRENT_LAYER", layer }),
    [],
  );

  const moveLayer = useCallback(
    (layer: string, direction: -1 | 1) => {
      const from = state.layerOrder.indexOf(layer);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= state.layerOrder.length) return;
      dispatch({ type: "REORDER_LAYER", from, to });
    },
    [state.layerOrder],
  );

  const loadLayerState = useCallback(
    (next: {
      layerOrder: string[];
      layerColors: Record<string, string>;
      hiddenLayers: string[];
      lockedLayers: string[];
    }) => dispatch({ type: "LOAD_LAYER_STATE", ...next }),
    [],
  );

  /** 撤销：command 模式弹出命令栈，snapshot 模式回退一帧快照 */
  const undo = useCallback(() => {
    if (state.historyMode === "snapshot") {
      const target = state.history[state.historyIndex - 1];
      dispatch({ type: "UNDO" });
      if (target) {
        lastCommittedRef.current = target;
        elementsRef.current = target;
      }
      return;
    }
    getCommandHistory().undo();
    syncCommandOverview();
  }, [state.historyMode, state.history, state.historyIndex, getCommandHistory, syncCommandOverview]);

  /** 重做：与撤销对称 */
  const redo = useCallback(() => {
    if (state.historyMode === "snapshot") {
      const target = state.history[state.historyIndex + 1];
      dispatch({ type: "REDO" });
      if (target) {
        lastCommittedRef.current = target;
        elementsRef.current = target;
      }
      return;
    }
    getCommandHistory().redo();
    syncCommandOverview();
  }, [state.historyMode, state.history, state.historyIndex, getCommandHistory, syncCommandOverview]);

  /**
   * 载入图纸时重置历史：
   * 命令栈清空，当前图形成为新的撤销基线。
   */
  const loadHistory = useCallback(
    (history: CADElement[][], index: number) => {
      const target = history[index] ?? [];
      dispatch({ type: "LOAD_HISTORY", history, index });
      dispatch({ type: "SET_ELEMENTS", elements: target });
      dispatch({ type: "CLEAR_SELECTION" });
      lastCommittedRef.current = target;
      elementsRef.current = target;
      commandHistoryRef.current?.clear();
      syncCommandOverview();
    },
    [syncCommandOverview],
  );

  /** 重置画布：同时清空命令栈，恢复到初始示例图形 */
  const resetCanvas = useCallback(() => {
    commandHistoryRef.current?.clear();
    lastCommittedRef.current = INITIAL_ELEMENTS;
    elementsRef.current = INITIAL_ELEMENTS;
    dispatch({ type: "RESET" });
    syncCommandOverview();
  }, [syncCommandOverview]);

  /**
   * 撤销历史概览：snapshot 模式直接从快照数组派生（渲染期只读 state），
   * command 模式使用事件回调中同步的 commandOverview。
   */
  const historyOverview: HistoryOverview =
    state.historyMode === "snapshot"
      ? {
          canUndo: state.historyIndex > 0,
          canRedo: state.historyIndex < state.history.length - 1,
          entries: state.history.map((_snapshot, index) => ({
            index,
            added: 0,
            removed: 0,
            modified: 0,
          })),
          currentIndex: state.historyIndex,
        }
      : commandOverview;

  /** 跳转到历史栈任意位置：command 模式批量 undo/redo；snapshot 模式直接取帧 */
  const jumpTo = useCallback(
    (target: number) => {
      if (state.historyMode === "snapshot") {
        const clamped = Math.max(0, Math.min(Math.trunc(target), state.history.length - 1));
        const snapshot = state.history[clamped];
        if (!snapshot || clamped === state.historyIndex) return;
        dispatch({ type: "LOAD_HISTORY", history: state.history, index: clamped });
        dispatch({ type: "SET_ELEMENTS", elements: snapshot });
        lastCommittedRef.current = snapshot;
        elementsRef.current = snapshot;
        return;
      }
      getCommandHistory().jumpTo(target);
      syncCommandOverview();
    },
    [state.historyMode, state.history, state.historyIndex, getCommandHistory, syncCommandOverview],
  );

  const value: CanvasContextValue = {
    state,
    dispatch,
    selectedIds: state.selectedIds,
    addElement,
    updateElement,
    bulkUpdate,
    commitAction,
    commitCurrent,
    getElements,
    setElements,
    applyRemoteElements,
    setSelection,
    addToSelection,
    toggleSelection,
    clearSelection,
    selectAll,
    setActiveTool,
    setDrawingSettings,
    setLayerVisibility,
    setLayerLocked,
    addLayer,
    renameLayer,
    deleteLayer,
    setLayerColor,
    setCurrentLayer,
    moveLayer,
    loadLayerState,
    undo,
    redo,
    historyOverview,
    jumpTo,
    loadHistory,
    resetCanvas,
  };

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

/* ─── Hook ──────────────────────────────────────────────────── */

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error("useCanvas must be used within a CanvasProvider");
  return ctx;
}
