import { Point, CADElement } from '../types';

/**
 * Curve Generation Service
 * 提供标准曲线生成算法
 * 确保生成的曲线数学正确且满足CAD需求
 */

export interface SineWaveParams {
  startX: number;
  endX: number;
  centerY: number;
  amplitude: number;
  wavelength: number; // 一个完整周期的x距离
  pointCount?: number; // 采样点数，默认60
}

export interface CosineWaveParams extends SineWaveParams {
  phaseShift?: number; // 相位偏移（弧度）
}

export interface SpiralParams {
  centerX: number;
  centerY: number;
  startRadius: number;
  endRadius: number;
  turns: number; // 旋转圈数
  pointCount?: number; // 采样点数，默认100
}

/**
 * 生成标准正弦波
 * 公式: y = centerY + amplitude * sin(2π * (x - startX) / wavelength)
 */
export const generateSineWave = (params: SineWaveParams): Point[] => {
  const {
    startX,
    endX,
    centerY,
    amplitude,
    wavelength,
    pointCount = 60
  } = params;

  const points: Point[] = [];
  const xRange = endX - startX;

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const x = startX + t * xRange;
    
    // 标准正弦公式
    const phase = (2 * Math.PI * (x - startX)) / wavelength;
    const y = centerY + amplitude * Math.sin(phase);
    
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return points;
};

/**
 * 生成标准余弦波
 * 公式: y = centerY + amplitude * cos(2π * (x - startX) / wavelength + phaseShift)
 */
export const generateCosineWave = (params: CosineWaveParams): Point[] => {
  const {
    startX,
    endX,
    centerY,
    amplitude,
    wavelength,
    pointCount = 60,
    phaseShift = 0
  } = params;

  const points: Point[] = [];
  const xRange = endX - startX;

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const x = startX + t * xRange;
    
    // 标准余弦公式
    const phase = (2 * Math.PI * (x - startX)) / wavelength + phaseShift;
    const y = centerY + amplitude * Math.cos(phase);
    
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return points;
};

/**
 * 生成阿基米德螺旋
 * 参数方程:
 * x = (r0 + k*t) * cos(t)
 * y = (r0 + k*t) * sin(t)
 * 其中t从0到2π*turns
 */
export const generateSpiral = (params: SpiralParams): Point[] => {
  const {
    centerX,
    centerY,
    startRadius,
    endRadius,
    turns,
    pointCount = 100
  } = params;

  const points: Point[] = [];
  const radiusRange = endRadius - startRadius;
  const totalAngle = 2 * Math.PI * turns;

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const angle = totalAngle * t;
    const radius = startRadius + radiusRange * t;
    
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return points;
};

/**
 * 生成对数螺旋
 * 公式: r = a * e^(b*θ)
 */
export const generateLogarithmicSpiral = (
  centerX: number,
  centerY: number,
  a: number,
  b: number,
  maxAngle: number = 4 * Math.PI,
  pointCount: number = 100
): Point[] => {
  const points: Point[] = [];

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const theta = maxAngle * t;
    const r = a * Math.exp(b * theta);
    
    const x = centerX + r * Math.cos(theta);
    const y = centerY + r * Math.sin(theta);
    
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return points;
};

/**
 * 生成贝塞尔曲线 (二次)
 * 公式: P(t) = (1-t)²*P0 + 2(1-t)t*P1 + t²*P2
 */
export const generateQuadraticBezier = (
  p0: Point,
  p1: Point,
  p2: Point,
  pointCount: number = 50
): Point[] => {
  const points: Point[] = [];

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const mt = 1 - t;
    
    const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
    const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
    
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return points;
};

/**
 * 生成贝塞尔曲线 (三次)
 * 公式: P(t) = (1-t)³*P0 + 3(1-t)²t*P1 + 3(1-t)t²*P2 + t³*P3
 */
export const generateCubicBezier = (
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  pointCount: number = 50
): Point[] => {
  const points: Point[] = [];

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;
    
    const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x;
    const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y;
    
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return points;
};

/**
 * 生成圆弧 (参数方程)
 * 公式: 
 * x = centerX + radius * cos(θ)
 * y = centerY + radius * sin(θ)
 */
export const generateArc = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  pointCount: number = 50
): Point[] => {
  const points: Point[] = [];
  const angleRange = endAngle - startAngle;

  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const angle = startAngle + angleRange * t;
    
    const x = centerX + radius * Math.cos(angle * Math.PI / 180);
    const y = centerY + radius * Math.sin(angle * Math.PI / 180);
    
    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return points;
};

/**
 * 验证生成的曲线数据
 * 检查点数、坐标范围等
 */
export const validateCurve = (points: Point[]): {
  valid: boolean;
  issues: string[];
} => {
  const issues: string[] = [];

  if (points.length < 2) {
    issues.push('曲线点数少于2个');
  }

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);

  if (xRange === 0) {
    issues.push('X轴范围为0 - 曲线是竖线');
  }
  if (yRange === 0) {
    issues.push('Y轴范围为0 - 曲线是横线');
  }

  // 检查是否有NaN或Infinity
  if (points.some(p => !isFinite(p.x) || !isFinite(p.y))) {
    issues.push('曲线包含无效坐标 (NaN 或 Infinity)');
  }

  // 检查点是否单调递增
  const xOrder = xs.every((val, i, arr) => i === 0 || val >= arr[i - 1]);
  if (!xOrder) {
    issues.push('X坐标不是单调递增的');
  }

  return {
    valid: issues.length === 0,
    issues
  };
};

/**
 * 从AI生成的元素创建CADElement
 */
export const createCurveElement = (
  points: Point[],
  id?: string,
  layer: string = 'AI_GENERATED',
  color: string = '#137fec'
): CADElement => {
  return {
    id: id || Math.random().toString(36).substr(2, 9),
    type: 'LWPOLYLINE',
    layer,
    color,
    points
  };
};
