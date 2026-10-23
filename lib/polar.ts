/**
 * polar.ts — 极轴追踪约束
 *
 * 正交只能锁到两轴；极轴在光标接近某个角度增量时把点吸附到该射线上，
 * 并返回命中角度供引导线渲染。纯函数，方便单测与复用。
 */

import type { Point } from "../types";

/** 默认角度增量：45° 覆盖 0/45/90/135… 等常用方向 */
export const DEFAULT_POLAR_STEP_DEG = 45;
/** 光标角度偏离增量多少度以内才吸附，避免"抢走"自由方向 */
export const POLAR_SNAP_TOLERANCE_DEG = 10;

const DEG_TO_RAD = Math.PI / 180;

export interface PolarConstraint {
    /** 约束后的点；未命中时与输入相同 */
    point: Point;
    /** 命中的角度（度，0–360）；未命中为 null */
    angle: number | null;
    /** 是否发生吸附 */
    snapped: boolean;
    /** 锚点到光标的距离 */
    distance: number;
}

/**
 * 将光标点约束到以 anchor 为起点的极轴方向。
 * 距离保持不变，只调整方向；未命中容差时原样返回。
 */
export function constrainToPolar(
    anchor: Point,
    point: Point,
    stepDeg: number = DEFAULT_POLAR_STEP_DEG,
    toleranceDeg: number = POLAR_SNAP_TOLERANCE_DEG,
): PolarConstraint {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-9 || stepDeg <= 0) {
        return { point, angle: null, snapped: false, distance };
    }

    const rawAngle = (Math.atan2(dy, dx) / DEG_TO_RAD + 360) % 360;
    const snappedAngle = (Math.round(rawAngle / stepDeg) * stepDeg) % 360;
    const diff = Math.abs(rawAngle - snappedAngle);
    const angularDistance = Math.min(diff, 360 - diff);
    if (angularDistance > toleranceDeg) {
        return { point, angle: null, snapped: false, distance };
    }

    return {
        point: {
            x: anchor.x + Math.cos(snappedAngle * DEG_TO_RAD) * distance,
            y: anchor.y + Math.sin(snappedAngle * DEG_TO_RAD) * distance,
        },
        angle: snappedAngle,
        snapped: true,
        distance,
    };
}

/** 由长度与角度（度）计算终点 */
export function pointFromPolar(anchor: Point, length: number, angleDeg: number): Point {
    const radians = angleDeg * DEG_TO_RAD;
    return {
        x: anchor.x + Math.cos(radians) * length,
        y: anchor.y + Math.sin(radians) * length,
    };
}

/** 归一化到 [0, 360) */
export function normalizeAngle(angleDeg: number): number {
    return ((angleDeg % 360) + 360) % 360;
}
