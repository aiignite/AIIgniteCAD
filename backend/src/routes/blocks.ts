/**
 * blocks.ts — 块定义与分类
 *
 * 块元素存在 BlockElement.elementData 里，目录接口必须把它们一起返回，
 * 否则前端目录拿到的块是空壳，insert_block 永远展开不出图元。
 */

import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/auth";
import { blockRateLimit } from "../middleware/rateLimit";
import { logger } from "../lib/logger";

const router = Router();

router.use(authenticate);
// 限流放在鉴权之后，才能按用户而不是 IP 计数
router.use(blockRateLimit());

/** 把 blockElements 还原成前端使用的 elements 数组 */
const toElements = (block: any): any[] => {
  if (Array.isArray(block?.elements)) return block.elements;
  if (!Array.isArray(block?.blockElements)) return [];
  return [...block.blockElements]
    .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((be: any) => be.elementData);
};

const transformBlock = (block: any) => {
  const { blockElements, ...rest } = block ?? {};
  return {
    ...rest,
    elements: toElements(block),
    basePoint: {
      x: Number(block.basePointX),
      y: Number(block.basePointY)
    }
  };
};

// Get Block Tree (Categories and Blocks)
router.get("/tree", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.query;

    if (!userId) {
       res.status(401).json({ error: "Unauthorized" });
       return;
    }

    const scope = projectId ? String(projectId) : null;
    if (scope) {
      const project = await prisma.project.findFirst({
        where: { id: scope, userId, isDeleted: false },
        select: { id: true },
      });
      if (!project) {
        res.status(404).json({ error: "Not Found", message: "Project not found" });
        return;
      }
    }

    // 项目块与全局块（projectId 为空）都出现在目录里
    const scopeWhere = scope
      ? { OR: [{ projectId: scope }, { projectId: null }] }
      : { projectId: null };

    // Fetch categories
    const categories: any[] = await prisma.blockCategory.findMany({
      where: {
        userId,
        ...scopeWhere,
      },
      include: {
        blocks: {
          where: scopeWhere,
          include: { blockElements: true },
        },
      }
    });

    // Transform blocks in categories
    const transformedCategories = categories.map(cat => ({
        ...cat,
        blocks: cat.blocks.map(transformBlock)
    }));

    // Fetch root blocks (no category)
    const rootBlocks = await prisma.blockDefinition.findMany({
      where: {
        userId,
        ...scopeWhere,
        categoryId: null
      },
      include: { blockElements: true },
    });

    res.json({ categories: transformedCategories, rootBlocks: rootBlocks.map(transformBlock) });
  } catch (error) {
    logger.error("Fetch block tree failed", { error, requestId: req.requestId });
    res.status(500).json({ error: "Failed to fetch block tree" });
  }
});

// Create Category
router.post("/category", async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { name, parentId, projectId } = req.body;

        if (!userId) {
             res.status(401).json({ error: "Unauthorized" });
             return;
        }

        // Validate projectId if provided
        if (projectId) {
            const project = await prisma.project.findFirst({
                where: { id: projectId, userId }
            });
            if (!project) {
                res.status(400).json({ error: "Project not found" });
                return;
            }
        }

        // Validate parentId if provided
        if (parentId) {
            const parent = await prisma.blockCategory.findFirst({
                where: { id: parentId, userId }
            });
            if (!parent) {
                res.status(400).json({ error: "Parent category not found" });
                return;
            }
        }

        const category = await prisma.blockCategory.create({
            data: {
                userId,
                name,
                parentId: parentId || null,
                projectId: projectId || null
            }
        });
        res.json(category);
    } catch (error) {
        logger.error("Create block category failed", { error, requestId: req.requestId });
        res.status(500).json({ error: "Failed to create category" });
    }
});

// Create Block Definition
router.post("/definition", async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { name, description, categoryId, projectId, basePoint, elements, thumbnail } = req.body;

         if (!userId) {
             res.status(401).json({ error: "Unauthorized" });
             return;
        }

        if (!Array.isArray(elements) || elements.length === 0) {
            res.status(400).json({ error: "elements must be a non-empty array" });
            return;
        }
        if (!basePoint || typeof basePoint.x !== "number" || typeof basePoint.y !== "number") {
            res.status(400).json({ error: "basePoint must contain numeric x and y" });
            return;
        }

        // Validate projectId if provided
        if (projectId) {
            const project = await prisma.project.findFirst({
                where: { id: projectId, userId }
            });
            if (!project) {
                res.status(400).json({ error: "Project not found" });
                return;
            }
        }

        // Validate categoryId if provided
        if (categoryId) {
            const category = await prisma.blockCategory.findFirst({
                where: { id: categoryId, userId }
            });
            if (!category) {
                res.status(400).json({ error: "Category not found" });
                return;
            }
        }

        const block = await prisma.blockDefinition.create({
            data: {
                userId,
                name,
                description,
                categoryId: categoryId || null,
                projectId: projectId || null,
                basePointX: basePoint.x,
                basePointY: basePoint.y,
                thumbnail,
                blockElements: {
                    create: elements.map((el: any, index: number) => ({
                        elementData: el,
                        displayOrder: index
                    }))
                }
            }
        });
        res.json(transformBlock(block));
    } catch (error) {
         logger.error("Create block definition failed", { error, requestId: req.requestId });
        res.status(500).json({ error: "Failed to create block" });
    }
});


// Move Item (Block or Category)
router.put("/move", async (req: AuthRequest, res: Response) => {
     try {
        const userId = req.user?.id;
        const { type, id, targetCategoryId } = req.body; // type: 'block' | 'category'

         if (!userId) {
             res.status(401).json({ error: "Unauthorized" });
             return;
        }

        if (type === 'block') {
            await prisma.blockDefinition.update({
                where: { id, userId },
                data: { categoryId: targetCategoryId || null }
            });
        } else if (type === 'category') {
             if (id === targetCategoryId) {
                 res.status(400).json({error: "Cannot move category into itself"});
                 return;
             }

            await prisma.blockCategory.update({
                where: { id, userId },
                data: { parentId: targetCategoryId || null }
            });
        }
        res.json({ success: true });
     } catch (error) {
        logger.error("Move block item failed", { error, requestId: req.requestId });
        res.status(500).json({ error: "Failed to move item" });
     }
});

// Delete Item
router.delete("/:type/:id", async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { type, id } = req.params;

        if (!userId) {
             res.status(401).json({ error: "Unauthorized" });
             return;
        }

        if (type === 'block') {
             await prisma.blockDefinition.delete({ where: { id, userId } });
        } else if (type === 'category') {
             await prisma.blockCategory.delete({ where: { id, userId } });
        }
        res.json({ success: true });
    } catch (error) {
         logger.error("Delete block item failed", { error, requestId: req.requestId });
        res.status(500).json({ error: "Failed to delete item" });
    }
});

// Get Definition by ID
router.get("/:id", async (req: AuthRequest, res: Response) => {
     try {
         const { id } = req.params;
         const userId = req.user?.id;

         if (!userId) {
              res.status(401).json({ error: "Unauthorized" });
              return;
         }

         const block = await prisma.blockDefinition.findFirst({
             where: { id, userId },
             include: {
                 blockElements: true
             }
         });

         if (!block) {
             res.status(404).json({ error: "Block not found" });
             return;
         }

         res.json(transformBlock(block));
     } catch (error) {
         logger.error("Get block definition failed", { error, requestId: req.requestId });
         res.status(500).json({ error: "Failed to get block" });
     }
});

export default router;
