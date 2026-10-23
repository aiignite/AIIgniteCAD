import { Point, CADElement, HatchPattern, HatchPatternType } from '../types';

/**
 * HATCH填充生成服务
 * 支持多种填充图案和实体填充
 */

/**
 * 创建HATCH填充元素
 * @param boundaryElements 边界元素（构成填充区域的元素）
 * @param pattern 填充图案配置
 * @param color 填充颜色
 * @param layer 图层
 * @returns CADElement HATCH元素
 */
export function createHatch(
  boundaryElements: CADElement[],
  pattern: HatchPattern,
  color: string = "#4a5568",
  layer: string = "0"
): CADElement {
  return {
    id: Math.random().toString(36).substr(2, 9),
    type: "HATCH",
    layer,
    color,
    hatchPattern: pattern,
    hatchAngle: pattern.angle || 0,
    hatchScale: 1,
    // 存储边界元素用于渲染
    points: extractBoundaryPoints(boundaryElements)
  };
}

/**
 * 从边界元素提取点集
 * 用于确定填充区域
 */
function extractBoundaryPoints(elements: CADElement[]): Point[] {
  const points: Point[] = [];

  for (const el of elements) {
    if (el.type === 'LINE' && el.start && el.end) {
      points.push(el.start, el.end);
    } else if (el.type === 'LWPOLYLINE' && el.points) {
      points.push(...el.points);
    } else if (el.type === 'RECTANGLE' && el.start && el.width !== undefined && el.height !== undefined) {
      const x = el.width > 0 ? el.start.x : el.start.x + el.width;
      const y = el.height > 0 ? el.start.y : el.start.y + el.height;
      const w = Math.abs(el.width);
      const h = Math.abs(el.height);
      points.push(
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h }
      );
    } else if (el.type === 'CIRCLE' && el.center && el.radius) {
      // 对于圆，生成近似边界点
      const segments = 32;
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        points.push({
          x: el.center.x + el.radius * Math.cos(angle),
          y: el.center.y + el.radius * Math.sin(angle)
        });
      }
    } else if (el.type === 'ARC' && el.center && el.radius) {
      // 对于圆弧，生成近似边界点
      const startAngle = (el.startAngle || 0) * Math.PI / 180;
      const endAngle = (el.endAngle || 90) * Math.PI / 180;
      const isClockwise = el.clockwise || false;
      const segments = 16;

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        let angle;
        if (isClockwise) {
          angle = startAngle + t * (endAngle - startAngle);
        } else {
          // Normalize angles to ensure proper sweep
          let diff = endAngle - startAngle;
          while (diff < 0) diff += 2 * Math.PI;
          angle = startAngle + t * diff;
        }
        points.push({
          x: el.center.x + el.radius * Math.cos(angle),
          y: el.center.y + el.radius * Math.sin(angle)
        });
      }
    } else if (el.type === 'ELLIPSE' && el.center && el.radiusX && el.radiusY) {
      const rotation = (el.rotation || 0) * Math.PI / 180;
      const segments = 64;
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = el.radiusX * Math.cos(angle);
        const y = el.radiusY * Math.sin(angle);
        // 旋转
        const rotatedX = x * Math.cos(rotation) - y * Math.sin(rotation);
        const rotatedY = x * Math.sin(rotation) + y * Math.cos(rotation);
        points.push({
          x: el.center.x + rotatedX,
          y: el.center.y + rotatedY
        });
      }
    }
  }

  return points;
}

/**
 * 生成填充图案的SVG路径数据
 * @param pattern 填充图案类型
 * @param bounds 边界矩形 {minX, minY, maxX, maxY}
 * @param spacing 线条间距
 * @param angle 旋转角度（度）
 * @returns SVG path d属性字符串
 */
export function generateHatchPattern(
  pattern: HatchPatternType,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  spacing: number = 10,
  angle: number = 0
): string {
  const { minX, minY, maxX, maxY } = bounds;
  const width = maxX - minX;
  const height = maxY - minY;

  if (pattern === 'SOLID') {
    return `M ${minX} ${minY} L ${maxX} ${minY} L ${maxX} ${maxY} L ${minX} ${maxY} Z`;
  }

  const angleRad = angle * Math.PI / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const transformPoint = (x: number, y: number) => {
    const cx = minX + width / 2;
    const cy = minY + height / 2;
    const dx = x - cx;
    const dy = y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos
    };
  };

  let paths = '';

  switch (pattern) {
    case 'HORIZONTAL':
      for (let y = minY; y <= maxY; y += spacing) {
        const p1 = transformPoint(minX, y);
        const p2 = transformPoint(maxX, y);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'VERTICAL':
      for (let x = minX; x <= maxX; x += spacing) {
        const p1 = transformPoint(x, minY);
        const p2 = transformPoint(x, maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'DIAGONAL_RIGHT':
      for (let offset = -height; offset < width; offset += spacing) {
        const p1 = transformPoint(Math.max(minX, minX + offset), minY);
        const p2 = transformPoint(Math.min(maxX, minX + offset + height), maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'DIAGONAL_LEFT':
      for (let offset = -height; offset < width; offset += spacing) {
        const p1 = transformPoint(Math.min(maxX, maxX - offset), minY);
        const p2 = transformPoint(Math.max(minX, maxX - offset - height), maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'CROSS':
      for (let y = minY; y <= maxY; y += spacing) {
        const p1 = transformPoint(minX, y);
        const p2 = transformPoint(maxX, y);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      for (let x = minX; x <= maxX; x += spacing) {
        const p1 = transformPoint(x, minY);
        const p2 = transformPoint(x, maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'GRID':
      for (let y = minY; y <= maxY; y += spacing) {
        const p1 = transformPoint(minX, y);
        const p2 = transformPoint(maxX, y);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      for (let x = minX; x <= maxX; x += spacing) {
        const p1 = transformPoint(x, minY);
        const p2 = transformPoint(x, maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'DOT':
      for (let y = minY + spacing / 2; y < maxY; y += spacing) {
        for (let x = minX + spacing / 2; x < maxX; x += spacing) {
          const p = transformPoint(x, y);
          paths += `M ${p.x} ${p.y} m 0 0.5 a 0.5 0.5 0 1 0 -1 0 a 0.5 0.5 0 1 0 1 0 `;
        }
      }
      break;

    case 'ANSI31':
      for (let offset = -height; offset < width + height; offset += spacing * 2) {
        const p1 = transformPoint(Math.max(minX, minX + offset), minY);
        const p2 = transformPoint(Math.min(maxX, minX + offset + height), maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'ANSI32':
      for (let x = minX; x <= maxX; x += spacing) {
        const p1 = transformPoint(x, minY);
        const p2 = transformPoint(x, maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      for (let y = minY; y <= maxY; y += spacing * 2) {
        const p1 = transformPoint(minX, y);
        const p2 = transformPoint(maxX, y);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'ISO02W100':
      for (let offset = -height; offset < width + height; offset += spacing) {
        const p1 = transformPoint(Math.max(minX, minX + offset), minY);
        const p2 = transformPoint(Math.min(maxX, minX + offset + height), maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    default:
      break;
  }

  return paths;
}

/**
 * 计算边界元素的矩形包围盒
 */
export function calculateHatchBounds(elements: CADElement[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const points = extractBoundaryPoints(elements);
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }

  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return { minX, minY, maxX, maxY };
}
