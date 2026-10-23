import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest, authenticate } from "../middleware/auth";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { normalizeDesignConventions } from "../lib/designConventions";

const router = Router();

router.use(authenticate);

const IDEMPOTENCY_HEADER = "idempotency-key";
const CONFLICT_TOLERANCE_MS = 1000;

const readIdempotencyKey = (req: AuthRequest): string | undefined => {
  const key = req.header(IDEMPOTENCY_HEADER)?.trim();
  return key || undefined;
};

type IdempotencyStart =
  | { duplicate: false }
  | { duplicate: true; projectId: string | null };

/** 先抢占 key 再执行写操作；唯一约束保证并发重复请求只有一个能落地 */
const beginIdempotent = async (
  req: AuthRequest,
  key: string | undefined,
  endpoint: string,
  projectId?: string,
): Promise<IdempotencyStart> => {
  if (!key) return { duplicate: false };
  const userId = req.user!.id;

  try {
    await prisma.idempotencyKey.create({
      data: { key, userId, endpoint, projectId },
    });
    return { duplicate: false };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const record = await prisma.idempotencyKey.findUnique({ where: { key } });
      metrics.increment("sync.duplicate_requests");
      logger.info("Idempotent replay detected", {
        requestId: req.requestId,
        endpoint,
        projectId: record?.projectId ?? projectId,
      });
      return { duplicate: true, projectId: record?.projectId ?? null };
    }
    throw error;
  }
};

/** 写操作失败时释放 key，允许客户端用同一 key 重试 */
const cancelIdempotent = async (key?: string) => {
  if (!key) return;
  await prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
};

const isStaleWrite = (baseUpdatedAt: unknown, serverUpdatedAt: Date): boolean => {
  if (typeof baseUpdatedAt !== "string") return false;
  const base = Date.parse(baseUpdatedAt);
  if (Number.isNaN(base)) return false;
  return serverUpdatedAt.getTime() > base + CONFLICT_TOLERANCE_MS;
};

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
      // 项目列表也要带设计约定：文件面板据此显示制图标准，避免逐个打开图纸才知道
      designConventions: p.designConventions ?? null,
    }));

    return res.json({
      projects: formattedProjects,
      total: formattedProjects.length,
    });
  } catch (error) {
    logger.error("List projects failed", {
      requestId: req.requestId,
      userId: req.user?.id,
      error,
    });
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
    logger.error("Get project failed", {
      requestId: req.requestId,
      projectId: req.params.id,
      userId: req.user?.id,
      error,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get project",
    });
  }
});

// Create new project
router.post("/", async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const key = readIdempotencyKey(req);

  try {
    const { name, description, thumbnail, designConventions: rawConventions } = req.body;
    const conventions = normalizeDesignConventions(rawConventions);
    if (!conventions.ok) {
      return res.status(400).json({
        error: "Bad Request",
        message: conventions.message,
      });
    }

    const claimed = await beginIdempotent(req, key, "POST /projects");
    if (claimed.duplicate) {
      return res.status(200).json({
        duplicate: true,
        message: "Project creation already processed",
        project: claimed.projectId ? { id: claimed.projectId } : null,
      });
    }

    const project = await prisma.project.create({
      data: {
        userId,
        name: name || "Untitled Drawing",
        description,
        thumbnail,
        designConventions:
          conventions.value === null
            ? Prisma.DbNull
            : (conventions.value as unknown as Prisma.InputJsonValue),
        drawingSettings: {
          create: {},
        },
      },
      include: {
        drawingSettings: true,
      },
    });

    if (key) {
      await prisma.idempotencyKey
        .update({ where: { key }, data: { projectId: project.id } })
        .catch(() => undefined);
    }

    metrics.increment("sync.projects.created");
    return res.status(201).json({
      message: "Project created successfully",
      project,
    });
  } catch (error) {
    await cancelIdempotent(key);
    logger.error("Create project failed", {
      requestId: req.requestId,
      userId,
      error,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create project",
    });
  }
});

// Update project
router.put("/:id", async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const key = readIdempotencyKey(req);

  try {
    const { name, description, thumbnail, baseUpdatedAt } = req.body;
    const hasConventions = Object.prototype.hasOwnProperty.call(req.body, "designConventions");
    const conventions = hasConventions
      ? normalizeDesignConventions(req.body.designConventions)
      : { ok: true as const, value: null };
    if (!conventions.ok) {
      return res.status(400).json({
        error: "Bad Request",
        message: conventions.message,
      });
    }

    const prior =
      typeof baseUpdatedAt === "string"
        ? await prisma.project.findFirst({
            where: { id, userId, isDeleted: false },
            select: { updatedAt: true },
          })
        : null;
    const conflict = prior ? isStaleWrite(baseUpdatedAt, prior.updatedAt) : false;

    const claimed = await beginIdempotent(req, key, "PUT /projects/:id", id);
    if (claimed.duplicate) {
      const current = await prisma.project.findUnique({ where: { id } });
      return res.json({
        duplicate: true,
        message: "Project update already processed",
        project: current,
        conflict: false,
      });
    }

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
        ...(hasConventions
          ? {
              designConventions:
                conventions.value === null
                  ? Prisma.DbNull
                  : (conventions.value as unknown as Prisma.InputJsonValue),
            }
          : {}),
      },
    });

    if (project.count === 0) {
      await cancelIdempotent(key);
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    const updatedProject = await prisma.project.findUnique({
      where: { id },
    });

    metrics.increment("sync.project_updates");
    if (conflict) {
      metrics.increment("sync.conflicts");
      logger.warn("Stale metadata write overwritten (last write wins)", {
        requestId: req.requestId,
        projectId: id,
        userId,
      });
    }

    return res.json({
      message: "Project updated successfully",
      project: updatedProject,
      conflict,
      ...(conflict && prior
        ? { serverUpdatedAt: prior.updatedAt.toISOString() }
        : {}),
    });
  } catch (error) {
    await cancelIdempotent(key);
    logger.error("Update project failed", {
      requestId: req.requestId,
      projectId: id,
      userId,
      error,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update project",
    });
  }
});

// Delete project (soft delete)
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const key = readIdempotencyKey(req);

  try {
    const claimed = await beginIdempotent(req, key, "DELETE /projects/:id", id);
    if (claimed.duplicate) {
      return res.json({
        duplicate: true,
        message: "Project deletion already processed",
      });
    }

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
      await cancelIdempotent(key);
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    metrics.increment("sync.projects.deleted");
    return res.json({
      message: "Project deleted successfully",
    });
  } catch (error) {
    await cancelIdempotent(key);
    logger.error("Delete project failed", {
      requestId: req.requestId,
      projectId: id,
      userId,
      error,
    });
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
    logger.error("Open project failed", {
      requestId: req.requestId,
      projectId: req.params.id,
      userId: req.user?.id,
      error,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update project",
    });
  }
});

// Save project elements (bulk update)
router.post("/:id/elements", async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const key = readIdempotencyKey(req);
  const { elements, baseUpdatedAt } = req.body;

  if (!Array.isArray(elements)) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Elements must be an array",
    });
  }

  try {
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

    const conflict = isStaleWrite(baseUpdatedAt, project.updatedAt);

    const claimed = await beginIdempotent(
      req,
      key,
      "POST /projects/:id/elements",
      id,
    );
    if (claimed.duplicate) {
      const current = await prisma.project.findUnique({
        where: { id },
        select: { updatedAt: true },
      });
      return res.json({
        duplicate: true,
        message: "Elements save already processed",
        conflict: false,
        updatedAt: current?.updatedAt.toISOString(),
      });
    }

    const savedAt = new Date();

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

      // 图元写入同样推进项目版本游标，供客户端做冲突检测
      await tx.project.update({
        where: { id },
        data: { updatedAt: savedAt },
      });
    });

    metrics.increment("sync.element_saves");
    metrics.increment("sync.saved_elements", elements.length);
    if (conflict) {
      metrics.increment("sync.conflicts");
      logger.warn("Stale element write overwritten (last write wins)", {
        requestId: req.requestId,
        projectId: id,
        userId,
        serverUpdatedAt: project.updatedAt.toISOString(),
      });
    }

    return res.json({
      message: "Elements saved successfully",
      count: elements.length,
      conflict,
      updatedAt: savedAt.toISOString(),
      ...(conflict ? { serverUpdatedAt: project.updatedAt.toISOString() } : {}),
    });
  } catch (error) {
    await cancelIdempotent(key);
    logger.error("Save elements failed", {
      requestId: req.requestId,
      projectId: id,
      userId,
      error,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to save elements",
    });
  }
});

export default router;
