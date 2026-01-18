import { Router, Response } from "express";
import { prisma } from "../index";
import { AuthRequest, authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

// Get all assistants for current user
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const assistants = await prisma.assistant.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return res.json({ assistants });
  } catch (error) {
    console.error("Get assistants error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get assistants",
    });
  }
});

// Create new assistant
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, icon, description, color, prompt, isActive } = req.body;

    const assistant = await prisma.assistant.create({
      data: {
        userId,
        name,
        icon: icon || "psychology",
        description: description || "",
        color: color || "text-cad-primary",
        prompt,
        isActive: isActive ?? true,
      },
    });

    return res.status(201).json({
      message: "Assistant created successfully",
      assistant,
    });
  } catch (error) {
    console.error("Create assistant error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create assistant",
    });
  }
});

// Update assistant
router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { name, icon, description, color, prompt, isActive } = req.body;

    const assistant = await prisma.assistant.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        name,
        icon,
        description,
        color,
        prompt,
        isActive,
      },
    });

    if (assistant.count === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Assistant not found",
      });
    }

    const updatedAssistant = await prisma.assistant.findUnique({
      where: { id },
    });

    return res.json({
      message: "Assistant updated successfully",
      assistant: updatedAssistant,
    });
  } catch (error) {
    console.error("Update assistant error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update assistant",
    });
  }
});

// Delete assistant
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const assistant = await prisma.assistant.deleteMany({
      where: {
        id,
        userId,
      },
    });

    if (assistant.count === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Assistant not found",
      });
    }

    return res.json({
      message: "Assistant deleted successfully",
    });
  } catch (error) {
    console.error("Delete assistant error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to delete assistant",
    });
  }
});

export default router;
