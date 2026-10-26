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

type ParsedLayers =
  | { ok: true; layers: Omit<Prisma.LayerUncheckedCreateInput, "projectId" | "displayOrder">[] }
  | { ok: false; message: string };

const LINE_TYPES = ["CONTINUOUS", "DASHED", "DOTTED", "DASHDOT"] as const;

/**
 * 图层载荷校验：整份替换语义，要求图层名非空且不重复。
 * 颜色与线型非法时回落默认值，缺省可见性/锁定按默认处理。
 */
const parseLayers = (raw: unknown): ParsedLayers => {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "layers must be an array" };
  }

  const layers: Omit<Prisma.LayerUncheckedCreateInput, "projectId" | "displayOrder">[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: `layers[${index}] must be an object` };
    }

    const { name, color, isVisible, isLocked, lineType, lineWeight } = entry as {
      name?: unknown;
      color?: unknown;
      isVisible?: unknown;
      isLocked?: unknown;
      lineType?: unknown;
      lineWeight?: unknown;
    };

    if (typeof name !== "string" || !name.trim() || name.length > 100) {
      return {
        ok: false,
        message: `layers[${index}].name must be a non-empty string (max 100 chars)`,
      };
    }
    const layerName = name.trim();
    if (seen.has(layerName)) {
      return { ok: false, message: `Duplicate layer name: ${layerName}` };
    }
    seen.add(layerName);

    if (color !== undefined && (typeof color !== "string" || !color || color.length > 32)) {
      return {
        ok: false,
        message: `layers[${index}].color must be a non-empty string (max 32 chars)`,
      };
    }
    if (lineWeight !== undefined && lineWeight !== null) {
      if (
        typeof lineWeight !== "number" ||
        !Number.isFinite(lineWeight) ||
        lineWeight < 0 ||
        lineWeight > 100
      ) {
        return {
          ok: false,
          message: `layers[${index}].lineWeight must be a number between 0 and 100`,
        };
      }
    }

    layers.push({
      name: layerName,
      color: typeof color === "string" && color ? color : "#e6edf3",
      isVisible: isVisible === undefined ? true : isVisible === true,
      isLocked: isLocked === true,
      lineType:
        typeof lineType === "string" && (LINE_TYPES as readonly string[]).includes(lineType)
          ? lineType
          : "CONTINUOUS",
      ...(typeof lineWeight === "number" ? { lineWeight } : {}),
    });
  }

  return { ok: true, layers };
};

type ParsedDrawingSettings =
  | { ok: true; settings: DrawingSettingsUpdate }
  | { ok: false; message: string };

/** 已校验的绘图设置字段；Prisma 的更新输入类型在使用处转换 */
interface DrawingSettingsUpdate {
  units?: string;
  gridSpacing?: number;
  snapDistance?: number;
  dimScale?: number;
  dimPrecision?: number;
}

const DRAWING_UNITS = ["mm", "cm", "m", "in", "ft"] as const;

/** 绘图设置校验：与前端 normalizeDrawingSettings 同一套取值域 */
const parseDrawingSettings = (raw: unknown): ParsedDrawingSettings => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "drawingSettings must be an object" };
  }

  const { units, gridSpacing, snapDistance, dimScale, dimPrecision } = raw as {
    units?: unknown;
    gridSpacing?: unknown;
    snapDistance?: unknown;
    dimScale?: unknown;
    dimPrecision?: unknown;
  };

  if (
    units !== undefined &&
    (typeof units !== "string" || !(DRAWING_UNITS as readonly string[]).includes(units))
  ) {
    return { ok: false, message: "drawingSettings.units is invalid" };
  }

  const settings: DrawingSettingsUpdate = {};
  for (const [field, value] of [
    ["gridSpacing", gridSpacing],
    ["snapDistance", snapDistance],
    ["dimScale", dimScale],
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return { ok: false, message: `drawingSettings.${field} must be a positive number` };
    }
    settings[field] = value;
  }

  if (
    dimPrecision !== undefined &&
    (typeof dimPrecision !== "number" ||
      !Number.isInteger(dimPrecision) ||
      dimPrecision < 0 ||
      dimPrecision > 8)
  ) {
    return {
      ok: false,
      message: "drawingSettings.dimPrecision must be an integer between 0 and 8",
    };
  }
  if (dimPrecision !== undefined) settings.dimPrecision = dimPrecision;
  if (units !== undefined) settings.units = units;

  return { ok: true, settings };
};

type ParsedElements =
  | { ok: true; ids: string[] }
  | { ok: false; message: string };

/** 增量保存要求每个图元带稳定 id；重复 id 会让 upsert 目标不明确 */
const parseElementIds = (elements: unknown[]): ParsedElements => {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const [index, element] of elements.entries()) {
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      return { ok: false, message: `elements[${index}] must be an object` };
    }

    const { id, type } = element as { id?: unknown; type?: unknown };
    if (typeof id !== "string" || !id) {
      return { ok: false, message: `elements[${index}].id must be a non-empty string` };
    }
    if (typeof type !== "string" || !type) {
      return { ok: false, message: `elements[${index}].type must be a non-empty string` };
    }
    if (seen.has(id)) {
      return { ok: false, message: `Duplicate element id: ${id}` };
    }

    seen.add(id);
    ids.push(id);
  }

  return { ok: true, ids };
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
          select: {
            elements: {
              where: { isDeleted: false },
            },
          },
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

    const hasLayers = Object.prototype.hasOwnProperty.call(req.body, "layers");
    const layersPayload = hasLayers ? parseLayers(req.body.layers) : null;
    if (layersPayload && !layersPayload.ok) {
      return res.status(400).json({
        error: "Bad Request",
        message: layersPayload.message,
      });
    }

    const hasSettings = Object.prototype.hasOwnProperty.call(req.body, "drawingSettings");
    const settingsPayload = hasSettings ? parseDrawingSettings(req.body.drawingSettings) : null;
    if (settingsPayload && !settingsPayload.ok) {
      return res.status(400).json({
        error: "Bad Request",
        message: settingsPayload.message,
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

    // 元数据、图层整份替换与设置 upsert 在同一事务内完成，
    // 避免出现"项目已改名但图层还是旧集合"的半份状态
    const updatedProject = await prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
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

      if (result.count === 0) {
        return null;
      }

      if (layersPayload?.ok) {
        await tx.layer.deleteMany({ where: { projectId: id } });
        if (layersPayload.layers.length > 0) {
          await tx.layer.createMany({
            data: layersPayload.layers.map((layer, index) => ({
              ...layer,
              projectId: id,
              displayOrder: index,
            })),
          });
        }
      }

      if (settingsPayload?.ok) {
        const settings = settingsPayload.settings as Omit<
          Prisma.DrawingSettingsUncheckedCreateInput,
          "projectId"
        >;
        await tx.drawingSettings.upsert({
          where: { projectId: id },
          create: { projectId: id, ...settings },
          update: settings as Prisma.DrawingSettingsUncheckedUpdateInput,
        });
      }

      return tx.project.findUnique({
        where: { id },
        include: {
          layers: { orderBy: { displayOrder: "asc" } },
          drawingSettings: true,
        },
      });
    });

    if (!updatedProject) {
      await cancelIdempotent(key);
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

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

  const parsedElements = parseElementIds(elements);
  if (!parsedElements.ok) {
    return res.status(400).json({
      error: "Bad Request",
      message: parsedElements.message,
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
    const incomingIds = parsedElements.ids;

    const saveResult = await prisma.$transaction(async (tx) => {
      const existing = await tx.element.findMany({
        where: {
          projectId: id,
          isDeleted: false,
          elementId: { in: incomingIds },
        },
        select: { id: true, elementId: true },
      });

      const rowIdByElementId = new Map(
        existing.map((row) => [row.elementId as string, row.id]),
      );

      let created = 0;
      let updated = 0;
      for (const el of elements) {
        const rowId = rowIdByElementId.get(el.id);
        const data = {
          elementId: el.id,
          elementType: el.type,
          geometryData: el,
          properties: {
            color: el.color,
            layer: el.layer,
          },
        };

        if (rowId) {
          await tx.element.update({ where: { id: rowId }, data });
          updated += 1;
        } else {
          await tx.element.create({
            data: {
              projectId: id,
              ...data,
            },
          });
          created += 1;
        }
      }

      const stale = await tx.element.updateMany({
        where: {
          projectId: id,
          isDeleted: false,
          elementId: { notIn: incomingIds },
        },
        data: { isDeleted: true },
      });

      // 图元写入同样推进项目版本游标，供客户端做冲突检测
      await tx.project.update({
        where: { id },
        data: { updatedAt: savedAt },
      });

      return { created, updated, deleted: stale.count };
    });

    metrics.increment("sync.element_saves");
    metrics.increment("sync.saved_elements", elements.length);
    metrics.increment("sync.created_elements", saveResult.created);
    metrics.increment("sync.updated_elements", saveResult.updated);
    metrics.increment("sync.deleted_elements", saveResult.deleted);
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
      created: saveResult.created,
      updated: saveResult.updated,
      deleted: saveResult.deleted,
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
