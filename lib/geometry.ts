// Geometry Library for AIIgniteCAD
// Comprehensive geometric calculations and utilities for CAD operations

import { Point, CADElement } from '../types';

// ============================================================================
// BASIC GEOMETRY TYPES AND CONSTANTS
// ============================================================================

export const EPSILON = 1e-10; // Tolerance for floating point comparisons
export const TWO_PI = Math.PI * 2;

export interface Vector2D {
    x: number;
    y: number;
}

export interface Line {
    start: Point;
    end: Point;
}

export interface Circle {
    center: Point;
    radius: number;
}

export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface Matrix3x3 {
    a: number; // scale X
    b: number; // skew Y
    c: number; // skew X
    d: number; // scale Y
    e: number; // translate X
    f: number; // translate Y
}

// ============================================================================
// POINT OPERATIONS
// ============================================================================

/**
 * Create a point
 */
export function point(x: number, y: number): Point {
    return { x, y };
}

/**
 * Calculate distance between two points
 */
export function distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate squared distance (faster, no sqrt)
 */
export function distanceSquared(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return dx * dx + dy * dy;
}

/**
 * Calculate midpoint between two points
 */
export function midpoint(p1: Point, p2: Point): Point {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
    };
}

/**
 * Check if two points are equal within tolerance
 */
export function pointsEqual(p1: Point, p2: Point, tolerance: number = EPSILON): boolean {
    return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance;
}

/**
 * Interpolate between two points (t = 0 to 1)
 */
export function lerp(p1: Point, p2: Point, t: number): Point {
    return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t
    };
}

// ============================================================================
// VECTOR OPERATIONS
// ============================================================================

/**
 * Add two vectors
 */
export function add(v1: Vector2D, v2: Vector2D): Vector2D {
    return { x: v1.x + v2.x, y: v1.y + v2.y };
}

/**
 * Subtract two vectors
 */
export function subtract(v1: Vector2D, v2: Vector2D): Vector2D {
    return { x: v1.x - v2.x, y: v1.y - v2.y };
}

/**
 * Multiply vector by scalar
 */
export function scale(v: Vector2D, scalar: number): Vector2D {
    return { x: v.x * scalar, y: v.y * scalar };
}

/**
 * Dot product of two vectors
 */
export function dot(v1: Vector2D, v2: Vector2D): number {
    return v1.x * v2.x + v1.y * v2.y;
}

/**
 * Cross product (returns scalar for 2D)
 */
export function cross(v1: Vector2D, v2: Vector2D): number {
    return v1.x * v2.y - v1.y * v2.x;
}

/**
 * Calculate vector length (magnitude)
 */
export function length(v: Vector2D): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * Calculate squared length (faster)
 */
export function lengthSquared(v: Vector2D): number {
    return v.x * v.x + v.y * v.y;
}

/**
 * Normalize vector to unit length
 */
export function normalize(v: Vector2D): Vector2D {
    const len = length(v);
    if (len < EPSILON) {
        return { x: 0, y: 0 };
    }
    return { x: v.x / len, y: v.y / len };
}

/**
 * Rotate vector by angle (radians)
 */
export function rotate(v: Vector2D, angle: number): Vector2D {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
        x: v.x * cos - v.y * sin,
        y: v.x * sin + v.y * cos
    };
}

/**
 * Get perpendicular vector (90 degrees counterclockwise)
 */
export function perpendicular(v: Vector2D): Vector2D {
    return { x: -v.y, y: v.x };
}

/**
 * Calculate angle between two vectors (radians)
 */
export function angleBetween(v1: Vector2D, v2: Vector2D): number {
    const dotProduct = dot(v1, v2);
    const lengths = length(v1) * length(v2);
    if (lengths < EPSILON) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dotProduct / lengths)));
}

/**
 * Calculate angle of vector from positive X axis (radians)
 */
export function angle(v: Vector2D): number {
    return Math.atan2(v.y, v.x);
}

/**
 * Calculate signed angle from v1 to v2 (radians)
 */
export function signedAngle(v1: Vector2D, v2: Vector2D): number {
    return Math.atan2(cross(v1, v2), dot(v1, v2));
}

// ============================================================================
// ANGLE UTILITIES
// ============================================================================

/**
 * Convert degrees to radians
 */
export function degToRad(degrees: number): number {
    return degrees * Math.PI / 180;
}

/**
 * Convert radians to degrees
 */
export function radToDeg(radians: number): number {
    return radians * 180 / Math.PI;
}

/**
 * Normalize angle to [0, 2π)
 */
export function normalizeAngle(angle: number): number {
    angle = angle % TWO_PI;
    if (angle < 0) angle += TWO_PI;
    return angle;
}

/**
 * Normalize angle to [-π, π)
 */
export function normalizeAngleSigned(angle: number): number {
    angle = normalizeAngle(angle);
    if (angle > Math.PI) angle -= TWO_PI;
    return angle;
}

/**
 * Calculate angle between two points
 */
export function angleFromPoints(p1: Point, p2: Point): number {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

// ============================================================================
// LINE OPERATIONS
// ============================================================================

/**
 * Calculate line length
 */
export function lineLength(line: Line): number {
    return distance(line.start, line.end);
}

/**
 * Get point on line at parameter t (0 = start, 1 = end)
 */
export function pointOnLine(line: Line, t: number): Point {
    return lerp(line.start, line.end, t);
}

/**
 * Calculate closest point on line segment to given point
 */
export function closestPointOnLineSegment(point: Point, line: Line): Point {
    const v = subtract(line.end, line.start);
    const u = subtract(point, line.start);
    const t = dot(u, v) / dot(v, v);

    if (t <= 0) return line.start;
    if (t >= 1) return line.end;

    return pointOnLine(line, t);
}

/**
 * Calculate closest point on infinite line to given point
 */
export function closestPointOnInfiniteLine(point: Point, line: Line): Point {
    const v = subtract(line.end, line.start);
    const u = subtract(point, line.start);
    const t = dot(u, v) / dot(v, v);

    return pointOnLine(line, t);
}

/**
 * Calculate distance from point to line segment
 */
export function distanceToLineSegment(point: Point, line: Line): number {
    const closest = closestPointOnLineSegment(point, line);
    return distance(point, closest);
}

/**
 * Calculate distance from point to infinite line
 */
export function distanceToInfiniteLine(point: Point, line: Line): number {
    const closest = closestPointOnInfiniteLine(point, line);
    return distance(point, closest);
}

/**
 * Check if point is on line segment
 */
export function isPointOnLineSegment(point: Point, line: Line, tolerance: number = EPSILON): boolean {
    return distanceToLineSegment(point, line) < tolerance;
}

/**
 * Get line direction vector (normalized)
 */
export function lineDirection(line: Line): Vector2D {
    return normalize(subtract(line.end, line.start));
}

/**
 * Get line normal vector (perpendicular, normalized)
 */
export function lineNormal(line: Line): Vector2D {
    return perpendicular(lineDirection(line));
}

// ============================================================================
// LINE-LINE INTERSECTION
// ============================================================================

export interface LineIntersection {
    point: Point;
    t1: number; // Parameter on line 1
    t2: number; // Parameter on line 2
}

/**
 * Find intersection between two infinite lines
 * Returns null if lines are parallel
 */
export function lineLineIntersection(line1: Line, line2: Line): LineIntersection | null {
    const d1 = subtract(line1.end, line1.start);
    const d2 = subtract(line2.end, line2.start);

    const cross12 = cross(d1, d2);

    // Lines are parallel
    if (Math.abs(cross12) < EPSILON) {
        return null;
    }

    const diff = subtract(line2.start, line1.start);
    const t1 = cross(diff, d2) / cross12;
    const t2 = cross(diff, d1) / cross12;

    const point = pointOnLine(line1, t1);

    return { point, t1, t2 };
}

/**
 * Find intersection between two line segments
 * Returns null if no intersection
 */
export function lineSegmentIntersection(line1: Line, line2: Line): Point | null {
    const result = lineLineIntersection(line1, line2);

    if (!result) return null;

    // Check if intersection is within both segments
    if (result.t1 >= -EPSILON && result.t1 <= 1 + EPSILON &&
        result.t2 >= -EPSILON && result.t2 <= 1 + EPSILON) {
        return result.point;
    }

    return null;
}

// ============================================================================
// CIRCLE OPERATIONS
// ============================================================================

/**
 * Check if point is on circle
 */
export function isPointOnCircle(point: Point, circle: Circle, tolerance: number = EPSILON): boolean {
    const dist = distance(point, circle.center);
    return Math.abs(dist - circle.radius) < tolerance;
}

/**
 * Check if point is inside circle
 */
export function isPointInCircle(point: Point, circle: Circle): boolean {
    return distance(point, circle.center) < circle.radius;
}

/**
 * Get point on circle at angle (radians)
 */
export function pointOnCircle(circle: Circle, angle: number): Point {
    return {
        x: circle.center.x + circle.radius * Math.cos(angle),
        y: circle.center.y + circle.radius * Math.sin(angle)
    };
}

/**
 * Find closest point on circle to given point
 */
export function closestPointOnCircle(point: Point, circle: Circle): Point {
    const direction = subtract(point, circle.center);
    const normalized = normalize(direction);
    return add(circle.center, scale(normalized, circle.radius));
}

/**
 * Calculate distance from point to circle perimeter
 */
export function distanceToCircle(point: Point, circle: Circle): number {
    const dist = distance(point, circle.center);
    return Math.abs(dist - circle.radius);
}

// ============================================================================
// LINE-CIRCLE INTERSECTION
// ============================================================================

/**
 * Find intersections between line and circle
 * Returns array of intersection points (0, 1, or 2 points)
 */
export function lineCircleIntersection(line: Line, circle: Circle): Point[] {
    const d = subtract(line.end, line.start);
    const f = subtract(line.start, circle.center);

    const a = dot(d, d);
    const b = 2 * dot(f, d);
    const c = dot(f, f) - circle.radius * circle.radius;

    let discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
        return []; // No intersection
    }

    discriminant = Math.sqrt(discriminant);

    const t1 = (-b - discriminant) / (2 * a);
    const t2 = (-b + discriminant) / (2 * a);

    const intersections: Point[] = [];

    if (t1 >= 0 && t1 <= 1) {
        intersections.push(pointOnLine(line, t1));
    }

    if (t2 >= 0 && t2 <= 1 && Math.abs(t2 - t1) > EPSILON) {
        intersections.push(pointOnLine(line, t2));
    }

    return intersections;
}

// ============================================================================
// CIRCLE-CIRCLE INTERSECTION
// ============================================================================

/**
 * Find intersections between two circles
 * Returns array of intersection points (0, 1, or 2 points)
 */
export function circleCircleIntersection(c1: Circle, c2: Circle): Point[] {
    const d = distance(c1.center, c2.center);

    // Circles don't intersect or are identical
    if (d > c1.radius + c2.radius || d < Math.abs(c1.radius - c2.radius) || d < EPSILON) {
        return [];
    }

    // Circles are tangent (one intersection point)
    if (Math.abs(d - (c1.radius + c2.radius)) < EPSILON ||
        Math.abs(d - Math.abs(c1.radius - c2.radius)) < EPSILON) {
        const direction = normalize(subtract(c2.center, c1.center));
        const point = add(c1.center, scale(direction, c1.radius));
        return [point];
    }

    // Two intersection points
    const a = (c1.radius * c1.radius - c2.radius * c2.radius + d * d) / (2 * d);
    const h = Math.sqrt(c1.radius * c1.radius - a * a);

    const direction = subtract(c2.center, c1.center);
    const p2 = add(c1.center, scale(direction, a / d));

    const perpDir = perpendicular(direction);
    const offset = scale(normalize(perpDir), h);

    return [
        add(p2, offset),
        subtract(p2, offset)
    ];
}

// ============================================================================
// BOUNDING BOX OPERATIONS
// ============================================================================

/**
 * Create bounding box from points
 */
export function boundingBoxFromPoints(points: Point[]): BoundingBox {
    if (points.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;

    for (let i = 1; i < points.length; i++) {
        minX = Math.min(minX, points[i].x);
        minY = Math.min(minY, points[i].y);
        maxX = Math.max(maxX, points[i].x);
        maxY = Math.max(maxY, points[i].y);
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Get bounding box for CAD element
 */
export function getElementBoundingBox(element: CADElement): BoundingBox {
    if (element.type === 'LINE' && element.start && element.end) {
        return boundingBoxFromPoints([element.start, element.end]);
    }

    if (element.type === 'CIRCLE' && element.center && element.radius) {
        return {
            minX: element.center.x - element.radius,
            minY: element.center.y - element.radius,
            maxX: element.center.x + element.radius,
            maxY: element.center.y + element.radius
        };
    }

    if (element.type === 'RECTANGLE' && element.start && element.width && element.height) {
        return {
            minX: element.start.x,
            minY: element.start.y,
            maxX: element.start.x + element.width,
            maxY: element.start.y + element.height
        };
    }

    if (element.type === 'LWPOLYLINE' && element.points) {
        return boundingBoxFromPoints(element.points);
    }

    if (element.type === 'TEXT' && element.start) {
        const fontSize = element.fontSize || 12;
        const textWidth = (element.text?.length || 0) * fontSize * 0.6;
        return {
            minX: element.start.x,
            minY: element.start.y - fontSize,
            maxX: element.start.x + textWidth,
            maxY: element.start.y
        };
    }

    if (element.type === 'ARC' && element.center && element.radius) {
        // Simplified: return circle bounding box
        return {
            minX: element.center.x - element.radius,
            minY: element.center.y - element.radius,
            maxX: element.center.x + element.radius,
            maxY: element.center.y + element.radius
        };
    }

    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/**
 * Check if point is inside bounding box
 */
export function isPointInBoundingBox(point: Point, bbox: BoundingBox): boolean {
    return point.x >= bbox.minX && point.x <= bbox.maxX &&
           point.y >= bbox.minY && point.y <= bbox.maxY;
}

/**
 * Check if two bounding boxes intersect
 */
export function boundingBoxesIntersect(bbox1: BoundingBox, bbox2: BoundingBox): boolean {
    return !(bbox1.maxX < bbox2.minX || bbox1.minX > bbox2.maxX ||
             bbox1.maxY < bbox2.minY || bbox1.minY > bbox2.maxY);
}

/**
 * Expand bounding box by margin
 */
export function expandBoundingBox(bbox: BoundingBox, margin: number): BoundingBox {
    return {
        minX: bbox.minX - margin,
        minY: bbox.minY - margin,
        maxX: bbox.maxX + margin,
        maxY: bbox.maxY + margin
    };
}

// ============================================================================
// TRANSFORMATION MATRICES
// ============================================================================

/**
 * Create identity matrix
 */
export function identityMatrix(): Matrix3x3 {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/**
 * Create translation matrix
 */
export function translationMatrix(tx: number, ty: number): Matrix3x3 {
    return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/**
 * Create rotation matrix
 */
export function rotationMatrix(angle: number): Matrix3x3 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/**
 * Create scale matrix
 */
export function scaleMatrix(sx: number, sy: number): Matrix3x3 {
    return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/**
 * Multiply two matrices
 */
export function multiplyMatrix(m1: Matrix3x3, m2: Matrix3x3): Matrix3x3 {
    return {
        a: m1.a * m2.a + m1.c * m2.b,
        b: m1.b * m2.a + m1.d * m2.b,
        c: m1.a * m2.c + m1.c * m2.d,
        d: m1.b * m2.c + m1.d * m2.d,
        e: m1.a * m2.e + m1.c * m2.f + m1.e,
        f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
}

/**
 * Apply matrix transformation to point
 */
export function transformPoint(point: Point, matrix: Matrix3x3): Point {
    return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f
    };
}

/**
 * Create combined transformation matrix (translate, rotate, scale)
 */
export function createTransform(translation: Point, rotation: number, scale: Point): Matrix3x3 {
    let matrix = identityMatrix();
    matrix = multiplyMatrix(matrix, translationMatrix(translation.x, translation.y));
    matrix = multiplyMatrix(matrix, rotationMatrix(rotation));
    matrix = multiplyMatrix(matrix, scaleMatrix(scale.x, scale.y));
    return matrix;
}

// ============================================================================
// POLYGON OPERATIONS
// ============================================================================

/**
 * Calculate area of polygon (signed)
 */
export function polygonArea(points: Point[]): number {
    if (points.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return area / 2;
}

/**
 * Calculate centroid of polygon
 */
export function polygonCentroid(points: Point[]): Point {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return points[0];

    let cx = 0;
    let cy = 0;
    let area = 0;

    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const cross = points[i].x * points[j].y - points[j].x * points[i].y;
        cx += (points[i].x + points[j].x) * cross;
        cy += (points[i].y + points[j].y) * cross;
        area += cross;
    }

    area /= 2;
    const factor = 1 / (6 * area);

    return { x: cx * factor, y: cy * factor };
}

/**
 * Check if point is inside polygon (ray casting algorithm)
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;

        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Check if number is approximately zero
 */
export function isZero(value: number, tolerance: number = EPSILON): boolean {
    return Math.abs(value) < tolerance;
}

/**
 * Round number to decimal places
 */
export function roundTo(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

/**
 * Snap value to grid
 */
export function snapToGrid(value: number, gridSize: number): number {
    return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap point to grid
 */
export function snapPointToGrid(point: Point, gridSize: number): Point {
    return {
        x: snapToGrid(point.x, gridSize),
        y: snapToGrid(point.y, gridSize)
    };
}
