/**
 * bootstrapAdmin.ts — 首个管理员提升
 *
 * 部署后库里没有任何 admin 时，把最早注册的用户提升为管理员，
 * 保证「用户管理」分区始终有人可用；幂等，可在每次启动时执行。
 */

import { prisma } from "./prisma";
import { logger } from "./logger";

export async function ensureFirstAdmin(): Promise<void> {
    try {
        const adminCount = await prisma.user.count({ where: { role: "admin" } });
        if (adminCount > 0) return;

        const first = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
        if (!first) {
            logger.info("No users yet; admin bootstrap will run after the first signup");
            return;
        }
        await prisma.user.update({ where: { id: first.id }, data: { role: "admin" } });
        logger.info("Promoted the earliest user to admin", { userId: first.id });
    } catch (error) {
        // 表还没迁移到位等情况：只记录，不阻断启动
        logger.warn("Admin bootstrap skipped", { reason: (error as Error).message });
    }
}
