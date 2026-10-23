/**
 * telemetry.test.ts — 前端遥测的批量、去重与静默失败
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telemetryService } from "../services/telemetryService";

const fetchMock = vi.fn();

const lastBody = () => {
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  const init = calls[calls.length - 1]?.[1];
  return JSON.parse(String(init?.body)) as {
    events: Array<{ type: string; message?: string; context?: Record<string, unknown> }>;
  };
};

describe("telemetryService", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("相同错误在节流窗口内只入队一次，并批量上报", async () => {
    telemetryService.captureError(
      new Error("canvas exploded"),
      { source: "unit-test" },
      "unhandled-rejection",
    );
    // 与上一条完全相同：应被去重
    telemetryService.captureError(
      new Error("canvas exploded"),
      { source: "unit-test" },
      "unhandled-rejection",
    );

    await telemetryService.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastBody();
    const matching = body.events.filter(
      (event) => event.message === "canvas exploded",
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].type).toBe("unhandled-rejection");
  });

  it("同步状态仅在快照变化时上报，并携带积压数量", async () => {
    const base = {
      online: true,
      syncing: false,
      pendingCount: 2,
      failedCount: 1,
      lastError: "network down",
      lastSyncedAt: null,
    };

    telemetryService.reportSyncStatus(base);
    telemetryService.reportSyncStatus(base);
    telemetryService.reportSyncStatus({ ...base, pendingCount: 0, failedCount: 0, lastError: null });

    await telemetryService.flush();

    const body = lastBody();
    const statusEvents = body.events.filter((event) => event.type === "sync-status");
    expect(statusEvents).toHaveLength(2);
    expect(statusEvents[0].context).toMatchObject({
      pendingCount: 2,
      failedCount: 1,
    });
    expect(statusEvents[1].context).toMatchObject({ pendingCount: 0 });
  });

  it("上报失败不抛异常，也不阻塞调用方", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    telemetryService.captureError(new Error("another failure"), {
      source: "unit-test-offline",
    });

    await expect(telemetryService.flush()).resolves.toBeUndefined();
  });
});
