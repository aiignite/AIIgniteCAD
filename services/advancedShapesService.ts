import { Point, CADElement } from '../types';

/**
 * 高级图形生成服务
 * 用于生成齿轮、渐开线、螺旋线等复杂图形
 */

/**
 * 生成渐开线齿轮
 * @param center 中心点
 * @param numTeeth 齿数
 * @param module 模数 (齿距/π)
 * @param pressureAngle 压力角 (度数，通常为20度)
 * @param color 颜色
 * @param layer 图层
 * @returns CADElement 齿轮元素
 */
export function generateGear(
    center: Point,
    numTeeth: number,
    module: number,
    pressureAngle: number = 20,
    color: string = "#8b949e",
    layer: string = "0"
): CADElement {
    const points: Point[] = [];
    
    // 计算基本参数
    const pitchRadius = (module * numTeeth) / 2;
    const baseRadius = pitchRadius * Math.cos(pressureAngle * Math.PI / 180);
    const addendum = module; // 齿顶高
    const dedendum = 1.25 * module; // 齿根高
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
