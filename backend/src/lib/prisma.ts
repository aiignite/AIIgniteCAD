/**
 * prisma.ts — Prisma 客户端单例
 *
 * 将数据库客户端从入口文件 index.ts 中剥离，使路由、中间件可以在不启动
 * HTTP 服务、不执行数据库迁移的情况下被测试代码直接引入。
 */

import { PrismaClient } from "@prisma/client";

/**
 * 全局唯一的 Prisma 客户端实例。
 * 所有路由与中间件统一从这里获取，避免重复建立连接池。
 */
export const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"],
});

export default prisma;
