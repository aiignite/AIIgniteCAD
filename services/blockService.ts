// Block Service for AIIgniteCAD Frontend
// Manages block operations with local IndexedDB and backend sync

import { BlockDefinition, BlockReference, CADElement, Point } from '../types';
import { indexedDBService } from './indexedDBService';
import {
    createBlockDefinition,
    createBlockReference,
    explodeBlockReference,
    getBlockReferenceElements,
    updateBlockDefinition,
    validateBlockDefinition,
    isBlockNameUnique,
    generateBlockThumbnail,
    hasCircularReference,
    cloneBlockDefinition
} from '../lib/block';

// ============================================================================
// BLOCK DEFINITION MANAGEMENT
// ============================================================================

/**
 * Create a new block definition from selected elements
 */
export async function createBlock(
    name: string,
    elements: CADElement[],
    basePoint: Point,
    description?: string,
    projectId?: string,
    userId?: string
): Promise<BlockDefinition> {
    // Validate block name
    const existingBlocks = await indexedDBService.getAllBlockDefinitions();

    if (!isBlockNameUnique(name, existingBlocks)) {
        throw new Error(`Block name "${name}" already exists`);
    }

    // Create block definition
    const blockDef = createBlockDefinition(name, elements, basePoint, description);
    blockDef.projectId = projectId;
    blockDef.userId = userId;

    // Validate
    const validation = validateBlockDefinition(blockDef);
    if (!validation.valid) {
        throw new Error(`Invalid block definition: ${validation.errors.join(', ')}`);
    }

    // Generate thumbnail
    blockDef.thumbnail = generateBlockThumbnail(blockDef);

    // Save to IndexedDB
    await indexedDBService.saveBlockDefinition(blockDef);

    return blockDef;
}

/**
 * Update an existing block definition
 */
export async function updateBlock(
    blockId: string,
    updates: Partial<BlockDefinition>
): Promise<BlockDefinition> {
    const blockDef = await indexedDBService.getBlockDefinition(blockId);

    if (!blockDef) {
        throw new Error(`Block definition ${blockId} not found`);
    }

    // Check name uniqueness if name is being changed
    if (updates.name && updates.name !== blockDef.name) {
        const existingBlocks = await indexedDBService.getAllBlockDefinitions();
        if (!isBlockNameUnique(updates.name, existingBlocks, blockId)) {
            throw new Error(`Block name "${updates.name}" already exists`);
        }
    }

    const updatedBlock = updateBlockDefinition(blockDef, updates);

    // Regenerate thumbnail if elements changed
    if (updates.elements) {
        updatedBlock.thumbnail = generateBlockThumbnail(updatedBlock);
    }

    // Save to IndexedDB
    await indexedDBService.saveBlockDefinition(updatedBlock);

    return updatedBlock;
}

/**
 * Delete a block definition
 */
export async function deleteBlock(blockId: string): Promise<void> {
    // Check if block is used in any project
    const allProjects = await indexedDBService.getAllProjects();

    for (const project of allProjects) {
        const blockRefs = await indexedDBService.getBlockReferencesByProject(project.id);
        const isUsed = blockRefs.some(ref => ref.blockDefinitionId === blockId);

        if (isUsed) {
            throw new Error('Cannot delete block: it is currently in use in one or more projects');
        }
    }

    await indexedDBService.delete('blockDefinitions', blockId);
}

/**
 * Get block definition by ID
 */
export async function getBlock(blockId: string): Promise<BlockDefinition | undefined> {
    return await indexedDBService.getBlockDefinition(blockId);
}

/**
 * Get all block definitions
 */
export async function getAllBlocks(): Promise<BlockDefinition[]> {
    return await indexedDBService.getAllBlockDefinitions();
}

/**
 * Get public blocks (shared library)
 */
export async function getPublicBlocks(): Promise<BlockDefinition[]> {
    return await indexedDBService.getPublicBlockDefinitions();
}

/**
 * Get user's private blocks
 */
export async function getUserBlocks(userId: string): Promise<BlockDefinition[]> {
    const allBlocks = await indexedDBService.getAllBlockDefinitions();
    return allBlocks.filter(block => block.userId === userId && !block.isPublic);
}

/**
 * Get project-specific blocks
 */
export async function getProjectBlocks(projectId: string): Promise<BlockDefinition[]> {
    const allBlocks = await indexedDBService.getAllBlockDefinitions();
    return allBlocks.filter(block => block.projectId === projectId);
}

/**
 * Clone (duplicate) a block definition
 */
export async function cloneBlock(
    blockId: string,
    newName: string
): Promise<BlockDefinition> {
    const originalBlock = await indexedDBService.getBlockDefinition(blockId);

    if (!originalBlock) {
        throw new Error(`Block definition ${blockId} not found`);
    }

    // Check name uniqueness
    const existingBlocks = await indexedDBService.getAllBlockDefinitions();
    if (!isBlockNameUnique(newName, existingBlocks)) {
        throw new Error(`Block name "${newName}" already exists`);
    }

    const cloned = cloneBlockDefinition(originalBlock, newName);
    cloned.thumbnail = generateBlockThumbnail(cloned);

    await indexedDBService.saveBlockDefinition(cloned);

    return cloned;
}

/**
 * Search blocks by name or description
 */
export async function searchBlocks(query: string): Promise<BlockDefinition[]> {
    const allBlocks = await indexedDBService.getAllBlockDefinitions();
    const lowerQuery = query.toLowerCase();

    return allBlocks.filter(block =>
        block.name.toLowerCase().includes(lowerQuery) ||
        (block.description && block.description.toLowerCase().includes(lowerQuery))
    );
}

// ============================================================================
// BLOCK REFERENCE MANAGEMENT
// ============================================================================

/**
 * Insert a block reference into a project
 */
export async function insertBlockReference(
    projectId: string,
    blockDefinitionId: string,
    insertionPoint: Point,
    layer: string = '0',
    rotation: number = 0,
    scaleX: number = 1,
    scaleY: number = 1
): Promise<BlockReference> {
    // Verify block exists
    const blockDef = await indexedDBService.getBlockDefinition(blockDefinitionId);

    if (!blockDef) {
        throw new Error(`Block definition ${blockDefinitionId} not found`);
    }

    // Check for circular references if block contains nested blocks
    const allBlocks = await indexedDBService.getAllBlockDefinitions();
    if (hasCircularReference(blockDef, allBlocks)) {
        throw new Error('Cannot insert block: circular reference detected');
    }

    const blockRef = createBlockReference(
        blockDefinitionId,
        insertionPoint,
        layer,
        rotation,
        scaleX,
        scaleY
    );

    blockRef.blockDefinition = blockDef; // Include definition for rendering

    await indexedDBService.saveBlockReference(blockRef, projectId);

    return blockRef;
}

/**
 * Update a block reference
 */
export async function updateBlockReference(
    projectId: string,
    blockRefId: string,
    updates: Partial<BlockReference>
): Promise<BlockReference> {
    const blockRefs = await indexedDBService.getBlockReferencesByProject(projectId);
    const blockRef = blockRefs.find(ref => ref.id === blockRefId);

    if (!blockRef) {
        throw new Error(`Block reference ${blockRefId} not found`);
    }

    const updated = { ...blockRef, ...updates };
    await indexedDBService.saveBlockReference(updated, projectId);

    return updated;
}

/**
 * Delete a block reference
 */
export async function deleteBlockReference(
    projectId: string,
    blockRefId: string
): Promise<void> {
    await indexedDBService.delete('blockReferences', blockRefId);
}

/**
 * Get all block references in a project
 */
export async function getProjectBlockReferences(
    projectId: string
): Promise<BlockReference[]> {
    const blockRefs = await indexedDBService.getBlockReferencesByProject(projectId);

    // Load block definitions for each reference
    const blockRefsWithDefs = await Promise.all(
        blockRefs.map(async (ref) => {
            const blockDef = await indexedDBService.getBlockDefinition(ref.blockDefinitionId);
            return { ...ref, blockDefinition: blockDef };
        })
    );

    return blockRefsWithDefs;
}

/**
 * Explode a block reference (convert to individual elements)
 */
export async function explodeBlock(
    projectId: string,
    blockRefId: string
): Promise<CADElement[]> {
    const blockRefs = await indexedDBService.getBlockReferencesByProject(projectId);
    const blockRef = blockRefs.find(ref => ref.id === blockRefId);

    if (!blockRef) {
        throw new Error(`Block reference ${blockRefId} not found`);
    }

    const blockDef = await indexedDBService.getBlockDefinition(blockRef.blockDefinitionId);

    if (!blockDef) {
        throw new Error(`Block definition ${blockRef.blockDefinitionId} not found`);
    }

    // Explode to elements
    const elements = explodeBlockReference(blockRef, blockDef);

    // Save elements to project
    for (const element of elements) {
        await indexedDBService.saveElement(element, projectId);
    }

    // Delete block reference
    await deleteBlockReference(projectId, blockRefId);

    return elements;
}

/**
 * Get rendered elements from a block reference (for display)
 */
export async function getBlockReferenceRenderedElements(
    blockRef: BlockReference
): Promise<CADElement[]> {
    const blockDef = await indexedDBService.getBlockDefinition(blockRef.blockDefinitionId);

    if (!blockDef) {
        return [];
    }

    return getBlockReferenceElements(blockRef, blockDef);
}

/**
 * Update all references when a block definition changes
 */
export async function updateAllBlockReferences(
    blockDefinitionId: string
): Promise<void> {
    const allProjects = await indexedDBService.getAllProjects();

    for (const project of allProjects) {
        const blockRefs = await indexedDBService.getBlockReferencesByProject(project.id);
        const refsUsingBlock = blockRefs.filter(ref => ref.blockDefinitionId === blockDefinitionId);

        // Reload block definition for each reference
        const blockDef = await indexedDBService.getBlockDefinition(blockDefinitionId);

        for (const ref of refsUsingBlock) {
            ref.blockDefinition = blockDef;
            await indexedDBService.saveBlockReference(ref, project.id);
        }
    }
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Import multiple blocks from JSON
 */
export async function importBlocks(blocksData: BlockDefinition[]): Promise<void> {
    const existingBlocks = await indexedDBService.getAllBlockDefinitions();

    for (const blockData of blocksData) {
        // Check for name conflicts
        if (existingBlocks.some(b => b.name === blockData.name)) {
            blockData.name = `${blockData.name}_imported_${Date.now()}`;
        }

        // Generate new ID
        blockData.id = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        blockData.createdAt = new Date().toISOString();
        blockData.updatedAt = new Date().toISOString();

        await indexedDBService.saveBlockDefinition(blockData);
    }
}

/**
 * Export blocks to JSON
 */
export async function exportBlocks(blockIds: string[]): Promise<BlockDefinition[]> {
    const blocks: BlockDefinition[] = [];

    for (const blockId of blockIds) {
        const block = await indexedDBService.getBlockDefinition(blockId);
        if (block) {
            blocks.push(block);
        }
    }

    return blocks;
}

/**
 * Get block usage statistics
 */
export async function getBlockUsageStats(blockId: string): Promise<{
    blockId: string;
    usageCount: number;
    projectIds: string[];
}> {
    const allProjects = await indexedDBService.getAllProjects();
    const projectIds: string[] = [];
    let usageCount = 0;

    for (const project of allProjects) {
        const blockRefs = await indexedDBService.getBlockReferencesByProject(project.id);
        const refsInProject = blockRefs.filter(ref => ref.blockDefinitionId === blockId);

        if (refsInProject.length > 0) {
            projectIds.push(project.id);
            usageCount += refsInProject.length;
        }
    }

    return { blockId, usageCount, projectIds };
}

// ============================================================================
// VALIDATION AND UTILITIES
// ============================================================================

/**
 * Validate block before insertion
 */
export async function validateBlockInsertion(
    blockDefinitionId: string,
    projectId: string
): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check if block exists
    const blockDef = await indexedDBService.getBlockDefinition(blockDefinitionId);
    if (!blockDef) {
        errors.push('Block definition not found');
        return { valid: false, errors };
    }

    // Validate block definition
    const validation = validateBlockDefinition(blockDef);
    if (!validation.valid) {
        errors.push(...validation.errors);
    }

    // Check for circular references
    const allBlocks = await indexedDBService.getAllBlockDefinitions();
    if (hasCircularReference(blockDef, allBlocks)) {
        errors.push('Circular reference detected in block definition');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Get suggested block name (with counter if needed)
 */
export async function getSuggestedBlockName(baseName: string): Promise<string> {
    const allBlocks = await indexedDBService.getAllBlockDefinitions();

    if (isBlockNameUnique(baseName, allBlocks)) {
        return baseName;
    }

    let counter = 1;
    let suggestedName = `${baseName}_${counter}`;

    while (!isBlockNameUnique(suggestedName, allBlocks)) {
        counter++;
        suggestedName = `${baseName}_${counter}`;
    }

    return suggestedName;
}

/**
 * Get block library summary
 */
export async function getBlockLibrarySummary(): Promise<{
    totalBlocks: number;
    publicBlocks: number;
    privateBlocks: number;
    projectBlocks: number;
}> {
    const allBlocks = await indexedDBService.getAllBlockDefinitions();

    return {
        totalBlocks: allBlocks.length,
        publicBlocks: allBlocks.filter(b => b.isPublic).length,
        privateBlocks: allBlocks.filter(b => !b.isPublic && !b.projectId).length,
        projectBlocks: allBlocks.filter(b => !!b.projectId).length
    };
}
