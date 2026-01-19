import { Router, Response } from "express";
import { prisma } from "../index";
import { AuthRequest, authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

// Get all LLM models for current user
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const models = await prisma.lLMModel.findMany({
      where: {
        OR: [
          { userId },
          { userId: null },
        ],
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({ models });
  } catch (error) {
    console.error("Get LLM models error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get LLM models",
    });
  }
});

// Create new LLM model
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, provider, modelId, apiKey, isActive, configuration } = req.body;

    const model = await prisma.lLMModel.create({
      data: {
        userId,
        name,
        provider,
        modelId,
        apiKeyEncrypted: apiKey,
        isActive: isActive ?? true,
        configuration,
      },
    });

    return res.status(201).json({
      message: "LLM model created successfully",
      model,
    });
  } catch (error) {
    console.error("Create LLM model error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create LLM model",
    });
  }
});

// Update LLM model
router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { name, provider, modelId, apiKey, isActive, configuration } = req.body;

    const model = await prisma.lLMModel.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        name,
        provider,
        modelId,
        apiKeyEncrypted: apiKey,
        isActive,
        configuration,
      },
    });

    if (model.count === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "LLM model not found",
      });
    }

    const updatedModel = await prisma.lLMModel.findUnique({
      where: { id },
    });

    return res.json({
      message: "LLM model updated successfully",
      model: updatedModel,
    });
  } catch (error) {
    console.error("Update LLM model error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update LLM model",
    });
  }
});

// Delete LLM model
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const model = await prisma.lLMModel.deleteMany({
      where: {
        id,
        userId,
      },
    });

    if (model.count === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "LLM model not found",
      });
    }

    return res.json({
      message: "LLM model deleted successfully",
    });
  } catch (error) {
    console.error("Delete LLM model error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to delete LLM model",
    });
  }
});

export default router;
