/**
 * canvasGeometry.ts — 画布交互相关的纯几何工具
 *
 * 从 Canvas 组件中抽出的距离计算、捕捉点、命中测试与缩放参考半径，
 * 保持无 React 依赖，便于单元测试与复用。
 */

import { CADElement, Point } from "../types";
import { getElementBoundingBox } from "./geometry";
import { getElementsCentroid } from "./transform";

/** 两点间距离 */
export const dist = (p1: Point, p2: Point): number =>
    Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

/**
 * 计算缩放交互的参考半径。
 * 取基点至选中对象形心、以及包围盒半对角线中的较大值，避免基点在形心上时除零。
 */
export const getScaleReference = (base: Point, targets: CADElement[]): number => {
    const centroid = getElementsCentroid(targets);

    // 直接使用元素包围盒（圆/圆弧包含半径范围），避免仅取形心导致参考半径退化为 0；
    // 过滤暂不支持包围盒计算的元素（返回零尺寸），防止原点被错误计入范围
    const boxes = targets
        .map(el => getElementBoundingBox(el))
        .filter(b => b.maxX > b.minX || b.maxY > b.minY);
    const minX = boxes.length > 0 ? Math.min(...boxes.map(b => b.minX)) : centroid.x;
    const minY = boxes.length > 0 ? Math.min(...boxes.map(b => b.minY)) : centroid.y;
    const maxX = boxes.length > 0 ? Math.max(...boxes.map(b => b.maxX)) : centroid.x;
    const maxY = boxes.length > 0 ? Math.max(...boxes.map(b => b.maxY)) : centroid.y;
    const halfDiagonal = Math.hypot(maxX - minX, maxY - minY) / 2;

    return Math.max(dist(base, centroid), halfDiagonal, 1);
};

/**
 * 根据光标与基点的距离计算缩放倍率。
 * 限制在 0.01～100 之间，避免一次误操作产生退化或超大图形。
 */
export const getScaleFactor = (base: Point, cursor: Point, targets: CADElement[]): number => {
    const factor = dist(base, cursor) / getScaleReference(base, targets);
    return Math.min(Math.max(factor, 0.01), 100);
};

/** 收集元素的捕捉点（端点、中点、中心、象限点等） */
export const getSnapPoints = (element: CADElement): Point[] => {
    const points: Point[] = [];
    if (element.type === 'LINE' && element.start && element.end) {
        points.push(element.start, element.end, { x: (element.start.x + element.end.x) / 2, y: (element.start.y + element.end.y) / 2 });
    } else if (element.type === 'RECTANGLE' && element.start && element.width !== undefined && element.height !== undefined) {
        points.push(
            element.start,
            { x: element.start.x + element.width, y: element.start.y },
            { x: element.start.x + element.width, y: element.start.y + element.height },
            { x: element.start.x, y: element.start.y + element.height }
        );
    } else if ((element.type === 'CIRCLE' || element.type === 'ARC') && element.center) {
        points.push(element.center);
        if (element.radius) {
            points.push({ x: element.center.x + element.radius, y: element.center.y });
            points.push({ x: element.center.x - element.radius, y: element.center.y });
            points.push({ x: element.center.x, y: element.center.y + element.radius });
            points.push({ x: element.center.x, y: element.center.y - element.radius });
        }
    } else if (element.type === 'TEXT' && element.start) {
        points.push(element.start);
    } else if (element.type === 'LWPOLYLINE' && element.points) {
        points.push(...element.points);
    } else if ((element.type === 'GEAR' || element.type === 'SPIRAL' || element.type === 'SPRING' || element.type === 'ELLIPSE') && element.points) {
        // 高级曲线：中心 + 首/中/尾采样点
        if (element.center) points.push(element.center);
        if (element.points.length > 0) {
            points.push(element.points[0]);
            if (element.points.length > 1) points.push(element.points[Math.floor(element.points.length / 2)]);
            if (element.points.length > 2) points.push(element.points[element.points.length - 1]);
        }
    }
    return points;
};

/**
 * 判断点是否落在元素上。
 * @param tolerance 命中容差（世界单位），由交互层按屏幕像素换算，保证缩放后手感一致
 */
export const isPointOnElement = (rawPt: Point, el: CADElement, tolerance = 5): boolean => {
    // 点到线段的距离
    const distToSeg = (p: Point, s1: Point, s2: Point) => {
        const l2 = Math.pow(dist(s1, s2), 2);
        if (l2 === 0) return dist(p, s1);
        const t = ((p.x - s1.x) * (s2.x - s1.x) + (p.y - s1.y) * (s2.y - s1.y)) / l2;
        const tClamped = Math.max(0, Math.min(1, t));
        const proj = { x: s1.x + tClamped * (s2.x - s1.x), y: s1.y + tClamped * (s2.y - s1.y) };
        return dist(p, proj);
    };

    /** 以包围盒作为拾取范围（文字、填充、块引用等） */
    const hitBox = (): boolean => {
        const box = getElementBoundingBox(el);
        if (box.maxX === box.minX && box.maxY === box.minY) return false;
        return rawPt.x >= box.minX - tolerance && rawPt.x <= box.maxX + tolerance &&
            rawPt.y >= box.minY - tolerance && rawPt.y <= box.maxY + tolerance;
    };

    if (el.type === 'LINE' && el.start && el.end) {
        return distToSeg(rawPt, el.start, el.end) <= tolerance;
    }
    if (el.type === 'CIRCLE' && el.center) {
        return Math.abs(dist(rawPt, el.center) - (el.radius || 0)) <= tolerance;
    }
    if (el.type === 'RECTANGLE' && el.start && el.width !== undefined && el.height !== undefined) {
        const x = el.start.x; const y = el.start.y;
        const w = el.width; const h = el.height;
        // 只检测四条边（描边命中），不检测填充区域
        if (distToSeg(rawPt, {x,y}, {x:x+w, y}) <= tolerance) return true;
        if (distToSeg(rawPt, {x,y:y+h}, {x:x+w, y:y+h}) <= tolerance) return true;
        if (distToSeg(rawPt, {x,y}, {x, y:y+h}) <= tolerance) return true;
        if (distToSeg(rawPt, {x:x+w,y}, {x:x+w, y:y+h}) <= tolerance) return true;
        return false;
    }
    if (el.type === 'LWPOLYLINE' && el.points) {
        for (let i = 0; i < el.points.length - 1; i++) {
            if (distToSeg(rawPt, el.points[i], el.points[i+1]) <= tolerance) return true;
        }
        if (el.closed && el.points.length > 2) {
            return distToSeg(rawPt, el.points[el.points.length - 1], el.points[0]) <= tolerance;
        }
        return false;
    }
    if (el.type === 'ARC' && el.center && el.radius) {
        return Math.abs(dist(rawPt, el.center) - el.radius) <= tolerance;
    }
    if (el.type === 'TEXT') {
        return hitBox() || (el.start ? dist(rawPt, el.start) <= tolerance : false);
    }
    if (el.type === 'DIMENSION' && el.start && el.end) {
        if (distToSeg(rawPt, el.start, el.end) <= tolerance) return true;
        if (el.offsetPoint) {
            if (distToSeg(rawPt, el.start, el.offsetPoint) <= tolerance) return true;
            if (distToSeg(rawPt, el.end, el.offsetPoint) <= tolerance) return true;
        }
        return false;
    }
    if (el.type === 'HATCH' || el.type === 'BLOCK_REFERENCE') {
        return hitBox();
    }
    // 高级曲线按折线逐段判断
    if ((el.type === 'GEAR' || el.type === 'SPIRAL' || el.type === 'SPRING' || el.type === 'ELLIPSE') && el.points) {
        for (let i = 0; i < el.points.length - 1; i++) {
            if (distToSeg(rawPt, el.points[i], el.points[i+1]) <= tolerance) return true;
        }
        return false;
    }
    return false;
};
