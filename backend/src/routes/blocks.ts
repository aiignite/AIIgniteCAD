import { Router, Response } from "express";
import { prisma } from "../index";
import { authenticate, AuthRequest } from "../middleware/auth";

const router = Router();

const transformBlock = (block: any) => ({
    ...block,
    basePoint: {
        x: Number(block.basePointX),
        y: Number(block.basePointY)
    }
});

// Get Block Tree (Categories and Blocks)
router.get("/tree", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.query;

    if (!userId) {
       res.status(401).json({ error: "Unauthorized" });
       return;
    }

    // Fetch categories
    const categories: any[] = await prisma.blockCategory.findMany({
      where: {
        userId,
        projectId: projectId ? String(projectId) : null,
      },
      include: {
        blocks: true,
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
            projectId: projectId ? String(projectId) : null,
            categoryId: null
        }
    });

    res.json({ categories: transformedCategories, rootBlocks: rootBlocks.map(transformBlock) });
  } catch (error) {
    console.error("Error fetching block tree:", error);
    res.status(500).json({ error: "Failed to fetch block tree" });
  }
});

// Create Category
router.post("/category", authenticate, async (req: AuthRequest, res: Response) => {
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
        console.error("Error creating category:", error);
        res.status(500).json({ error: "Failed to create category" });
    }
});

// Create Block Definition
router.post("/definition", authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { name, description, categoryId, projectId, basePoint, elements, thumbnail } = req.body;

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
         console.error("Error creating block:", error);
        res.status(500).json({ error: "Failed to create block" });
    }
});


// Move Item (Block or Category)
router.put("/move", authenticate, async (req: AuthRequest, res: Response) => {
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
        console.error("Error moving item:", error);
        res.status(500).json({ error: "Failed to move item" });
     }
});

// Delete Item
router.delete("/:type/:id", authenticate, async (req: AuthRequest, res: Response) => {
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
         console.error("Error deleting item:", error);
        res.status(500).json({ error: "Failed to delete item" });
    }
});

// Get Definition by ID
router.get("/:id", authenticate, async (req: AuthRequest, res: Response) => {
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

        // Must transform element structure back to simplified frontend format if needed
        // But for now, returning as is and handling in frontend is easier logic-wise, 
        // however the elements are stored in blockElements table with elementData JSON.
        // We likely need to map it back to `elements` array on the response.
        
        const elements = block.blockElements
            .sort((a: any, b: any) => a.displayOrder - b.displayOrder)
            .map((be: any) => be.elementData);

        const result = transformBlock({
            ...block,
            elements // Override/Inject elements array
        });

         res.json(result);
     } catch (error) {
         console.error("Error getting block:", error);
         res.status(500).json({ error: "Failed to get block" });
     }
});

export default router;
