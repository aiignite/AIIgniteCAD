/**
 * useCanvasInteraction.ts — 画布交互状态机
 *
 * 集中管理坐标换算、捕捉约束、命中测试、平移缩放与鼠标事件分发。
 * 各工具的行为位于 tools/ 下的独立状态机，本 hook 只负责构造 ToolContext 并转发事件。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ArrayParams } from '../components/ArrayModal';
import { CADElement, DEFAULT_SNAP_TYPES, DragMode, Point, SnapType, ToolType } from '../types';
import { useCanvas } from '../store/canvasStore';
import { updateCanvasStatus } from '../store/canvasStatus';
import {
    getViewBox,
    setViewBox,
    setViewportAspect,
    subscribeViewBox,
} from '../store/viewport';
import * as Transform from '../lib/transform';
import { getElementBoundingBox } from '../lib/geometry';
import { dist, getScaleFactor } from '../lib/canvasGeometry';
import { applyGripDrag, getGripPoints, GripPoint } from '../lib/grip';
import { collectSnapCandidates } from '../lib/snapping';
import { SpatialGrid } from '../lib/spatialIndex';
import { getSelectionMode } from '../lib/selection';
import { displayableElements } from '../lib/isolation';
import {
    EMPTY_CLICK_CYCLE_STATE,
    resolveClickCycle,
    type ClickCycleState,
} from '../lib/clickCycle';
import { collaborationClient } from '../services/collaborationService';
import { bufferedViewportBounds, svgRenderer } from '../renderer/svgRenderer';
import { FrameCoalescer } from '../lib/frameCoalescer';
import { DEFAULT_POLAR_STEP_DEG, constrainToPolar } from '../lib/polar';
import {
    buildDynamicDraft,
    parseDynamicValue,
    resolveDynamicAnchor,
    resolveDynamicPoint,
    type DynamicDraft,
    type DynamicFieldKey,
    type DynamicValues,
} from '../lib/dynamicInput';
import {
    fitViewBox,
    unionBounds,
    zoomPercent,
    zoomViewBoxAt,
    ZOOM_STEP,
} from '../lib/viewport';
import { isEditableTarget } from '../lib/keyboard';
import { getTool } from '../tools';
import type { ToolContext } from '../tools/BaseTool';
import { finishPolyline } from '../tools/PolylineTool';

/** 命中测试与夹点拾取的屏幕像素孔径，缩放后手感保持一致 */
const HIT_APERTURE_PX = 6;
const GRIP_APERTURE_PX = 8;

/** 右键按下到松开的最大位移：超过则算拖拽平移，不弹上下文菜单 */
const RIGHT_CLICK_TOLERANCE_PX = 4;

/** 未启用隔离时的隐藏集常量，保持 useMemo 依赖稳定 */
const NO_HIDDEN: ReadonlySet<string> = new Set();

/** 允许预选高亮的工具：绘制类工具悬停高亮反而干扰取点 */
const HOVER_TOOLS = new Set<ToolType>([ToolType.SELECT, ToolType.COPY, ToolType.TRIM]);

/** 动态输入编辑态：当前字段下标与各字段原始文本 */
interface DynamicEditState {
    activeIndex: number;
    values: string[];
}

/** 交互 hook 需要的外部回调 */
export interface CanvasInteractionOptions {
    /** 请求输入文字 */
    onRequestTextEntry: (pos: Point) => void;
    /** 请求高级图形参数弹窗 */
    onRequestAdvancedShape?: (tool: ToolType, pos: Point) => void;
    /** 请求打开填充对话框（HATCH 工具） */
    onRequestHatch?: () => void;
    /** 状态栏通知 */
    onNotification: (msg: string) => void;
    /** 块拖放 */
    onBlockDrop?: (blockId: string, position: Point) => void;
    /** 隔离 / 隐藏对象的临时隐藏集；既不渲染也不参与捕捉与框选 */
    hiddenObjectIds?: ReadonlySet<string>;
    /** 右键点击画布（未拖拽）时请求弹出上下文菜单 */
    onRequestContextMenu?: (payload: { client: Point; world: Point }) => void;
}

/**
 * 画布交互 hook。
 * 返回事件处理器、交互态与渲染所需的派生数据（视口裁剪结果、预览位移等）。
 */
export function useCanvasInteraction({
    onRequestTextEntry,
    onRequestAdvancedShape,
    onRequestHatch,
    onNotification,
    onBlockDrop,
    hiddenObjectIds = NO_HIDDEN,
    onRequestContextMenu,
}: CanvasInteractionOptions) {
    /** OFFSET 动态输入键入的距离；null 表示未键入。切工具时清除 */
    const [dynamicDistance, setDynamicDistance] = useState<number | null>(null);
    const {
        state,
        addElement,
        commitAction,
        setActiveTool: dispatchActiveTool,
        selectedIds,
        setSelection,
        addToSelection,
        clearSelection,
    } = useCanvas();

    /** 切换工具：同时清掉动态输入暂存的偏移距离，避免带进下一个工具 */
    const setActiveTool = useCallback(
        (tool: ToolType) => {
            setDynamicDistance(null);
            dispatchActiveTool(tool);
        },
        [dispatchActiveTool],
    );
    const {
        elements,
        activeTool,
        drawingSettings,
        orthoMode,
        polarMode,
        snapMode,
        gridMode,
        hiddenLayers,
        lockedLayers,
        currentLayer,
        layerColors,
    } = state;

    /** 当前绘图层的新图元默认颜色 */
    const currentLayerColor = layerColors[currentLayer] ?? '#e6edf3';

    const svgRef = useRef<SVGSVGElement>(null);
    const viewBox = useSyncExternalStore(subscribeViewBox, getViewBox, getViewBox);

    /** 画布像素尺寸：用于把屏幕像素孔径换算为世界单位，并绘制固定像素大小的标记 */
    const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });

    // 视口比例同步给视口 store：命令行与 AI 的缩放到范围按画布比例取景
    useEffect(() => {
        if (viewportSize.height > 0) {
            setViewportAspect(viewportSize.width / viewportSize.height);
        }
    }, [viewportSize]);

    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const update = () => {
            const width = svg.clientWidth || svg.getBoundingClientRect().width;
            const height = svg.clientHeight || svg.getBoundingClientRect().height;
            setViewportSize(prev =>
                prev.width === width && prev.height === height ? prev : { width, height },
            );
        };
        update();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', update);
            return () => window.removeEventListener('resize', update);
        }
        const observer = new ResizeObserver(update);
        observer.observe(svg);
        return () => observer.disconnect();
    }, []);

    /** 当前渲染比例（屏幕像素 / 世界单位）；preserveAspectRatio=meet 时取两轴较小值 */
    const pixelsPerUnit = Math.min(
        viewBox.w > 0 ? viewportSize.width / viewBox.w : 1,
        viewBox.h > 0 ? viewportSize.height / viewBox.h : 1,
    ) || 1;

    /** 事件处理中直接读取 CTM，确保与当前 viewBox 完全一致 */
    const getPixelsPerUnit = (): number => {
        const ctm = svgRef.current?.getScreenCTM();
        const scale = ctm ? Math.abs(ctm.a) : 0;
        return scale > 1e-6 ? scale : pixelsPerUnit;
    };

    /** 将屏幕像素孔径换算为世界单位容差 */
    const worldTolerance = (pixels: number): number => pixels / getPixelsPerUnit();

    /** 可见元素：隐藏图层与被临时隐藏的图元既不渲染，也不参与捕捉和框选 */
    const visibleSource = useMemo(
        () => displayableElements(elements, hiddenLayers, hiddenObjectIds),
        [elements, hiddenLayers, hiddenObjectIds],
    );

    // 空间索引：可见元素集合变化时重建，命中测试/框选/视口裁剪共用
    const spatialIndex = useMemo(() => new SpatialGrid(visibleSource), [visibleSource]);

    // 交互状态
    const [dragMode, setDragMode] = useState<DragMode | null>(null);
    const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
    const [drawStart, setDrawStart] = useState<Point | null>(null);
    const [snapIndicator, setSnapIndicator] = useState<Point | null>(null);
    /** 当前捕捉类型，供状态栏显示 OSNAP 提示 */
    const [snapType, setSnapType] = useState<SnapType | null>(null);
    /** 光标下的候选图元，用于预选高亮 */
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    /** 极轴命中时的引导线信息 */
    const [polarGuide, setPolarGuide] = useState<{
        anchor: Point;
        point: Point;
        angle: number;
    } | null>(null);
    /** 动态输入的键盘编辑态；null 表示未在键入 */
    const [dynamicEdit, setDynamicEdit] = useState<DynamicEditState | null>(null);

    // 多步工具状态
    const [polyPoints, setPolyPoints] = useState<Point[]>([]);
    const [arcPoints, setArcPoints] = useState<Point[]>([]); // 圆弧三点
    const [dimPoints, setDimPoints] = useState<Point[]>([]); // 标注：起点、终点
    /** 正在拖拽的夹点；null 表示未处于夹点编辑 */
    const [activeGrip, setActiveGrip] = useState<GripPoint | null>(null);

    /**
     * 选中图元的夹点集合。
     * 仅在 SELECT 工具下生成；隐藏与锁定图层不提供夹点。
     */
    const grips = useMemo(() => {
        if (activeTool !== ToolType.SELECT) return [];
        return visibleSource
            .filter(el => selectedIds.has(el.id) && !lockedLayers.includes(el.layer || "0"))
            .flatMap(el => getGripPoints(el));
    }, [activeTool, visibleSource, selectedIds, lockedLayers]);

    /**
     * 夹点拖拽中的幽灵图元：实时应用拖拽结果，供预览层绘制变形效果。
     * 未处于夹点拖拽或图元已不存在时返回 null。
     */
    const gripPreview = useMemo(() => {
        if (dragMode !== 'GRIP_EDIT' || !activeGrip || !currentPoint) return null;
        const target = elements.find(el => el.id === activeGrip.elementId);
        if (!target) return null;
        return applyGripDrag(target, activeGrip, currentPoint);
    }, [dragMode, activeGrip, currentPoint, elements]);

    /**
     * 将鼠标事件坐标换算为 SVG 用户坐标。
     */
    const getSVGPoint = (e: React.MouseEvent | React.DragEvent): Point => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const CTM = svgRef.current.getScreenCTM();
        if (!CTM) return { x: 0, y: 0 };
        return {
            x: (e.clientX - CTM.e) / CTM.a,
            y: (e.clientY - CTM.f) / CTM.d
        };
    };

    /**
     * 应用网格与捕捉约束，并更新捕捉指示点。
     */
    const applyConstraints = (pt: Point, anchor?: Point): Point => {
        let constrained = { ...pt };

        if (gridMode) {
            const spacing = drawingSettings.gridSpacing;
            constrained.x = Math.round(constrained.x / spacing) * spacing;
            constrained.y = Math.round(constrained.y / spacing) * spacing;
        }

        if (snapMode) {
            // 仅检查光标附近图元，避免全图遍历；
            // 捕捉类型可通过绘图设置逐项开关（端点/中点/圆心/象限/交点/垂足/切点/最近点）
            const enabledTypes = drawingSettings.enabledSnapTypes ?? DEFAULT_SNAP_TYPES;
            // 捕捉孔径以屏幕像素配置，换算为世界单位后与缩放无关
            const aperture = worldTolerance(drawingSettings.snapDistance);
            const nearby = spatialIndex.queryPoint(pt, aperture);
            const candidates = collectSnapCandidates(nearby, pt, anchor, enabledTypes);
            let closestDist = aperture;
            let closestPt: Point | null = null;
            let closestType: SnapType | null = null;
            candidates.forEach(candidate => {
                const d = dist(pt, candidate.point);
                // 取 <= 使后加入的高优先级类型（交点等）在等距时优先
                if (d <= closestDist) {
                    closestDist = d;
                    closestPt = candidate.point;
                    closestType = candidate.type;
                }
            });
            if (closestPt) {
                constrained = closestPt;
                setSnapIndicator(closestPt);
                setSnapType(closestType);
            } else {
                setSnapIndicator(null);
                setSnapType(null);
            }
        } else {
            setSnapIndicator(null);
            setSnapType(null);
        }

        if (orthoMode && anchor) {
            const dx = Math.abs(constrained.x - anchor.x);
            const dy = Math.abs(constrained.y - anchor.y);
            if (dx > dy) constrained.y = anchor.y; else constrained.x = anchor.x;
            setPolarGuide(null);
        } else if (polarMode && anchor) {
            // 极轴只在接近增量角度时吸附，其余方向保持自由
            const polar = constrainToPolar(anchor, constrained, DEFAULT_POLAR_STEP_DEG);
            if (polar.snapped && polar.angle !== null) {
                constrained = polar.point;
                setPolarGuide({ anchor, point: polar.point, angle: polar.angle });
            } else {
                setPolarGuide(null);
            }
        } else {
            setPolarGuide(null);
        }

        return constrained;
    };

    /**
     * 命中测试：先从空间索引取光标附近候选，再按绘制顺序从后往前做精确几何判断，
     * 保持"后绘制元素优先选中"的既有语义；锁定图层的元素不可选中。
     */
    const findHitElements = (pt: Point): CADElement[] => {
        // 命中孔径固定为屏幕像素，放大后仍能精确点到细线
        const tolerance = worldTolerance(HIT_APERTURE_PX);
        const candidates = new Set(spatialIndex.queryPoint(pt, tolerance).map(el => el.id));
        const ordered = visibleSource.filter(
            el => candidates.has(el.id) && !lockedLayers.includes(el.layer || "0"),
        );
        return svgRenderer.hitTestAll(pt, ordered, tolerance);
    };

    const findHitElement = (pt: Point): CADElement | undefined => findHitElements(pt)[0];

    /**
     * 重叠图元的点击循环：同一位置短时间重复点击时按命中顺序切换。
     * 状态是瞬时的，不进 store，也不影响撤销。
     */
    const clickCycleRef = useRef<ClickCycleState>(EMPTY_CLICK_CYCLE_STATE);

    /** 按下时命中的图元；跨按下 / 松开保留，用于点击后收窄选择集 */
    const pressTargetRef = useRef<CADElement | undefined>(undefined);

    // 拖拽预览与平移合并到每帧一次，避免高频 mousemove 重复渲染整棵画布
    const pointCoalescerRef = useRef<FrameCoalescer<Point> | null>(null);
    const panAccumRef = useRef({ dx: 0, dy: 0 });
    /** 平移增量基准用 ref 同步维护，避免等待 setState 造成重复位移 */
    const panLastClientRef = useRef<Point | null>(null);
    /** 右键按下的位置：未拖拽的松开视为右键点击，用于弹出上下文菜单 */
    const rightPressRef = useRef<Point | null>(null);
    const panCoalescerRef = useRef<FrameCoalescer<{ dx: number; dy: number }> | null>(null);

    useEffect(() => {
        pointCoalescerRef.current = new FrameCoalescer<Point>((point) =>
            setCurrentPoint(point),
        );
        panCoalescerRef.current = new FrameCoalescer<{ dx: number; dy: number }>((delta) => {
            setViewBox(prev => ({ ...prev, x: prev.x - delta.dx, y: prev.y - delta.dy }));
            panAccumRef.current = { dx: 0, dy: 0 };
        });
        return () => {
            pointCoalescerRef.current?.cancel();
            panCoalescerRef.current?.cancel();
            pointCoalescerRef.current = null;
            panCoalescerRef.current = null;
        };
    }, []);

    const schedulePoint = (point: Point) => {
        pointCoalescerRef.current?.schedule(point);
    };

    const resolveClickTarget = (pt: Point): CADElement | undefined => {
        const hits = findHitElements(pt);
        const result = resolveClickCycle(
            hits,
            pt,
            clickCycleRef.current,
            performance.now(),
            worldTolerance(HIT_APERTURE_PX),
        );
        clickCycleRef.current = result.state;
        return result.target ?? undefined;
    };

    /** 将当前渲染闭包中的交互态与动作打包给工具状态机 */
    const buildToolContext = (
        rawPoint: Point,
        point: Point,
        input: { client?: Point; button?: number; shiftKey?: boolean } = {},
    ): ToolContext => ({
        rawPoint,
        point,
        client: input.client ?? { x: 0, y: 0 },
        button: input.button ?? 0,
        shiftKey: input.shiftKey ?? false,
        activeTool,
        dragMode,
        drawStart,
        currentPoint,
        polyPoints,
        arcPoints,
        dimPoints,
        activeGrip,
        elements,
        selectedIds,
        drawingSettings,
        orthoMode,
        currentLayer,
        currentLayerColor,
        lockedLayers,
        grips,
        findHitElement,
        resolveClickTarget,
        pressTargetRef,
        worldTolerance,
        queryRect: (minX, minY, maxX, maxY) =>
            spatialIndex.queryRect(minX, minY, maxX, maxY),
        setDragMode,
        setDrawStart,
        setCurrentPoint,
        setPolyPoints,
        setArcPoints,
        setDimPoints,
        setActiveGrip,
        setActiveTool,
        addElement,
        commitAction,
        setSelection,
        addToSelection,
        clearSelection,
        dynamicDistance,
        onNotification,
        onRequestTextEntry,
        onRequestAdvancedShape,
        onRequestHatch,
    });

    // 动态输入：已有第一点时推导可键入的字段与实时数值
    const dynamicAnchor = resolveDynamicAnchor({
        tool: activeTool,
        dragMode,
        drawStart,
        polyPoints,
        dimPoints,
    });
    const dynamicDraft = buildDynamicDraft(activeTool, dynamicAnchor, currentPoint);

    // Space 重复命令需要知道动态输入是否激活；走 canvasStatus 外部 store 避免整树重渲
    const dynamicActive = dynamicDraft !== null;
    useEffect(() => {
        updateCanvasStatus({ dynamicInput: dynamicActive });
    }, [dynamicActive]);

    // 键盘回调通过 ref 读取最新草稿，避免每次移动光标都重绑监听
    const interactionRef = useRef<{
        draft: DynamicDraft | null;
        edit: DynamicEditState | null;
        commit: () => void;
    }>({ draft: null, edit: null, commit: () => {} });

    /** 把键入值合成坐标，并按一次点击提交给当前工具 */
    const commitDynamicInput = () => {
        const { draft, edit } = interactionRef.current;
        if (!draft) return;
        const values: DynamicValues = {};
        if (edit) {
            draft.fields.forEach((key: DynamicFieldKey, index) => {
                const parsed = parseDynamicValue(edit.values[index] ?? '');
                if (parsed !== null) values[key] = parsed;
            });
        }

        // 距离模式不合成点击：暂存键入值，等待下一次真实点击（OFFSET 按该距离偏移）
        if (draft.mode === 'distance') {
            if (typeof values.length === 'number') {
                setDynamicDistance(values.length);
            }
            setDynamicEdit(null);
            setPolarGuide(null);
            return;
        }

        const point = resolveDynamicPoint(draft, values);
        const ctm = svgRef.current?.getScreenCTM();
        const client = ctm
            ? { x: point.x * ctm.a + ctm.e, y: point.y * ctm.d + ctm.f }
            : { x: 0, y: 0 };
        const tool = getTool(activeTool);
        const ctx = buildToolContext(point, point, { client, button: 0, shiftKey: false });
        if (tool?.onDynamicSubmit) {
            // 工具自治：以键入值（角度 / 倍率）完成并提交
            tool.onDynamicSubmit(ctx, values);
        } else {
            tool?.onMouseDown?.(ctx);
        }
        setDynamicEdit(null);
        setPolarGuide(null);
    };

    // 每次渲染后同步最新草稿与提交函数；ref 不在渲染期写入
    useEffect(() => {
        interactionRef.current = {
            draft: dynamicDraft,
            edit: dynamicEdit,
            commit: commitDynamicInput,
        };
    });

    /**
     * 动态输入键盘处理：数字开始键入，Tab 切换字段，Enter 提交。
     * 输入控件获得焦点时不拦截，避免影响命令栏与聊天框。
     */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isEditableTarget(e.target)) return;
            const { draft, edit, commit } = interactionRef.current;
            if (!draft) {
                if (edit) setDynamicEdit(null);
                return;
            }

            if (e.key === 'Escape') {
                if (edit) {
                    e.preventDefault();
                    setDynamicEdit(null);
                }
                return;
            }
            if (e.key === 'Enter') {
                if (!edit) return;
                e.preventDefault();
                commit();
                return;
            }
            if (e.key === 'Tab' && draft.fields.length > 1) {
                e.preventDefault();
                setDynamicEdit(prev => {
                    const base = prev ?? { activeIndex: 0, values: draft.fields.map(() => '') };
                    return { ...base, activeIndex: (base.activeIndex + 1) % draft.fields.length };
                });
                return;
            }
            if (e.key === 'Backspace') {
                if (!edit) return;
                e.preventDefault();
                setDynamicEdit(prev => {
                    if (!prev) return prev;
                    const values = [...prev.values];
                    values[prev.activeIndex] = (values[prev.activeIndex] ?? '').slice(0, -1);
                    return values.every(value => value === '') ? null : { ...prev, values };
                });
                return;
            }
            if (/^[0-9.-]$/.test(e.key)) {
                e.preventDefault();
                setDynamicEdit(prev => {
                    const base = prev ?? { activeIndex: 0, values: draft.fields.map(() => '') };
                    const values = [...base.values];
                    const current = values[base.activeIndex] ?? '';
                    // 只允许开头一个负号与一个小数点
                    if (e.key === '-' && current.length > 0) return base;
                    if (e.key === '.' && current.includes('.')) return base;
                    values[base.activeIndex] = current + e.key;
                    return { ...base, values };
                });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // 多段线快捷键：Enter 完成，Escape 取消（输入控件内不拦截）
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isEditableTarget(e.target)) return;
            // 正在键入数值时 Enter 属于动态输入，不能顺手结束多段线
            if (interactionRef.current.edit) return;
            if (e.key === 'Enter' && activeTool === ToolType.POLYLINE && polyPoints.length > 1) {
                finishPolyline({
                    polyPoints,
                    currentLayer,
                    currentLayerColor,
                    addElement,
                    setPolyPoints,
                    setDragMode,
                });
            }
            if (e.key === 'Escape') {
                setPolyPoints([]);
                setArcPoints([]);
                setDimPoints([]);
                setDragMode(null);
                setDrawStart(null);
                // 取消未落帧的预览更新，避免 Esc 后又被补回一帧
                pointCoalescerRef.current?.cancel();
                panCoalescerRef.current?.cancel();
                setCurrentPoint(null);
                setPolarGuide(null);
                setDynamicEdit(null);
                // 取消进行中的夹点拖拽，不写回任何修改
                setActiveGrip(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTool, polyPoints, addElement, currentLayer, currentLayerColor]);

    // 切换工具时清理未完成的绘制状态（渲染阶段按前值调整，避免 effect 二次渲染）
    const [prevTool, setPrevTool] = useState(activeTool);
    if (prevTool !== activeTool) {
        setPrevTool(activeTool);
        setPolyPoints([]);
        setArcPoints([]);
        setDimPoints([]);
        setDragMode(null);
        setDrawStart(null);
        setCurrentPoint(null);
        setHoveredId(null);
        setPolarGuide(null);
        setDynamicEdit(null);
        // 切换工具时放弃未完成的夹点拖拽
        setActiveGrip(null);
    }

    /** 鼠标离开画布：清理悬停捕捉与动态输入，拖拽过程中保留状态 */
    const handleMouseLeave = () => {
        if (dragMode) return;
        setSnapIndicator(null);
        setSnapType(null);
        setCurrentPoint(null);
        setHoveredId(null);
        setPolarGuide(null);
    };

    /** 块拖放：读取 blockId 并交给上层插入 */
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const blockId = e.dataTransfer.getData('blockId');
        if (blockId && onBlockDrop) {
            onBlockDrop(blockId, getSVGPoint(e));
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // 允许放置
    };

    /**
     * 鼠标按下：按当前工具进入对应的交互模式或立即执行动作。
     */
    const handleMouseDown = (e: React.MouseEvent) => {
        const rawPt = getSVGPoint(e);
        // 点击表示用户改为鼠标操作，放弃尚未提交的键盘数值
        setDynamicEdit(null);

        // 右键不进绘制流程：轻点弹上下文菜单，拖拽仍是平移
        if (e.button === 2) {
            rightPressRef.current = { x: e.clientX, y: e.clientY };
            if (activeTool === ToolType.SELECT || activeTool === ToolType.PAN) {
                setDragMode('PAN');
                panLastClientRef.current = { x: e.clientX, y: e.clientY };
                panAccumRef.current = { dx: 0, dy: 0 };
            }
            return;
        }

        // 平移：PAN 工具左键、任意工具中键
        if (activeTool === ToolType.PAN || e.button === 1) {
            setDragMode('PAN');
            panLastClientRef.current = { x: e.clientX, y: e.clientY };
            panAccumRef.current = { dx: 0, dy: 0 };
            return;
        }

        // 夹点编辑优先于普通选择：命中最上层夹点后直接进入拖拽
        if (activeTool === ToolType.SELECT && e.button === 0 && grips.length > 0) {
            const gripTolerance = worldTolerance(GRIP_APERTURE_PX);
            const hitGrip = grips.find(grip => dist(rawPt, grip.point) <= gripTolerance);
            if (hitGrip) {
                setActiveGrip(hitGrip);
                setDragMode('GRIP_EDIT');
                setDrawStart(hitGrip.point);
                setCurrentPoint(hitGrip.point);
                return;
            }
        }

        let anchor = drawStart || undefined;
        if (activeTool === ToolType.POLYLINE && polyPoints.length > 0) anchor = polyPoints[polyPoints.length - 1];
        if (activeTool === ToolType.DIMENSION && dimPoints.length === 1) anchor = dimPoints[0];

        const pt = applyConstraints(rawPt, anchor);

        const tool = getTool(activeTool);
        tool?.onMouseDown?.(buildToolContext(rawPt, pt, {
            client: { x: e.clientX, y: e.clientY },
            button: e.button,
            shiftKey: e.shiftKey,
        }));
    };

    /**
     * 鼠标移动：更新光标、平移视图或刷新预览。
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        const rawPt = getSVGPoint(e);
        let anchor = drawStart || undefined;
        if (activeTool === ToolType.POLYLINE && polyPoints.length > 0) anchor = polyPoints[polyPoints.length-1];
        if (activeTool === ToolType.DIMENSION && dimPoints.length === 1) anchor = dimPoints[0];

        const pt = applyConstraints(rawPt, anchor);

        // 协作光标：客户端内部节流，未连接时静默忽略
        collaborationClient.sendCursor(pt.x, pt.y);

        // 预选高亮：只在未拖拽且工具支持选择时做命中测试
        if (!dragMode && HOVER_TOOLS.has(activeTool)) {
            const hit = findHitElement(rawPt);
            const nextId = hit?.id ?? null;
            setHoveredId(prev => (prev === nextId ? prev : nextId));
        } else if (hoveredId !== null) {
            setHoveredId(null);
        }

        // 缩放交互：实时更新光标位置，用于渲染倍率预览
        if (dragMode === 'SCALE_ITEMS') {
            schedulePoint(pt);
            return;
        }

        // 夹点拖拽：实时记录目标点，供预览层绘制变形后的幽灵图形
        if (dragMode === 'GRIP_EDIT' && activeGrip) {
            schedulePoint(pt);
            return;
        }

        if (dragMode === 'PAN' && panLastClientRef.current) {
            const last = panLastClientRef.current;
            const worldPerPixel = 1 / getPixelsPerUnit();
            panAccumRef.current = {
                dx: panAccumRef.current.dx + (e.clientX - last.x) * worldPerPixel,
                dy: panAccumRef.current.dy + (e.clientY - last.y) * worldPerPixel,
            };
            panLastClientRef.current = { x: e.clientX, y: e.clientY };
            panCoalescerRef.current?.schedule({ ...panAccumRef.current });
            return;
        }

        schedulePoint(pt);
    };

    // 切换工具时丢弃未落帧的拖拽更新
    useEffect(() => {
        pointCoalescerRef.current?.cancel();
        panCoalescerRef.current?.cancel();
    }, [activeTool]);

    /**
     * 鼠标松开：完成移动/复制/镜像/旋转/绘制/框选等动作并清理交互态。
     */
    const handleMouseUp = (e: React.MouseEvent) => {
        // 补齐最后一段平移与预览，避免快速松开时丢掉最后一帧
        panCoalescerRef.current?.flush();
        pointCoalescerRef.current?.flush();
        const rawPt = getSVGPoint(e);
        const pt = applyConstraints(rawPt, drawStart || undefined);

        // 右键未拖拽：视为右键点击，弹出上下文菜单
        const rightPress = rightPressRef.current;
        rightPressRef.current = null;
        if (rightPress && onRequestContextMenu) {
            const travel = Math.hypot(e.clientX - rightPress.x, e.clientY - rightPress.y);
            if (travel <= RIGHT_CLICK_TOLERANCE_PX) {
                onRequestContextMenu({
                    client: { x: e.clientX, y: e.clientY },
                    world: rawPt,
                });
            }
        }

        const tool = getTool(activeTool);
        const result = tool?.onMouseUp?.(buildToolContext(rawPt, pt, {
            client: { x: e.clientX, y: e.clientY },
            button: e.button,
            shiftKey: e.shiftKey,
        }));

        // 多步工具（多段线/圆弧/标注/缩放基点）保留当前拖拽态，等待下一次点击
        if (result && result.keepDragState) {
            setPolarGuide(null);
            setDynamicEdit(null);
            return;
        }

        setDragMode(null);
        setDrawStart(null);
        setCurrentPoint(null);
        setPolarGuide(null);
        setDynamicEdit(null);
    };

    /**
     * 应用矩形阵列：保留原始对象，新增副本并选中，随后回到选择工具。
     */
    const handleArrayConfirm = (params: ArrayParams) => {
        const targets = elements.filter(el => selectedIds.has(el.id));
        if (targets.length === 0) {
            onNotification("Select objects first to array.");
            setActiveTool(ToolType.SELECT);
            return;
        }

        const copies = Transform
            .rectangularArray(targets, params.rows, params.columns, params.rowSpacing, params.columnSpacing);

        commitAction([...elements, ...copies]);
        setSelection(copies.map(el => el.id));
        onNotification(`Array ${params.rows}×${params.columns}`);
        setActiveTool(ToolType.SELECT);
    };

    /**
     * 滚轮缩放：以鼠标位置为锚点，限制最大/最小缩放范围。
     * 使用原生非 passive 监听，确保可以阻止页面滚动。
     */
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;

        const onWheel = (e: WheelEvent) => {
            if (e.deltaY === 0) return;
            e.preventDefault();
            const ctm = svg.getScreenCTM();
            if (!ctm || !ctm.a || !ctm.d) return;
            const anchor = {
                x: (e.clientX - ctm.e) / ctm.a,
                y: (e.clientY - ctm.f) / ctm.d,
            };
            // 滚轮向上（deltaY < 0）放大，向下缩小
            const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
            setViewBox(prev => zoomViewBoxAt(prev, anchor, factor));
        };

        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, []);

    /** 以视口中心缩放，供工具栏按钮使用 */
    const zoomBy = (factor: number) => {
        setViewBox(prev => zoomViewBoxAt(
            prev,
            { x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 },
            factor,
        ));
    };

    /** 缩放到全部可见图元；空图纸回到默认视口 */
    const zoomExtents = () => {
        const boxes = visibleSource
            .map(el => getElementBoundingBox(el))
            .filter(box => box.maxX > box.minX || box.maxY > box.minY);
        const bounds = unionBounds(boxes);
        const aspect = viewportSize.height > 0
            ? viewportSize.width / viewportSize.height
            : 4 / 3;
        setViewBox(fitViewBox(bounds, aspect));
    };

    /** 当前光标样式 */
    const getCursor = () => {
        if (dragMode === 'PAN' || activeTool === ToolType.PAN) return 'grab';
        if (activeTool === ToolType.SELECT || activeTool === ToolType.COPY) return 'move';
        return 'crosshair';
    };

    // 缩放倍率预览：仅在基点已确定且存在选中对象时计算
    const scaleTargets = elements.filter(el => selectedIds.has(el.id));
    const scalePreview = dragMode === 'SCALE_ITEMS' && drawStart && currentPoint && scaleTargets.length > 0
        ? getScaleFactor(drawStart, currentPoint, scaleTargets)
        : null;

    // 移动/复制拖拽预览位移：所有选中元素共享同一位移
    const previewOffset = useMemo(() => {
        let x = 0;
        let y = 0;
        if ((dragMode === 'MOVE_ITEMS' || dragMode === 'COPY_ITEMS') && drawStart && currentPoint) {
            x = currentPoint.x - drawStart.x;
            y = currentPoint.y - drawStart.y;
            if (orthoMode) {
                if (Math.abs(x) > Math.abs(y)) y = 0;
                else x = 0;
            }
        }
        return { x, y };
    }, [dragMode, drawStart, currentPoint, orthoMode]);

    // 视口裁剪：仅渲染当前 viewBox（含 10% 缓冲）内的元素。
    // 空间索引在构建时已缓存包围盒，这里按原始顺序直接取精确相交的元素，
    // 不再遍历全部图元、也不重复计算包围盒（平移 / 缩放每帧都会走到这里）。
    const visibleElements = useMemo(() => {
        const { minX, minY, maxX, maxY } = bufferedViewportBounds({
            viewBox,
            width: viewportSize.width,
            height: viewportSize.height,
        });
        return spatialIndex.queryVisible(minX, minY, maxX, maxY);
    }, [spatialIndex, viewBox, viewportSize.width, viewportSize.height]);

    /** 框选语义：向右为窗口选择，向左为交叉选择 */
    const selectionMode = dragMode === 'SELECT_BOX' && drawStart && currentPoint
        ? getSelectionMode(drawStart, currentPoint)
        : null;

    return {
        // 渲染数据
        svgRef,
        viewBox,
        viewportSize,
        setViewBox,
        zoomPercent: zoomPercent(viewBox),
        pixelsPerUnit,
        elements,
        activeTool,
        drawingSettings,
        gridMode,
        visibleElements,
        /** 未按视口裁剪的可显示图元，供迷你导航图使用 */
        displayable: visibleSource,
        previewOffset,
        scalePreview,
        selectedIds,
        // 交互态
        dragMode,
        drawStart,
        currentPoint,
        polyPoints,
        arcPoints,
        dimPoints,
        snapIndicator,
        snapType,
        selectionMode,
        hoveredId,
        polarGuide: polarMode ? polarGuide : null,
        dynamicDraft,
        dynamicEdit,
        // 夹点编辑
        grips,
        activeGrip,
        gripPreview,
        // 事件与动作
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleMouseLeave,
        handleDrop,
        handleDragOver,
        handleArrayConfirm,
        zoomBy,
        zoomExtents,
        getCursor,
        setActiveTool,
    };
}
