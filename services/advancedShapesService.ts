import { Point, CADElement } from '../types';
import { GEO_TOL, isFiniteNumber, isFinitePoint } from '../lib/geometryTolerance';

/**
 * 高级图形生成服务
 * 用于生成齿轮、渐开线、螺旋线等复杂图形
 *
 * ELLIPSE / GEAR / SPIRAL / SPRING 的参数化图元的显示几何（points）由参数派生，
 * 修改参数后必须调用 regenerateElement 重新派生轮廓，否则渲染、命中测试与
 * 导出会沿用旧几何。夹点拖动中心时只需平移轮廓，见 reconcileElement。
 */

/** 正数参数校验（排除 NaN / Infinity / 0 / 负数） */
const isPositive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > GEO_TOL.radius;

/**
 * 生成渐开线齿轮
 * @param center 中心点
 * @param numTeeth 齿数
 * @param module 模数 (齿距/π)
 * @param pressureAngle 压力角 (度数，通常为20度)
 * @param color 颜色
 * @param layer 图层
 * @param addendum 齿顶高（默认 = module）
 * @param dedendum 齿根高（默认 = 1.25 × module）
 * @returns CADElement 齿轮元素
 */
export function generateGear(
    center: Point,
    numTeeth: number,
    module: number,
    pressureAngle: number = 20,
    color: string = "#8b949e",
    layer: string = "0",
    addendum: number = module,
    dedendum: number = 1.25 * module
): CADElement {
    const points: Point[] = [];
    
    // 计算基本参数
    const pitchRadius = (module * numTeeth) / 2;
    const baseRadius = pitchRadius * Math.cos(pressureAngle * Math.PI / 180);
    const outerRadius = pitchRadius + addendum;
    const rootRadius = pitchRadius - dedendum;
    
    // 每个齿的角度
    const toothAngle = (2 * Math.PI) / numTeeth;
    
    // 生成齿轮轮廓
    for (let i = 0; i < numTeeth; i++) {
        const baseAngle = i * toothAngle;
        
        // 每个齿分为多个段
        const segments = 20; // 每个齿的分段数
        
        // 齿根圆弧
        for (let j = 0; j <= 5; j++) {
            const angle = baseAngle - toothAngle / 4 + (j / 5) * (toothAngle / 2);
            points.push({
                x: center.x + rootRadius * Math.cos(angle),
                y: center.y + rootRadius * Math.sin(angle)
            });
        }
        
        // 左侧渐开线
        for (let j = 1; j <= segments / 2; j++) {
            const t = j / (segments / 2);
            const involutePoint = getInvolutePoint(baseRadius, t, baseAngle - toothAngle / 8);
            if (getDistance({ x: 0, y: 0 }, involutePoint) >= rootRadius && 
                getDistance({ x: 0, y: 0 }, involutePoint) <= outerRadius) {
                points.push({
                    x: center.x + involutePoint.x,
                    y: center.y + involutePoint.y
                });
            }
        }
        
        // 齿顶圆弧
        for (let j = 0; j <= 3; j++) {
            const angle = baseAngle - toothAngle / 16 + (j / 3) * (toothAngle / 8);
            points.push({
                x: center.x + outerRadius * Math.cos(angle),
                y: center.y + outerRadius * Math.sin(angle)
            });
        }
        
        // 右侧渐开线
        for (let j = segments / 2; j >= 1; j--) {
            const t = j / (segments / 2);
            const involutePoint = getInvolutePoint(baseRadius, t, baseAngle + toothAngle / 8);
            if (getDistance({ x: 0, y: 0 }, involutePoint) >= rootRadius && 
                getDistance({ x: 0, y: 0 }, involutePoint) <= outerRadius) {
                points.push({
                    x: center.x + involutePoint.x,
                    y: center.y + involutePoint.y
                });
            }
        }
    }
    
    // 闭合路径
    if (points.length > 0) {
        points.push({ ...points[0] });
    }
    
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: "GEAR",
        center,
        points,
        numTeeth,
        module,
        pressureAngle,
        radius: pitchRadius,
        layer,
        color
    };
}

/**
 * 计算渐开线上的点
 * @param baseRadius 基圆半径
 * @param t 参数 (0-1)
 * @param offsetAngle 偏移角度
 * @returns Point 渐开线上的点
 */
function getInvolutePoint(baseRadius: number, t: number, offsetAngle: number): Point {
    const theta = t * Math.PI / 2; // 展开角度
    const x = baseRadius * (Math.cos(theta) + theta * Math.sin(theta));
    const y = baseRadius * (Math.sin(theta) - theta * Math.cos(theta));
    
    // 旋转到正确的位置
    const rotatedX = x * Math.cos(offsetAngle) - y * Math.sin(offsetAngle);
    const rotatedY = x * Math.sin(offsetAngle) + y * Math.cos(offsetAngle);
    
    return { x: rotatedX, y: rotatedY };
}

/**
 * 生成渐开线曲线
 * @param center 中心点
 * @param baseRadius 基圆半径
 * @param turns 圈数
 * @param color 颜色
 * @param layer 图层
 * @returns CADElement 渐开线元素
 */
export function generateInvolute(
    center: Point,
    baseRadius: number,
    turns: number = 2,
    color: string = "#8b949e",
    layer: string = "0"
): CADElement {
    const points: Point[] = [];
    const segments = 100 * turns;
    
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * turns;
        const theta = t * 2 * Math.PI;
        const x = baseRadius * (Math.cos(theta) + theta * Math.sin(theta));
        const y = baseRadius * (Math.sin(theta) - theta * Math.cos(theta));
        
        points.push({
            x: center.x + x,
            y: center.y + y
        });
    }
    
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: "LWPOLYLINE",
        points,
        layer,
        color
    };
}

/**
 * 生成阿基米德螺旋线
 * @param center 中心点
 * @param startRadius 起始半径
 * @param turns 圈数
 * @param radiusIncrement 每圈半径增量
 * @param color 颜色
 * @param layer 图层
 * @returns CADElement 螺旋线元素
 */
export function generateSpiral(
    center: Point,
    startRadius: number,
    turns: number,
    radiusIncrement: number,
    color: string = "#8b949e",
    layer: string = "0"
): CADElement {
    const points: Point[] = [];
    const segments = 100 * turns;
    
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = t * turns * 2 * Math.PI;
        const radius = startRadius + (radiusIncrement * t * turns);
        
        points.push({
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle)
        });
    }
    
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: "SPIRAL",
        points,
        turns,
        radiusIncrement,
        startRadius,
        layer,
        color
    };
}

/**
 * 生成弹簧
 * @param start 起始点
 * @param end 结束点
 * @param coils 圈数
 * @param springRadius 弹簧半径
 * @param color 颜色
 * @param layer 图层
 * @returns CADElement 弹簧元素
 */
export function generateSpring(
    start: Point,
    end: Point,
    coils: number,
    springRadius: number,
    color: string = "#8b949e",
    layer: string = "0"
): CADElement {
    const points: Point[] = [];
    
    // 计算弹簧的方向和长度
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    
    const segments = 50 * coils;
    
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const z = t * length; // 沿轴向的位置
        const theta = t * coils * 2 * Math.PI; // 旋转角度
        
        // 螺旋线的径向位移
        const r = springRadius * Math.sin(theta);
        
        // 在局部坐标系中的点
        const localX = z;
        const localY = r;
        
        // 旋转到正确的角度
        const x = start.x + localX * Math.cos(angle) - localY * Math.sin(angle);
        const y = start.y + localX * Math.sin(angle) + localY * Math.cos(angle);
        
        points.push({ x, y });
    }
    
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: "SPRING",
        start,
        end,
        points,
        coils,
        springRadius,
        layer,
        color
    };
}

/**
 * 生成正多边形
 * @param center 中心点
 * @param radius 外接圆半径
 * @param sides 边数
 * @param rotation 旋转角度（度）
 * @param color 颜色
 * @param layer 图层
 * @returns CADElement 多边形元素
 */
export function generatePolygon(
    center: Point,
    radius: number,
    sides: number,
    rotation: number = 0,
    color: string = "#8b949e",
    layer: string = "0"
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
        id: Math.random().toString(36).substr(2, 9),
        type: "LWPOLYLINE",
        points,
        layer,
        color
    };
}

/**
 * 生成椭圆
 * @param center 中心点
 * @param radiusX X轴半径
 * @param radiusY Y轴半径
 * @param rotation 旋转角度（度）
 * @param color 颜色
 * @param layer 图层
 * @returns CADElement 椭圆元素
 */
export function generateEllipse(
    center: Point,
    radiusX: number,
    radiusY: number,
    rotation: number = 0,
    color: string = "#8b949e",
    layer: string = "0"
): CADElement {
    const points: Point[] = [];
    const segments = 64;
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
        id: Math.random().toString(36).substr(2, 9),
        type: "ELLIPSE",
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
 * 计算两点之间的距离
 */
function getDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================================
// 参数化图元：几何重算与同步
// ============================================================================

/** 显示几何（points）由参数派生的图元类型 */
const PARAM_BASED_TYPES = new Set<CADElement["type"]>(["ELLIPSE", "GEAR", "SPIRAL", "SPRING"]);

export const isParamBasedShape = (element: CADElement): boolean =>
    PARAM_BASED_TYPES.has(element.type);

/** 形状参数（决定轮廓的形状，与位置无关）是否一致 */
const shapeParamsEqual = (a: CADElement, b: CADElement): boolean => {
    switch (a.type) {
        case "ELLIPSE":
            return (
                a.radiusX === b.radiusX &&
                a.radiusY === b.radiusY &&
                (a.rotation ?? 0) === (b.rotation ?? 0)
            );
        case "GEAR":
            return (
                a.numTeeth === b.numTeeth &&
                a.module === b.module &&
                (a.pressureAngle ?? 20) === (b.pressureAngle ?? 20) &&
                a.addendum === b.addendum &&
                a.dedendum === b.dedendum
            );
        case "SPIRAL":
            return (
                a.turns === b.turns &&
                a.radiusIncrement === b.radiusIncrement &&
                a.startRadius === b.startRadius
            );
        case "SPRING":
            return a.coils === b.coils && a.springRadius === b.springRadius;
        default:
            return true;
    }
};

/** 螺旋线起始半径：优先取存储值，旧存档从轮廓首点相对圆心的距离推导 */
const resolveSpiralStartRadius = (element: CADElement): number | null => {
    if (isPositive(element.startRadius)) return element.startRadius;
    const first = element.points?.[0];
    if (!element.center || !first) return null;
    const radius = getDistance(element.center, first);
    return isPositive(radius) ? radius : null;
};

/**
 * 按当前参数重新生成参数化图元的轮廓（points）。
 *
 * 用于属性面板修改参数后的重算。参数非法（非有限数值、齿数过小、
 * 偏移后半径非正等）时保持元素原样返回，不产生不可绘制的几何。
 */
export function regenerateElement(element: CADElement): CADElement {
    switch (element.type) {
        case "ELLIPSE": {
            const { center, radiusX, radiusY } = element;
            if (!isFinitePoint(center) || !isPositive(radiusX) || !isPositive(radiusY)) {
                return element;
            }
            const rotation = isFiniteNumber(element.rotation) ? element.rotation : 0;
            const regenerated = generateEllipse(center, radiusX, radiusY, rotation, element.color, element.layer);
            return { ...element, points: regenerated.points };
        }

        case "GEAR": {
            const { center, numTeeth, module: gearModule, pressureAngle, addendum, dedendum } = element;
            if (!isFinitePoint(center) || !isPositive(gearModule)) return element;
            if (!isFiniteNumber(numTeeth) || !Number.isInteger(numTeeth) || numTeeth < 3) {
                return element;
            }
            const angle = isFiniteNumber(pressureAngle) ? pressureAngle : 20;
            if (!(angle > 0 && angle < 90)) return element;
            // 齿顶高 / 齿根高缺省时按模数推导；显式提供时必须为正
            const toothAddendum = addendum === undefined ? gearModule : addendum;
            const toothDedendum = dedendum === undefined ? 1.25 * gearModule : dedendum;
            if (!isPositive(toothAddendum) || !isPositive(toothDedendum)) return element;
            // 齿根圆必须为正，否则轮廓自交
            if ((gearModule * numTeeth) / 2 - toothDedendum <= 0) return element;

            const regenerated = generateGear(
                center,
                numTeeth,
                gearModule,
                angle,
                element.color,
                element.layer,
                toothAddendum,
                toothDedendum,
            );
            return { ...element, points: regenerated.points, radius: regenerated.radius };
        }

        case "SPIRAL": {
            const { center, turns, radiusIncrement } = element;
            if (!isFinitePoint(center) || !isPositive(turns)) return element;
            const startRadius = resolveSpiralStartRadius(element);
            if (startRadius === null) return element;
            const increment = isFiniteNumber(radiusIncrement) ? radiusIncrement : 0;
            // 末圈半径必须保持为正，避免螺旋线翻转
            if (startRadius + increment * turns <= 0) return element;

            const regenerated = generateSpiral(center, startRadius, turns, increment, element.color, element.layer);
            return { ...element, points: regenerated.points };
        }

        case "SPRING": {
            const { start, end, coils, springRadius } = element;
            if (!isFinitePoint(start) || !isFinitePoint(end)) return element;
            if (!isPositive(coils) || !isPositive(springRadius)) return element;
            const regenerated = generateSpring(start, end, coils, springRadius, element.color, element.layer);
            return { ...element, points: regenerated.points };
        }

        default:
            return element;
    }
}

/** 参数化图元的平移量；无法判定唯一平移时返回 null */
const translationDelta = (previous: CADElement, next: CADElement): Point | null => {
    if (next.type === "SPRING") {
        if (!previous.start || !next.start || !previous.end || !next.end) return null;
        const fromStart = { x: next.start.x - previous.start.x, y: next.start.y - previous.start.y };
        const fromEnd = { x: next.end.x - previous.end.x, y: next.end.y - previous.end.y };
        // 起终点同向同距移动视为整体平移，否则按参数变化重算
        if (Math.abs(fromStart.x - fromEnd.x) > GEO_TOL.point) return null;
        if (Math.abs(fromStart.y - fromEnd.y) > GEO_TOL.point) return null;
        return fromStart;
    }
    if (!previous.center || !next.center) return null;
    return { x: next.center.x - previous.center.x, y: next.center.y - previous.center.y };
};

/**
 * 用 next 的更新对齐 previous 的派生几何。
 *
 * - 仅位置变化（夹点移中心）：平移轮廓，保留手工编辑过的顶点；
 * - 形状参数变化（属性面板）：按参数重新生成轮廓；
 * - 非参数化图元或参数非法：原样返回 next。
 */
export function reconcileElement(previous: CADElement, next: CADElement): CADElement {
    if (next.type !== previous.type || !isParamBasedShape(next)) return next;

    if (shapeParamsEqual(previous, next)) {
        const delta = translationDelta(previous, next);
        if (!delta || (delta.x === 0 && delta.y === 0) || !next.points) return next;
        return {
            ...next,
            points: next.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
        };
    }

    return regenerateElement(next);
}
