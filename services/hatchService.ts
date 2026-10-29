import { Point, CADElement, HatchPattern, HatchPatternType } from '../types';

/**
 * HATCH填充生成服务
 * 支持多种填充图案和实体填充
 */

/** 默认填充间距（世界单位）；用户未指定或非法时使用 */
export const DEFAULT_HATCH_SPACING = 10;

/** 单张填充最多生成的图案线数量，防止把间距填成 0.1 时卡死画布 */
const MAX_PATTERN_LINES = 4000;

/** 间距必须是有限正数，否则回落到默认值 */
export function normalizeHatchSpacing(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HATCH_SPACING;
  }
  return parsed;
}

/**
 * 图元实际使用的填充间距（世界单位）。
 * 优先用户设定；旧存档没有 spacing 时回落到 hatchScale × 默认间距。
 */
export function hatchSpacingOf(element: CADElement): number {
  const spacing = element.hatchPattern?.spacing;
  if (typeof spacing === 'number' && Number.isFinite(spacing) && spacing > 0) {
    return spacing;
  }
  const scale = element.hatchScale;
  if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) {
    return DEFAULT_HATCH_SPACING * scale;
  }
  return DEFAULT_HATCH_SPACING;
}

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
    // 间距是用户输入的唯一事实源；hatchScale 仅保留给旧存档兼容
    hatchPattern: { ...pattern, spacing: normalizeHatchSpacing(pattern.spacing) },
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

  // 间距兜底：非法值回落到默认；过密时按包围盒上限收敛，避免填 0.1 时卡死画布
  const span = Math.max(width, height, 1);
  const dotFloor = pattern === 'DOT'
    ? Math.sqrt((Math.max(width, 1) * Math.max(height, 1)) / MAX_PATTERN_LINES)
    : 0;
  const step = Math.max(normalizeHatchSpacing(spacing), span / MAX_PATTERN_LINES, dotFloor);

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

  /**
   * 45° 斜线与包围盒的交点：在未旋转坐标里按线段参数求交，再统一旋转。
   * 不能分别夹住起点/终点的 x，否则斜线会收束到某个角点。
   * direction=1 为向右下，-1 为向左下；null 表示该线不穿过边界。
   */
  const diagonalSegment = (xAtTop: number, direction: 1 | -1) => {
    const tStart = Math.max(0, direction === 1 ? minX - xAtTop : xAtTop - maxX);
    const tEnd = Math.min(
      direction === 1 ? maxX - xAtTop : xAtTop - minX,
      height,
    );
    if (tStart >= tEnd) return null;
    return {
      p1: transformPoint(xAtTop + direction * tStart, minY + tStart),
      p2: transformPoint(xAtTop + direction * tEnd, minY + tEnd),
    };
  };

  const appendDiagonal = (xAtTop: number, direction: 1 | -1) => {
    const segment = diagonalSegment(xAtTop, direction);
    if (segment) {
      paths += `M ${segment.p1.x} ${segment.p1.y} L ${segment.p2.x} ${segment.p2.y} `;
    }
  };

  let paths = '';

  switch (pattern) {
    case 'HORIZONTAL':
      for (let y = minY; y <= maxY; y += step) {
        const p1 = transformPoint(minX, y);
        const p2 = transformPoint(maxX, y);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'VERTICAL':
      for (let x = minX; x <= maxX; x += step) {
        const p1 = transformPoint(x, minY);
        const p2 = transformPoint(x, maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'DIAGONAL_RIGHT':
      for (let offset = -height; offset < width; offset += step) {
        appendDiagonal(minX + offset, 1);
      }
      break;

    case 'DIAGONAL_LEFT':
      for (let offset = -height; offset < width; offset += step) {
        appendDiagonal(maxX - offset, -1);
      }
      break;

    case 'CROSS':
      for (let y = minY; y <= maxY; y += step) {
        const p1 = transformPoint(minX, y);
        const p2 = transformPoint(maxX, y);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      for (let x = minX; x <= maxX; x += step) {
        const p1 = transformPoint(x, minY);
        const p2 = transformPoint(x, maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'GRID':
      for (let y = minY; y <= maxY; y += step) {
        const p1 = transformPoint(minX, y);
        const p2 = transformPoint(maxX, y);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      for (let x = minX; x <= maxX; x += step) {
        const p1 = transformPoint(x, minY);
        const p2 = transformPoint(x, maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'DOT':
      for (let y = minY + step / 2; y < maxY; y += step) {
        for (let x = minX + step / 2; x < maxX; x += step) {
          const p = transformPoint(x, y);
          paths += `M ${p.x} ${p.y} m 0 0.5 a 0.5 0.5 0 1 0 -1 0 a 0.5 0.5 0 1 0 1 0 `;
        }
      }
      break;

    case 'ANSI31':
      for (let offset = -height; offset < width; offset += step * 2) {
        appendDiagonal(minX + offset, 1);
      }
      break;

    case 'ANSI32':
      for (let x = minX; x <= maxX; x += step) {
        const p1 = transformPoint(x, minY);
        const p2 = transformPoint(x, maxY);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      for (let y = minY; y <= maxY; y += step * 2) {
        const p1 = transformPoint(minX, y);
        const p2 = transformPoint(maxX, y);
        paths += `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} `;
      }
      break;

    case 'ISO02W100':
      for (let offset = -height; offset < width; offset += step) {
        appendDiagonal(minX + offset, 1);
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
