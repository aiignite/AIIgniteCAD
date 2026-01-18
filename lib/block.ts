// Block Operations Library for AIIgniteCAD
// Comprehensive block definition and reference management

import {
    Point,
    CADElement,
    BlockDefinition,
    BlockReference,
    Transform
} from '../types';
import {
    transformPoint,
    createTransform,
    degToRad,
    distance,
    boundingBoxFromPoints,
    BoundingBox
} from './geometry';

// ============================================================================
// BLOCK DEFINITION OPERATIONS
// ============================================================================

/**
 * Create a new block definition from selected elements
 */
export function createBlockDefinition(
    name: string,
    elements: CADElement[],
    basePoint: Point,
    description?: string
): BlockDefinition {
    const id = generateId();
    const now = new Date().toISOString();

    // Normalize elements to be relative to base point
    const normalizedElements = elements.map(el => normalizeElementToBasePoint(el, basePoint));

    return {
        id,
        name,
        description,
        basePoint: { x: 0, y: 0 }, // Base point is origin in block space
        elements: normalizedElements,
        isPublic: false,
        createdAt: now,
        updatedAt: now
    };
}

/**
 * Update an existing block definition
 */
export function updateBlockDefinition(
    blockDef: BlockDefinition,
    updates: Partial<BlockDefinition>
): BlockDefinition {
    return {
        ...blockDef,
        ...updates,
        updatedAt: new Date().toISOString()
    };
}

/**
 * Add elements to a block definition
 */
export function addElementsToBlock(
    blockDef: BlockDefinition,
    elements: CADElement[],
    basePoint: Point
): BlockDefinition {
    const normalizedElements = elements.map(el => normalizeElementToBasePoint(el, basePoint));

    return {
        ...blockDef,
        elements: [...blockDef.elements, ...normalizedElements],
        updatedAt: new Date().toISOString()
    };
}

/**
 * Remove elements from a block definition
 */
export function removeElementsFromBlock(
    blockDef: BlockDefinition,
    elementIds: string[]
): BlockDefinition {
    return {
        ...blockDef,
        elements: blockDef.elements.filter(el => !elementIds.includes(el.id)),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Generate thumbnail for block definition (returns SVG string)
 */
export function generateBlockThumbnail(
    blockDef: BlockDefinition,
    size: number = 100
): string {
    const bbox = getBlockBoundingBox(blockDef);
    const width = bbox.maxX - bbox.minX;
    const height = bbox.maxY - bbox.minY;
    const scale = Math.min(size / width, size / height) * 0.8;
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;

    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="${size}" height="${size}" fill="white"/>`;
    svg += `<g transform="translate(${size / 2},${size / 2}) scale(${scale},-${scale}) translate(${-centerX},${-centerY})">`;

    blockDef.elements.forEach(el => {
        svg += renderElementToSVG(el);
    });

    svg += `</g></svg>`;
    return svg;
}

/**
 * Get bounding box of block definition
 */
export function getBlockBoundingBox(blockDef: BlockDefinition): BoundingBox {
    const points: Point[] = [];

    blockDef.elements.forEach(el => {
        if (el.type === 'LINE' && el.start && el.end) {
            points.push(el.start, el.end);
        } else if (el.type === 'CIRCLE' && el.center && el.radius) {
            points.push(
                { x: el.center.x - el.radius, y: el.center.y - el.radius },
                { x: el.center.x + el.radius, y: el.center.y + el.radius }
            );
        } else if (el.type === 'RECTANGLE' && el.start && el.width && el.height) {
            points.push(
                el.start,
                { x: el.start.x + el.width, y: el.start.y + el.height }
            );
        } else if (el.type === 'LWPOLYLINE' && el.points) {
            points.push(...el.points);
        } else if (el.type === 'TEXT' && el.start) {
            points.push(el.start);
        }
    });

    return boundingBoxFromPoints(points);
}

// ============================================================================
// BLOCK REFERENCE OPERATIONS
// ============================================================================

/**
 * Create a new block reference (insert block into drawing)
 */
export function createBlockReference(
    blockDefinitionId: string,
    insertionPoint: Point,
    layer: string = '0',
    rotation: number = 0,
    scaleX: number = 1,
    scaleY: number = 1
): BlockReference {
    return {
        id: generateId(),
        blockDefinitionId,
        layer,
        insertionPoint,
        rotation,
        scaleX,
        scaleY,
        selected: false
    };
}

/**
 * Update block reference transformation
 */
export function updateBlockReference(
    blockRef: BlockReference,
    updates: Partial<BlockReference>
): BlockReference {
    return {
        ...blockRef,
        ...updates
    };
}

/**
 * Move block reference
 */
export function moveBlockReference(
    blockRef: BlockReference,
    delta: Point
): BlockReference {
    return {
        ...blockRef,
        insertionPoint: {
            x: blockRef.insertionPoint.x + delta.x,
            y: blockRef.insertionPoint.y + delta.y
        }
    };
}

/**
 * Rotate block reference
 */
export function rotateBlockReference(
    blockRef: BlockReference,
    angle: number,
    center?: Point
): BlockReference {
    if (!center || (center.x === blockRef.insertionPoint.x && center.y === blockRef.insertionPoint.y)) {
        // Rotate around insertion point
        return {
            ...blockRef,
            rotation: blockRef.rotation + angle
        };
    }

    // Rotate around different point
    const angleRad = degToRad(angle);
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const dx = blockRef.insertionPoint.x - center.x;
    const dy = blockRef.insertionPoint.y - center.y;

    return {
        ...blockRef,
        insertionPoint: {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        },
        rotation: blockRef.rotation + angle
    };
}

/**
 * Scale block reference
 */
export function scaleBlockReference(
    blockRef: BlockReference,
    scaleFactorX: number,
    scaleFactorY: number,
    center?: Point
): BlockReference {
    const newRef = {
        ...blockRef,
        scaleX: blockRef.scaleX * scaleFactorX,
        scaleY: blockRef.scaleY * scaleFactorY
    };

    if (center && (center.x !== blockRef.insertionPoint.x || center.y !== blockRef.insertionPoint.y)) {
        // Scale position relative to center
        const dx = blockRef.insertionPoint.x - center.x;
        const dy = blockRef.insertionPoint.y - center.y;
        newRef.insertionPoint = {
            x: center.x + dx * scaleFactorX,
            y: center.y + dy * scaleFactorY
        };
    }

    return newRef;
}

/**
 * Mirror block reference
 */
export function mirrorBlockReference(
    blockRef: BlockReference,
    mirrorLine: { start: Point; end: Point }
): BlockReference {
    // Calculate mirror transformation
    const dx = mirrorLine.end.x - mirrorLine.start.x;
    const dy = mirrorLine.end.y - mirrorLine.start.y;
    const angle = Math.atan2(dy, dx);

    // Mirror insertion point
    const cos = Math.cos(2 * angle);
    const sin = Math.sin(2 * angle);
    const px = blockRef.insertionPoint.x - mirrorLine.start.x;
    const py = blockRef.insertionPoint.y - mirrorLine.start.y;

    return {
        ...blockRef,
        insertionPoint: {
            x: mirrorLine.start.x + px * cos + py * sin,
            y: mirrorLine.start.y + px * sin - py * cos
        },
        scaleX: -blockRef.scaleX,
        rotation: -blockRef.rotation
    };
}

// ============================================================================
// BLOCK TRANSFORMATION AND EXPANSION
// ============================================================================

/**
 * Get transformation matrix for block reference
 */
export function getBlockTransform(blockRef: BlockReference): Transform {
    return {
        translation: blockRef.insertionPoint,
        rotation: degToRad(blockRef.rotation),
        scale: { x: blockRef.scaleX, y: blockRef.scaleY }
    };
}

/**
 * Apply block transformation to a point
 */
export function transformPointByBlock(point: Point, blockRef: BlockReference): Point {
    const transform = getBlockTransform(blockRef);
    const matrix = createTransform(
        transform.translation,
        transform.rotation,
        transform.scale
    );
    return transformPoint(point, matrix);
}

/**
 * Explode block reference into individual elements
 * Converts block reference back to its constituent elements with transformations applied
 */
export function explodeBlockReference(
    blockRef: BlockReference,
    blockDef: BlockDefinition
): CADElement[] {
    const matrix = createTransform(
        blockRef.insertionPoint,
        degToRad(blockRef.rotation),
        { x: blockRef.scaleX, y: blockRef.scaleY }
    );

    return blockDef.elements.map(el => transformElement(el, matrix));
}

/**
 * Transform a CAD element by transformation matrix
 */
export function transformElement(element: CADElement, matrix: any): CADElement {
    const transformed: CADElement = {
        ...element,
        id: generateId() // Generate new ID for exploded element
    };

    if (element.type === 'LINE' && element.start && element.end) {
        transformed.start = transformPoint(element.start, matrix);
        transformed.end = transformPoint(element.end, matrix);
    } else if (element.type === 'CIRCLE' && element.center && element.radius) {
        transformed.center = transformPoint(element.center, matrix);
        // Note: radius scaling assumes uniform scale
        transformed.radius = element.radius * Math.abs(matrix.a);
    } else if (element.type === 'RECTANGLE' && element.start && element.width && element.height) {
        // Convert rectangle to polyline for non-uniform transformations
        const points = [
            element.start,
            { x: element.start.x + element.width, y: element.start.y },
            { x: element.start.x + element.width, y: element.start.y + element.height },
            { x: element.start.x, y: element.start.y + element.height }
        ];
        transformed.type = 'LWPOLYLINE';
        transformed.points = points.map(p => transformPoint(p, matrix));
        delete transformed.start;
        delete transformed.width;
        delete transformed.height;
    } else if (element.type === 'LWPOLYLINE' && element.points) {
        transformed.points = element.points.map(p => transformPoint(p, matrix));
    } else if (element.type === 'TEXT' && element.start) {
        transformed.start = transformPoint(element.start, matrix);
        if (element.fontSize) {
            transformed.fontSize = element.fontSize * Math.abs(matrix.a);
        }
    } else if (element.type === 'ARC' && element.center && element.radius) {
        transformed.center = transformPoint(element.center, matrix);
        transformed.radius = element.radius * Math.abs(matrix.a);
        // Note: angles might need adjustment for rotation
        if (element.startAngle !== undefined && element.endAngle !== undefined) {
            const rotationAngle = Math.atan2(matrix.b, matrix.a);
            transformed.startAngle = element.startAngle + rotationAngle * 180 / Math.PI;
            transformed.endAngle = element.endAngle + rotationAngle * 180 / Math.PI;
        }
    }

    return transformed;
}

/**
 * Get all elements from block reference (transformed)
 * This doesn't explode, just returns transformed elements for rendering
 */
export function getBlockReferenceElements(
    blockRef: BlockReference,
    blockDef: BlockDefinition
): CADElement[] {
    return explodeBlockReference(blockRef, blockDef).map(el => ({
        ...el,
        blockReferenceId: blockRef.id // Mark as part of block
    }));
}

// ============================================================================
// BLOCK LIBRARY OPERATIONS
// ============================================================================

/**
 * Search blocks by name
 */
export function searchBlocks(
    blocks: BlockDefinition[],
    query: string
): BlockDefinition[] {
    const lowerQuery = query.toLowerCase();
    return blocks.filter(block =>
        block.name.toLowerCase().includes(lowerQuery) ||
        (block.description && block.description.toLowerCase().includes(lowerQuery))
    );
}

/**
 * Filter public blocks
 */
export function getPublicBlocks(blocks: BlockDefinition[]): BlockDefinition[] {
    return blocks.filter(block => block.isPublic);
}

/**
 * Filter user's private blocks
 */
export function getUserBlocks(blocks: BlockDefinition[], userId: string): BlockDefinition[] {
    return blocks.filter(block => block.userId === userId && !block.isPublic);
}

/**
 * Filter project-specific blocks
 */
export function getProjectBlocks(blocks: BlockDefinition[], projectId: string): BlockDefinition[] {
    return blocks.filter(block => block.projectId === projectId);
}

/**
 * Sort blocks by name
 */
export function sortBlocksByName(blocks: BlockDefinition[]): BlockDefinition[] {
    return [...blocks].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Sort blocks by date (most recent first)
 */
export function sortBlocksByDate(blocks: BlockDefinition[]): BlockDefinition[] {
    return [...blocks].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}

// ============================================================================
// BLOCK VALIDATION
// ============================================================================

/**
 * Validate block definition
 */
export function validateBlockDefinition(blockDef: BlockDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!blockDef.name || blockDef.name.trim() === '') {
        errors.push('Block name is required');
    }

    if (blockDef.name.length > 255) {
        errors.push('Block name is too long (max 255 characters)');
    }

    if (!blockDef.elements || blockDef.elements.length === 0) {
        errors.push('Block must contain at least one element');
    }

    if (!blockDef.basePoint) {
        errors.push('Block must have a base point');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Check if block name is unique
 */
export function isBlockNameUnique(
    name: string,
    blocks: BlockDefinition[],
    excludeId?: string
): boolean {
    return !blocks.some(block =>
        block.name.toLowerCase() === name.toLowerCase() &&
        block.id !== excludeId
    );
}

// ============================================================================
// BLOCK NESTING
// ============================================================================

/**
 * Check if a block contains nested block references
 */
export function hasNestedBlocks(blockDef: BlockDefinition): boolean {
    return blockDef.elements.some(el => el.type === 'BLOCK_REFERENCE');
}

/**
 * Get all nested block IDs (recursive)
 */
export function getNestedBlockIds(
    blockDef: BlockDefinition,
    allBlocks: BlockDefinition[]
): string[] {
    const nestedIds = new Set<string>();

    function traverse(block: BlockDefinition) {
        block.elements.forEach(el => {
            if (el.type === 'BLOCK_REFERENCE' && el.blockReferenceId) {
                nestedIds.add(el.blockReferenceId);
                const nestedBlock = allBlocks.find(b => b.id === el.blockReferenceId);
                if (nestedBlock) {
                    traverse(nestedBlock);
                }
            }
        });
    }

    traverse(blockDef);
    return Array.from(nestedIds);
}

/**
 * Check for circular block references
 */
export function hasCircularReference(
    blockDef: BlockDefinition,
    allBlocks: BlockDefinition[],
    visited: Set<string> = new Set()
): boolean {
    if (visited.has(blockDef.id)) {
        return true;
    }

    visited.add(blockDef.id);

    for (const el of blockDef.elements) {
        if (el.type === 'BLOCK_REFERENCE' && el.blockReferenceId) {
            const nestedBlock = allBlocks.find(b => b.id === el.blockReferenceId);
            if (nestedBlock && hasCircularReference(nestedBlock, allBlocks, new Set(visited))) {
                return true;
            }
        }
    }

    return false;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate unique ID
 */
function generateId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Normalize element coordinates relative to base point
 */
function normalizeElementToBasePoint(element: CADElement, basePoint: Point): CADElement {
    const normalized = { ...element };

    if (element.start) {
        normalized.start = {
            x: element.start.x - basePoint.x,
            y: element.start.y - basePoint.y
        };
    }

    if (element.end) {
        normalized.end = {
            x: element.end.x - basePoint.x,
            y: element.end.y - basePoint.y
        };
    }

    if (element.center) {
        normalized.center = {
            x: element.center.x - basePoint.x,
            y: element.center.y - basePoint.y
        };
    }

    if (element.points) {
        normalized.points = element.points.map(p => ({
            x: p.x - basePoint.x,
            y: p.y - basePoint.y
        }));
    }

    return normalized;
}

/**
 * Simple SVG renderer for thumbnail generation
 */
function renderElementToSVG(element: CADElement): string {
    const color = element.color || '#000000';

    if (element.type === 'LINE' && element.start && element.end) {
        return `<line x1="${element.start.x}" y1="${element.start.y}" x2="${element.end.x}" y2="${element.end.y}" stroke="${color}" stroke-width="1" />`;
    }

    if (element.type === 'CIRCLE' && element.center && element.radius) {
        return `<circle cx="${element.center.x}" cy="${element.center.y}" r="${element.radius}" stroke="${color}" fill="none" stroke-width="1" />`;
    }

    if (element.type === 'RECTANGLE' && element.start && element.width && element.height) {
        return `<rect x="${element.start.x}" y="${element.start.y}" width="${element.width}" height="${element.height}" stroke="${color}" fill="none" stroke-width="1" />`;
    }

    if (element.type === 'LWPOLYLINE' && element.points && element.points.length > 0) {
        const pathData = element.points.map((p, i) =>
            `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
        ).join(' ');
        return `<path d="${pathData}" stroke="${color}" fill="none" stroke-width="1" />`;
    }

    return '';
}

/**
 * Clone block definition (for duplication)
 */
export function cloneBlockDefinition(
    blockDef: BlockDefinition,
    newName: string
): BlockDefinition {
    return {
        ...blockDef,
        id: generateId(),
        name: newName,
        elements: blockDef.elements.map(el => ({ ...el, id: generateId() })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}
