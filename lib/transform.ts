// Transform Operations Library for AIIgniteCAD
// Comprehensive transformation operations for CAD elements

import { Point, CADElement, BlockReference } from '../types';
import {
    transformPoint,
    createTransform,
    degToRad,
    radToDeg,
    distance,
    add,
    subtract,
    normalize,
    scale as scaleVector,
    rotate as rotateVector
} from './geometry';

// ============================================================================
// MOVE/TRANSLATE OPERATIONS
// ============================================================================

/**
 * Move element by delta
 */
export function moveElement(element: CADElement, delta: Point): CADElement {
    const moved = { ...element };

    if (element.start) {
        moved.start = {
            x: element.start.x + delta.x,
            y: element.start.y + delta.y
        };
    }

    if (element.end) {
        moved.end = {
            x: element.end.x + delta.x,
            y: element.end.y + delta.y
        };
    }

    if (element.center) {
        moved.center = {
            x: element.center.x + delta.x,
            y: element.center.y + delta.y
        };
    }

    if (element.points) {
        moved.points = element.points.map(p => ({
            x: p.x + delta.x,
            y: p.y + delta.y
        }));
    }

    if (element.offsetPoint) {
        moved.offsetPoint = {
            x: element.offsetPoint.x + delta.x,
            y: element.offsetPoint.y + delta.y
        };
    }

    return moved;
}

/**
 * Move multiple elements by delta
 */
export function moveElements(elements: CADElement[], delta: Point): CADElement[] {
    return elements.map(el => moveElement(el, delta));
}

/**
 * Move element from one point to another
 */
export function moveElementFromTo(element: CADElement, from: Point, to: Point): CADElement {
    const delta = {
        x: to.x - from.x,
        y: to.y - from.y
    };
    return moveElement(element, delta);
}

// ============================================================================
// COPY OPERATIONS
// ============================================================================

/**
 * Copy element with new position
 */
export function copyElement(element: CADElement, delta: Point): CADElement {
    const copied = moveElement(element, delta);
    copied.id = generateId();
    copied.selected = false;
    return copied;
}

/**
 * Copy multiple elements with new position
 */
export function copyElements(elements: CADElement[], delta: Point): CADElement[] {
    return elements.map(el => copyElement(el, delta));
}

/**
 * Create multiple copies in a linear array
 */
export function linearArray(
    elements: CADElement[],
    count: number,
    delta: Point
): CADElement[] {
    const result: CADElement[] = [];

    for (let i = 1; i <= count; i++) {
        const arrayDelta = {
            x: delta.x * i,
            y: delta.y * i
        };
        result.push(...copyElements(elements, arrayDelta));
    }

    return result;
}

/**
 * Create rectangular array of elements
 */
export function rectangularArray(
    elements: CADElement[],
    rows: number,
    columns: number,
    rowSpacing: number,
    columnSpacing: number
): CADElement[] {
    const result: CADElement[] = [];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
            if (row === 0 && col === 0) continue; // Skip original

            const delta = {
                x: col * columnSpacing,
                y: row * rowSpacing
            };
            result.push(...copyElements(elements, delta));
        }
    }

    return result;
}

/**
 * Create polar/circular array of elements
 */
export function polarArray(
    elements: CADElement[],
    center: Point,
    count: number,
    angleIncrement: number,
    rotateItems: boolean = true
): CADElement[] {
    const result: CADElement[] = [];
    const angleRad = degToRad(angleIncrement);

    for (let i = 1; i < count; i++) {
        const totalAngle = angleRad * i;
        const rotated = rotateItems
            ? rotateElements(elements, center, angleIncrement * i)
            : moveElements(elements, { x: 0, y: 0 }); // Clone without rotation

        // Move to circular position
        const centroid = getElementsCentroid(elements);
        const radius = distance(center, centroid);
        const currentAngle = Math.atan2(centroid.y - center.y, centroid.x - center.x);
        const newAngle = currentAngle + totalAngle;

        const newPosition = {
            x: center.x + radius * Math.cos(newAngle),
            y: center.y + radius * Math.sin(newAngle)
        };

        const delta = {
            x: newPosition.x - centroid.x,
            y: newPosition.y - centroid.y
        };

        result.push(...moveElements(rotated, delta).map(el => ({
            ...el,
            id: generateId(),
            selected: false
        })));
    }

    return result;
}

// ============================================================================
// ROTATE OPERATIONS
// ============================================================================

/**
 * Rotate element around a point
 */
export function rotateElement(
    element: CADElement,
    center: Point,
    angle: number
): CADElement {
    const rotated = { ...element };
    const angleRad = degToRad(angle);
    const matrix = createTransform(center, angleRad, { x: 1, y: 1 });

    // Apply inverse translation for rotation around center
    const negCenter = { x: -center.x, y: -center.y };
    const moveToOrigin = createTransform(negCenter, 0, { x: 1, y: 1 });
    const rotateMatrix = createTransform({ x: 0, y: 0 }, angleRad, { x: 1, y: 1 });
    const moveBack = createTransform(center, 0, { x: 1, y: 1 });

    const transformPointAround = (p: Point) => {
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    };

    if (element.start) {
        rotated.start = transformPointAround(element.start);
    }

    if (element.end) {
        rotated.end = transformPointAround(element.end);
    }

    if (element.center) {
        rotated.center = transformPointAround(element.center);
    }

    if (element.points) {
        rotated.points = element.points.map(transformPointAround);
    }

    if (element.offsetPoint) {
        rotated.offsetPoint = transformPointAround(element.offsetPoint);
    }

    // Update arc angles if applicable
    if (element.type === 'ARC' && element.startAngle !== undefined && element.endAngle !== undefined) {
        rotated.startAngle = element.startAngle + angle;
        rotated.endAngle = element.endAngle + angle;
    }

    return rotated;
}

/**
 * Rotate multiple elements around a point
 */
export function rotateElements(
    elements: CADElement[],
    center: Point,
    angle: number
): CADElement[] {
    return elements.map(el => rotateElement(el, center, angle));
}

// ============================================================================
// SCALE OPERATIONS
// ============================================================================

/**
 * Scale element from a base point
 */
export function scaleElement(
    element: CADElement,
    basePoint: Point,
    scaleX: number,
    scaleY: number
): CADElement {
    const scaled = { ...element };

    const scalePoint = (p: Point) => ({
        x: basePoint.x + (p.x - basePoint.x) * scaleX,
        y: basePoint.y + (p.y - basePoint.y) * scaleY
    });

    if (element.start) {
        scaled.start = scalePoint(element.start);
    }

    if (element.end) {
        scaled.end = scalePoint(element.end);
    }

    if (element.center) {
        scaled.center = scalePoint(element.center);
    }

    if (element.radius) {
        scaled.radius = element.radius * Math.abs(scaleX); // Assuming uniform scale
    }

    if (element.width) {
        scaled.width = element.width * scaleX;
    }

    if (element.height) {
        scaled.height = element.height * scaleY;
    }

    if (element.points) {
        scaled.points = element.points.map(scalePoint);
    }

    if (element.offsetPoint) {
        scaled.offsetPoint = scalePoint(element.offsetPoint);
    }

    if (element.fontSize) {
        scaled.fontSize = element.fontSize * Math.abs(scaleX);
    }

    return scaled;
}

/**
 * Scale multiple elements
 */
export function scaleElements(
    elements: CADElement[],
    basePoint: Point,
    scaleX: number,
    scaleY: number
): CADElement[] {
    return elements.map(el => scaleElement(el, basePoint, scaleX, scaleY));
}

/**
 * Uniform scale (same factor for X and Y)
 */
export function uniformScale(
    elements: CADElement[],
    basePoint: Point,
    scaleFactor: number
): CADElement[] {
    return scaleElements(elements, basePoint, scaleFactor, scaleFactor);
}

// ============================================================================
// MIRROR OPERATIONS
// ============================================================================

/**
 * Mirror element across a line
 */
export function mirrorElement(
    element: CADElement,
    mirrorLine: { start: Point; end: Point }
): CADElement {
    const mirrored = { ...element };

    const dx = mirrorLine.end.x - mirrorLine.start.x;
    const dy = mirrorLine.end.y - mirrorLine.start.y;
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(2 * angle);
    const sin = Math.sin(2 * angle);

    const mirrorPoint = (p: Point) => {
        const px = p.x - mirrorLine.start.x;
        const py = p.y - mirrorLine.start.y;
        return {
            x: mirrorLine.start.x + px * cos + py * sin,
            y: mirrorLine.start.y + px * sin - py * cos
        };
    };

    if (element.start) {
        mirrored.start = mirrorPoint(element.start);
    }

    if (element.end) {
        mirrored.end = mirrorPoint(element.end);
    }

    if (element.center) {
        mirrored.center = mirrorPoint(element.center);
    }

    if (element.points) {
        mirrored.points = element.points.map(mirrorPoint);
    }

    if (element.offsetPoint) {
        mirrored.offsetPoint = mirrorPoint(element.offsetPoint);
    }

    // Mirror arc angles
    if (element.type === 'ARC' && element.startAngle !== undefined && element.endAngle !== undefined) {
        const mirrorAngle = radToDeg(angle) * 2;
        mirrored.startAngle = mirrorAngle - element.endAngle;
        mirrored.endAngle = mirrorAngle - element.startAngle;
        if (element.clockwise !== undefined) {
            mirrored.clockwise = !element.clockwise;
        }
    }

    return mirrored;
}

/**
 * Mirror multiple elements
 */
export function mirrorElements(
    elements: CADElement[],
    mirrorLine: { start: Point; end: Point }
): CADElement[] {
    return elements.map(el => mirrorElement(el, mirrorLine));
}

/**
 * Mirror horizontally (across vertical line)
 */
export function mirrorHorizontal(elements: CADElement[], centerX: number): CADElement[] {
    return mirrorElements(elements, {
        start: { x: centerX, y: -1000 },
        end: { x: centerX, y: 1000 }
    });
}

/**
 * Mirror vertically (across horizontal line)
 */
export function mirrorVertical(elements: CADElement[], centerY: number): CADElement[] {
    return mirrorElements(elements, {
        start: { x: -1000, y: centerY },
        end: { x: 1000, y: centerY }
    });
}

// ============================================================================
// ALIGN OPERATIONS
// ============================================================================

/**
 * Align elements to left edge
 */
export function alignLeft(elements: CADElement[]): CADElement[] {
    if (elements.length === 0) return elements;

    const minX = Math.min(...elements.map(el => getElementMinX(el)));
    return elements.map(el => {
        const currentMinX = getElementMinX(el);
        return moveElement(el, { x: minX - currentMinX, y: 0 });
    });
}

/**
 * Align elements to right edge
 */
export function alignRight(elements: CADElement[]): CADElement[] {
    if (elements.length === 0) return elements;

    const maxX = Math.max(...elements.map(el => getElementMaxX(el)));
    return elements.map(el => {
        const currentMaxX = getElementMaxX(el);
        return moveElement(el, { x: maxX - currentMaxX, y: 0 });
    });
}

/**
 * Align elements to top edge
 */
export function alignTop(elements: CADElement[]): CADElement[] {
    if (elements.length === 0) return elements;

    const minY = Math.min(...elements.map(el => getElementMinY(el)));
    return elements.map(el => {
        const currentMinY = getElementMinY(el);
        return moveElement(el, { x: 0, y: minY - currentMinY });
    });
}

/**
 * Align elements to bottom edge
 */
export function alignBottom(elements: CADElement[]): CADElement[] {
    if (elements.length === 0) return elements;

    const maxY = Math.max(...elements.map(el => getElementMaxY(el)));
    return elements.map(el => {
        const currentMaxY = getElementMaxY(el);
        return moveElement(el, { x: 0, y: maxY - currentMaxY });
    });
}

/**
 * Align elements to vertical center
 */
export function alignCenterVertical(elements: CADElement[]): CADElement[] {
    if (elements.length === 0) return elements;

    const centerX = elements.reduce((sum, el) => sum + getElementCenterX(el), 0) / elements.length;
    return elements.map(el => {
        const currentCenterX = getElementCenterX(el);
        return moveElement(el, { x: centerX - currentCenterX, y: 0 });
    });
}

/**
 * Align elements to horizontal center
 */
export function alignCenterHorizontal(elements: CADElement[]): CADElement[] {
    if (elements.length === 0) return elements;

    const centerY = elements.reduce((sum, el) => sum + getElementCenterY(el), 0) / elements.length;
    return elements.map(el => {
        const currentCenterY = getElementCenterY(el);
        return moveElement(el, { x: 0, y: centerY - currentCenterY });
    });
}

/**
 * Distribute elements horizontally with equal spacing
 */
export function distributeHorizontally(elements: CADElement[]): CADElement[] {
    if (elements.length < 3) return elements;

    const sorted = [...elements].sort((a, b) => getElementCenterX(a) - getElementCenterX(b));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstCenter = getElementCenterX(first);
    const lastCenter = getElementCenterX(last);
    const totalSpan = lastCenter - firstCenter;
    const spacing = totalSpan / (sorted.length - 1);

    return sorted.map((el, index) => {
        if (index === 0 || index === sorted.length - 1) return el;
        const targetX = firstCenter + spacing * index;
        const currentX = getElementCenterX(el);
        return moveElement(el, { x: targetX - currentX, y: 0 });
    });
}

/**
 * Distribute elements vertically with equal spacing
 */
export function distributeVertically(elements: CADElement[]): CADElement[] {
    if (elements.length < 3) return elements;

    const sorted = [...elements].sort((a, b) => getElementCenterY(a) - getElementCenterY(b));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstCenter = getElementCenterY(first);
    const lastCenter = getElementCenterY(last);
    const totalSpan = lastCenter - firstCenter;
    const spacing = totalSpan / (sorted.length - 1);

    return sorted.map((el, index) => {
        if (index === 0 || index === sorted.length - 1) return el;
        const targetY = firstCenter + spacing * index;
        const currentY = getElementCenterY(el);
        return moveElement(el, { x: 0, y: targetY - currentY });
    });
}

// ============================================================================
// STRETCH OPERATIONS
// ============================================================================

/**
 * Stretch element (move endpoints within selection)
 */
export function stretchElement(
    element: CADElement,
    stretchBox: { minX: number; minY: number; maxX: number; maxY: number },
    delta: Point
): CADElement {
    const stretched = { ...element };

    const isInStretchBox = (p: Point) =>
        p.x >= stretchBox.minX && p.x <= stretchBox.maxX &&
        p.y >= stretchBox.minY && p.y <= stretchBox.maxY;

    if (element.type === 'LINE' && element.start && element.end) {
        if (isInStretchBox(element.start)) {
            stretched.start = {
                x: element.start.x + delta.x,
                y: element.start.y + delta.y
            };
        }
        if (isInStretchBox(element.end)) {
            stretched.end = {
                x: element.end.x + delta.x,
                y: element.end.y + delta.y
            };
        }
    } else if (element.type === 'LWPOLYLINE' && element.points) {
        stretched.points = element.points.map(p =>
            isInStretchBox(p)
                ? { x: p.x + delta.x, y: p.y + delta.y }
                : p
        );
    } else {
        // For other elements, move entirely if any point is in stretch box
        const elementPoints = getElementPoints(element);
        if (elementPoints.some(isInStretchBox)) {
            return moveElement(element, delta);
        }
    }

    return stretched;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get centroid of multiple elements
 */
export function getElementsCentroid(elements: CADElement[]): Point {
    let totalX = 0;
    let totalY = 0;
    let count = 0;

    elements.forEach(el => {
        const points = getElementPoints(el);
        points.forEach(p => {
            totalX += p.x;
            totalY += p.y;
            count++;
        });
    });

    return count > 0
        ? { x: totalX / count, y: totalY / count }
        : { x: 0, y: 0 };
}

/**
 * Get all points from an element
 */
function getElementPoints(element: CADElement): Point[] {
    const points: Point[] = [];

    if (element.start) points.push(element.start);
    if (element.end) points.push(element.end);
    if (element.center) points.push(element.center);
    if (element.points) points.push(...element.points);
    if (element.offsetPoint) points.push(element.offsetPoint);

    return points;
}

/**
 * Get minimum X coordinate of element
 */
function getElementMinX(element: CADElement): number {
    const points = getElementPoints(element);
    if (points.length === 0) return 0;
    return Math.min(...points.map(p => p.x));
}

/**
 * Get maximum X coordinate of element
 */
function getElementMaxX(element: CADElement): number {
    const points = getElementPoints(element);
    if (points.length === 0) return 0;
    return Math.max(...points.map(p => p.x));
}

/**
 * Get minimum Y coordinate of element
 */
function getElementMinY(element: CADElement): number {
    const points = getElementPoints(element);
    if (points.length === 0) return 0;
    return Math.min(...points.map(p => p.y));
}

/**
 * Get maximum Y coordinate of element
 */
function getElementMaxY(element: CADElement): number {
    const points = getElementPoints(element);
    if (points.length === 0) return 0;
    return Math.max(...points.map(p => p.y));
}

/**
 * Get center X coordinate of element
 */
function getElementCenterX(element: CADElement): number {
    return (getElementMinX(element) + getElementMaxX(element)) / 2;
}

/**
 * Get center Y coordinate of element
 */
function getElementCenterY(element: CADElement): number {
    return (getElementMinY(element) + getElementMaxY(element)) / 2;
}

/**
 * Generate unique ID
 */
function generateId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Get combined bounding box of multiple elements
 */
export function getCombinedBoundingBox(elements: CADElement[]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
} {
    if (elements.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    elements.forEach(el => {
        minX = Math.min(minX, getElementMinX(el));
        minY = Math.min(minY, getElementMinY(el));
        maxX = Math.max(maxX, getElementMaxX(el));
        maxY = Math.max(maxY, getElementMaxY(el));
    });

    return { minX, minY, maxX, maxY };
}
