import { Router, Response } from "express";
import { prisma } from "../index";
import { AuthRequest, authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

// Get all chat sessions for a project
router.get("/sessions/:projectId", async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;

    const sessions = await prisma.chatSession.findMany({
      where: {
        projectId,
        userId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return res.json({ sessions });
  } catch (error) {
    console.error("Get chat sessions error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get chat sessions",
    });
  }
});

// Create new chat session
router.post("/sessions", async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.body;
    const userId = req.user!.id;

    const session = await prisma.chatSession.create({
      data: {
        projectId,
        userId,
      },
    });

    return res.status(201).json({
      message: "Chat session created successfully",
      session,
    });
  } catch (error) {
    console.error("Create chat session error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create chat session",
    });
  }
});

// Get messages for a session
router.get("/sessions/:sessionId/messages", async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.id;

    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
      },
    });

    if (!session) {
      return res.status(404).json({
        error: "Not Found",
        message: "Chat session not found",
      });
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        sessionId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return res.json({ messages });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get messages",
    });
  }
});

// Add message to session
router.post("/sessions/:sessionId/messages", async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.id;
    const { senderType, messageType, content, metadata } = req.body;

    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
      },
    });

    if (!session) {
      return res.status(404).json({
        error: "Not Found",
        message: "Chat session not found",
      });
    }

    const message = await prisma.chatMessage.create({
      data: {
        sessionId,
        senderType,
        messageType,
        content,
        metadata,
      },
    });

    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return res.status(201).json({
      message: "Message added successfully",
      chatMessage: message,
    });
  } catch (error) {
    console.error("Add message error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to add message",
    });
  }
});

// Delete chat session
router.delete("/sessions/:sessionId", async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.id;

    const session = await prisma.chatSession.deleteMany({
      where: {
        id: sessionId,
        userId,
      },
    });

    if (session.count === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Chat session not found",
      });
    }

    return res.json({
      message: "Chat session deleted successfully",
    });
  } catch (error) {
    console.error("Delete chat session error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to delete chat session",
    });
  }
});

export default router;
