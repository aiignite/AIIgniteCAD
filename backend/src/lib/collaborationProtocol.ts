/**
 * collaborationProtocol.ts — 协作消息的边界校验
 *
 * Socket 消息来自不可信客户端，进入房间前必须确认身份与项目归属，
 * 广播前必须收窄载荷，避免跨项目泄漏或超大包拖垮房间。
 */

import { prisma } from "./prisma";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 单次补丁的图元上限，与前端 lib/collaboration.ts 保持一致 */
export const MAX_PATCH_ELEMENTS = 2000;

/** 协作坐标的绝对值上限，过滤明显异常的光标位置 */
export const MAX_CURSOR_COORDINATE = 10_000_000;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export interface SanitizedPatch {
  upserts: Record<string, unknown>[];
  deletes: string[];
}

/** 校验补丁形状、条数与图元关键字段；不合法时返回 null */
export function sanitizePatch(value: unknown): SanitizedPatch | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { upserts?: unknown; deletes?: unknown };
  if (!Array.isArray(candidate.upserts) || !Array.isArray(candidate.deletes)) {
    return null;
  }
  if (
    candidate.upserts.length > MAX_PATCH_ELEMENTS ||
    candidate.deletes.length > MAX_PATCH_ELEMENTS
  ) {
    return null;
  }

  const upserts: Record<string, unknown>[] = [];
  for (const item of candidate.upserts) {
    if (!item || typeof item !== "object") return null;
    const element = item as { id?: unknown; type?: unknown };
    if (typeof element.id !== "string" || typeof element.type !== "string") {
      return null;
    }
    upserts.push(element as Record<string, unknown>);
  }

  const deletes: string[] = [];
  for (const item of candidate.deletes) {
    if (typeof item !== "string") return null;
    deletes.push(item);
  }

  return { upserts, deletes };
}

/** 光标载荷：只接受有限数值且在合理范围内 */
export function sanitizeCursor(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (
    Math.abs(x) > MAX_CURSOR_COORDINATE ||
    Math.abs(y) > MAX_CURSOR_COORDINATE
  ) {
    return null;
  }
  return { x, y };
}

/**
 * 项目归属校验：只有项目所有者能加入房间。
 * 离线创建、尚未同步到服务端的项目没有服务端记录，会被拒绝。
 */
export async function canJoinProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  if (!isUuid(projectId)) return false;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId, isDeleted: false },
    select: { id: true },
  });
  return Boolean(project);
}
