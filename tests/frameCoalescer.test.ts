/**
 * frameCoalescer.test.ts — 逐帧合并的调度行为
 */

import { describe, expect, it, vi } from "vitest";
import { FrameCoalescer, type FrameScheduler } from "../lib/frameCoalescer";

function createScheduler() {
    const callbacks = new Map<number, () => void>();
    let nextId = 1;
    const scheduler: FrameScheduler = {
        schedule: (callback) => {
            const id = nextId++;
            callbacks.set(id, callback);
            return id;
        },
        cancel: (handle) => {
            callbacks.delete(handle);
        },
    };
    const tick = () => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((callback) => callback());
    };
    return { scheduler, tick, callbacks };
}

describe("FrameCoalescer", () => {
    it("同一帧内只应用最后一次值", () => {
        const { scheduler, tick } = createScheduler();
        const apply = vi.fn();
        const coalescer = new FrameCoalescer<number>(apply, scheduler);

        coalescer.schedule(1);
        coalescer.schedule(2);
        coalescer.schedule(3);
        expect(apply).not.toHaveBeenCalled();

        tick();
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith(3);
    });

    it("flush 立即补齐挂起值并取消帧回调", () => {
        const { scheduler, tick, callbacks } = createScheduler();
        const apply = vi.fn();
        const coalescer = new FrameCoalescer<string>(apply, scheduler);

        coalescer.schedule("last");
        coalescer.flush();
        expect(apply).toHaveBeenCalledWith("last");
        expect(callbacks.size).toBe(0);

        tick();
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it("cancel 丢弃挂起值", () => {
        const { scheduler, tick } = createScheduler();
        const apply = vi.fn();
        const coalescer = new FrameCoalescer<number>(apply, scheduler);

        coalescer.schedule(1);
        coalescer.cancel();
        tick();
        expect(apply).not.toHaveBeenCalled();
        expect(coalescer.hasPending).toBe(false);
    });
});
