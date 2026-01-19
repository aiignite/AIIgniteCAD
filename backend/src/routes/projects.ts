import { Router, Response } from "express";
import { prisma } from "../index";
import { AuthRequest, authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

// Get all projects for current user
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const projects = await prisma.project.findMany({
      where: {
        userId,
        isDeleted: false,
      },
      orderBy: {
        lastOpenedAt: "desc",
      },
      include: {
        elements: {
          where: { isDeleted: false },
          take: 1,
        },
        _count: {
          select: { elements: true },
        },
      },
    });

    const formattedProjects = projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      lastModified: p.updatedAt.toISOString(),
      lastOpened: p.lastOpenedAt?.toISOString(),
      thumbnail: p.thumbnail,
      elementCount: p._count.elements,
    }));

    return res.json({
      projects: formattedProjects,
      total: formattedProjects.length,
    });
  } catch (error) {
    console.error("Get projects error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get projects",
    });
  }
});

// Get project by ID with full data
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const project = await prisma.project.findFirst({
      where: {
        id,
        userId,
        isDeleted: false,
      },
      include: {
        elements: {
          where: { isDeleted: false },
        },
        layers: true,
        drawingSettings: true,
        blockReferences: {
          where: { isDeleted: false },
          include: {
            blockDefinition: true,
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    return res.json({ project });
  } catch (error) {
    console.error("Get project error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get project",
    });
  }
});

// Create new project
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, description, thumbnail } = req.body;

    const project = await prisma.project.create({
      data: {
        userId,
        name: name || "Untitled Drawing",
        description,
        thumbnail,
        drawingSettings: {
          create: {},
        },
      },
      include: {
        drawingSettings: true,
      },
    });

    return res.status(201).json({
      message: "Project created successfully",
      project,
    });
  } catch (error) {
    console.error("Create project error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create project",
    });
  }
});

// Update project
router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { name, description, thumbnail } = req.body;

    const project = await prisma.project.updateMany({
      where: {
        id,
        userId,
        isDeleted: false,
      },
      data: {
        name,
        description,
        thumbnail,
      },
    });

    if (project.count === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    const updatedProject = await prisma.project.findUnique({
      where: { id },
    });

    return res.json({
      message: "Project updated successfully",
      project: updatedProject,
    });
  } catch (error) {
    console.error("Update project error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update project",
    });
  }
});

// Delete project (soft delete)
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const project = await prisma.project.updateMany({
      where: {
        id,
        userId,
        isDeleted: false,
      },
      data: {
        isDeleted: true,
      },
    });

    if (project.count === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    return res.json({
      message: "Project deleted successfully",
    });
  } catch (error) {
    console.error("Delete project error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to delete project",
    });
  }
});

// Update last opened timestamp
router.post("/:id/open", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    await prisma.project.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        lastOpenedAt: new Date(),
      },
    });

    return res.json({ message: "Project opened" });
  } catch (error) {
    console.error("Open project error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update project",
    });
  }
});

// Save project elements (bulk update)
router.post("/:id/elements", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { elements } = req.body;

    if (!Array.isArray(elements)) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Elements must be an array",
      });
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        userId,
        isDeleted: false,
      },
    });

    if (!project) {
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.element.updateMany({
        where: {
          projectId: id,
        },
        data: {
          isDeleted: true,
        },
      });

      for (const el of elements) {
        await tx.element.create({
          data: {
            projectId: id,
            elementType: el.type,
            geometryData: el,
            properties: {
              color: el.color,
              layer: el.layer,
            },
          },
        });
      }
    });

    return res.json({
      message: "Elements saved successfully",
      count: elements.length,
    });
  } catch (error) {
    console.error("Save elements error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to save elements",
    });
  }
});

export default router;
