// Backend Entry Point for AIIgniteCAD
// Express server with PostgreSQL, JWT authentication, and WebSocket support

import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

// Load environment variables
dotenv.config();

// Initialize Prisma Client
export const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"],
});

// Initialize Express app
const app: Express = express();
const PORT = 3410;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO for real-time collaboration
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3400",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3400",
    credentials: true,
  }),
);

// Body parsing middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan("dev"));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// ROUTES
// ============================================================================

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// API routes (to be implemented)
app.get("/api", (req: Request, res: Response) => {
  res.json({
    message: "AIIgniteCAD API Server",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      projects: "/api/projects",
      elements: "/api/elements",
      blocks: "/api/blocks",
      blockReferences: "/api/block-references",
      layers: "/api/layers",
      versions: "/api/versions",
      chat: "/api/chat",
    },
  });
});

// Authentication routes
// app.use('/api/auth', authRoutes);

// Project routes
// app.use('/api/projects', projectRoutes);

// Block routes
// app.use('/api/blocks', blockRoutes);

// Block reference routes
// app.use('/api/block-references', blockReferenceRoutes);

// Element routes
// app.use('/api/elements', elementRoutes);

// Layer routes
// app.use('/api/layers', layerRoutes);

// Version routes
// app.use('/api/versions', versionRoutes);

// Chat routes
// app.use('/api/chat', chatRoutes);

// ============================================================================
// WEBSOCKET HANDLERS
// ============================================================================

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Join project room
  socket.on("join-project", (projectId: string) => {
    socket.join(`project:${projectId}`);
    console.log(`Socket ${socket.id} joined project ${projectId}`);

    // Notify others in the room
    socket.to(`project:${projectId}`).emit("user-joined", {
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // Leave project room
  socket.on("leave-project", (projectId: string) => {
    socket.leave(`project:${projectId}`);
    console.log(`Socket ${socket.id} left project ${projectId}`);

    socket.to(`project:${projectId}`).emit("user-left", {
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // Real-time element updates
  socket.on("element-updated", (data: { projectId: string; element: any }) => {
    socket.to(`project:${data.projectId}`).emit("element-updated", {
      element: data.element,
      updatedBy: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // Real-time element creation
  socket.on("element-created", (data: { projectId: string; element: any }) => {
    socket.to(`project:${data.projectId}`).emit("element-created", {
      element: data.element,
      createdBy: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // Real-time element deletion
  socket.on(
    "element-deleted",
    (data: { projectId: string; elementId: string }) => {
      socket.to(`project:${data.projectId}`).emit("element-deleted", {
        elementId: data.elementId,
        deletedBy: socket.id,
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Real-time block insertion
  socket.on(
    "block-inserted",
    (data: { projectId: string; blockReference: any }) => {
      socket.to(`project:${data.projectId}`).emit("block-inserted", {
        blockReference: data.blockReference,
        insertedBy: socket.id,
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Real-time cursor position (for collaborative editing)
  socket.on(
    "cursor-move",
    (data: { projectId: string; x: number; y: number }) => {
      socket.to(`project:${data.projectId}`).emit("cursor-move", {
        socketId: socket.id,
        x: data.x,
        y: data.y,
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Error:", err);

  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "production" ? "An error occurred" : err.message,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function startServer() {
  try {
    // Connect to database
    await prisma.$connect();
    console.log("✓ Connected to PostgreSQL database");

    // Start server
    server.listen(PORT, () => {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`🚀 AIIgniteCAD Backend Server`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`HTTP Server: http://localhost:${PORT}`);
      console.log(`WebSocket Server: ws://localhost:${PORT}`);
      console.log(`Health Check: http://localhost:${PORT}/health`);
      console.log(`API Endpoint: http://localhost:${PORT}/api`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");

  // Close WebSocket connections
  io.close();

  // Disconnect from database
  await prisma.$disconnect();

  // Close server
  server.close(() => {
    console.log("✓ Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down...");
  await prisma.$disconnect();
  server.close(() => {
    console.log("✓ Server closed");
    process.exit(0);
  });
});

// Start the server
startServer();

// Export for testing
export { app, io };
