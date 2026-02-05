import { Point, CADElement } from '../types';

/**
 * OFFSET偏移服务
 * 创建与现有元素平行的副本
 */

const EPSILON = 1e-10;

/**
 * 创建与线段平行的线
 * @param start 起始点
 * @param end 结束点
 * @param distance 偏移距离（正数向左，负数向右）
 * @returns 新的线段
 */
export function offsetLine(start: Point, end: Point, distance: number): CADElement {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < EPSILON) {
    return {
      id: Math.random().toString(36).substr(2, 9),
      type: 'LINE',
      layer: '0',
      color: '#e6edf3',
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y }
    };
  }

  const nx = -dy / len;
  const ny = dx / len;

  return {
    id: Math.random().toString(36).substr(2, 9),
    type: 'LINE',
    layer: '0',
    color: '#e6edf3',
    start: { x: start.x + nx * distance, y: start.y + ny * distance },
    end: { x: end.x + nx * distance, y: end.y + ny * distance }
  };
}

/**
 * 偏移圆
 * @param center 圆心
 * @param radius 半径
 * @param distance 偏移距离
 * @returns 新的圆
 */
export function offsetCircle(center: Point, radius: number, distance: number): CADElement {
  const newRadius = radius + distance;
  return {
    id: Math.random().toString(36).substr(2, 9),
    type: 'CIRCLE',
    layer: '0',
    color: '#e6edf3',
    center,
    radius: Math.abs(newRadius)
  };
}

/**
 * 偏移多段线（每条线段分别偏移）
 * @param points 多段线的点
 * @param distance 偏移距离
 * @returns 新的多段线
 */
export function offsetPolyline(points: Point[], distance: number): CADElement {
  if (points.length < 2) {
    return {
      id: Math.random().toString(36).substr(2, 9),
      type: 'LWPOLYLINE',
      layer: '0',
      color: '#e6edf3',
      points
    };
  }

  const newPoints: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < EPSILON) {
      newPoints.push({ ...p1 });
      continue;
    }

    const nx = -dy / len;
    const ny = dx / len;

    const offsetPoint: Point = {
      x: p1.x + nx * distance,
      y: p1.y + ny * distance
    };

    newPoints.push(offsetPoint);
  }

  return {
    id: Math.random().toString(36).substr(2, 9),
    type: 'LWPOLYLINE',
    layer: '0',
    color: '#e6edf3',
    points: newPoints
  };
}

/**
 * 偏移弧
 * @param center 圆心
 * @param radius 半径
 * @param startAngle 起始角度
 * @param endAngle 结束角度
 * @param clockwise 是否顺时针
 * @param distance 偏移距离
 * @returns 新的弧
 */
export function offsetArc(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  clockwise: boolean,
  distance: number
): CADElement {
  const newRadius = radius + distance;
  return {
    id: Math.random().toString(36).substr(2, 9),
    type: 'ARC',
    layer: '0',
    color: '#e6edf3',
    center,
    radius: Math.abs(newRadius),
    startAngle,
    endAngle,
    clockwise
  };
}

/**
 * 主函数：偏移CAD元素
 * @param element 要偏移的元素
 * @param distance 偏移距离（正数向内，负数向外）
 * @returns 偏移后的新元素
 */
export function offsetElement(element: CADElement, distance: number): CADElement {
  switch (element.type) {
    case 'LINE':
      if (element.start && element.end) {
        return offsetLine(element.start, element.end, distance);
      }
      break;

    case 'CIRCLE':
      if (element.center && element.radius) {
        return offsetCircle(element.center, element.radius, distance);
      }
      break;

    case 'LWPOLYLINE':
      if (element.points) {
        return offsetPolyline(element.points, distance);
      }
      break;

    case 'ARC':
      if (element.center && element.radius && element.startAngle !== undefined && element.endAngle !== undefined) {
        return offsetArc(
          element.center,
          element.radius,
          element.startAngle,
          element.endAngle,
          element.clockwise || false,
          distance
        );
      }
      break;

    case 'RECTANGLE':
      if (element.start && element.width && element.height) {
        const p1 = element.start;
        const p2 = { x: element.start.x + element.width, y: element.start.y };
        const p3 = { x: element.start.x + element.width, y: element.start.y + element.height };
        const p4 = { x: element.start.x, y: element.start.y + element.height };

        const line1 = offsetLine(p1, p2, distance);
        const line2 = offsetLine(p2, p3, distance);
        const line3 = offsetLine(p3, p4, distance);
        const line4 = offsetLine(p4, p1, distance);

        const pts: Point[] = [
          ...line1.start ? [line1.start!] : [],
          ...line1.end ? [line1.end!] : [],
          ...line2.start ? [line2.start!] : [],
          ...line2.end ? [line2.end!] : [],
          ...line3.start ? [line3.start!] : [],
          ...line3.end ? [line3.end!] : [],
          ...line4.start ? [line4.start!] : [],
          ...line4.end ? [line4.end!] : []
        ];

        return {
          id: Math.random().toString(36).substr(2, 9),
          type: 'LWPOLYLINE',
          layer: element.layer,
          color: element.color,
          points: pts
        };
      }
      break;

    default:
      console.warn(`Offset not supported for element type: ${element.type}`);
      return { ...element, id: Math.random().toString(36).substr(2, 9) };
  }

  return { ...element, id: Math.random().toString(36).substr(2, 9) };
}

/**
 * 批量偏移多个元素
 * @param elements 元素数组
 * @param distance 偏移距离
 * @returns 偏移后的新元素数组
 */
export function offsetElements(elements: CADElement[], distance: number): CADElement[] {
  return elements.map(el => offsetElement(el, distance));
}
