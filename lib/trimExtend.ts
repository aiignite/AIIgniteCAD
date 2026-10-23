/**
 * trimExtend.ts — 修剪 / 延伸的确定性几何实现（quick 模式）
 *
 * TRIM 对齐 AutoCAD 2020+ 快速修剪：不选边界，其余图元互为边界；
 * 交点把目标分成若干段，剪掉点击所在段、保留其余（可能拆出多条图元）。
 * EXTEND：点击目标的一端，沿该端方向延伸到最近的边界交点。
 * 全部为纯函数，可脱离 DOM 单测；退化情形返回 null，由调用方提示并保留原样。
 */

import type { CADElement, Point } from "../types";
import { getElementIntersections } from "./snapping";

/** 残余段/角小于该值视为退化，直接丢弃 */
const EPS = 1e-6;

export interface TrimOutcome {
    /** 替换目标图元的新图元（首条继承原 id）；空数组表示目标整体删除 */
    replacements: CADElement[];
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** 排序并合并间距小于容差的参数，返回严格递增序列 */
function dedupeSorted(values: number[]): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    const out: number[] = [];
    for (const value of sorted) {
        if (out.length === 0 || value - out[out.length - 1] > EPS) out.push(value);
    }
    return out;
}

const pointOnLine = (start: Point, ux: number, uy: number, at: number): Point => ({
    x: start.x + ux * at,
    y: start.y + uy * at,
});

const pointOnArcDeg = (center: Point, radius: number, deg: number): Point => {
    const rad = (deg * Math.PI) / 180;
    return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) };
};

/** 目标与其他图元的交点；只统计有限点 */
function intersectionsOf(target: CADElement, others: CADElement[]): Point[] {
    const pts: Point[] = [];
    for (const other of others) {
        if (!other.center && !other.start && !other.points) continue;
        pts.push(...getElementIntersections(target, other));
    }
    return pts.filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
}

/* ─── TRIM: LINE ───────────────────────────────────────────── */

function trimLine(
    target: CADElement,
    click: Point,
    others: CADElement[],
    newId: () => string,
): TrimOutcome | null {
    const start = target.start!;
    const end = target.end!;
    const length = dist(start, end);
    if (length < EPS) return null;
    const ux = (end.x - start.x) / length;
    const uy = (end.y - start.y) / length;

    const params = intersectionsOf(target, others)
        .map((pt) => ((pt.x - start.x) * ux + (pt.y - start.y) * uy) / length)
        .filter((t) => t > EPS && t < 1 - EPS);
    const bounds = dedupeSorted([0, ...params, 1]);
    if (bounds.length <= 2) return null;

    const tc = Math.min(1, Math.max(0, ((click.x - start.x) * ux + (click.y - start.y) * uy) / length));
    let cut = 0;
    while (cut < bounds.length - 2 && tc > bounds[cut + 1]) cut += 1;

    const replacements: CADElement[] = [];
    for (let i = 0; i < bounds.length - 1; i += 1) {
        if (i === cut) continue;
        const a = pointOnLine(start, ux, uy, bounds[i] * length);
        const b = pointOnLine(start, ux, uy, bounds[i + 1] * length);
        if (dist(a, b) < EPS) continue;
        replacements.push({
            ...target,
            id: replacements.length === 0 ? target.id : newId(),
            start: a,
            end: b,
        });
    }
    return { replacements };
}

/* ─── TRIM: ARC ────────────────────────────────────────────── */

/** 弧的扫描参数化：clockwise=true 从 start 增大扫到 end，否则减小；与 snapping 的约定一致 */
function arcSweep(el: CADElement & { startAngle: number; endAngle: number }): number {
    const sweep = el.clockwise === true
        ? norm360(el.endAngle - el.startAngle)
        : norm360(el.startAngle - el.endAngle);
    return sweep < EPS ? 360 : sweep;
}

function trimArc(
    target: CADElement,
    click: Point,
    others: CADElement[],
    newId: () => string,
): TrimOutcome | null {
    const { center, radius, startAngle, endAngle } = target as CADElement & {
        center: Point;
        radius: number;
        startAngle: number;
        endAngle: number;
    };
    const clockwise = target.clockwise === true;
    const sweep = arcSweep(target as CADElement & { startAngle: number; endAngle: number });

    const angleToSweep = (deg: number): number =>
        clockwise ? norm360(deg - startAngle) : norm360(startAngle - deg);

    const params = intersectionsOf(target, others)
        .map((pt) => angleToSweep((Math.atan2(pt.y - center.y, pt.x - center.x) * 180) / Math.PI))
        .filter((s) => s > EPS && s < sweep - EPS);
    const bounds = dedupeSorted([0, ...params, sweep]);
    if (bounds.length <= 2) return null;

    const clickSweep = angleToSweep((Math.atan2(click.y - center.y, click.x - center.x) * 180) / Math.PI);
    let cut = 0;
    while (cut < bounds.length - 2 && clickSweep > bounds[cut + 1]) cut += 1;

    const replacements: CADElement[] = [];
    for (let i = 0; i < bounds.length - 1; i += 1) {
        if (i === cut) continue;
        const span = bounds[i + 1] - bounds[i];
        if (span < EPS) continue;
        replacements.push({
            ...target,
            id: replacements.length === 0 ? target.id : newId(),
            startAngle: clockwise ? startAngle + bounds[i] : startAngle - bounds[i],
            endAngle: clockwise ? startAngle + bounds[i + 1] : startAngle - bounds[i + 1],
        });
    }
    return { replacements };
}

/* ─── TRIM: CIRCLE → ARC ───────────────────────────────────── */

function trimCircle(target: CADElement, click: Point, others: CADElement[]): TrimOutcome | null {
    const { center, radius } = target as CADElement & { center: Point; radius: number };
    const angles = dedupeSorted(
        intersectionsOf(target, others).map(
            (pt) => norm360((Math.atan2(pt.y - center.y, pt.x - center.x) * 180) / Math.PI),
        ),
    );
    if (angles.length < 2) return null;

    const clickAngle = norm360((Math.atan2(click.y - center.y, click.x - center.x) * 180) / Math.PI);
    // 递增方向下包含点击角的弧段（末段跨 0°）
    let cutStart = -1;
    let cutEnd = -1;
    for (let i = 0; i < angles.length; i += 1) {
        const a = angles[i];
        const b = i === angles.length - 1 ? angles[0] + 360 : angles[i + 1];
        if ([clickAngle, clickAngle + 360].some((p) => p > a + EPS && p < b - EPS)) {
            cutStart = a;
            cutEnd = b;
            break;
        }
    }
    if (cutStart < 0) return null;

    // 保留弧：从剪切段终点递增绕回到剪切段起点，固定按 clockwise 存储保持 start<end
    const span = cutStart + 360 - cutEnd;
    if (span < EPS || span > 360 - EPS) return { replacements: [] };
    return {
        replacements: [
            {
                ...target,
                type: "ARC",
                clockwise: true,
                startAngle: norm360(cutEnd),
                endAngle: norm360(cutEnd) + span,
            },
        ],
    };
}

/* ─── TRIM: POLYLINE（直线段） ─────────────────────────────── */

function trimPolyline(
    target: CADElement,
    click: Point,
    others: CADElement[],
    newId: () => string,
): TrimOutcome | null {
    const points = target.points;
    if (!points || points.length < 2) return null;
    const closed = target.closed === true;
    const count = closed ? points.length : points.length - 1;

    // 每段的交点参数
    const segmentParams: number[][] = Array.from({ length: count }, () => []);
    let hitIndex = -1;
    let hitT = 0;
    let bestDist = Infinity;

    for (let i = 0; i < count; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const segLen = dist(a, b);
        if (segLen < EPS) continue;
        const probe: CADElement = { ...target, id: `${target.id}-seg${i}`, type: "LINE", start: a, end: b };
        for (const other of others) {
            if (!other.center && !other.start && !other.points) continue;
            for (const pt of getElementIntersections(probe, other)) {
                const t = ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / (segLen * segLen);
                if (t > EPS && t < 1 - EPS) segmentParams[i].push(t);
            }
        }
        // 点击定位到最近段
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const t = Math.min(1, Math.max(0, ((click.x - a.x) * vx + (click.y - a.y) * vy) / (segLen * segLen)));
        const proj = { x: a.x + vx * t, y: a.y + vy * t };
        const d = dist(proj, click);
        if (d < bestDist) {
            bestDist = d;
            hitIndex = i;
            hitT = t;
        }
    }
    if (hitIndex < 0) return null;

    const bounds = dedupeSorted([0, ...segmentParams[hitIndex], 1]);
    if (bounds.length <= 2) return null;
    let cut = 0;
    while (cut < bounds.length - 2 && hitT > bounds[cut + 1]) cut += 1;
    const t0 = bounds[cut];
    const t1 = bounds[cut + 1];

    const a = points[hitIndex];
    const b = points[(hitIndex + 1) % points.length];
    const pAt = (t: number): Point => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    });

    if (closed) {
        // 闭合链剪掉一段后成为一条开放链：从剪切段终点绕回到剪切段起点
        const chain: Point[] = [pAt(t1)];
        for (let i = (hitIndex + 1) % points.length; i !== hitIndex; i = (i + 1) % points.length) {
            chain.push(points[i]);
        }
        chain.push(pAt(t0));
        if (chain.length < 2) return null;
        return { replacements: [{ ...target, closed: false, points: chain }] };
    }

    // 开放多段线：拆成前 / 后两段；剪切段端点侧自然收缩
    const frontPoints = [...points.slice(0, hitIndex + 1)];
    if (t0 > EPS && t0 < 1 - EPS) frontPoints.push(pAt(t0));
    const backPoints: Point[] = [];
    if (t1 > EPS && t1 < 1 - EPS) backPoints.push(pAt(t1));
    backPoints.push(...points.slice(hitIndex + 1));

    const replacements: CADElement[] = [];
    const build = (pts: Point[], keepId: boolean): void => {
        if (pts.length < 2) return;
        // 相邻点重合时收敛
        const clean = pts.filter((pt, i) => i === 0 || dist(pt, pts[i - 1]) > EPS);
        if (clean.length < 2) return;
        replacements.push({
            ...target,
            id: keepId ? target.id : newId(),
            points: clean,
        });
    };

    build(frontPoints, true);
    build(backPoints, false);
    if (replacements.length === 0) return null;
    return { replacements };
}

/* ─── 公共入口 ─────────────────────────────────────────────── */

/**
 * 快速修剪：在 target 上 click 处剪掉一段，其余图元互为边界。
 * 无交点 / 相切共线等退化情形返回 null。
 */
export function trimElementAt(
    target: CADElement,
    click: Point,
    others: CADElement[],
    newId: () => string,
): TrimOutcome | null {
    switch (target.type) {
        case "LINE":
            return trimLine(target, click, others, newId);
        case "ARC":
            return trimArc(target, click, others, newId);
        case "CIRCLE":
            return trimCircle(target, click, others);
        case "LWPOLYLINE":
            return trimPolyline(target, click, others, newId);
        default:
            return null;
    }
}

/* ─── EXTEND ───────────────────────────────────────────────── */

/** 从 from 沿 dir 的射线与其他图元的最近交点；无则 null */
function nearestRayHit(from: Point, dir: Point, others: CADElement[]): Point | null {
    const reach = 1e7;
    const ray: CADElement = {
        id: "__trim_extend_ray__",
        type: "LINE",
        layer: "0",
        color: "#000000",
        start: from,
        end: { x: from.x + dir.x * reach, y: from.y + dir.y * reach },
    };
    let best: Point | null = null;
    let bestS = Infinity;
    for (const other of others) {
        if (!other.center && !other.start && !other.points) continue;
        for (const pt of getElementIntersections(ray, other)) {
            const s = dist(from, pt);
            if (s > EPS && s < bestS) {
                bestS = s;
                best = pt;
            }
        }
    }
    return best;
}

/**
 * 快速延伸：点击目标的一端，沿该端向外延伸到最近的边界交点。
 * 支持 LINE、ARC（沿扫描方向扩展起 / 终角）与多段线两端的直线段。
 */
export function extendElementAt(
    target: CADElement,
    click: Point,
    others: CADElement[],
): CADElement | null {
    if (target.type === "LINE" && target.start && target.end) {
        const extendStart = dist(click, target.start) <= dist(click, target.end);
        const from = extendStart ? target.start : target.end;
        const anchor = extendStart ? target.end : target.start;
        const len = dist(from, anchor);
        if (len < EPS) return null;
        const dir = { x: (from.x - anchor.x) / len, y: (from.y - anchor.y) / len };
        const hit = nearestRayHit(from, dir, others);
        if (!hit) return null;
        return extendStart ? { ...target, start: hit } : { ...target, end: hit };
    }

    if (
        target.type === "ARC" &&
        target.center &&
        target.radius &&
        target.startAngle !== undefined &&
        target.endAngle !== undefined
    ) {
        const clockwise = target.clockwise === true;
        const sweep = arcSweep(target as CADElement & { startAngle: number; endAngle: number });
        // 与边界在整圆上的交点角
        const circle: CADElement = {
            ...target,
            type: "CIRCLE",
            center: target.center,
            radius: target.radius,
        };
        const angles = intersectionsOf(circle, others).map(
            (pt) => (Math.atan2(pt.y - target.center!.y, pt.x - target.center!.x) * 180) / Math.PI,
        );
        if (angles.length === 0) return null;

        const extendStart =
            dist(click, pointOnArcDeg(target.center, target.radius, target.startAngle)) <=
            dist(click, pointOnArcDeg(target.center, target.radius, target.endAngle));
        let bestDelta = Infinity;
        for (const deg of angles) {
            // delta = 沿扫描方向从被延伸端走到交点角的距离
            const delta = extendStart
                ? clockwise
                    ? 360 - norm360(deg - target.startAngle)
                    : norm360(deg - target.startAngle)
                : clockwise
                  ? norm360(deg - target.endAngle)
                  : 360 - norm360(deg - target.endAngle);
            if (delta > EPS && delta < bestDelta) bestDelta = delta;
        }
        if (!Number.isFinite(bestDelta) || sweep + bestDelta >= 360 - EPS) return null;
        return extendStart
            ? {
                  ...target,
                  startAngle: clockwise
                      ? target.startAngle - bestDelta
                      : target.startAngle + bestDelta,
              }
            : {
                  ...target,
                  endAngle: clockwise
                      ? target.endAngle + bestDelta
                      : target.endAngle - bestDelta,
              };
    }

    if (target.type === "LWPOLYLINE" && target.points && !target.closed) {
        const points = target.points;
        if (points.length < 2) return null;
        const extendFirst = dist(click, points[0]) <= dist(click, points[points.length - 1]);
        const from = extendFirst ? points[0] : points[points.length - 1];
        const anchor = extendFirst ? points[1] : points[points.length - 2];
        const len = dist(from, anchor);
        if (len < EPS) return null;
        const dir = { x: (from.x - anchor.x) / len, y: (from.y - anchor.y) / len };
        const hit = nearestRayHit(from, dir, others);
        if (!hit) return null;
        const next = [...points];
        if (extendFirst) next[0] = hit;
        else next[next.length - 1] = hit;
        return { ...target, points: next };
    }

    return null;
}
