/**
 * imageTrace.ts — 参考图矢量化（纯函数）
 *
 * 输入 RGBA 像素，先按亮度二值化，再用 marching squares 提取轮廓并简化。
 * 轮廓在浏览器本地生成，不上传图片；输出 LWPOLYLINE，用户预览后再插入图纸。
 */

import type { CADElement, Point } from "../types";

export interface TraceImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray | number[];
}

export interface TraceOptions {
    /** 亮度低于该值视为墨线 */
    threshold: number;
    /** 反色：浅色线条 / 深色背景 */
    invert: boolean;
    /** 简化容差（源图像素），0 表示不简化 */
    simplifyTolerance: number;
    /** 目标世界宽度，用于把像素换算为图纸单位 */
    targetWidth: number;
    /** 插入点（左上角对应的世界坐标） */
    offset?: Point;
    /** 最多输出的轮廓数量 */
    maxPaths?: number;
    /** 过滤短于该像素长度的轮廓 */
    minLength?: number;
    layer?: string;
    color?: string;
}

export interface TraceResult {
    elements: CADElement[];
    /** 追踪出的原始轮廓数（简化前） */
    contourCount: number;
    /** 源图像素对应的世界尺寸 */
    scale: number;
}

interface PixelPoint {
    x: number;
    y: number;
}

interface Segment {
    a: PixelPoint;
    b: PixelPoint;
    used: boolean;
}

const DEFAULT_MAX_PATHS = 80;
const DEFAULT_MIN_LENGTH = 6;

const createElementId = (): string =>
    `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const luminance = (data: Uint8ClampedArray | number[], index: number): number => {
    const r = data[index] ?? 255;
    const g = data[index + 1] ?? 255;
    const b = data[index + 2] ?? 255;
    const a = data[index + 3] ?? 255;
    if (a < 32) return 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
};

export function traceImage(image: TraceImageData, options: TraceOptions): TraceResult {
    const { width, height } = image;
    const threshold = Math.min(Math.max(options.threshold, 1), 254);
    const scale = options.targetWidth > 0 ? options.targetWidth / Math.max(width, 1) : 1;
    const offset = options.offset ?? { x: 0, y: 0 };
    const empty: TraceResult = { elements: [], contourCount: 0, scale };
    if (width < 2 || height < 2) return empty;

    const ink = new Uint8Array((width + 2) * (height + 2));
    const inkAt = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const value = luminance(image.data, (y * width + x) * 4);
        return options.invert ? value > threshold : value < threshold;
    };
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            ink[(y + 1) * (width + 2) + (x + 1)] = inkAt(x, y) ? 1 : 0;
        }
    }
    const bit = (x: number, y: number): number =>
        ink[(y + 1) * (width + 2) + (x + 1)] === 1 ? 1 : 0;

    const segments: Segment[] = [];
    const midTop = (x: number, y: number): PixelPoint => ({ x: x + 0.5, y });
    const midRight = (x: number, y: number): PixelPoint => ({ x: x + 1, y: y + 0.5 });
    const midBottom = (x: number, y: number): PixelPoint => ({ x: x + 0.5, y: y + 1 });
    const midLeft = (x: number, y: number): PixelPoint => ({ x, y: y + 0.5 });

    for (let y = -1; y < height; y += 1) {
        for (let x = -1; x < width; x += 1) {
            const a = bit(x, y);
            const b = bit(x + 1, y);
            const c = bit(x + 1, y + 1);
            const d = bit(x, y + 1);
            const value = (a << 3) | (b << 2) | (c << 1) | d;
            if (value === 0 || value === 15) continue;

            const top = () => midTop(x, y);
            const right = () => midRight(x, y);
            const bottom = () => midBottom(x, y);
            const left = () => midLeft(x, y);
            const add = (p1: PixelPoint, p2: PixelPoint) =>
                segments.push({ a: p1, b: p2, used: false });

            switch (value) {
                case 1:
                case 14:
                    add(left(), bottom());
                    break;
                case 2:
                case 13:
                    add(right(), bottom());
                    break;
                case 3:
                case 12:
                    add(left(), right());
                    break;
                case 4:
                case 11:
                    add(top(), right());
                    break;
                case 5:
                    // 鞍点：固定连接右上—左下，保持结果确定
                    add(top(), right());
                    add(left(), bottom());
                    break;
                case 6:
                case 9:
                    add(top(), bottom());
                    break;
                case 7:
                case 8:
                    add(left(), top());
                    break;
                case 10:
                    add(left(), top());
                    add(right(), bottom());
                    break;
                default:
                    break;
            }
        }
    }

    const key = (point: PixelPoint): string =>
        `${Math.round(point.x * 2)},${Math.round(point.y * 2)}`;
    const adjacency = new Map<string, number[]>();
    for (const [index, segment] of segments.entries()) {
        for (const point of [segment.a, segment.b]) {
            const list = adjacency.get(key(point));
            if (list) list.push(index);
            else adjacency.set(key(point), [index]);
        }
    }

    const samePoint = (a: PixelPoint, b: PixelPoint): boolean =>
        Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

    const chains: { points: PixelPoint[]; closed: boolean }[] = [];
    for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
        const start = segments[startIndex];
        if (start.used) continue;
        start.used = true;
        const points: PixelPoint[] = [start.a, start.b];
        let current = start.b;
        let closed = false;
        for (;;) {
            if (samePoint(current, points[0])) {
                closed = true;
                break;
            }
            const candidates = adjacency.get(key(current)) ?? [];
            const nextIndex = candidates.find((index) => !segments[index].used);
            if (nextIndex === undefined) break;
            const next = segments[nextIndex];
            next.used = true;
            const other = samePoint(next.a, current) ? next.b : next.a;
            points.push(other);
            current = other;
        }
        if (closed && points.length > 2) points.pop();
        chains.push({ points, closed });
    }

    const maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
    const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
    const contourCount = chains.length;
    const elements: CADElement[] = [];
    for (const chain of chains) {
        if (elements.length >= maxPaths) break;
        const simplified = simplifyPath(chain.points, options.simplifyTolerance);
        if (simplified.length < (chain.closed ? 3 : 2)) continue;
        if (pathLength(simplified) < minLength) continue;
        const points = simplified.map<Point>((point) => ({
            x: Math.round((offset.x + point.x * scale) * 1000) / 1000,
            y: Math.round((offset.y + point.y * scale) * 1000) / 1000,
        }));
        elements.push({
            id: createElementId(),
            type: "LWPOLYLINE",
            layer: options.layer ?? "TRACE",
            color: options.color ?? "#e6edf3",
            points,
            ...(chain.closed ? { closed: true } : {}),
        });
    }

    return { elements, contourCount, scale };
}

const pathLength = (points: PixelPoint[]): number => {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        total += Math.hypot(
            points[index].x - points[index - 1].x,
            points[index].y - points[index - 1].y,
        );
    }
    return total;
};

/** Ramer–Douglas–Peucker；tolerance<=0 时原样返回 */
export function simplifyPath(points: PixelPoint[], tolerance: number): PixelPoint[] {
    if (tolerance <= 0 || points.length <= 2) return points;
    const sqTolerance = tolerance * tolerance;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, points.length - 1]];
    while (stack.length > 0) {
        const [first, last] = stack.pop()!;
        if (last <= first + 1) continue;
        let maxDistance = 0;
        let index = first;
        const a = points[first];
        const b = points[last];
        for (let item = first + 1; item < last; item += 1) {
            const distance = squaredDistanceToSegment(points[item], a, b);
            if (distance > maxDistance) {
                maxDistance = distance;
                index = item;
            }
        }
        if (maxDistance > sqTolerance) {
            keep[index] = 1;
            stack.push([first, index], [index, last]);
        }
    }
    return points.filter((_, index) => keep[index] === 1);
}

const squaredDistanceToSegment = (point: PixelPoint, a: PixelPoint, b: PixelPoint): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;
    const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    const x = a.x + t * dx;
    const y = a.y + t * dy;
    return (point.x - x) ** 2 + (point.y - y) ** 2;
};
