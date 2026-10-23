/**
 * Canvas.tsx — CAD 画布渲染组件
 *
 * 仅负责 SVG 舞台渲染（网格、坐标轴、图元列表、交互预览、视图叠加层）。
 * 坐标换算、捕捉约束、命中测试与全部工具交互逻辑集中在 useCanvasInteraction，
 * 交互预览图形集中在 CanvasPreview，避免工具分支继续堆积在本文件。
 */

import React, { useEffect, useMemo } from 'react';
import { CADElement, Point, ToolType } from '../types';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import CADElementRenderer from './CADElementRenderer';
import CanvasPreview from './CanvasPreview';
import { RemoteCursors } from './RemoteCursors';
import { svgRenderer } from '../renderer/svgRenderer';
import { ArrayModal } from './ArrayModal';
import { MiniMap } from './MiniMap';
import { useCanvas } from '../store/canvasStore';
import { updateCanvasStatus } from '../store/canvasStatus';
import { ZOOM_STEP } from '../lib/viewport';
import { getCombinedBoundingBox } from '../lib/transform';
import { planAIGhostPreview } from '../lib/aiGhost';
import { snapTypeLabel } from '../lib/snapping';
import { describeToolHint } from '../lib/toolHints';
import { useI18n } from '../lib/i18n';
import { dynamicFieldLabel, dynamicFieldSuffix } from '../lib/dynamicInput';

/** 选中集迷你工具栏：全部复用左侧工具栏的工具态，参数仍由各自工具收集 */
const SELECTION_TOOLS: ReadonlyArray<{ tool: ToolType; icon: string; label: string }> = [
    { tool: ToolType.SELECT, icon: 'open_with', label: '移动' },
    { tool: ToolType.COPY, icon: 'content_copy', label: '复制' },
    { tool: ToolType.ROTATE, icon: 'rotate_right', label: '旋转' },
    { tool: ToolType.SCALE, icon: 'aspect_ratio', label: '缩放' },
    { tool: ToolType.MIRROR, icon: 'flip', label: '镜像' },
    { tool: ToolType.OFFSET, icon: 'format_indent_increase', label: '偏移' },
    { tool: ToolType.ARRAY, icon: 'grid_view', label: '阵列' },
];

/** 迷你工具栏的近似尺寸，用于把浮层夹在画布内 */
const SELECTION_BAR_W = 268;
const SELECTION_BAR_H = 44;

/**
 * 迷你工具栏按钮
 * 模块级组件，避免每次渲染都产生新的组件类型
 */
const BarButton: React.FC<{
    icon: string;
    label: string;
    action?: string;
    tool?: string;
    active?: boolean;
    onClick: () => void;
}> = ({ icon, label, action, tool, active = false, onClick }) => (
    <button
        onClick={onClick}
        data-action={action}
        data-tool={tool}
        title={label}
        className={`group relative flex size-8 items-center justify-center rounded-md transition-colors
        ${active ? 'bg-cad-primary/15 text-cad-primary' : 'text-gray-400 hover:bg-cad-text/10 hover:text-cad-text'}`}
    >
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
        <span className="absolute top-9 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 select-none">
            {label}
        </span>
    </button>
);

/** Canvas 组件入参：由 App 注入的跨组件回调 */
interface CanvasProps {
    /** 请求弹出文字输入框 */
    onRequestTextEntry: (pos: Point) => void;
    /** 请求高级图形（齿轮/多边形/椭圆等）参数弹窗 */
    onRequestAdvancedShape?: (tool: ToolType, pos: Point) => void;
    /** 状态栏通知 */
    onNotification: (msg: string) => void;
    /** 块拖放到画布 */
    onBlockDrop?: (blockId: string, position: Point) => void;
    /** AI 变更预览的差分；只叠加幽灵层，不写入 store */
    aiPreview?: { beforeElements: CADElement[]; afterElements: CADElement[] } | null;
    /** 刚被 AI 改动的图元 id，用于落图后的脉冲高亮 */
    flashIds?: Set<string> | null;
    /** 删除当前选择集（超过阈值时由 App 要求显式确认） */
    onRequestDeleteSelection: () => void;
    /** 以当前选择集为上下文向 AI 提问 */
    onAskAboutSelection: () => void;
    /** 隔离 / 隐藏对象的临时隐藏集 */
    hiddenObjectIds?: ReadonlySet<string>;
    /** 右键点击画布：请求弹出上下文菜单 */
    onRequestContextMenu?: (payload: { client: Point; world: Point }) => void;
}

/**
 * 画布主组件。
 * 交互状态与事件处理全部来自 useCanvasInteraction，本组件只组合渲染。
 */
export const Canvas: React.FC<CanvasProps> = ({
    onRequestTextEntry,
    onRequestAdvancedShape,
    onNotification,
    onBlockDrop,
    aiPreview,
    flashIds,
    onRequestDeleteSelection,
    onAskAboutSelection,
    hiddenObjectIds,
    onRequestContextMenu,
}) => {
    const { state } = useCanvas();
    const { activeTool, drawingSettings, gridMode } = state;

    const {
        svgRef,
        viewBox,
        setViewBox,
        viewportSize,
        zoomPercent,
        pixelsPerUnit,
        visibleElements,
        displayable,
        previewOffset,
        scalePreview,
        selectedIds,
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
        polarGuide,
        dynamicDraft,
        dynamicEdit,
        grips,
        activeGrip,
        gripPreview,
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
    } = useCanvasInteraction({
        onRequestTextEntry,
        onRequestAdvancedShape,
        onNotification,
        onBlockDrop,
        hiddenObjectIds,
        onRequestContextMenu,
    });

    const selectedCount = selectedIds.size;
    const { t, locale } = useI18n();
    const hint = describeToolHint(
        {
            tool: activeTool,
            dragMode,
            hasAnchor: drawStart !== null,
            polyCount: polyPoints.length,
            arcCount: arcPoints.length,
            dimCount: dimPoints.length,
            selectedCount,
        },
        locale,
    );
    const hintText = `${hint.tool} · ${hint.next}`;

    // 光标坐标与操作提示只更新状态栏订阅者，避免整棵组件树随鼠标移动重渲染
    useEffect(() => {
        updateCanvasStatus({
            x: currentPoint?.x ?? 0,
            y: currentPoint?.y ?? 0,
            active: currentPoint !== null,
            snapType: currentPoint ? snapType : null,
            zoomPercent,
            hint: hintText,
            selectedCount,
        });
    }, [currentPoint, snapType, zoomPercent, hintText, selectedCount]);

    const precision = Math.min(Math.max(drawingSettings.dimPrecision, 0), 4);
    const format = (value: number) => value.toFixed(precision);

    // AI 预览期间把差分换算成幽灵层：将被移除的图元从真实图层摘掉，改用红色虚线示意
    const ghost = useMemo(
        () =>
            aiPreview
                ? planAIGhostPreview(aiPreview.beforeElements, aiPreview.afterElements)
                : null,
        [aiPreview],
    );
    const baseElements = ghost
        ? visibleElements.filter((el) => !ghost.outgoingIds.has(el.id))
        : visibleElements;

    /** 选择集外接框：仅在选择工具、空闲、无 AI 预览时用于定位迷你工具栏 */
    const selectionBounds = useMemo(() => {
        if (activeTool !== ToolType.SELECT || dragMode !== null || aiPreview) return null;
        const selected = visibleElements.filter((el) => selectedIds.has(el.id));
        if (selected.length === 0) return null;
        return getCombinedBoundingBox(selected);
    }, [activeTool, dragMode, aiPreview, visibleElements, selectedIds]);

    /** 世界坐标 → 画布内屏幕坐标，供跟随光标的 HTML 浮层定位 */
    const toScreen = (point: Point) =>
        svgRenderer.toScreen(point, {
            viewBox,
            width: viewportSize.width,
            height: viewportSize.height,
        });

    /** 迷你工具栏贴在选框上方居中，越界时夹回画布内 */
    const selectionBar = (() => {
        if (!selectionBounds) return null;
        const anchor = toScreen({
            x: (selectionBounds.minX + selectionBounds.maxX) / 2,
            y: selectionBounds.minY,
        });
        return {
            left: Math.min(
                Math.max(8, anchor.x - SELECTION_BAR_W / 2),
                Math.max(8, viewportSize.width - SELECTION_BAR_W - 8),
            ),
            top: Math.max(8, anchor.y - SELECTION_BAR_H),
        };
    })();

    /** 光标旁的动态输入：随缩放保持屏幕尺寸，显示坐标与当前操作尺寸 */
    const dynamicInput = (() => {
        if (!currentPoint) return null;
        const multiStepAnchor =
            (activeTool === ToolType.POLYLINE && polyPoints.length > 0
                ? polyPoints[polyPoints.length - 1]
                : null) ??
            (activeTool === ToolType.DIMENSION && dimPoints.length === 1
                ? dimPoints[0]
                : null);
        if (!dragMode && !multiStepAnchor) return null;

        const anchor = drawStart ?? multiStepAnchor;
        const screen = toScreen(currentPoint);

        let measurement: string | null = null;
        if (anchor && (dragMode === 'DRAW' || dragMode === 'MEASURE')) {
            const dx = currentPoint.x - anchor.x;
            const dy = currentPoint.y - anchor.y;
            const length = Math.hypot(dx, dy);
            const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
            measurement = `L ${format(length)} ${drawingSettings.units}  ∠ ${angle.toFixed(1)}°`;
        } else if (dragMode === 'SELECT_BOX' && drawStart) {
            measurement = `W ${format(Math.abs(currentPoint.x - drawStart.x))}  H ${format(Math.abs(currentPoint.y - drawStart.y))}`;
        }

        return {
            x: currentPoint.x,
            y: currentPoint.y,
            left: Math.min(Math.max(8, screen.x + 16), Math.max(8, viewportSize.width - 220)),
            top: Math.min(Math.max(8, screen.y + 16), Math.max(8, viewportSize.height - 96)),
            measurement,
        };
    })();

    /** 捕捉类型标签：没有动态输入卡片时单独浮在光标上方 */
    const snapScreen = snapIndicator ? toScreen(snapIndicator) : null;

    const formatDraftValue = (key: 'length' | 'angle' | 'width' | 'height'): string => {
        if (!dynamicDraft) return '';
        switch (key) {
            case 'length':
                return format(dynamicDraft.length);
            case 'angle':
                return dynamicDraft.angle.toFixed(1);
            case 'width':
                return format(dynamicDraft.width);
            case 'height':
                return format(dynamicDraft.height);
        }
    };

    return (
        <main className="flex-1 relative bg-cad-bg overflow-hidden group/canvas">
            {/* 视图状态浮层 */}
            <div className="absolute top-4 left-4 bg-cad-panel/80 backdrop-blur border border-cad-border rounded px-3 py-1.5 text-xs font-mono text-cad-muted pointer-events-none select-none z-10 flex items-center gap-2">
                <span>{t('canvas.view2d')}</span>
                <span className="w-px h-3 bg-gray-500"></span>
                <span>{t('canvas.zoom', { value: zoomPercent })}</span>
            </div>

            <div
                className="w-full h-full"
                id="drawing-surface"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
            >
                <svg
                    ref={svgRef}
                    className="w-full h-full block"
                    viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ cursor: getCursor() }}
                >
                    <defs>
                        <marker id="arrow" markerHeight="10" markerUnits="strokeWidth" markerWidth="10" orient="auto" refX="9" refY="3">
                            <path d="M0,0 L0,6 L9,3 z" fill="#137fec"></path>
                        </marker>

                        {/* 动态网格图案 */}
                        {gridMode && (
                            <pattern id="grid" width={drawingSettings.gridSpacing} height={drawingSettings.gridSpacing} patternUnits="userSpaceOnUse">
                                <path d={`M ${drawingSettings.gridSpacing} 0 L 0 0 0 ${drawingSettings.gridSpacing}`} fill="none" stroke="var(--cad-grid)" strokeWidth="1"/>
                            </pattern>
                        )}
                    </defs>

                    {/* 网格背景 */}
                    {gridMode && <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="url(#grid)" vectorEffect="non-scaling-stroke" />}

                    {/* 原点坐标轴（UCS 图标） */}
                    <g>
                        <line x1="0" y1="0" x2="50" y2="0" stroke="red" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        <line x1="0" y1="0" x2="0" y2="50" stroke="green" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        <rect x="-2" y="-2" width="4" height="4" fill="white" stroke="none" vectorEffect="non-scaling-stroke" />
                    </g>

                    {/* 图元列表（视口裁剪 + memo 渲染） */}
                    {baseElements.map(el => {
                        const isSelected = selectedIds.has(el.id);
                        const node = (
                            <CADElementRenderer
                                key={el.id}
                                element={el}
                                isSelected={isSelected}
                                isHovered={!isSelected && hoveredId === el.id}
                                offsetX={isSelected ? previewOffset.x : 0}
                                offsetY={isSelected ? previewOffset.y : 0}
                                dimScale={drawingSettings.dimScale}
                                dimPrecision={drawingSettings.dimPrecision}
                            />
                        );
                        // AI 刚落图的图元套一层脉冲动画，1.2s 后由 App 清除
                        return flashIds?.has(el.id)
                            ? <g key={el.id} className="cad-ai-flash">{node}</g>
                            : node;
                    })}

                    {/* AI 幽灵层：红=将被移除，紫=提议结果；不参与命中测试 */}
                    {ghost && (
                        <g pointerEvents="none" data-ai-ghost="">
                            {ghost.outgoing.map(el => (
                                <CADElementRenderer
                                    key={`out-${el.id}`}
                                    element={el}
                                    isSelected={false}
                                    ghost="outgoing"
                                    dimScale={drawingSettings.dimScale}
                                    dimPrecision={drawingSettings.dimPrecision}
                                />
                            ))}
                            {ghost.incoming.map(el => (
                                <CADElementRenderer
                                    key={`in-${el.id}`}
                                    element={el}
                                    isSelected={false}
                                    ghost="incoming"
                                    dimScale={drawingSettings.dimScale}
                                    dimPrecision={drawingSettings.dimPrecision}
                                />
                            ))}
                        </g>
                    )}

                    {/* 交互预览层 */}
                    <CanvasPreview
                        activeTool={activeTool}
                        dragMode={dragMode}
                        drawStart={drawStart}
                        currentPoint={currentPoint}
                        polyPoints={polyPoints}
                        arcPoints={arcPoints}
                        dimPoints={dimPoints}
                        snapIndicator={snapIndicator}
                        scalePreview={scalePreview}
                        drawingSettings={drawingSettings}
                        grips={grips}
                        activeGrip={activeGrip}
                        gripPreview={gripPreview}
                        pixelsPerUnit={pixelsPerUnit}
                        selectionMode={selectionMode}
                        polarGuide={polarGuide}
                    />

                    {/* 其他协作者的远程光标（仅协作开启时渲染） */}
                    <RemoteCursors pixelsPerUnit={pixelsPerUnit} />
                </svg>
            </div>

            {/* 动态输入：坐标、可键入尺寸与捕捉提示 */}
            {dynamicInput && (
                <div
                    className="absolute z-20 pointer-events-none select-none rounded border border-cad-border bg-cad-panel/95 backdrop-blur px-2 py-1 font-mono text-[10px] leading-4 text-cad-text shadow-lg min-w-[180px]"
                    style={{ left: dynamicInput.left, top: dynamicInput.top }}
                >
                    <div className="flex items-center justify-between gap-3">
                        <span>X <span className="font-bold">{format(dynamicInput.x)}</span></span>
                        <span>Y <span className="font-bold">{format(dynamicInput.y)}</span></span>
                    </div>

                    {dynamicDraft ? (
                        <div className="mt-1 flex items-center gap-2 whitespace-nowrap">
                            {dynamicDraft.fields.map((key, index) => {
                                const active = dynamicEdit?.activeIndex === index;
                                const typed = dynamicEdit?.values[index] ?? '';
                                const text = typed || formatDraftValue(key);
                                return (
                                    <span
                                        key={key}
                                        className={`flex items-baseline gap-1 ${
                                            active ? 'text-cad-primary' : 'text-cad-text'
                                        }`}
                                    >
                                        <span className="text-cad-muted">
                                            {dynamicFieldLabel(dynamicDraft.mode, key)}
                                        </span>
                                        <span
                                            className={`font-bold ${
                                                active ? 'border-b border-cad-primary' : ''
                                            }`}
                                        >
                                            {text}
                                            {dynamicFieldSuffix(key)}
                                        </span>
                                    </span>
                                );
                            })}
                        </div>
                    ) : dynamicInput.measurement ? (
                        <div className="text-cad-muted">{dynamicInput.measurement}</div>
                    ) : null}

                    {(dynamicDraft || snapType) && (
                        <div className="mt-0.5 flex items-center justify-between gap-3">
                            <span className="text-cad-muted">
                                {dynamicDraft
                                    ? dynamicEdit
                                        ? 'Enter 确认 · Tab 切换'
                                        : '键入数值可精确输入'
                                    : ''}
                            </span>
                            {snapType && (
                                <span className="font-bold text-cad-primary">
                                    {snapTypeLabel(snapType)}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* 选中集迷你工具栏：贴在选择结果上方，Esc 或取消选择即消失 */}
            {selectionBar && (
                <div
                    className="absolute z-20 flex items-center gap-0.5 rounded-lg border border-cad-border bg-cad-panel/95 backdrop-blur px-1 py-1 shadow-lg"
                    style={{ left: selectionBar.left, top: selectionBar.top }}
                >
                    {SELECTION_TOOLS.map(item => (
                        <BarButton
                            key={item.tool}
                            tool={item.tool}
                            icon={item.icon}
                            label={item.label}
                            active={activeTool === item.tool}
                            onClick={() => setActiveTool(item.tool)}
                        />
                    ))}
                    <span className="w-px h-5 bg-cad-border mx-1"></span>
                    <BarButton
                        action="delete"
                        icon="delete"
                        label="删除选中"
                        onClick={onRequestDeleteSelection}
                    />
                    <BarButton
                        action="ask-ai"
                        icon="smart_toy"
                        label="问 AI"
                        onClick={onAskAboutSelection}
                    />
                </div>
            )}

            {/* 未处于绘制阶段时，捕捉标签单独跟随光标 */}
            {snapType && !dynamicInput && snapScreen && (
                <div
                    className="absolute z-20 pointer-events-none select-none rounded border border-cad-primary/40 bg-cad-panel/95 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cad-primary shadow"
                    style={{
                        left: Math.min(Math.max(8, snapScreen.x + 12), Math.max(8, viewportSize.width - 96)),
                        top: Math.max(8, snapScreen.y - 26),
                    }}
                >
                    {snapTypeLabel(snapType)}
                </div>
            )}

            {/* 浮动缩放控件 */}
            <div className="absolute top-4 right-4 flex flex-col items-center gap-1">
                <div className="bg-cad-panel/90 backdrop-blur rounded p-1 shadow-lg border border-cad-border flex flex-col gap-1">
                    <button className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-cad-text" onClick={() => zoomBy(1 / ZOOM_STEP)} title={t('canvas.zoomIn')}><span className="material-symbols-outlined text-lg">add</span></button>
                    <button className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-cad-text" onClick={() => zoomBy(ZOOM_STEP)} title={t('canvas.zoomOut')}><span className="material-symbols-outlined text-lg">remove</span></button>
                    <button className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-cad-text" onClick={zoomExtents} title={t('canvas.zoomExtents')}><span className="material-symbols-outlined text-lg">crop_free</span></button>
                </div>
            </div>

            {/* 迷你导航图：点击或拖拽即把视口移到对应位置 */}
            <MiniMap
                elements={displayable}
                viewBox={viewBox}
                onCenter={(point) =>
                    setViewBox((prev) => ({
                        ...prev,
                        x: point.x - prev.w / 2,
                        y: point.y - prev.h / 2,
                    }))
                }
            />

            {/* ARRAY 参数弹窗：由工具栏 ARRAY 工具激活 */}
            <ArrayModal
                visible={activeTool === ToolType.ARRAY}
                onConfirm={handleArrayConfirm}
                onCancel={() => setActiveTool(ToolType.SELECT)}
            />
        </main>
    );
};
