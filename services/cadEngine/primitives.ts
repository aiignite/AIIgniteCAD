/**
 * 基础图元生成库
 * 提供各种基础图形的创建功能
 */

import { CADElement, Point } from '../../types';

/**
 * 生成直线
 */
export function drawLine(
    start: Point,
    end: Point,
    color: string = '#8b949e',
    layer: string = '0'
): CADElement {
    return {
        id: generateId(),
        type: 'LINE',
        start,
        end,
        layer,
        color
    };
}

/**
 * 生成圆
 */
export function drawCircle(
    center: Point,
    radius: number,
    color: string = '#8b949e',
    layer: string = '0'
): CADElement {
    return {
        id: generateId(),
        type: 'CIRCLE',
        center,
        radius,
        layer,
        color
    };
}

/**
 * 生成矩形
 */
export function drawRectangle(
    corner: Point,
    width: number,
    height: number,
    color: string = '#8b949e',
    layer: string = '0'
): CADElement {
    return {
        id: generateId(),
        type: 'RECTANGLE',
        start: corner,
        width,
        height,
        layer,
        color
    };
}

/**
 * 生成圆弧
 */
export function drawArc(
    center: Point,
    radius: number,
    startAngle: number,
    endAngle: number,
    clockwise: boolean = false,
    color: string = '#8b949e',
    layer: string = '0'
): CADElement {
    return {
        id: generateId(),
        type: 'ARC',
        center,
        radius,
        startAngle,
        endAngle,
        clockwise,
        layer,
        color
    };
}

/**
 * 生成多段线
 */
export function drawPolyline(
    points: Point[],
    color: string = '#8b949e',
    layer: string = '0'
): CADElement {
    return {
        id: generateId(),
        type: 'LWPOLYLINE',
        points: [...points], // 复制数组
        layer,
        color
    };
}

/**
 * 生成文本
 */
export function drawText(
    position: Point,
    text: string,
    fontSize: number = 12,
    color: string = '#8b949e',
    layer: string = '0'
): CADElement {
    return {
        id: generateId(),
        type: 'TEXT',
        start: position,
        text,
        fontSize,
        layer,
        color
    };
}

/**
 * 生成正多边形（作为多段线）
 */
export function drawPolygon(
    center: Point,
    sides: number,
    radius: number,
    rotation: number = 0,
    color: string = '#8b949e',
    layer: string = '0'
): CADElement {
    const points: Point[] = [];
    const angleStep = (2 * Math.PI) / sides;
    const rotationRad = rotation * Math.PI / 180;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep + rotationRad;
        points.push({
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle)
        });
    }
    
    // 闭合多边形
    points.push({ ...points[0] });
    
    return {
        id: generateId(),
        type: 'LWPOLYLINE',
        points,
        layer,
        color
    };
}

/**
 * 生成椭圆（作为多段线近似）
 */
export function drawEllipse(
    center: Point,
    radiusX: number,
    radiusY: number,
    rotation: number = 0,
    color: string = '#8b949e',
    layer: string = '0',
    segments: number = 64
): CADElement {
    const points: Point[] = [];
    const rotationRad = rotation * Math.PI / 180;
    
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = radiusX * Math.cos(angle);
        const y = radiusY * Math.sin(angle);
        
        // 旋转点
        const rotatedX = x * Math.cos(rotationRad) - y * Math.sin(rotationRad);
        const rotatedY = x * Math.sin(rotationRad) + y * Math.cos(rotationRad);
        
        points.push({
            x: center.x + rotatedX,
            y: center.y + rotatedY
        });
    }
    
    return {
        id: generateId(),
        type: 'ELLIPSE',
        center,
        radiusX,
        radiusY,
        rotation,
        points,
        layer,
        color
    };
}

/**
 * 在圆上均匀分布点
 */
export function distributePointsOnCircle(
    center: Point,
    radius: number,
    count: number,
    startAngle: number = 0
): Point[] {
    const points: Point[] = [];
    const angleStep = (2 * Math.PI) / count;
    const startRad = startAngle * Math.PI / 180;
    
    for (let i = 0; i < count; i++) {
        const angle = i * angleStep + startRad;
        points.push({
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle)
        });
    }
    
    return points;
}

/**
 * 在直线上均匀分布点
 */
export function distributePointsOnLine(
    start: Point,
    end: Point,
    count: number,
    includeEndpoints: boolean = true
): Point[] {
    const points: Point[] = [];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    
    const segments = includeEndpoints ? count - 1 : count + 1;
    const offset = includeEndpoints ? 0 : 1;
    
    for (let i = 0; i < count; i++) {
        const t = (i + offset) / segments;
        points.push({
            x: start.x + t * dx,
            y: start.y + t * dy
        });
    }
    
    return points;
}

/**
 * 生成网格点
 */
export function generateGrid(
    origin: Point,
    rows: number,
    cols: number,
    rowSpacing: number,
    colSpacing: number
): Point[] {
    const points: Point[] = [];
    
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            points.push({
                x: origin.x + col * colSpacing,
                y: origin.y + row * rowSpacing
            });
        }
    }
    
    return points;
}

/**
 * 生成标注尺寸
 */
export function drawDimension(
    start: Point,
    end: Point,
    offsetPoint: Point,
    color: string = '#4ade80',
    layer: string = 'DIM'
): CADElement {
    return {
        id: generateId(),
        type: 'DIMENSION',
        start,
        end,
        offsetPoint,
        layer,
        color
    };
}

// ==================== 辅助函数 ====================

/**
 * 生成唯一ID
 */
function generateId(): string {
    return Math.random().toString(36).substr(2, 9);
}

/**
 * 复制元素
 */
export function cloneElement(element: CADElement): CADElement {
    return {
        ...element,
        id: generateId(),
        selected: false
    };
}

/**
 * 批量创建元素
 */
export function createElements(
    generator: () => CADElement,
    count: number
): CADElement[] {
    const elements: CADElement[] = [];
    for (let i = 0; i < count; i++) {
        elements.push(generator());
    }
    return elements;
}
