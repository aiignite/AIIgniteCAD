import { Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { prisma } from "../index";
import { hashPassword, comparePassword, generateToken, AuthRequest } from "../middleware/auth";

const router = Router();

async function createDefaultWorkspaceForUser(userId: string) {
    try {
        const projectCount = await prisma.project.count({ where: { userId } });
        if (projectCount > 0) return;

        const project = await prisma.project.create({
            data: {
                userId,
                name: "My First Project",
                description: "A starter project created for you. Start designing with the AI CAD Designer.",
            },
        });

        // Create default drawing settings (schema defaults will apply where appropriate)
        await prisma.drawingSettings.create({
            data: {
                projectId: project.id,
            },
        });

        // Create a default layer
        await prisma.layer.create({
            data: {
                projectId: project.id,
                name: "Default",
                color: "#000000",
                displayOrder: 0,
            },
        });

        // Create a default AI assistant for the user if they don't have one
        const assistantCount = await prisma.assistant.count({ where: { userId } });
        if (assistantCount === 0) {
            // Find or create a system-level default LLM model
            let defaultModel = await prisma.lLMModel.findFirst({
                where: { userId: null }
            });

            if (!defaultModel) {
                // Create system-level default LLM model
                defaultModel = await prisma.lLMModel.create({
                    data: {
                        userId: null,
                        name: "Gemini 2.0 Flash",
                        provider: "Google",
                        modelId: "gemini-2.0-flash-exp",
                        apiKeyEncrypted: process.env.GEMINI_API_KEY || null,
                        isActive: true,
                    },
                });
                console.log("Created system-level default LLM model");
            }

            await prisma.assistant.create({
                data: {
                    userId,
                    name: "AI CAD Designer",
                    icon: "engineering",
                    description: "An AI assistant tuned for CAD operations and layout.",
                    color: "text-cad-primary",
                    prompt: `You are an expert AI CAD Designer.\nThe canvas coordinate system is: X increases right, Y increases down. Default size is 800x600.\nYou should analyze user requests and output a JSON action structure when appropriate.`,
                    isActive: true,
                    llmModelId: defaultModel.id,
                },
            });
        }

        // Create an initial chat session for this project
        await prisma.chatSession.create({
            data: {
                projectId: project.id,
                userId,
            },
        });

        console.log("Default workspace created for user:", userId);
    } catch (err) {
        console.error("Failed to create default workspace:", err);
    }
}

// Register new user
router.post(
  "/register",
  [
    body("username").trim().isLength({ min: 3, max: 50 }).withMessage("Username must be 3-50 characters"),
    body("email").isEmail().withMessage("Invalid email address"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation Error",
          message: errors.array()[0].msg,
        });
      }

      const { username, email, password } = req.body;

      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ email }, { username }],
        },
      });

      if (existingUser) {
        if (existingUser.email === email) {
          return res.status(400).json({
            error: "Bad Request",
            message: "Email already registered",
          });
        }
        if (existingUser.username === username) {
          return res.status(400).json({
            error: "Bad Request",
            message: "Username already taken",
          });
        }
      }

      const passwordHash = await hashPassword(password);

      const user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash,
        },
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true,
        },
      });

      // Initialize basic AI CAD Designer for this new user (create default project, layers, assistant)
      await createDefaultWorkspaceForUser(user.id);

      const token = generateToken(user);

      return res.status(201).json({
        message: "User registered successfully",
        token,
        user,
      });
    } catch (error) {
      console.error("Registration error:", error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to register user",
      });
    }
  }
);

// Login user
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Invalid email address"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation Error",
          message: errors.array()[0].msg,
        });
      }

      const { email, password } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Invalid email or password",
        });
      }

      const isValidPassword = await comparePassword(password, user.passwordHash);

      if (!isValidPassword) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Invalid email or password",
        });
      }

      // Ensure the user has a default AI CAD workspace on login
      await createDefaultWorkspaceForUser(user.id);

      const token = generateToken({
        id: user.id,
        email: user.email,
        username: user.username,
      });

      return res.json({
        message: "Login successful",
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to login",
      });
    }
  }
);

// Get current user
router.get("/me", async (req: AuthRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "No token provided",
      });
    }

    const token = authHeader.substring(7);
    const { verifyToken } = await import("../middleware/auth");
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or expired token",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: "Not Found",
        message: "User not found",
      });
    }

    return res.json({ user });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get user",
    });
  }
});

// Logout (client-side token removal, no server action needed)
router.post("/logout", async (req: AuthRequest, res: Response) => {
  return res.json({
    message: "Logout successful",
  });
});

// Update user profile
router.put(
  "/profile",
  [
    body("username").optional().trim().isLength({ min: 3, max: 50 }).withMessage("Username must be 3-50 characters"),
    body("email").optional().isEmail().withMessage("Invalid email address"),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation Error",
          message: errors.array()[0].msg,
        });
      }

      const userId = req.user!.id;
      const { username, email } = req.body;

      // Check if new username/email already exists
      if (username || email) {
        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [
              username ? { username } : {},
              email ? { email } : {},
            ],
            NOT: {
              id: userId,
            },
          },
        });

        if (existingUser) {
          if (existingUser.username === username) {
            return res.status(400).json({
              error: "Bad Request",
              message: "Username already taken",
            });
          }
          if (existingUser.email === email) {
            return res.status(400).json({
              error: "Bad Request",
              message: "Email already in use",
            });
          }
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(username && { username }),
          ...(email && { email }),
        },
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true,
        },
      });

      return res.json({
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to update profile",
      });
    }
  }
);

// Change password
router.post(
  "/change-password",
  [
    body("currentPassword").notEmpty().withMessage("Current password is required"),
    body("newPassword").isLength({ min: 6 }).withMessage("New password must be at least 6 characters"),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation Error",
          message: errors.array()[0].msg,
        });
      }

      const userId = req.user!.id;
      const { currentPassword, newPassword } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({
          error: "Not Found",
          message: "User not found",
        });
      }

      const isValidPassword = await comparePassword(currentPassword, user.passwordHash);

      if (!isValidPassword) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Current password is incorrect",
        });
      }

      const newPasswordHash = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      });

      return res.json({
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Change password error:", error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to change password",
      });
    }
  }
);

export default router;
