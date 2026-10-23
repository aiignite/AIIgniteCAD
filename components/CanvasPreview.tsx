/**
 * CanvasPreview.tsx — 画布交互预览层
 *
 * 负责渲染绘制中的幽灵图形、多段线/圆弧/标注预览、镜像线、测量线、
 * 框选矩形、缩放提示与捕捉标记，使 Canvas 主组件只关注事件与图元列表。
 */

import React from 'react';
import { CADElement, DragMode, DrawingSettings, Point, ToolType } from '../types';
import { dist } from '../lib/canvasGeometry';
import { GripPoint } from '../lib/grip';
import { SelectionMode } from '../lib/selection';
import CADElementRenderer, { renderDimension } from './CADElementRenderer';

/** 预览层入参 */
export interface CanvasPreviewProps {
    /** 当前激活的工具 */
    activeTool: ToolType;
    /** 当前拖拽模式 */
    dragMode: DragMode | null;
    /** 拖拽起点 */
    drawStart: Point | null;
    /** 当前光标位置 */
    currentPoint: Point | null;
    /** 多段线已确认的顶点 */
    polyPoints: Point[];
    /** 圆弧已确认的点 */
    arcPoints: Point[];
    /** 标注已确认的点 */
    dimPoints: Point[];
    /** 捕捉指示点 */
    snapIndicator: Point | null;
    /** 缩放倍率预览，null 表示不显示 */
    scalePreview: number | null;
    /** 标注与网格设置 */
    drawingSettings: DrawingSettings;
    /** 选中图元的夹点集合 */
    grips?: GripPoint[];
    /** 当前正在拖拽的夹点 */
    activeGrip?: GripPoint | null;
    /** 夹点拖拽中的幽灵图元（实时变形结果） */
    gripPreview?: CADElement | null;
    /** 屏幕像素 / 世界单位，用于绘制固定像素大小的标记 */
    pixelsPerUnit?: number;
    /** 框选语义，决定选择框颜色 */
    selectionMode?: SelectionMode | null;
    /** 极轴命中时的引导线：起点、当前吸附点与角度 */
    polarGuide?: { anchor: Point; point: Point; angle: number } | null;
}

/**
 * 交互预览层。
 * 所有图形均为临时 SVG，不写入文档状态，松开鼠标后由 Canvas 提交正式元素。
 */
const CanvasPreview: React.FC<CanvasPreviewProps> = ({
    activeTool,
    dragMode,
    drawStart,
    currentPoint,
    polyPoints,
    arcPoints,
    dimPoints,
    snapIndicator,
    scalePreview,
    drawingSettings,
    grips,
    activeGrip,
    gripPreview,
    pixelsPerUnit = 1,
    selectionMode,
    polarGuide,
}) => {
    /** 将屏幕像素尺寸换算为当前视口下的世界单位 */
    const px = (value: number) => value / Math.max(pixelsPerUnit, 1e-6);

    /** 极轴引导线终点：沿吸附方向多延伸一段，视觉上像一条射线 */
    const polarRay = (() => {
        if (!polarGuide) return null;
        const dx = polarGuide.point.x - polarGuide.anchor.x;
        const dy = polarGuide.point.y - polarGuide.anchor.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-6) return null;
        const extension = length * 1.35 + 40;
        return {
            x: polarGuide.anchor.x + (dx / length) * extension,
            y: polarGuide.anchor.y + (dy / length) * extension,
        };
    })();

    return (
        <>
            {/* 多段线预览 */}
            {activeTool === ToolType.POLYLINE && polyPoints.length > 0 && currentPoint && (
                <g>
                    <polyline points={polyPoints.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#137fec" strokeWidth={2} vectorEffect="non-scaling-stroke"/>
                    <line x1={polyPoints[polyPoints.length-1].x} y1={polyPoints[polyPoints.length-1].y} x2={currentPoint.x} y2={currentPoint.y} stroke="#137fec" strokeDasharray="5,5" vectorEffect="non-scaling-stroke"/>
                </g>
            )}

            {/* 圆弧采点预览 */}
            {activeTool === ToolType.ARC && arcPoints.length > 0 && currentPoint && (
                <g>
                    {arcPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={px(3.5)} fill="red"/>)}
                    <line x1={arcPoints[arcPoints.length-1].x} y1={arcPoints[arcPoints.length-1].y} x2={currentPoint.x} y2={currentPoint.y} stroke="#137fec" strokeDasharray="5,5"/>
                </g>
            )}

            {/* 标注预览 */}
            {activeTool === ToolType.DIMENSION && (
                <g>
                    {dimPoints.length === 1 && currentPoint && (
                        <line x1={dimPoints[0].x} y1={dimPoints[0].y} x2={currentPoint.x} y2={currentPoint.y} stroke="#137fec" strokeDasharray="5,5"/>
                    )}
                    {dimPoints.length === 2 && currentPoint && (
                        renderDimension({
                            id: 'temp', type: 'DIMENSION', layer: 'DIM', color: '#4ade80',
                            start: dimPoints[0], end: dimPoints[1], offsetPoint: currentPoint
                        }, false, drawingSettings.dimScale, drawingSettings.dimPrecision)
                    )}
                </g>
            )}

            {/* 拖拽绘制时的幽灵图形 */}
            {dragMode === 'DRAW' && drawStart && currentPoint && (
                <g opacity="0.6">
                    {activeTool === ToolType.LINE && (
                        <line x1={drawStart.x} y1={drawStart.y} x2={currentPoint.x} y2={currentPoint.y} stroke="#137fec" strokeWidth={2} strokeDasharray="5,5" vectorEffect="non-scaling-stroke" />
                    )}
                    {activeTool === ToolType.RECTANGLE && (
                        <rect
                            x={Math.min(drawStart.x, currentPoint.x)}
                            y={Math.min(drawStart.y, currentPoint.y)}
                            width={Math.abs(currentPoint.x - drawStart.x)}
                            height={Math.abs(currentPoint.y - drawStart.y)}
                            fill="rgba(19, 127, 236, 0.1)" stroke="#137fec" strokeWidth={2} strokeDasharray="5,5" vectorEffect="non-scaling-stroke"
                        />
                    )}
                    {activeTool === ToolType.CIRCLE && (
                        <circle
                            cx={drawStart.x}
                            cy={drawStart.y}
                            r={dist(drawStart, currentPoint)}
                            fill="none" stroke="#137fec" strokeWidth={2} strokeDasharray="5,5" vectorEffect="non-scaling-stroke"
                        />
                    )}
                </g>
            )}

            {/* 镜像线预览 */}
            {dragMode === 'MIRROR_LINE' && drawStart && currentPoint && (
                <line x1={drawStart.x} y1={drawStart.y} x2={currentPoint.x} y2={currentPoint.y} stroke="#fbbf24" strokeWidth={1} strokeDasharray="10,5,2,5" vectorEffect="non-scaling-stroke" />
            )}

            {/* 测量线预览 */}
            {dragMode === 'MEASURE' && drawStart && currentPoint && (
                <g>
                    <line x1={drawStart.x} y1={drawStart.y} x2={currentPoint.x} y2={currentPoint.y} stroke="#22c55e" strokeWidth={2} strokeDasharray="4,2" vectorEffect="non-scaling-stroke" />
                    <text x={(drawStart.x + currentPoint.x)/2} y={(drawStart.y + currentPoint.y)/2 - px(10)} fill="#22c55e" fontSize={px(12)} textAnchor="middle" style={{textShadow: '0 1px 2px black'}}>
                        {dist(drawStart, currentPoint).toFixed(drawingSettings.dimPrecision)} {drawingSettings.units}
                    </text>
                </g>
            )}

            {/* 框选矩形：蓝色为窗口选择（完全包含），绿色为交叉选择（相交即选中） */}
            {dragMode === 'SELECT_BOX' && drawStart && currentPoint && (
                <rect
                    x={Math.min(drawStart.x, currentPoint.x)}
                    y={Math.min(drawStart.y, currentPoint.y)}
                    width={Math.abs(currentPoint.x - drawStart.x)}
                    height={Math.abs(currentPoint.y - drawStart.y)}
                    fill={selectionMode === 'CROSSING' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)'}
                    stroke={selectionMode === 'CROSSING' ? '#22c55e' : '#3b82f6'}
                    strokeDasharray={selectionMode === 'CROSSING' ? '6,4' : undefined}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                />
            )}

            {/* 缩放预览：基点、光标连线与倍率 */}
            {dragMode === 'SCALE_ITEMS' && drawStart && currentPoint && scalePreview !== null && (
                <g pointerEvents="none">
                    <line
                        x1={drawStart.x} y1={drawStart.y}
                        x2={currentPoint.x} y2={currentPoint.y}
                        stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="4,3"
                        vectorEffect="non-scaling-stroke"
                    />
                    <circle cx={drawStart.x} cy={drawStart.y} r={px(4)}
                        fill="none" stroke="#fbbf24" strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                    />
                    <text
                        x={currentPoint.x + px(10)} y={currentPoint.y - px(10)}
                        fill="#fbbf24" fontSize={px(12)} fontWeight="bold"
                        vectorEffect="non-scaling-stroke"
                    >
                        ×{scalePreview.toFixed(2)}
                    </text>
                </g>
            )}

            {/* 夹点拖拽预览：实时显示变形后的图元 */}
            {dragMode === 'GRIP_EDIT' && gripPreview && (
                <g opacity={0.5} pointerEvents="none">
                    <CADElementRenderer
                        element={gripPreview}
                        isSelected={false}
                        dimScale={drawingSettings.dimScale}
                        dimPrecision={drawingSettings.dimPrecision}
                    />
                </g>
            )}

            {/* 夹点：选中图元的可拖拽控制点 */}
            {grips && grips.length > 0 && (
                <g pointerEvents="none">
                    {grips.map(grip => {
                        const isActive = activeGrip?.elementId === grip.elementId && activeGrip.key === grip.key;
                        const size = px(isActive ? 8 : 6);
                        return (
                            <rect
                                key={`${grip.elementId}-${grip.key}`}
                                x={grip.point.x - size / 2}
                                y={grip.point.y - size / 2}
                                width={size}
                                height={size}
                                fill={isActive ? '#f97316' : '#22d3ee'}
                                stroke="#0b1220"
                                strokeWidth={1}
                                vectorEffect="non-scaling-stroke"
                            />
                        );
                    })}
                </g>
            )}

            {/* 极轴引导：锚点 + 沿锁定方向的虚线射线 */}
            {polarGuide && polarRay && (
                <g pointerEvents="none">
                    <line
                        x1={polarGuide.anchor.x}
                        y1={polarGuide.anchor.y}
                        x2={polarRay.x}
                        y2={polarRay.y}
                        stroke="#38bdf8"
                        strokeWidth={1}
                        strokeDasharray="7,5"
                        opacity={0.8}
                        vectorEffect="non-scaling-stroke"
                    />
                    <circle
                        cx={polarGuide.anchor.x}
                        cy={polarGuide.anchor.y}
                        r={px(3)}
                        fill="#38bdf8"
                    />
                </g>
            )}

            {/* 捕捉标记：固定 8px，避免缩放后过大或不可见 */}
            {snapIndicator && (
                <rect
                    x={snapIndicator.x - px(4)} y={snapIndicator.y - px(4)}
                    width={px(8)} height={px(8)}
                    fill="none"
                    stroke="#facc15"
                    strokeWidth={2}
                    className="animate-pulse"
                    vectorEffect="non-scaling-stroke"
                />
            )}
        </>
    );
};

export default CanvasPreview;
