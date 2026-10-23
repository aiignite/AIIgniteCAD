/**
 * commands/builtins.ts — 内置命令定义
 *
 * 每个命令声明名称、别名、说明、参数与执行函数；
 * 参数缺失时由命令行 UI 自动进入分步提示，无需命令自行处理。
 */

import { ToolType } from "../../types";
import type { CADElement } from "../../types";
import { offsetElements } from "../../services/offsetService";
import {
    countHiddenObjects,
    displayableElements,
    isolateIds,
    mergeHiddenIds,
    selectSimilarIds,
} from "../isolation";
import { getElementBoundingBox, type BoundingBox } from "../geometry";
import { groupElements, ungroupElements } from "../groups";
import {
    alignElements,
    distributeElements,
    type AlignMode,
    type DistributeAxis,
} from "../designOps";
import { normalizeViewName } from "../namedViews";
import { unionBounds } from "../viewport";
import * as Transform from "../transform";
import type { CommandContext, CommandDefinition, CommandOutcome } from "./types";

/** 工具激活命令：清一色切换到对应画布工具 */
function toolCommand(
    name: string,
    aliases: string[],
    tool: ToolType,
    description: string,
    message = `Tool: ${tool}`,
): CommandDefinition {
    return {
        name,
        aliases,
        description,
        run: (ctx) => {
            ctx.setActiveTool(tool);
            return { message };
        },
    };
}

const requireSelection = (ctx: CommandContext, action: string): CommandOutcome | null =>
    ctx.selectedElements.length > 0
        ? null
        : { message: `Select objects to ${action}`, error: true };

const toFiniteNumber = (raw: string | undefined, fallback: number): number => {
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
};

const toPositiveInteger = (raw: string | undefined, fallback: number): number =>
    Math.max(1, Math.floor(toFiniteNumber(raw, fallback) || fallback));

/** 图元集合的包围盒；退化包围盒（零宽高）不参与取景 */
const boundsOf = (elements: CADElement[]): BoundingBox | null => {
    const boxes = elements
        .map((element) => getElementBoundingBox(element))
        .filter((box) => box.maxX > box.minX || box.maxY > box.minY);
    return unionBounds(boxes);
};

const alignRun = (ctx: CommandContext, mode: AlignMode): CommandOutcome => {
    if (ctx.selectedElements.length < 2) {
        return { message: "Select at least two objects to align", error: true };
    }
    const outcome = alignElements(ctx.elements, ctx.selectedElements, mode);
    if (!outcome || outcome.changedIds.length === 0) {
        return { message: "The selection is already aligned", error: true };
    }
    ctx.commitAction(outcome.elements);
    return { message: `Aligned ${outcome.changedIds.length} objects` };
};

const distributeRun = (ctx: CommandContext, axis: DistributeAxis): CommandOutcome => {
    if (ctx.selectedElements.length < 3) {
        return { message: "Select at least three objects to distribute", error: true };
    }
    const outcome = distributeElements(ctx.elements, ctx.selectedElements, axis);
    if (!outcome) {
        return { message: "Objects overlap; cannot distribute evenly", error: true };
    }
    ctx.commitAction(outcome.elements);
    return { message: `Distributed ${outcome.changedIds.length} objects` };
};

export const BUILTIN_COMMANDS: CommandDefinition[] = [
    // ── 绘图与编辑工具 ──────────────────────────────────────
    toolCommand("LINE", ["L"], ToolType.LINE, "Draw line segments"),
    toolCommand("CIRCLE", ["C"], ToolType.CIRCLE, "Draw a circle by center and radius"),
    toolCommand("RECTANGLE", ["R", "REC"], ToolType.RECTANGLE, "Draw a rectangle by two corners"),
    toolCommand("POLYLINE", ["PL"], ToolType.POLYLINE, "Draw a polyline; Enter finishes"),
    toolCommand("ARC", ["A"], ToolType.ARC, "Draw a 3-point arc"),
    toolCommand("TEXT", ["T"], ToolType.TEXT, "Place a text label"),
    toolCommand("COPY", ["CO", "CP"], ToolType.COPY, "Copy selected objects by dragging"),
    toolCommand("TRIM", ["TR"], ToolType.TRIM, "Trim the clicked segment against other objects"),
    toolCommand("EXTEND", ["EX"], ToolType.EXTEND, "Extend the clicked end to the nearest boundary"),
    toolCommand("MIRROR", ["MI"], ToolType.MIRROR, "Mirror selected objects across a line"),
    toolCommand("ROTATE", ["RO"], ToolType.ROTATE, "Rotate selected objects around a base point"),
    toolCommand("DIMENSION", ["D", "DIM"], ToolType.DIMENSION, "Add a linear dimension"),
    toolCommand("MEASURE", ["DI", "DIST"], ToolType.MEASURE, "Measure a distance"),
    toolCommand("MOVE", ["M"], ToolType.SELECT, "Select and move objects", "Mode: MOVE/SELECT"),

    // ── 编辑动作 ────────────────────────────────────────────
    {
        name: "ERASE",
        aliases: ["E", "DEL"],
        description: "Delete the selected objects",
        run: (ctx) => {
            const missing = requireSelection(ctx, "erase");
            if (missing) return missing;
            const ids = [...ctx.selectedIds];
            if (ctx.confirmBulkDelete && !ctx.confirmBulkDelete(ids)) {
                return { message: "Confirm deletion in the dialog" };
            }
            ctx.commitAction(ctx.elements.filter((element) => !ctx.selectedIds.has(element.id)));
            ctx.clearSelection();
            return { message: "Deleted selected objects" };
        },
    },
    {
        name: "SCALE",
        aliases: ["SC"],
        description: "Scale the selection around its centroid",
        args: [
            {
                name: "factor",
                description: "Scale factor, greater than 0 (e.g. 1.5)",
                type: "number",
                required: true,
            },
        ],
        run: (ctx, values) => {
            const missing = requireSelection(ctx, "scale");
            if (missing) return missing;

            const factor = Number(values.factor);
            if (!Number.isFinite(factor) || factor <= 0) {
                return { message: "Usage: SCALE <factor>, e.g. SCALE 1.5", error: true };
            }

            const basePoint = Transform.getElementsCentroid(ctx.selectedElements);
            const scaledById = new Map(
                Transform.scaleElements(ctx.selectedElements, basePoint, factor, factor)
                    .map((element) => [element.id, element]),
            );
            ctx.commitAction(ctx.elements.map((element) => scaledById.get(element.id) ?? element));
            return { message: `Scaled selection ×${factor}` };
        },
    },
    {
        name: "OFFSET",
        aliases: ["O"],
        description: "Offset selected objects by a distance",
        args: [
            {
                name: "distance",
                description: "Offset distance (default 20)",
                type: "number",
                defaultValue: "20",
            },
        ],
        run: (ctx, values) => {
            const missing = requireSelection(ctx, "offset");
            if (missing) return missing;

            const distance = Number(values.distance);
            if (!Number.isFinite(distance) || distance === 0) {
                return { message: "Usage: OFFSET <distance>, e.g. OFFSET 20", error: true };
            }

            const copies = offsetElements(ctx.selectedElements, distance);
            ctx.commitAction([...ctx.elements, ...copies]);
            ctx.setSelection(copies.map((element) => element.id));
            return { message: `Offset by ${distance}` };
        },
    },
    {
        name: "ARRAY",
        aliases: ["AR"],
        description: "Create a rectangular array from the selection",
        args: [
            { name: "rows", description: "Row count (default 2)", type: "number", defaultValue: "2" },
            { name: "columns", description: "Column count (default 2)", type: "number", defaultValue: "2" },
            { name: "columnSpacing", description: "Column spacing (default 100)", type: "number", defaultValue: "100" },
            { name: "rowSpacing", description: "Row spacing (default 100)", type: "number", defaultValue: "100" },
        ],
        run: (ctx, values) => {
            const missing = requireSelection(ctx, "array");
            if (missing) return missing;

            const rows = toPositiveInteger(values.rows, 2);
            const columns = toPositiveInteger(values.columns, 2);
            const columnSpacing = toFiniteNumber(values.columnSpacing, 100);
            const rowSpacing = toFiniteNumber(values.rowSpacing, 100);
            const copies = Transform.rectangularArray(
                ctx.selectedElements,
                rows,
                columns,
                rowSpacing,
                columnSpacing,
            );

            ctx.commitAction([...ctx.elements, ...copies]);
            ctx.setSelection(copies.map((element) => element.id));
            return { message: `Array ${rows}×${columns}` };
        },
    },
    {
        name: "GROUP",
        aliases: ["G", "JOIN"],
        description: "Combine the selected objects into one group",
        run: (ctx) => {
            const missing = requireSelection(ctx, "group");
            if (missing) return missing;
            if (ctx.selectedElements.length < 2) {
                return { message: "Select at least two objects to group", error: true };
            }
            ctx.commitAction(groupElements(ctx.elements, ctx.selectedIds));
            return { message: `Grouped ${ctx.selectedElements.length} objects` };
        },
    },
    {
        name: "UNGROUP",
        aliases: ["UG", "UNJOIN"],
        description: "Dissolve the groups of the selected objects",
        run: (ctx) => {
            const missing = requireSelection(ctx, "ungroup");
            if (missing) return missing;
            const next = ungroupElements(ctx.elements, ctx.selectedIds);
            if (next === ctx.elements) {
                return { message: "The selection is not grouped", error: true };
            }
            ctx.commitAction(next);
            return { message: "Ungrouped the selection" };
        },
    },
    {
        name: "ALIGNLEFT",
        aliases: ["AL"],
        description: "Align the selection to its left edge",
        run: (ctx) => alignRun(ctx, "left"),
    },
    {
        name: "ALIGNRIGHT",
        aliases: ["ARIGHT"],
        description: "Align the selection to its right edge",
        run: (ctx) => alignRun(ctx, "right"),
    },
    {
        name: "ALIGNCENTERX",
        aliases: ["ACX"],
        description: "Align the selection to its horizontal center",
        run: (ctx) => alignRun(ctx, "centerX"),
    },
    {
        name: "ALIGNTOP",
        aliases: ["AT"],
        description: "Align the selection to its top edge",
        run: (ctx) => alignRun(ctx, "top"),
    },
    {
        name: "ALIGNBOTTOM",
        aliases: ["AB"],
        description: "Align the selection to its bottom edge",
        run: (ctx) => alignRun(ctx, "bottom"),
    },
    {
        name: "ALIGNCENTERY",
        aliases: ["ACY"],
        description: "Align the selection to its vertical center",
        run: (ctx) => alignRun(ctx, "centerY"),
    },
    {
        name: "DISTRIBUTEH",
        aliases: ["DH"],
        description: "Space the selection evenly between left and right",
        run: (ctx) => distributeRun(ctx, "horizontal"),
    },
    {
        name: "DISTRIBUTEV",
        aliases: ["DV"],
        description: "Space the selection evenly between top and bottom",
        run: (ctx) => distributeRun(ctx, "vertical"),
    },
    {
        name: "SELECTALL",
        aliases: ["SA", "ALL"],
        description: "Select all unlocked, visible objects",
        run: (ctx) => {
            const visible = displayableElements(
                ctx.elements,
                ctx.hiddenLayers,
                ctx.hiddenObjectIds,
            ).filter((element) => !ctx.lockedLayers.includes(element.layer || "0"));
            ctx.setSelection(visible.map((element) => element.id));
            return { message: `Selected ${visible.length} objects` };
        },
    },
    {
        name: "SELECTSIMILAR",
        aliases: ["SSI", "SIMILAR"],
        description: "Select every displayable object of the selected types",
        run: (ctx) => {
            if (ctx.selectedElements.length === 0) {
                return { message: "Select objects first", error: true };
            }
            const candidates = displayableElements(
                ctx.elements,
                ctx.hiddenLayers,
                ctx.hiddenObjectIds,
            );
            const ids = selectSimilarIds(candidates, ctx.selectedElements);
            ctx.setSelection(ids);
            return { message: `Selected ${ids.length} similar objects` };
        },
    },
    {
        name: "QSELECT",
        aliases: ["QS"],
        description: "Open the quick select panel (type / layer / color filters)",
        run: (ctx) => {
            if (!ctx.openQuickSelect) {
                return { message: "Quick select is unavailable", error: true };
            }
            ctx.openQuickSelect();
            return { message: "Quick select" };
        },
    },
    {
        name: "ISOLATE",
        aliases: ["ISO"],
        description: "Hide every object except the selection",
        run: (ctx) => {
            if (ctx.selectedElements.length === 0) {
                return { message: "Select objects to isolate", error: true };
            }
            ctx.setHiddenObjectIds(isolateIds(ctx.elements, ctx.hiddenLayers, ctx.selectedIds));
            return { message: `Isolated ${ctx.selectedElements.length} objects` };
        },
    },
    {
        name: "HIDEOBJECTS",
        aliases: ["HIDE", "HI"],
        description: "Hide the selected objects",
        run: (ctx) => {
            const missing = requireSelection(ctx, "hide");
            if (missing) return missing;
            const ids = ctx.selectedElements.map((element) => element.id);
            ctx.setHiddenObjectIds(mergeHiddenIds(ctx.hiddenObjectIds, ids));
            ctx.clearSelection();
            return { message: `Hidden ${ids.length} objects` };
        },
    },
    {
        name: "SHOWALL",
        aliases: ["SH", "UNISOLATE", "UNISO"],
        description: "Show objects hidden by ISOLATE or HIDEOBJECTS",
        run: (ctx) => {
            const hidden = countHiddenObjects(ctx.elements, ctx.hiddenObjectIds);
            // 即使隐藏集只剩失效 id（图元已删除）也要清空，避免撤销回来后仍是隐藏状态
            if (ctx.hiddenObjectIds.size > 0) ctx.setHiddenObjectIds([]);
            return { message: hidden > 0 ? `Showed ${hidden} objects` : "No hidden objects" };
        },
    },
    {
        name: "DESELECT",
        aliases: ["DS"],
        description: "Clear the current selection",
        run: (ctx) => {
            ctx.clearSelection();
            return { message: "Selection cleared" };
        },
    },
    {
        name: "UNDO",
        aliases: ["U"],
        description: "Undo the last change",
        run: (ctx) => {
            ctx.undo();
            return { message: "Undo" };
        },
    },
    {
        name: "REDO",
        aliases: [],
        description: "Redo the last undone change",
        run: (ctx) => {
            ctx.redo();
            return { message: "Redo" };
        },
    },

    // ── 视图与图层 ──────────────────────────────────────────
    {
        name: "ORTHO",
        aliases: [],
        description: "Toggle orthogonal drawing mode",
        run: (ctx) => {
            const next = !ctx.orthoMode;
            ctx.setOrthoMode(next);
            return { message: `ORTHO: ${next ? "ON" : "OFF"}` };
        },
    },
    {
        name: "GRID",
        aliases: [],
        description: "Toggle the grid",
        run: (ctx) => {
            const next = !ctx.gridMode;
            ctx.setGridMode(next);
            return { message: `GRID: ${next ? "ON" : "OFF"}` };
        },
    },
    {
        name: "SNAP",
        aliases: [],
        description: "Toggle object snapping",
        run: (ctx) => {
            const next = !ctx.snapMode;
            ctx.setSnapMode(next);
            return { message: `SNAP: ${next ? "ON" : "OFF"}` };
        },
    },
    {
        name: "ZOOM",
        aliases: ["Z"],
        description: "Zoom to extents (E), a window (W x1 y1 x2 y2) or the selection (S)",
        args: [
            { name: "mode", description: "E 范围 / W 窗口 / S 选择集", type: "string" },
            { name: "x1", description: "窗口左下角 X", type: "number" },
            { name: "y1", description: "窗口左下角 Y", type: "number" },
            { name: "x2", description: "窗口右上角 X", type: "number" },
            { name: "y2", description: "窗口右上角 Y", type: "number" },
        ],
        run: (ctx, values) => {
            if (!ctx.zoomToBounds) {
                return { message: "Zoom is unavailable", error: true };
            }
            const mode = (values.mode ?? "").trim().toUpperCase();

            if (mode === "E" || mode === "A") {
                const visible = displayableElements(
                    ctx.elements,
                    ctx.hiddenLayers,
                    ctx.hiddenObjectIds,
                );
                ctx.zoomToBounds(boundsOf(visible));
                return { message: "Zoom to extents" };
            }

            if (mode === "S") {
                if (ctx.selectedElements.length === 0) {
                    return { message: "Select objects to zoom to", error: true };
                }
                ctx.zoomToBounds(boundsOf(ctx.selectedElements));
                return { message: `Zoom to ${ctx.selectedElements.length} selected objects` };
            }

            if (mode === "W") {
                const [x1, y1, x2, y2] = [values.x1, values.y1, values.x2, values.y2].map(Number);
                if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) {
                    return { message: "Usage: ZOOM W <x1> <y1> <x2> <y2>", error: true };
                }
                ctx.zoomToBounds({
                    minX: Math.min(x1, x2),
                    minY: Math.min(y1, y2),
                    maxX: Math.max(x1, x2),
                    maxY: Math.max(y1, y2),
                });
                return { message: "Zoom to window" };
            }

            return {
                message: "Usage: ZOOM E | ZOOM W <x1> <y1> <x2> <y2> | ZOOM S",
                error: true,
            };
        },
    },
    {
        name: "VIEW",
        aliases: ["V"],
        description: "Save, restore or list named views",
        args: [
            { name: "action", description: "SAVE / RESTORE / LIST", type: "string" },
            { name: "name", description: "View name", type: "string" },
        ],
        run: (ctx, values) => {
            const action = (values.action ?? "").trim().toUpperCase();

            if (action === "LIST") {
                const views = ctx.listNamedViews?.() ?? [];
                return {
                    message:
                        views.length > 0 ? `Named views: ${views.join(", ")}` : "No named views",
                };
            }

            if (action === "SAVE") {
                const name = normalizeViewName(values.name ?? "");
                if (!name) return { message: "Usage: VIEW SAVE <name>", error: true };
                if (!ctx.saveNamedView || !ctx.currentViewBox) {
                    return { message: "Named views are unavailable", error: true };
                }
                ctx.saveNamedView({ name, viewBox: ctx.currentViewBox() });
                return { message: `Saved view: ${name}` };
            }

            if (action === "RESTORE") {
                const name = normalizeViewName(values.name ?? "");
                if (!name) return { message: "Usage: VIEW RESTORE <name>", error: true };
                if (!ctx.restoreNamedView?.(name)) {
                    return { message: `No named view: ${name}`, error: true };
                }
                return { message: `Restored view: ${name}` };
            }

            return {
                message: "Usage: VIEW SAVE <name> | VIEW RESTORE <name> | VIEW LIST",
                error: true,
            };
        },
    },
    {
        name: "PLOT",
        aliases: ["PRINT"],
        description: "Open the plot / print dialog",
        run: (ctx) => {
            if (!ctx.openPlot) {
                return { message: "Plot is unavailable", error: true };
            }
            ctx.openPlot();
            return { message: "Plot" };
        },
    },
    {
        name: "LAYER",
        aliases: ["LA"],
        description: "Switch to a layer, creating it if necessary",
        args: [
            {
                name: "name",
                description: "Layer name",
                type: "string",
                required: true,
            },
        ],
        run: (ctx, values) => {
            const name = values.name.trim();
            if (!name) return { message: "Usage: LAYER <name>", error: true };
            if (!ctx.layerOrder.includes(name)) ctx.addLayer(name, "#e6edf3");
            ctx.setCurrentLayer(name);
            return { message: `Current layer: ${name}` };
        },
    },
];
