/**
 * 几何计算核心库
 * 提供各种几何计算功能
 */

import { Point, CADElement } from '../../types';

// ==================== 基础点和向量运算 ====================

/**
 * 计算两点之间的距离
 */
export function distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算两点之间的角度（弧度）
 */
export function angleBetweenPoints(p1: Point, p2: Point): number {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * 计算两向量之间的角度（度）
 */
export function angleBetweenVectors(v1: Point, v2: Point): number {
    const dot = v1.x * v2.x + v1.y * v2.y;
    const det = v1.x * v2.y - v1.y * v2.x;
    const angle = Math.atan2(det, dot);
    return angle * (180 / Math.PI);
}

/**
 * 向量点积
 */
export function dotProduct(v1: Point, v2: Point): number {
    return v1.x * v2.x + v1.y * v2.y;
}

/**
 * 向量叉积（2D返回标量）
 */
export function crossProduct(v1: Point, v2: Point): number {
    return v1.x * v2.y - v1.y * v2.x;
}

/**
 * 向量长度
 */
export function vectorLength(v: Point): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * 向量归一化
 */
export function normalize(v: Point): Point {
    const len = vectorLength(v);
    if (len === 0) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
}

/**
 * 向量加法
 */
export function addVectors(v1: Point, v2: Point): Point {
    return { x: v1.x + v2.x, y: v1.y + v2.y };
}

/**
 * 向量减法
 */
export function subtractVectors(v1: Point, v2: Point): Point {
    return { x: v1.x - v2.x, y: v1.y - v2.y };
}

/**
 * 向量缩放
 */
export function scaleVector(v: Point, scale: number): Point {
    return { x: v.x * scale, y: v.y * scale };
}

/**
 * 向量旋转
 */
export function rotateVector(v: Point, angle: number): Point {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
        x: v.x * cos - v.y * sin,
        y: v.x * sin + v.y * cos
    };
}

// ==================== 点与线的关系 ====================

/**
 * 点到线段的距离
 */
export function pointToSegmentDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lengthSquared = dx * dx + dy * dy;
    
    if (lengthSquared === 0) {
        return distance(point, lineStart);
    }
    
    const t = Math.max(0, Math.min(1, 
        ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared
    ));
    
    const projection = {
        x: lineStart.x + t * dx,
        y: lineStart.y + t * dy
    };
    
    return distance(point, projection);
}

/**
 * 点在线段上的投影
 */
export function projectPointOntoSegment(point: Point, lineStart: Point, lineEnd: Point): Point {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lengthSquared = dx * dx + dy * dy;
    
    if (lengthSquared === 0) {
        return { ...lineStart };
    }
    
    const t = Math.max(0, Math.min(1, 
        ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared
    ));
    
    return {
        x: lineStart.x + t * dx,
        y: lineStart.y + t * dy
    };
}

/**
 * 点是否在线段上
 */
export function isPointOnSegment(point: Point, lineStart: Point, lineEnd: Point, tolerance: number = 0.001): boolean {
    return pointToSegmentDistance(point, lineStart, lineEnd) < tolerance;
}

// ==================== 线与线的关系 ====================

/**
 * 两条线段是否平行
 */
export function areSegmentsParallel(
    line1Start: Point, line1End: Point,
    line2Start: Point, line2End: Point,
    tolerance: number = 0.001
): boolean {
    const v1 = subtractVectors(line1End, line1Start);
    const v2 = subtractVectors(line2End, line2Start);
    const cross = Math.abs(crossProduct(v1, v2));
    return cross < tolerance;
}

/**
 * 两条线段是否垂直
 */
export function areSegmentsPerpendicular(
    line1Start: Point, line1End: Point,
    line2Start: Point, line2End: Point,
    tolerance: number = 0.001
): boolean {
    const v1 = subtractVectors(line1End, line1Start);
    const v2 = subtractVectors(line2End, line2Start);
    const dot = Math.abs(dotProduct(v1, v2));
    return dot < tolerance;
}

/**
 * 两条直线的交点（无限延伸）
 */
export function lineIntersection(
    line1Start: Point, line1End: Point,
    line2Start: Point, line2End: Point
): Point | null {
    const x1 = line1Start.x, y1 = line1Start.y;
    const x2 = line1End.x, y2 = line1End.y;
    const x3 = line2Start.x, y3 = line2Start.y;
    const x4 = line2End.x, y4 = line2End.y;
    
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    
    if (Math.abs(denom) < 1e-10) {
        return null; // 平行或重合
    }
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    
    return {
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1)
    };
}

/**
 * 两条线段的交点（有限长度）
 */
export function segmentIntersection(
    line1Start: Point, line1End: Point,
    line2Start: Point, line2End: Point
): Point | null {
    const x1 = line1Start.x, y1 = line1Start.y;
    const x2 = line1End.x, y2 = line1End.y;
    const x3 = line2Start.x, y3 = line2Start.y;
    const x4 = line2End.x, y4 = line2End.y;
    
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    
    if (Math.abs(denom) < 1e-10) {
        return null;
    }
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1)
        };
    }
    
    return null;
}

// ==================== 圆与其他图形的关系 ====================

/**
 * 点到圆心的距离
 */
export function pointToCircleDistance(point: Point, center: Point, radius: number): number {
    return Math.abs(distance(point, center) - radius);
}

/**
 * 点是否在圆内
 */
export function isPointInCircle(point: Point, center: Point, radius: number): boolean {
    return distance(point, center) <= radius;
}

/**
 * 点是否在圆上
 */
export function isPointOnCircle(point: Point, center: Point, radius: number, tolerance: number = 0.001): boolean {
    return Math.abs(distance(point, center) - radius) < tolerance;
}

/**
 * 直线与圆的交点
 */
export function lineCircleIntersection(
    lineStart: Point, lineEnd: Point,
    center: Point, radius: number
): Point[] {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const fx = lineStart.x - center.x;
    const fy = lineStart.y - center.y;
    
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    
    const discriminant = b * b - 4 * a * c;
    
    if (discriminant < 0) {
        return []; // 无交点
    }
    
    const intersections: Point[] = [];
    
    if (discriminant === 0) {
        const t = -b / (2 * a);
        intersections.push({
            x: lineStart.x + t * dx,
            y: lineStart.y + t * dy
        });
    } else {
        const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);
        const t2 = (-b - Math.sqrt(discriminant)) / (2 * a);
        
        intersections.push({
            x: lineStart.x + t1 * dx,
            y: lineStart.y + t1 * dy
        });
        
        intersections.push({
            x: lineStart.x + t2 * dx,
            y: lineStart.y + t2 * dy
        });
    }
    
    return intersections;
}

/**
 * 两圆的交点
 */
export function circleCircleIntersection(
    center1: Point, radius1: number,
    center2: Point, radius2: number
): Point[] {
    const d = distance(center1, center2);
    
    // 圆不相交或一个圆在另一个内部
    if (d > radius1 + radius2 || d < Math.abs(radius1 - radius2) || d === 0) {
        return [];
    }
    
    // 圆相切
    if (d === radius1 + radius2 || d === Math.abs(radius1 - radius2)) {
        const ratio = radius1 / d;
        return [{
            x: center1.x + ratio * (center2.x - center1.x),
            y: center1.y + ratio * (center2.y - center1.y)
        }];
    }
    
    // 两个交点
    const a = (radius1 * radius1 - radius2 * radius2 + d * d) / (2 * d);
    const h = Math.sqrt(radius1 * radius1 - a * a);
    
    const px = center1.x + a * (center2.x - center1.x) / d;
    const py = center1.y + a * (center2.y - center1.y) / d;
    
    const intersections: Point[] = [
        {
            x: px + h * (center2.y - center1.y) / d,
            y: py - h * (center2.x - center1.x) / d
        },
        {
            x: px - h * (center2.y - center1.y) / d,
            y: py + h * (center2.x - center1.x) / d
        }
    ];
    
    return intersections;
}

// ==================== 多边形相关 ====================

/**
 * 计算多边形面积（Shoelace公式）
 */
export function polygonArea(points: Point[]): number {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    
    return Math.abs(area / 2);
}

/**
 * 计算多边形周长
 */
export function polygonPerimeter(points: Point[]): number {
    if (points.length < 2) return 0;
    
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        perimeter += distance(points[i], points[j]);
    }
    
    return perimeter;
}

/**
 * 计算多边形重心
 */
export function polygonCentroid(points: Point[]): Point {
    if (points.length === 0) return { x: 0, y: 0 };
    
    let cx = 0, cy = 0;
    let signedArea = 0;
    
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const cross = points[i].x * points[j].y - points[j].x * points[i].y;
        signedArea += cross;
        cx += (points[i].x + points[j].x) * cross;
        cy += (points[i].y + points[j].y) * cross;
    }
    
    signedArea /= 2;
    cx /= (6 * signedArea);
    cy /= (6 * signedArea);
    
    return { x: cx, y: cy };
}

/**
 * 点是否在多边形内（射线法）
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        
        if (intersect) inside = !inside;
    }
    
    return inside;
}

// ==================== 边界框 ====================

/**
 * 计算点集的边界框
 */
export function boundingBox(points: Point[]): { min: Point; max: Point } | null {
    if (points.length === 0) return null;
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }
    
    return {
        min: { x: minX, y: minY },
        max: { x: maxX, y: maxY }
    };
}

/**
 * 计算CADElement的边界框
 */
export function elementBoundingBox(element: CADElement): { min: Point; max: Point } | null {
    const points: Point[] = [];
    
    if (element.type === 'LINE' && element.start && element.end) {
        points.push(element.start, element.end);
    } else if (element.type === 'CIRCLE' && element.center && element.radius) {
        const r = element.radius;
        points.push(
            { x: element.center.x - r, y: element.center.y - r },
            { x: element.center.x + r, y: element.center.y + r }
        );
    } else if (element.type === 'RECTANGLE' && element.start && element.width && element.height) {
        points.push(
            element.start,
            { x: element.start.x + element.width, y: element.start.y + element.height }
        );
    } else if (element.points) {
        points.push(...element.points);
    }
    
    return boundingBox(points);
}

// ==================== 辅助工具 ====================

/**
 * 判断两个数是否近似相等
 */
export function approximatelyEqual(a: number, b: number, tolerance: number = 0.001): boolean {
    return Math.abs(a - b) < tolerance;
}

/**
 * 判断两个点是否近似相等
 */
export function pointsApproximatelyEqual(p1: Point, p2: Point, tolerance: number = 0.001): boolean {
    return approximatelyEqual(p1.x, p2.x, tolerance) && 
           approximatelyEqual(p1.y, p2.y, tolerance);
}

/**
 * 将角度限制在0-360范围内
 */
export function normalizeAngle(angle: number): number {
    angle = angle % 360;
    if (angle < 0) angle += 360;
    return angle;
}

/**
 * 度转弧度
 */
export function degreesToRadians(degrees: number): number {
    return degrees * Math.PI / 180;
}

/**
 * 弧度转度
 */
export function radiansToDegrees(radians: number): number {
    return radians * 180 / Math.PI;
}
