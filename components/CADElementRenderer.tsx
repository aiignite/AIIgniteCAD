/**
 * CADElementRenderer.tsx — 单个 CAD 元素的 SVG 渲染单元
 * 从 Canvas 中拆出图元渲染逻辑，配合 React.memo 实现"只有变化的元素才重渲染"，
 * 避免大图纸下每次交互都重建全部 SVG 节点。
 */

import React from 'react';
import { CADElement, Point } from '../types';
import { add, distance, dot, subtract } from '../lib/geometry';
import { AI_GHOST_COLORS } from '../lib/aiGhost';

/** 打印 / 图框渲染覆盖项；未提供时保持屏幕渲染行为 */
export interface CADElementRenderOverrides {
    /** 世界单位线宽；提供时覆盖屏幕线宽 */
    strokeWidth?: number;
    /** 是否使用 non-scaling-stroke；打印时传 false，让线宽随图纸比例缩放 */
    nonScalingStroke?: boolean;
    /** 强制单色输出（白纸黑线） */
    monochrome?: boolean;
}

/** AI 幽灵预览状态：只改颜色与线型，几何与真实图元完全一致 */
export type AIGhostState = 'incoming' | 'outgoing';

/** 渲染器入参 */
export interface CADElementRendererProps {
    /** 需要渲染的 CAD 元素 */
    element: CADElement;
    /** 是否处于选中态（黄色虚线高亮） */
    isSelected: boolean;
    /** 是否处于预选态（光标悬停，浅蓝高亮） */
    isHovered?: boolean;
    /** AI 预览幽灵态：紫色=提议结果、红色=将被移除 */
    ghost?: AIGhostState;
    /** 移动/复制拖拽预览的 X 位移 */
    offsetX?: number;
    /** 移动/复制拖拽预览的 Y 位移 */
    offsetY?: number;
    /** 标注文字与箭头的缩放系数 */
    dimScale?: number;
    /** 标注数值的小数位数 */
    dimPrecision?: number;
    /** 打印覆盖项 */
    overrides?: CADElementRenderOverrides;
}

/**
 * 将极坐标（角度制）转换为画布上的直角坐标。
 */
const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number): Point => {
    const angleInRadians = angleInDegrees * Math.PI / 180.0;
    return {
        x: centerX + (radius * Math.cos(angleInRadians)),
        y: centerY + (radius * Math.sin(angleInRadians))
    };
};

/**
 * 生成 SVG 圆弧路径（A 指令）。
 * clockwise 决定扫描方向，跨度大于 180° 时启用 large-arc-flag。
 */
const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number, clockwise: boolean): string => {
    const start = polarToCartesian(x, y, radius, startAngle);
    const end = polarToCartesian(x, y, radius, endAngle);

    // 圆弧跨度取决于绘制方向
    const span = clockwise
        ? (endAngle - startAngle + 360) % 360
        : (startAngle - endAngle + 360) % 360;

    const largeArcFlag = span > 180 ? "1" : "0";
    const sweepFlag = clockwise ? "1" : "0";

    return [
        "M", start.x, start.y,
        "A", radius, radius, 0, largeArcFlag, sweepFlag, end.x, end.y
    ].join(" ");
};

/**
 * 生成尺寸标注箭头的三角形路径。
 */
const getArrowPath = (tip: Point, angle: number, size: number) => {
    const x1 = tip.x - size * Math.cos(angle - Math.PI / 6);
    const y1 = tip.y - size * Math.sin(angle - Math.PI / 6);
    const x2 = tip.x - size * Math.cos(angle + Math.PI / 6);
    const y2 = tip.y - size * Math.sin(angle + Math.PI / 6);
    return `M ${tip.x} ${tip.y} L ${x1} ${y1} L ${x2} ${y2} Z`;
};

/**
 * 渲染尺寸标注：引出线、标注线、箭头与数值文字。
 * 由起点、终点与偏移点共同决定标注高度。
 * 同时导出给 Canvas 用于绘制"未提交的标注预览"。
 */
export const renderDimension = (
    el: CADElement,
    isSelected: boolean,
    dimScale: number,
    dimPrecision: number,
    overrides?: CADElementRenderOverrides,
    isHovered = false,
    ghost?: AIGhostState,
) => {
    if (!el.start || !el.end || !el.offsetPoint) return null;

    const v = subtract(el.end, el.start);
    const len = distance(el.start, el.end);
    if (len === 0) return null;

    const unitV = { x: v.x / len, y: v.y / len };
    const normal = { x: -unitV.y, y: unitV.x };

    // 将偏移点投影到法线上得到标注高度
    const vOffset = subtract(el.offsetPoint, el.start);
    const h = dot(vOffset, normal);

    const scale = dimScale || 1;
    const originOffset = 2 * scale; // 与被标注对象的间隙
    const extensionOver = 3 * scale; // 引出线超出标注线的长度
    const dir = Math.sign(h) || 1; // 标注方向

    const p1ExtStart = add(el.start, { x: normal.x * dir * originOffset, y: normal.y * dir * originOffset });
    const p1ExtEnd = add(el.start, { x: normal.x * (h + dir * extensionOver), y: normal.y * (h + dir * extensionOver) });

    const p2ExtStart = add(el.end, { x: normal.x * dir * originOffset, y: normal.y * dir * originOffset });
    const p2ExtEnd = add(el.end, { x: normal.x * (h + dir * extensionOver), y: normal.y * (h + dir * extensionOver) });

    const dimLineStart = add(el.start, { x: normal.x * h, y: normal.y * h });
    const dimLineEnd = add(el.end, { x: normal.x * h, y: normal.y * h });

    // 文字位置：标注线中点沿法线再偏移一小段
    const mid = { x: (dimLineStart.x + dimLineEnd.x) / 2, y: (dimLineStart.y + dimLineEnd.y) / 2 };
    const textOffset = 5 * scale;
    const textPos = add(mid, { x: normal.x * dir * textOffset, y: normal.y * dir * textOffset });

    // 幽灵层优先着色，其次选中黄、预选浅蓝；单色打印固定黑色
    const color = overrides?.monochrome
        ? '#000000'
        : ghost
          ? AI_GHOST_COLORS[ghost]
          : isSelected
            ? '#fbbf24'
            : isHovered
              ? '#38bdf8'
              : (el.color === '#e6edf3' ? '#4ade80' : el.color);
    const strokeWidth = overrides?.strokeWidth ?? (ghost ? 2 : 1);
    const vectorEffect = overrides?.nonScalingStroke === false ? undefined : 'non-scaling-stroke';

    const angle = Math.atan2(dimLineEnd.y - dimLineStart.y, dimLineEnd.x - dimLineStart.x);
    const arrowSize = 6 * scale;
    const arrow1 = getArrowPath(dimLineStart, angle + Math.PI, arrowSize);
    const arrow2 = getArrowPath(dimLineEnd, angle, arrowSize);

    // 文字旋转到与标注线平行，并保持可读方向
    let textRot = angle * 180 / Math.PI;
    if (textRot > 90 || textRot < -90) textRot += 180;

    return (
        <g opacity={isSelected || ghost || overrides ? 1 : 0.9}>
            {/* 引出线 */}
            <line x1={p1ExtStart.x} y1={p1ExtStart.y} x2={p1ExtEnd.x} y2={p1ExtEnd.y} stroke={color} strokeWidth={strokeWidth} vectorEffect={vectorEffect} />
            <line x1={p2ExtStart.x} y1={p2ExtStart.y} x2={p2ExtEnd.x} y2={p2ExtEnd.y} stroke={color} strokeWidth={strokeWidth} vectorEffect={vectorEffect} />
            {/* 标注线 */}
            <line x1={dimLineStart.x} y1={dimLineStart.y} x2={dimLineEnd.x} y2={dimLineEnd.y} stroke={color} strokeWidth={strokeWidth} vectorEffect={vectorEffect} />
            {/* 箭头 */}
            <path d={arrow1} fill={color} />
            <path d={arrow2} fill={color} />
            {/* 数值 */}
            <text
                x={textPos.x} y={textPos.y}
                fill={color}
                fontSize={10 * scale}
                textAnchor="middle"
                alignmentBaseline="middle"
                transform={`rotate(${textRot}, ${textPos.x}, ${textPos.y})`}
                style={overrides ? undefined : { textShadow: '0 0 4px rgba(0,0,0,0.5)' }}
            >
                {len.toFixed(dimPrecision)}
            </text>
        </g>
    );
};

/**
 * 单个 CAD 元素渲染器。
 * 仅当 element 引用、选中态、拖拽位移或标注参数变化时才重新渲染。
 */
const CADElementRenderer: React.FC<CADElementRendererProps> = ({
    element: el,
    isSelected,
    isHovered = false,
    ghost,
    offsetX = 0,
    offsetY = 0,
    dimScale = 1,
    dimPrecision = 2,
    overrides,
}) => {
    const isPlot = overrides !== undefined;
    const monochrome = overrides?.monochrome ?? false;
    // 主题默认色（#e6edf3）在屏幕上跟随主题，在打印时固定为黑色
    const baseColor = el.color === '#e6edf3'
        ? (isPlot ? '#000000' : 'rgb(var(--cad-text))')
        : el.color;
    // 幽灵层用固定配色，其余状态沿用预选浅蓝、选中黄
    const color = monochrome
        ? '#000000'
        : ghost
          ? AI_GHOST_COLORS[ghost]
          : isSelected
            ? '#fbbf24'
            : isHovered
              ? '#38bdf8'
              : baseColor;
    const style = {
        stroke: color,
        strokeWidth: overrides?.strokeWidth ?? (isSelected ? 3 : ghost || isHovered ? 2.5 : 2),
        strokeDasharray: ghost ? '6,4' : isSelected ? '5,2' : 'none',
    };
    const vectorEffect = overrides?.nonScalingStroke === false ? undefined : 'non-scaling-stroke';
    const textFill = monochrome
        ? '#000000'
        : ghost
          ? AI_GHOST_COLORS[ghost]
          : isSelected
            ? '#fbbf24'
            : isHovered
              ? '#38bdf8'
              : isPlot
                ? baseColor
                : 'rgb(var(--cad-text))';
    // 位移为零时省略 transform，减少无意义的属性
    const transform = offsetX !== 0 || offsetY !== 0 ? `translate(${offsetX}, ${offsetY})` : undefined;
    // DXF 文字旋转为世界坐标逆时针，屏幕 Y 向下时需取反
    const textRotation = el.rotation ?? 0;
    const textTransform = [
        transform,
        el.start && Math.abs(textRotation) > 1e-9
            ? `rotate(${-textRotation} ${el.start.x} ${el.start.y})`
            : undefined,
    ]
        .filter(Boolean)
        .join(' ') || undefined;

    if (el.type === 'LINE' && el.start && el.end) {
        return <line x1={el.start.x} y1={el.start.y} x2={el.end.x} y2={el.end.y} {...style} transform={transform} vectorEffect={vectorEffect} />;
    }
    if (el.type === 'RECTANGLE' && el.start && el.width) {
        // 宽高可能为负，统一换算为左上角 + 正尺寸
        const x = el.width > 0 ? el.start.x : el.start.x + el.width;
        const y = (el.height ?? 0) > 0 ? el.start.y : el.start.y + (el.height ?? 0);
        return <rect x={x} y={y} width={Math.abs(el.width)} height={Math.abs(el.height || 0)} fill="none" {...style} transform={transform} vectorEffect={vectorEffect} />;
    }
    if (el.type === 'CIRCLE' && el.center && el.radius) {
        return <circle cx={el.center.x} cy={el.center.y} r={el.radius} fill="none" {...style} transform={transform} vectorEffect={vectorEffect} />;
    }
    if (el.type === 'TEXT' && el.start && el.text) {
        return (
            <text
                x={el.start.x}
                y={el.start.y}
                fill={textFill}
                fontSize={el.fontSize || 12}
                fontFamily="monospace"
                transform={textTransform}
                style={{ userSelect: 'none', ...style, stroke: 'none' }}
            >
                {el.text}
            </text>
        );
    }
    if (el.type === 'LWPOLYLINE' && el.points) {
        const pts = el.points.map(p => `${p.x},${p.y}`).join(' ');
        const Tag = el.closed ? 'polygon' : 'polyline';
        return <Tag points={pts} fill="none" {...style} transform={transform} vectorEffect={vectorEffect} />;
    }
    if (el.type === 'ARC' && el.center && el.radius && el.startAngle !== undefined && el.endAngle !== undefined) {
        const pathData = describeArc(el.center.x, el.center.y, el.radius, el.startAngle, el.endAngle, el.clockwise || false);
        return <path d={pathData} fill="none" {...style} transform={transform} vectorEffect={vectorEffect} />;
    }
    if (el.type === 'DIMENSION') {
        return renderDimension(el, isSelected, dimScale, dimPrecision, overrides, isHovered, ghost);
    }
    // 高级曲线统一按多段线渲染
    if ((el.type === 'GEAR' || el.type === 'SPIRAL' || el.type === 'SPRING' || el.type === 'ELLIPSE') && el.points) {
        const pts = el.points.map(p => `${p.x},${p.y}`).join(' ');
        return <polyline points={pts} fill="none" {...style} transform={transform} vectorEffect={vectorEffect} />;
    }
    return null;
};

export default React.memo(CADElementRenderer);
