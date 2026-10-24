/**
 * users.ts — 用户管理路由（仅管理员）
 *
 * GET  /api/users       列出全部用户（含项目数）
 * PATCH /api/users/:id  调整角色（admin | user）；不允许管理员改动自己的角色，
 *                       避免最后一个管理员把自己降级后无人可管。
 */

import { Router, Response } from "express";
import { param, body, validationResult } from "express-validator";
import { prisma } from "../lib/prisma";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { logger } from "../lib/logger";

const router = Router();

const USER_LIST_SELECT = {
    id: true,
    username: true,
    email: true,
    role: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { projects: true } },
} as const;

router.use(authenticate, requireAdmin);

router.get("/", async (req: AuthRequest, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            select: USER_LIST_SELECT,
            orderBy: { createdAt: "asc" },
        });
        return res.json({ users });
    } catch (error) {
        logger.error("List users error", { requestId: req.requestId, error });
        return res.status(500).json({
            error: "Internal Server Error",
            message: "Failed to list users",
        });
    }
});

router.patch(
    "/:id",
    [
        param("id").isUUID().withMessage("Invalid user id"),
        body("role")
            .isIn(["admin", "user"])
            .withMessage("Role must be admin or user"),
    ],
    async (req: AuthRequest, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: "Validation Error",
                message: errors.array()[0].msg,
            });
        }

        const targetId = req.params.id;
        if (targetId === req.user!.id) {
            return res.status(400).json({
                error: "Bad Request",
                message: "You cannot change your own role",
            });
        }

        try {
            const target = await prisma.user.findUnique({ where: { id: targetId } });
            if (!target) {
                return res.status(404).json({
                    error: "Not Found",
                    message: "User not found",
                });
            }

            const role = req.body.role as string;
            // 最后一个管理员不可降级，否则系统失去管理能力
            if (target.role === "admin" && role !== "admin") {
                const adminCount = await prisma.user.count({ where: { role: "admin" } });
                if (adminCount <= 1) {
                    return res.status(400).json({
                        error: "Bad Request",
                        message: "Cannot demote the last admin",
                    });
                }
            }

            const user = await prisma.user.update({
                where: { id: targetId },
                data: { role },
                select: USER_LIST_SELECT,
            });
            logger.info("User role updated", {
                requestId: req.requestId,
                targetId,
                role,
                operatorId: req.user!.id,
            });
            return res.json({ user });
        } catch (error) {
            logger.error("Update user role error", { requestId: req.requestId, error });
            return res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to update user",
            });
        }
    },
);

export default router;
