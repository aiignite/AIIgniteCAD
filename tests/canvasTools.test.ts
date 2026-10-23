/**
 * canvasTools.test.ts — 画布工具状态机单元测试
 *
 * 直接驱动 tools/ 下的状态机，验证各工具在按下/松开后的文档变更与多步行为。
 */

import { describe, expect, it } from "vitest";
import { ToolType } from "../types";
import type { CADElement, DrawingSettings, DragMode, Point } from "../types";
import type { GripPoint } from "../lib/grip";
import type { ToolContext } from "../tools/BaseTool";
import { getTool } from "../tools";
import { finishPolyline } from "../tools/PolylineTool";

const SETTINGS: DrawingSettings = {
    units: "mm",
    gridSpacing: 10,
    snapDistance: 8,
    dimScale: 1,
    dimPrecision: 2,
};

const element = (partial: Partial<CADElement> & Pick<CADElement, "type">): CADElement => ({
    id: "el-1",
    layer: "0",
    color: "#ffffff",
    ...partial,
});

const line = (x1: number, y1: number, x2: number, y2: number, id = "el-1"): CADElement =>
    element({ id, type: "LINE", start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });

function applyUpdater<T>(value: T | ((prev: T) => T), prev: T): T {
    return typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
}

interface HarnessOptions {
    elements?: CADElement[];
    selectedIds?: string[];
    hit?: CADElement;
    /** 点击循环解析出的命中图元；缺省时工具退回 findHitElement */
    resolveClickTarget?: (point: Point) => CADElement | undefined;
    dragMode?: DragMode | null;
    activeGrip?: GripPoint | null;
}

/** 可变 ToolContext 测试桩：setter 同步写回，模拟两次点击间的重新渲染 */
function createHarness(options: HarnessOptions = {}) {
    let elements = options.elements ?? [];
    let selection = new Set(options.selectedIds ?? []);
    let activeGrip = options.activeGrip ?? null;
    const notifications: string[] = [];
    const added: CADElement[] = [];
    const commits: CADElement[][] = [];
    const textRequests: Point[] = [];
    const advancedRequests: Array<{ tool: ToolType; point: Point }> = [];
    const toolSwitches: ToolType[] = [];
    /** 按下时命中的图元；跨按下 / 松开保留 */
    const pressTargetRef: { current: CADElement | undefined } = { current: undefined };

    const ctx: ToolContext = {
        rawPoint: { x: 0, y: 0 },
        point: { x: 0, y: 0 },
        client: { x: 0, y: 0 },
        button: 0,
        shiftKey: false,
        activeTool: ToolType.LINE,
        dragMode: options.dragMode ?? null,
        drawStart: null,
        currentPoint: null,
        polyPoints: [],
        arcPoints: [],
        dimPoints: [],
        activeGrip,
        elements,
        selectedIds: selection,
        drawingSettings: SETTINGS,
        orthoMode: false,
        currentLayer: "0",
        currentLayerColor: "#ffffff",
        lockedLayers: [],
        grips: [],
        findHitElement: () => options.hit,
        resolveClickTarget: options.resolveClickTarget,
        pressTargetRef,
        worldTolerance: () => 1,
        queryRect: () => elements,
        setDragMode: value => {
            ctx.dragMode = applyUpdater(value, ctx.dragMode);
        },
        setDrawStart: value => {
            ctx.drawStart = applyUpdater(value, ctx.drawStart);
        },
        setCurrentPoint: value => {
            ctx.currentPoint = applyUpdater(value, ctx.currentPoint);
        },
        setPolyPoints: value => {
            ctx.polyPoints = applyUpdater(value, ctx.polyPoints);
        },
        setArcPoints: value => {
            ctx.arcPoints = applyUpdater(value, ctx.arcPoints);
        },
        setDimPoints: value => {
            ctx.dimPoints = applyUpdater(value, ctx.dimPoints);
        },
        setActiveGrip: value => {
            activeGrip = applyUpdater(value, activeGrip);
            ctx.activeGrip = activeGrip;
        },
        setActiveTool: tool => {
            toolSwitches.push(tool);
            ctx.activeTool = tool;
        },
        addElement: next => {
            added.push(next);
            elements = [...elements, next];
            ctx.elements = elements;
        },
        commitAction: next => {
            commits.push(next);
            elements = next;
            ctx.elements = elements;
        },
        setSelection: ids => {
            selection = new Set(ids);
            ctx.selectedIds = selection;
        },
        addToSelection: ids => {
            const next = new Set(selection);
            ids.forEach(id => next.add(id));
            selection = next;
            ctx.selectedIds = selection;
        },
        clearSelection: () => {
            selection = new Set();
            ctx.selectedIds = selection;
        },
        dynamicDistance: null,
        onNotification: message => notifications.push(message),
        onRequestTextEntry: position => textRequests.push(position),
        onRequestAdvancedShape: (tool, position) => advancedRequests.push({ tool, point: position }),
    };

    const use = (tool: ToolType) => {
        ctx.activeTool = tool;
    };

    const moveTo = (x: number, y: number, raw: Point = { x, y }) => {
        ctx.point = { x, y };
        ctx.rawPoint = raw;
    };

    const down = () => {
        getTool(ctx.activeTool)?.onMouseDown?.(ctx);
    };

    /** 模拟 hook 的 mouseup 清理：工具未要求保留时清空拖拽态 */
    const up = () => {
        const result = getTool(ctx.activeTool)?.onMouseUp?.(ctx);
        if (!(result && result.keepDragState)) {
            ctx.dragMode = null;
            ctx.drawStart = null;
            ctx.currentPoint = null;
        }
        return result;
    };

    const click = (x: number, y: number) => {
        moveTo(x, y);
        down();
        up();
    };

    return {
        ctx,
        notifications,
        added,
        commits,
        textRequests,
        advancedRequests,
        toolSwitches,
        use,
        moveTo,
        down,
        up,
        click,
        get elements() {
            return elements;
        },
        get selection() {
            return selection;
        },
    };
}

describe("绘制工具", () => {
    it("LINE 在有效拖拽后创建线段", () => {
        const h = createHarness();
        h.use(ToolType.LINE);
        h.moveTo(0, 0);
        h.down();
        h.moveTo(100, 50);
        h.up();

        expect(h.added).toHaveLength(1);
        expect(h.added[0]).toMatchObject({
            type: "LINE",
            layer: "0",
            color: "#ffffff",
            start: { x: 0, y: 0 },
            end: { x: 100, y: 50 },
        });
    });

    it("拖拽距离不足时忽略微小点击", () => {
        const h = createHarness();
        h.use(ToolType.LINE);
        h.moveTo(0, 0);
        h.down();
        h.moveTo(1, 0);
        h.up();

        expect(h.added).toHaveLength(0);
    });

    it("LINE 支持点击两次成线：第一次留住锚点", () => {
        const h = createHarness();
        h.use(ToolType.LINE);

        h.click(0, 0);
        expect(h.ctx.dragMode).toBe("DRAW");
        expect(h.ctx.drawStart).toEqual({ x: 0, y: 0 });
        expect(h.added).toHaveLength(0);

        h.click(100, 50);
        expect(h.added[0]).toMatchObject({
            type: "LINE",
            start: { x: 0, y: 0 },
            end: { x: 100, y: 50 },
        });
        expect(h.ctx.dragMode).toBeNull();
        expect(h.ctx.drawStart).toBeNull();
    });

    it("RECTANGLE 点击两次成矩形", () => {
        const h = createHarness();
        h.use(ToolType.RECTANGLE);

        h.click(10, 10);
        h.click(60, 40);

        expect(h.added).toHaveLength(1);
        expect(h.added[0]).toMatchObject({
            type: "RECTANGLE",
            start: { x: 10, y: 10 },
            width: 50,
            height: 30,
        });
    });

    it("CIRCLE 点击两次成圆，第二次决定半径", () => {
        const h = createHarness();
        h.use(ToolType.CIRCLE);

        h.click(0, 0);
        h.click(30, 40);

        expect(h.added).toHaveLength(1);
        expect(h.added[0]).toMatchObject({ center: { x: 0, y: 0 }, radius: 50 });
    });

    it("RECTANGLE 记录对角点与负宽高", () => {
        const h = createHarness();
        h.use(ToolType.RECTANGLE);
        h.moveTo(100, 80);
        h.down();
        h.moveTo(20, 10);
        h.up();

        expect(h.added[0]).toMatchObject({
            type: "RECTANGLE",
            start: { x: 100, y: 80 },
            width: -80,
            height: -70,
        });
    });

    it("CIRCLE 以按下点为圆心、拖拽距离为半径", () => {
        const h = createHarness();
        h.use(ToolType.CIRCLE);
        h.moveTo(10, 10);
        h.down();
        h.moveTo(16, 18);
        h.up();

        expect(h.added[0]).toMatchObject({
            type: "CIRCLE",
            center: { x: 10, y: 10 },
            radius: 10,
        });
    });
});

describe("多步工具", () => {
    it("POLYLINE 逐点累加，Enter 完成后提交 LWPOLYLINE", () => {
        const h = createHarness();
        h.use(ToolType.POLYLINE);

        h.click(0, 0);
        h.click(50, 0);
        h.click(50, 40);

        expect(h.ctx.polyPoints).toHaveLength(3);
        expect(h.ctx.dragMode).toBe("POLYLINE_ADD");

        finishPolyline({
            polyPoints: h.ctx.polyPoints,
            currentLayer: h.ctx.currentLayer,
            currentLayerColor: h.ctx.currentLayerColor,
            addElement: h.ctx.addElement,
            setPolyPoints: h.ctx.setPolyPoints,
            setDragMode: h.ctx.setDragMode,
        });

        expect(h.added[0]).toMatchObject({
            type: "LWPOLYLINE",
            points: [
                { x: 0, y: 0 },
                { x: 50, y: 0 },
                { x: 50, y: 40 },
            ],
        });
        expect(h.ctx.polyPoints).toEqual([]);
        expect(h.ctx.dragMode).toBeNull();
    });

    it("ARC 用三点外接圆求解圆心与半径", () => {
        const h = createHarness();
        h.use(ToolType.ARC);

        h.click(0, 0);
        h.click(10, 10);
        h.click(20, 0);

        expect(h.added).toHaveLength(1);
        const arc = h.added[0];
        expect(arc.type).toBe("ARC");
        expect(arc.center!.x).toBeCloseTo(10, 6);
        expect(arc.center!.y).toBeCloseTo(0, 6);
        expect(arc.radius).toBeCloseTo(10, 6);
    });

    it("ARC 三点共线时提示且不创建图元", () => {
        const h = createHarness();
        h.use(ToolType.ARC);

        h.click(0, 0);
        h.click(10, 0);
        h.click(20, 0);

        expect(h.added).toHaveLength(0);
        expect(h.notifications).toContain("Points are collinear, cannot draw arc.");
    });

    it("DIMENSION 三点确定起止点与标注高度", () => {
        const h = createHarness();
        h.use(ToolType.DIMENSION);

        h.click(0, 0);
        h.click(100, 0);
        h.click(50, 20);

        expect(h.added[0]).toMatchObject({
            type: "DIMENSION",
            layer: "DIM",
            color: "#4ade80",
            start: { x: 0, y: 0 },
            end: { x: 100, y: 0 },
            offsetPoint: { x: 50, y: 20 },
        });
        expect(h.ctx.dimPoints).toEqual([]);
    });

    it("MEASURE 松开后通知距离", () => {
        const h = createHarness();
        h.use(ToolType.MEASURE);

        h.moveTo(0, 0);
        h.down();
        h.moveTo(3, 4);
        h.up();

        expect(h.notifications).toEqual(["Distance: 5.00 mm"]);
        expect(h.commits).toHaveLength(0);
    });
});

describe("选择与编辑工具", () => {
    it("SELECT 命中图元后拖拽移动所选对象", () => {
        const target = line(10, 10, 20, 20);
        const h = createHarness({ elements: [target], hit: target });
        h.use(ToolType.SELECT);

        h.moveTo(10, 10);
        h.down();
        expect(h.ctx.dragMode).toBe("MOVE_ITEMS");
        expect(h.ctx.drawStart).toEqual({ x: 10, y: 10 });

        h.moveTo(20, 15);
        h.up();

        expect(h.commits).toHaveLength(1);
        expect(h.elements[0].start).toEqual({ x: 20, y: 15 });
        expect(h.elements[0].end).toEqual({ x: 30, y: 25 });
    });

    it("SELECT 空白处拖拽进行窗口框选", () => {
        const target = line(10, 10, 20, 20);
        const h = createHarness({ elements: [target] });
        h.use(ToolType.SELECT);

        h.moveTo(0, 0);
        h.down();
        expect(h.ctx.dragMode).toBe("SELECT_BOX");

        h.moveTo(50, 50);
        h.up();

        expect([...h.selection]).toEqual(["el-1"]);
    });

    it("SELECT 采用点击循环解析出的重叠图元", () => {
        const top = line(10, 10, 20, 20, "el-1");
        const under = line(10, 10, 20, 20, "el-2");
        const h = createHarness({
            elements: [under, top],
            hit: top,
            resolveClickTarget: () => under,
        });
        h.use(ToolType.SELECT);

        h.moveTo(15, 15);
        h.down();
        expect([...h.selection]).toEqual(["el-2"]);
    });

    it("多选状态下点中成员保留整个选择集", () => {
        const top = line(10, 10, 20, 20, "el-1");
        const other = line(0, 0, 5, 5, "el-2");
        const h = createHarness({
            elements: [other, top],
            selectedIds: ["el-1", "el-2"],
            hit: top,
            resolveClickTarget: () => other,
        });
        h.use(ToolType.SELECT);

        h.moveTo(15, 15);
        h.down();
        expect([...h.selection]).toEqual(["el-1", "el-2"]);
    });

    it("点击（未拖拽）已选中对象时把选择集收窄到该对象", () => {
        const first = line(0, 0, 10, 0, "el-1");
        const second = line(0, 5, 10, 5, "el-2");
        const h = createHarness({
            elements: [first, second],
            selectedIds: ["el-1", "el-2"],
            hit: first,
        });
        h.use(ToolType.SELECT);

        h.click(5, 0);

        expect([...h.selection]).toEqual(["el-1"]);
        expect(h.commits).toHaveLength(0);
    });

    it("拖拽已选中的多个对象时仍整体移动", () => {
        const first = line(0, 0, 10, 0, "el-1");
        const second = line(0, 5, 10, 5, "el-2");
        const h = createHarness({
            elements: [first, second],
            selectedIds: ["el-1", "el-2"],
            hit: first,
        });
        h.use(ToolType.SELECT);

        h.moveTo(5, 0);
        h.down();
        h.moveTo(15, 0);
        h.up();

        expect(h.elements[0].start).toEqual({ x: 10, y: 0 });
        expect(h.elements[1].start).toEqual({ x: 10, y: 5 });
        expect(h.selection.size).toBe(2);
    });

    it("组合中的图元按整组选中", () => {
        const grouped = { ...line(0, 0, 10, 0, "el-1"), groupId: "grp-1" };
        const mate = { ...line(0, 5, 10, 5, "el-2"), groupId: "grp-1" };
        const h = createHarness({ elements: [grouped, mate], hit: grouped });
        h.use(ToolType.SELECT);

        h.click(5, 0);

        expect([...h.selection]).toEqual(["el-1", "el-2"]);
    });

    it("框选组合成员时整组进入选择集", () => {
        const grouped = { ...line(0, 0, 10, 0, "el-1"), groupId: "grp-1" };
        const mate = { ...line(0, 5, 10, 5, "el-2"), groupId: "grp-1" };
        const h = createHarness({ elements: [grouped, mate] });
        h.use(ToolType.SELECT);

        h.moveTo(-5, -5);
        h.down();
        h.moveTo(20, 2);
        h.up();

        expect([...h.selection]).toEqual(["el-1", "el-2"]);
    });

    it("COPY 拖拽完成后回到选择工具，副本可逐个单独选中", () => {
        const target = line(0, 0, 10, 0);
        const h = createHarness({ elements: [target], selectedIds: ["el-1"], hit: target });
        h.use(ToolType.COPY);

        h.moveTo(0, 0);
        h.down();
        h.moveTo(10, 5);
        h.up();

        expect(h.toolSwitches).toEqual([ToolType.SELECT]);
    });

    it("SELECT 夹点拖拽写回图元并只提交一次历史", () => {
        const target = line(0, 0, 10, 0);
        const grip: GripPoint = { elementId: "el-1", key: "end", point: { x: 10, y: 0 } };
        const h = createHarness({
            elements: [target],
            selectedIds: ["el-1"],
            dragMode: "GRIP_EDIT",
            activeGrip: grip,
        });
        h.use(ToolType.SELECT);

        h.moveTo(20, 5);
        h.up();

        expect(h.commits).toHaveLength(1);
        expect(h.elements[0].end).toEqual({ x: 20, y: 5 });
        expect(h.ctx.activeGrip).toBeNull();
    });

    it("COPY 拖拽生成偏移副本并选中副本", () => {
        const target = line(0, 0, 10, 0);
        const h = createHarness({ elements: [target], selectedIds: ["el-1"], hit: target });
        h.use(ToolType.COPY);

        h.moveTo(0, 0);
        h.down();
        expect(h.ctx.dragMode).toBe("COPY_ITEMS");

        h.moveTo(10, 5);
        h.up();

        expect(h.elements).toHaveLength(2);
        const copy = h.elements[1];
        expect(copy.id).not.toBe("el-1");
        expect(copy.start).toEqual({ x: 10, y: 5 });
        expect([...h.selection]).toEqual([copy.id]);
    });

    it("MIRROR 沿竖直线镜像，矩形转为多段线", () => {
        const targetLine = line(10, 0, 20, 0, "line");
        const targetRect = element({
            id: "rect",
            type: "RECTANGLE",
            start: { x: 10, y: 10 },
            width: 10,
            height: 20,
        });
        const h = createHarness({
            elements: [targetLine, targetRect],
            selectedIds: ["line", "rect"],
        });
        h.use(ToolType.MIRROR);

        h.moveTo(0, 0);
        h.down();
        h.moveTo(0, 100);
        h.up();

        expect(h.elements).toHaveLength(4);
        const mirroredLine = h.elements[2];
        expect(mirroredLine.start).toEqual({ x: -10, y: 0 });
        expect(mirroredLine.end).toEqual({ x: -20, y: 0 });

        const mirroredRect = h.elements[3];
        expect(mirroredRect.type).toBe("LWPOLYLINE");
        expect(mirroredRect.points).toHaveLength(5);
        expect(mirroredRect.start).toBeUndefined();
        expect(mirroredRect.width).toBeUndefined();
        expect(h.selection.size).toBe(2);
        expect(h.notifications).toContain("Mirrored 2 objects.");
    });

    it("ROTATE 按拖拽角度旋转选中对象", () => {
        const target = line(10, 0, 20, 0);
        const h = createHarness({ elements: [target], selectedIds: ["el-1"] });
        h.use(ToolType.ROTATE);

        h.moveTo(0, 0);
        h.down();
        h.moveTo(0, 10);
        h.up();

        expect(h.commits).toHaveLength(1);
        expect(h.elements[0].start!.x).toBeCloseTo(0, 6);
        expect(h.elements[0].start!.y).toBeCloseTo(10, 6);
        expect(h.elements[0].end!.x).toBeCloseTo(0, 6);
        expect(h.elements[0].end!.y).toBeCloseTo(20, 6);
        expect(h.notifications).toContain("Rotated 1 objects by 90.0°.");
    });

    it("SCALE 首次点击设基点并保留状态，第二次点击应用倍率", () => {
        const target = line(10, 0, 20, 0);
        const h = createHarness({ elements: [target], selectedIds: ["el-1"] });
        h.use(ToolType.SCALE);

        h.moveTo(0, 0);
        h.down();
        h.moveTo(0, 0);
        expect(h.up()).toEqual({ keepDragState: true });
        expect(h.ctx.dragMode).toBe("SCALE_ITEMS");

        // 参考距离为基点至包围盒/形心的最大值：形心 15 -> 光标距离 30 => ×2
        h.moveTo(0, 30);
        h.down();
        h.up();

        expect(h.commits).toHaveLength(1);
        expect(h.elements[0].start).toEqual({ x: 20, y: 0 });
        expect(h.elements[0].end).toEqual({ x: 40, y: 0 });
        expect(h.notifications.some(message => message.startsWith("Scaled selection ×2.00"))).toBe(true);
    });

    it("OFFSET 以点击距离生成偏移副本", () => {
        const target = line(10, 0, 20, 0);
        const h = createHarness({ elements: [target], selectedIds: ["el-1"] });
        h.use(ToolType.OFFSET);

        h.click(15, 10);

        expect(h.commits).toHaveLength(1);
        expect(h.commits[0].length).toBeGreaterThan(1);
        expect(h.notifications).toContain("Offset by 10.00");
    });

    it("TRIM 无剪切边界时不提交并提示", () => {
        const target = line(0, 0, 10, 0);
        const h = createHarness({ elements: [target], hit: target });
        h.use(ToolType.TRIM);

        h.moveTo(5, 0);
        h.down();

        expect(h.commits).toHaveLength(0);
        expect(h.notifications.join(" ")).toContain("No cutting edges");
    });

    it("TRIM 剪掉交点一侧的线段并提交历史", () => {
        const target = line(0, 0, 100, 0);
        const cutter = line(50, -20, 50, 20, "cutter");
        const h = createHarness({ elements: [target, cutter], hit: target });
        h.use(ToolType.TRIM);

        // 点击右侧（x>50），保留左半
        h.moveTo(80, 0);
        h.down();

        expect(h.commits).toHaveLength(1);
        const committed = h.commits[0];
        expect(committed).toHaveLength(2);
        const trimmed = committed.find((element) => element.id === target.id)!;
        expect(trimmed.start!.x).toBe(0);
        expect(trimmed.end!.x).toBeCloseTo(50, 6);
    });
});

describe("占位与弹窗工具", () => {
    it("TEXT 请求文字输入并传递点击位置", () => {
        const h = createHarness();
        h.use(ToolType.TEXT);
        h.click(12, 34);

        expect(h.textRequests).toEqual([{ x: 12, y: 34 }]);
    });

    it("高级图形把工具与位置交给参数弹窗", () => {
        const h = createHarness();
        h.use(ToolType.GEAR);
        h.click(5, 6);

        expect(h.advancedRequests).toEqual([{ tool: ToolType.GEAR, point: { x: 5, y: 6 } }]);
    });

    it("HATCH 给出待后端实现的提示", () => {
        const h = createHarness();
        h.use(ToolType.HATCH);
        h.click(0, 0);

        expect(h.notifications[0]).toContain("requires backend implementation");
    });

    it("注册表覆盖所有交互工具", () => {
        const registered = [
            ToolType.SELECT,
            ToolType.LINE,
            ToolType.CIRCLE,
            ToolType.RECTANGLE,
            ToolType.TEXT,
            ToolType.POLYLINE,
            ToolType.ARC,
            ToolType.HATCH,
            ToolType.COPY,
            ToolType.TRIM,
            ToolType.MIRROR,
            ToolType.ROTATE,
            ToolType.SCALE,
            ToolType.OFFSET,
            ToolType.DIMENSION,
            ToolType.MEASURE,
            ToolType.GEAR,
            ToolType.INVOLUTE,
            ToolType.SPIRAL,
            ToolType.SPRING,
            ToolType.POLYGON,
            ToolType.ELLIPSE,
        ];
        registered.forEach(tool => expect(getTool(tool)).toBeDefined());
        expect(getTool(ToolType.PAN)).toBeUndefined();
        expect(getTool(ToolType.ARRAY)).toBeUndefined();
    });
});
