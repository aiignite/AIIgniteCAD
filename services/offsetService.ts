import { Point, CADElement } from '../types';
import {
    GEO_TOL,
    isDegenerateRadius,
    isDegenerateSegment,
    isValidOffsetDistance,
    lineLineIntersectionPoint,
} from '../lib/geometryTolerance';

/**
 * OFFSET 偏移服务
 *
 * 创建与现有对象平行的副本。距离为正时向线段行进方向的左侧偏移
 * （LINE 由 start→end 决定，闭合多段线由顶点顺序决定），与 AutoCAD 的
 * "through point" 语义不同：方向由几何方向决定，点击只用于量取距离。
 *
 * 几何约定：
 * - LINE / LWPOLYLINE 按线段法向平移，相邻偏移段在顶点处求交，
 *   避免开放多段线被当作闭合、凹角出现尖刺或间隙；
 * - CIRCLE / ARC / RECTANGLE 偏移后保持原类型与参数化结构；
 * - 退化输入（零长线段、偏移后半径非正、矩形退化）返回失败而不是
 *   静默生成重叠副本或翻转半径。
 */

const uid = () => Math.random().toString(36).substr(2, 9);

/** 单个图元偏移失败的原因（稳定标识，供工具提示与测试断言） */
export type OffsetFailureReason =
    | 'unsupported-type'
    | 'degenerate-geometry'
    | 'non-positive-radius';

export interface OffsetFailure {
    id: string;
    type: CADElement['type'];
    reason: OffsetFailureReason;
}

export interface OffsetOutcome {
    /** 偏移成功的副本 */
    elements: CADElement[];
    /** 失败清单：调用方应明确告知用户，不能静默丢弃 */
    failures: OffsetFailure[];
}

/** 线段的单位法向（行进方向左侧）；零长线段返回 null */
const segmentNormal = (start: Point, end: Point): Point | null => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < GEO_TOL.segmentLength) return null;
    return { x: -dy / len, y: dx / len };
};

/**
 * 创建与线段平行的线
 * @param start 起始点
 * @param end 结束点
 * @param distance 偏移距离（正数向左，负数向右）
 * @returns 新的线段；输入退化时返回 null
 */
export function offsetLine(start: Point, end: Point, distance: number): CADElement | null {
    if (!isValidOffsetDistance(distance)) return null;
    const normal = segmentNormal(start, end);
    if (!normal) return null;

    return {
        id: uid(),
        type: 'LINE',
        layer: '0',
        color: '#e6edf3',
        start: { x: start.x + normal.x * distance, y: start.y + normal.y * distance },
        end: { x: end.x + normal.x * distance, y: end.y + normal.y * distance },
    };
}

/**
 * 偏移圆
 * @returns 新的圆；偏移后半径非正时返回 null（不允许圆翻面）
 */
export function offsetCircle(center: Point, radius: number, distance: number): CADElement | null {
    if (!isValidOffsetDistance(distance)) return null;
    if (isDegenerateRadius(radius)) return null;
    const newRadius = radius + distance;
    if (isDegenerateRadius(newRadius)) return null;

    return {
        id: uid(),
        type: 'CIRCLE',
        layer: '0',
        color: '#e6edf3',
        center: { x: center.x, y: center.y },
        radius: newRadius,
    };
}

/**
 * 偏移多段线：逐段平移后在顶点处求交。
 *
 * - 开放多段线按 N-1 段处理（不再绕回起点）；
 * - 闭合多段线按 N 段处理，首尾顶点同样求交；
 * - 相邻偏移段平行时回退为该顶点的平移点（共线延续时结果精确）；
 * - 连续重复点先去除，避免零长段污染法向计算。
 *
 * @returns 新的多段线；点数不足或距离无效时返回 null
 */
export function offsetPolyline(
    points: Point[],
    distance: number,
    closed = false,
): CADElement | null {
    if (!isValidOffsetDistance(distance)) return null;

    // 去除连续重复点
    const cleaned: Point[] = [];
    for (const point of points) {
        const previous = cleaned[cleaned.length - 1];
        if (previous && isDegenerateSegment(previous, point)) continue;
        cleaned.push({ x: point.x, y: point.y });
    }
    if (closed && cleaned.length > 1) {
        const first = cleaned[0];
        const last = cleaned[cleaned.length - 1];
        if (isDegenerateSegment(first, last)) cleaned.pop();
    }
    if (cleaned.length < 2) return null;

    const count = cleaned.length;
    const segmentCount = closed ? count : count - 1;

    // 每段平移后的起终点
    const offsetSegments: Array<{ a: Point; b: Point } | null> = [];
    for (let i = 0; i < segmentCount; i++) {
        const start = cleaned[i];
        const end = cleaned[(i + 1) % count];
        const normal = segmentNormal(start, end);
        if (!normal) {
            offsetSegments.push(null);
            continue;
        }
        offsetSegments.push({
            a: { x: start.x + normal.x * distance, y: start.y + normal.y * distance },
            b: { x: end.x + normal.x * distance, y: end.y + normal.y * distance },
        });
    }

    const newPoints: Point[] = [];
    for (let vertex = 0; vertex < count; vertex++) {
        // 开放多段线：首末顶点直接取相邻段的平移端点
        if (!closed && vertex === 0) {
            const first = offsetSegments[0];
            if (!first) return null;
            newPoints.push(first.a);
            continue;
        }
        if (!closed && vertex === count - 1) {
            const last = offsetSegments[segmentCount - 1];
            if (!last) return null;
            newPoints.push(last.b);
            continue;
        }

        const previousIndex = (vertex - 1 + segmentCount) % segmentCount;
        const currentIndex = vertex % segmentCount;
        const previous = offsetSegments[previousIndex];
        const current = offsetSegments[currentIndex];
        if (!previous || !current) {
            // 相邻段退化：回退为该顶点的平移点
            const source = cleaned[vertex];
            newPoints.push({ x: source.x, y: source.y });
            continue;
        }

        const intersection = lineLineIntersectionPoint(previous.a, previous.b, current.a, current.b);
        if (intersection) {
            newPoints.push(intersection);
        } else {
            // 平行（共线延续或反向尖刺）：取当前段平移后的顶点
            newPoints.push(current.a);
        }
    }

    if (newPoints.length < 2) return null;

    return {
        id: uid(),
        type: 'LWPOLYLINE',
        layer: '0',
        color: '#e6edf3',
        points: newPoints,
        ...(closed ? { closed: true } : {}),
    };
}

/**
 * 偏移弧
 * @returns 新的弧；偏移后半径非正时返回 null
 */
export function offsetArc(
    center: Point,
    radius: number,
    startAngle: number,
    endAngle: number,
    clockwise: boolean,
    distance: number,
): CADElement | null {
    if (!isValidOffsetDistance(distance)) return null;
    if (isDegenerateRadius(radius)) return null;
    const newRadius = radius + distance;
    if (isDegenerateRadius(newRadius)) return null;

    return {
        id: uid(),
        type: 'ARC',
        layer: '0',
        color: '#e6edf3',
        center: { x: center.x, y: center.y },
        radius: newRadius,
        startAngle,
        endAngle,
        clockwise,
    };
}

/** 矩形的规范化参数（左上角 + 正宽高）；宽高退化时返回 null */
const normalizeRectangle = (
    start: Point,
    width: number,
    height: number,
): { x: number; y: number; width: number; height: number } | null => {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    const w = Math.abs(width);
    const h = Math.abs(height);
    if (w < GEO_TOL.segmentLength || h < GEO_TOL.segmentLength) return null;
    return {
        x: Math.min(start.x, start.x + width),
        y: Math.min(start.y, start.y + height),
        width: w,
        height: h,
    };
};

/**
 * 主函数：偏移单个 CAD 元素
 * @param element 要偏移的元素
 * @param distance 偏移距离（正数向左，负数向右）
 * @returns 偏移后的新元素；不支持或退化时返回 null
 */
export function offsetElement(element: CADElement, distance: number): CADElement | null {
    if (!isValidOffsetDistance(distance)) return null;

    switch (element.type) {
        case 'LINE':
            if (element.start && element.end) {
                return offsetLine(element.start, element.end, distance);
            }
            return null;

        case 'CIRCLE':
            if (element.center && element.radius !== undefined) {
                return offsetCircle(element.center, element.radius, distance);
            }
            return null;

        case 'ARC':
            if (
                element.center &&
                element.radius !== undefined &&
                element.startAngle !== undefined &&
                element.endAngle !== undefined
            ) {
                return offsetArc(
                    element.center,
                    element.radius,
                    element.startAngle,
                    element.endAngle,
                    element.clockwise || false,
                    distance,
                );
            }
            return null;

        case 'LWPOLYLINE':
            if (element.points) {
                return offsetPolyline(element.points, distance, Boolean(element.closed));
            }
            return null;

        case 'RECTANGLE': {
            if (!element.start || element.width === undefined || element.height === undefined) {
                return null;
            }
            const rect = normalizeRectangle(element.start, element.width, element.height);
            if (!rect) return null;

            // 轴对齐矩形的平行偏移仍是轴对齐矩形：正距离向内收缩。
            // 直接按边长推导，避免偏移越界（上下/左右边穿越）时
            // 对自交多边形取包围盒得到"假矩形"。
            const newWidth = rect.width - 2 * distance;
            const newHeight = rect.height - 2 * distance;
            if (newWidth < GEO_TOL.segmentLength || newHeight < GEO_TOL.segmentLength) {
                return null;
            }
            return {
                id: uid(),
                type: 'RECTANGLE',
                layer: element.layer,
                color: element.color,
                start: { x: rect.x + distance, y: rect.y + distance },
                width: newWidth,
                height: newHeight,
            };
        }

        default:
            // TEXT / DIMENSION / HATCH / BLOCK_REFERENCE / 高级曲线等不支持偏移：
            // 由调用方汇总为失败清单并提示用户，不再静默返回原对象副本
            return null;
    }
}

/**
 * 批量偏移多个元素
 * @returns 成功副本与失败清单；失败不会中断其余元素的偏移
 */
export function offsetElements(elements: CADElement[], distance: number): OffsetOutcome {
    const outcome: OffsetOutcome = { elements: [], failures: [] };
    if (!isValidOffsetDistance(distance)) {
        for (const element of elements) {
            outcome.failures.push({
                id: element.id,
                type: element.type,
                reason: 'degenerate-geometry',
            });
        }
        return outcome;
    }

    for (const element of elements) {
        const offset = offsetElement(element, distance);
        if (offset) {
            outcome.elements.push(offset);
            continue;
        }
        outcome.failures.push({
            id: element.id,
            type: element.type,
            reason:
                element.type === 'CIRCLE' ||
                element.type === 'ARC' ||
                element.type === 'RECTANGLE'
                    ? 'non-positive-radius'
                    : element.type === 'LINE' ||
                        element.type === 'LWPOLYLINE'
                      ? 'degenerate-geometry'
                      : 'unsupported-type',
        });
    }
    return outcome;
}
