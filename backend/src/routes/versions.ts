/**
 * versions.ts — 项目版本历史
 *
 * 版本按项目递增编号；列表只返回元数据，详情按需加载完整快照。
 * 恢复由客户端应用快照后走正常保存链路，保证服务端状态仍以最后写入为准。
 */

import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest, authenticate } from "../middleware/auth";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { summarizeVersionChange } from "../lib/versionMemory";

const router = Router({ mergeParams: true });
router.use(authenticate);

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 200;

const projectIdOf = (req: AuthRequest): string =>
  (req.params as Record<string, string>).id;

const ownsProject = async (req: AuthRequest, projectId: string): Promise<boolean> => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: req.user!.id, isDeleted: false },
    select: { id: true },
  });
  return project !== null;
};

const parseLimit = (raw: unknown): number => {
  if (typeof raw !== "string") return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
};

// 版本列表（不含快照体）
router.get("/", async (req: AuthRequest, res: Response) => {
  const projectId = projectIdOf(req);
  const userId = req.user!.id;
  const limit = parseLimit(req.query.limit);
  const beforeRaw = req.query.before;
  const before =
    typeof beforeRaw === "string" ? Number.parseInt(beforeRaw, 10) : undefined;

  try {
    if (!(await ownsProject(req, projectId))) {
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    const rows = await prisma.projectVersion.findMany({
      where: {
        projectId,
        ...(before !== undefined && Number.isFinite(before)
          ? { versionNumber: { lt: before } }
          : {}),
      },
      orderBy: { versionNumber: "desc" },
      take: limit + 1,
      select: {
        id: true,
        projectId: true,
        versionNumber: true,
        elementCount: true,
        commitMessage: true,
        changeSummary: true,
        createdBy: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    return res.json({
      versions: hasMore ? rows.slice(0, limit) : rows,
      hasMore,
    });
  } catch (error) {
    logger.error("List versions failed", {
      requestId: req.requestId,
      projectId,
      userId,
      error,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to list versions",
    });
  }
});

// 创建版本
router.post("/", async (req: AuthRequest, res: Response) => {
  const projectId = projectIdOf(req);
  const userId = req.user!.id;
  const { snapshotData, commitMessage } = req.body as {
    snapshotData?: { elements?: unknown };
    commitMessage?: unknown;
  };
  const elements = snapshotData?.elements;

  if (!snapshotData || !Array.isArray(elements)) {
    return res.status(400).json({
      error: "Bad Request",
      message: "snapshotData.elements must be an array",
    });
  }

  const message =
    typeof commitMessage === "string" && commitMessage.trim()
      ? commitMessage.trim().slice(0, MAX_MESSAGE_LENGTH)
      : undefined;

  try {
    if (!(await ownsProject(req, projectId))) {
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    const version = await prisma.$transaction(async (tx) => {
      const latest = await tx.projectVersion.findFirst({
        where: { projectId },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true, snapshotData: true },
      });
      const changeSummary = summarizeVersionChange(
        latest?.snapshotData ?? null,
        snapshotData,
      );

      return tx.projectVersion.create({
        data: {
          projectId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          snapshotData: snapshotData as Prisma.InputJsonValue,
          elementCount: elements.length,
          commitMessage: message,
          changeSummary: changeSummary as unknown as Prisma.InputJsonValue,
          createdBy: userId,
        },
        select: {
          id: true,
          projectId: true,
          versionNumber: true,
          elementCount: true,
          commitMessage: true,
          changeSummary: true,
          createdBy: true,
          createdAt: true,
        },
      });
    });

    metrics.increment("versions.created");
    logger.info("Version created", {
      requestId: req.requestId,
      projectId,
      userId,
      versionNumber: version.versionNumber,
      elementCount: version.elementCount,
    });

    return res.status(201).json({ version });
  } catch (error) {
    // 并发创建时唯一约束冲突，客户端重试即可获得下一个编号
    if ((error as { code?: string }).code === "P2002") {
      return res.status(409).json({
        error: "Conflict",
        message: "Version number conflict, please retry",
      });
    }
    logger.error("Create version failed", {
      requestId: req.requestId,
      projectId,
      userId,
      error,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create version",
    });
  }
});

// 版本详情（含完整快照）
router.get("/:versionId", async (req: AuthRequest, res: Response) => {
  const projectId = projectIdOf(req);
  const userId = req.user!.id;
  const versionId = req.params.versionId;

  try {
    if (!(await ownsProject(req, projectId))) {
      return res.status(404).json({
        error: "Not Found",
        message: "Project not found",
      });
    }

    const version = await prisma.projectVersion.findFirst({
      where: { id: versionId, projectId },
    });

    if (!version) {
      return res.status(404).json({
        error: "Not Found",
        message: "Version not found",
      });
    }

    return res.json({ version });
  } catch (error) {
    logger.error("Get version failed", {
      requestId: req.requestId,
      projectId,
      userId,
      versionId,
      error,
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get version",
    });
  }
});

export default router;
