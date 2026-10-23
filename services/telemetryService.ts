/**
 * telemetryService.ts — 前端运行时遥测
 *
 * 采集全局错误、未处理 Promise 拒绝与同步积压状态，
 * 批量上报到 POST /api/telemetry/events。
 * 遥测失败必须静默：任何异常都不能影响编辑与同步主流程。
 */

import { API_BASE_URL } from "./apiService";
import type { SyncStatusSnapshot } from "./syncService";

export type ClientEventType =
  | "error"
  | "unhandled-rejection"
  | "sync-error"
  | "sync-status"
  | "client-info";

export interface ClientTelemetryEvent {
  type: ClientEventType;
  timestamp: string;
  message?: string;
  context?: Record<string, unknown>;
}

const MAX_QUEUE = 100;
const MAX_BATCH = 20;
const FLUSH_DELAY_MS = 4000;
const ERROR_THROTTLE_MS = 60_000;
const MAX_BREADCRUMBS = 20;

/** 构建时注入的版本号，便于把线上错误定位到具体发布 */
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** 最近一次用户操作序列，随错误事件一起上报 */
export interface ActionBreadcrumb {
  name: string;
  at: string;
  detail?: Record<string, unknown>;
}

const isDisabled = (): boolean =>
  (import.meta.env as Record<string, string | undefined>)
    .VITE_TELEMETRY_DISABLED === "true";

class TelemetryService {
  private queue: ClientTelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private lastErrorAt = new Map<string, number>();
  private lastSyncSignature = "";
  private breadcrumbs: ActionBreadcrumb[] = [];
  private readonly sessionId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  /** 记录一条用户操作，供错误上报还原操作序列 */
  recordAction(name: string, detail?: Record<string, unknown>): void {
    this.breadcrumbs.push({ name, at: new Date().toISOString(), detail });
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) {
      this.breadcrumbs.splice(0, this.breadcrumbs.length - MAX_BREADCRUMBS);
    }
  }

  private baseContext(): Record<string, unknown> {
    return {
      appVersion: APP_VERSION,
      sessionId: this.sessionId,
      breadcrumbs: [...this.breadcrumbs],
    };
  }

  init(): void {
    if (this.initialized || typeof window === "undefined" || isDisabled()) return;
    this.initialized = true;

    window.addEventListener("error", (event) => {
      this.captureError(event.error ?? event.message, {
        source: "window.error",
        filename: event.filename,
        line: event.lineno,
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.captureError(event.reason, { source: "unhandledrejection" });
    });

    window.addEventListener("pagehide", () => {
      void this.flush();
    });
  }

  captureError(
    error: unknown,
    context: Record<string, unknown> = {},
    type: "error" | "unhandled-rejection" = "error",
  ): void {
    if (isDisabled()) return;

    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    const dedupeKey = `${message}|${String(context.source ?? type)}`;
    const now = Date.now();
    if (now - (this.lastErrorAt.get(dedupeKey) ?? 0) < ERROR_THROTTLE_MS) {
      return;
    }
    this.lastErrorAt.set(dedupeKey, now);

    this.enqueue({
      type,
      timestamp: new Date().toISOString(),
      message,
      context: {
        ...this.baseContext(),
        ...context,
        stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
      },
    });
  }

  reportClientInfo(
    message: string,
    context: Record<string, unknown> = {},
  ): void {
    if (isDisabled()) return;
    this.enqueue({
      type: "client-info",
      timestamp: new Date().toISOString(),
      message,
      context: { ...this.baseContext(), ...context },
    });
  }

  reportSyncError(message: string, context: Record<string, unknown> = {}): void {
    if (isDisabled()) return;
    this.enqueue({
      type: "sync-error",
      timestamp: new Date().toISOString(),
      message,
      context: { ...this.baseContext(), ...context },
    });
  }

  reportSyncStatus(status: SyncStatusSnapshot): void {
    if (isDisabled()) return;

    const signature = [
      status.online,
      status.syncing,
      status.pendingCount,
      status.failedCount,
      status.lastError ?? "",
    ].join("|");
    if (signature === this.lastSyncSignature) return;
    this.lastSyncSignature = signature;

    this.enqueue({
      type: "sync-status",
      timestamp: new Date().toISOString(),
      context: {
        ...this.baseContext(),
        online: status.online,
        syncing: status.syncing,
        pendingCount: status.pendingCount,
        failedCount: status.failedCount,
        lastError: status.lastError,
      },
    });
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, MAX_BATCH);
    const body = JSON.stringify({ events: batch });

    try {
      await fetch(`${API_BASE_URL}/telemetry/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
    } catch {
      // 遥测属于旁路能力：网络失败时直接丢弃当前批次
    }

    if (this.queue.length > 0) this.schedule();
  }

  private enqueue(event: ClientTelemetryEvent): void {
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE);
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || typeof window === "undefined") return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }
}

export const telemetryService = new TelemetryService();
