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

/** 房间状态快照的图元上限，与单次补丁上限一致 */
export const MAX_STATE_ELEMENTS = MAX_PATCH_ELEMENTS;

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

export interface SanitizedStateSnapshot {
  /** 请求方 socket id（服务端定向转发的目标） */
  targetId: string;
  elements: Record<string, unknown>[];
  truncated: boolean;
}

/**
 * 房间快照载荷：目标 socket id + 图元数组。
 * 图元复用补丁的字段校验与数量上限，避免加入房间成为新的放大通道。
 */
export function sanitizeStateSnapshot(
  value: unknown,
): SanitizedStateSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    targetId?: unknown;
    elements?: unknown;
    truncated?: unknown;
  };
  if (typeof candidate.targetId !== "string" || !candidate.targetId) return null;
  if (candidate.targetId.length > 128) return null;

  const sanitized = sanitizePatch({ upserts: candidate.elements, deletes: [] });
  if (!sanitized) return null;

  return {
    targetId: candidate.targetId,
    elements: sanitized.upserts,
    truncated: candidate.truncated === true,
  };
}

/** 从房间成员中选一个非请求者的 socket，作为快照应答方 */
export function pickPeerSocket(
  members: Iterable<string> | undefined,
  excludeId: string,
): string | null {
  for (const socketId of members ?? []) {
    if (socketId !== excludeId) return socketId;
  }
  return null;
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
