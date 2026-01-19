import { Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { prisma } from "../index";
import { hashPassword, comparePassword, generateToken, AuthRequest } from "../middleware/auth";

const router = Router();

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

export default router;
