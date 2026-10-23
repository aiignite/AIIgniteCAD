/**
 * commands/types.ts — 命令行的共享类型
 *
 * 命令定义只依赖 CommandContext，不直接访问 React 状态或组件，
 * 因此新增命令只需在 builtins 中注册，无需修改 App.tsx。
 */

import type { CADElement, ToolType } from "../../types";
import type { BoundingBox } from "../geometry";
import type { NamedView } from "../namedViews";
import type { ViewBox } from "../viewport";

export interface CommandContext {
    elements: CADElement[];
    selectedIds: ReadonlySet<string>;
    selectedElements: CADElement[];
    orthoMode: boolean;
    gridMode: boolean;
    snapMode: boolean;
    currentLayer: string;
    layerOrder: string[];
    hiddenLayers: string[];
    lockedLayers: string[];
    /** 临时隐藏集（隔离 / 隐藏对象），与图层可见性无关 */
    hiddenObjectIds: ReadonlySet<string>;
    setHiddenObjectIds: (ids: string[]) => void;

    setActiveTool: (tool: ToolType) => void;
    setSelection: (ids: string[]) => void;
    clearSelection: () => void;
    commitAction: (elements: CADElement[]) => void;
    /** 批量删除需要宿主弹窗确认；返回 false 表示已转入确认流程 */
    confirmBulkDelete?: (ids: string[]) => boolean;
    showNotification: (message: string) => void;
    setOrthoMode: (value: boolean) => void;
    setGridMode: (value: boolean) => void;
    setSnapMode: (value: boolean) => void;
    undo: () => void;
    redo: () => void;
    addLayer: (layer: string, color: string) => void;
    setCurrentLayer: (layer: string) => void;
    /** 打开图框 / 打印面板 */
    openPlot?: () => void;
    /** 打开快速选择面板 */
    openQuickSelect?: () => void;
    /** 视图控制：只改变视口，不产生画布变更，也不占撤销步骤 */
    zoomToBounds?: (bounds: BoundingBox) => void;
    /** 当前视口，用于保存命名视图 */
    currentViewBox?: () => ViewBox;
    /** 命名视图：保存 / 恢复 / 列举 */
    saveNamedView?: (view: NamedView) => boolean;
    restoreNamedView?: (name: string) => boolean;
    listNamedViews?: () => string[];
}

export interface CommandArg {
    /** 参数名，同时用于分步提示与取值 */
    name: string;
    description: string;
    type: "number" | "string";
    required?: boolean;
    /** 缺省值；提供后该参数不再触发分步输入 */
    defaultValue?: string;
}

export interface CommandOutcome {
    message?: string;
    error?: boolean;
}

export interface CommandDefinition {
    /** 规范名（大写）；别名只用于输入解析 */
    name: string;
    aliases: string[];
    description: string;
    args?: CommandArg[];
    run: (ctx: CommandContext, values: Record<string, string>) => CommandOutcome;
}

export interface ResolvedCommand {
    definition: CommandDefinition | null;
    /** 命令行中实际提供的参数 token（不含命令名） */
    provided: string[];
    /** 参数名 -> 原始 token（含默认值） */
    values: Record<string, string>;
    /** 尚未提供的必填参数，按声明顺序 */
    missing: CommandArg[];
    raw: string;
}
