/**
 * frameCoalescer.ts — 把高频更新合并到每一帧一次
 *
 * 鼠标移动可能每毫秒触发多次；合并后每个动画帧最多执行一次 setState，
 * 避免拖拽与平移时整棵画布组件树被重复渲染。
 */

export interface FrameScheduler {
    schedule(callback: () => void): number;
    cancel(handle: number): void;
}

const defaultScheduler: FrameScheduler = {
    schedule: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
};

export class FrameCoalescer<T> {
    private pending: T | null = null;
    private handle: number | null = null;

    constructor(
        private readonly apply: (value: T) => void,
        private readonly scheduler: FrameScheduler = defaultScheduler,
    ) {}

    /** 记录最新值；同一帧内的多次调用只保留最后一次 */
    schedule(value: T): void {
        this.pending = value;
        if (this.handle !== null) return;
        this.handle = this.scheduler.schedule(() => this.flush());
    }

    /** 立即执行挂起的更新，用于 pointerup / 卸载前补齐最后一帧 */
    flush(): void {
        if (this.handle !== null) {
            this.scheduler.cancel(this.handle);
            this.handle = null;
        }
        const value = this.pending;
        this.pending = null;
        if (value !== null) this.apply(value);
    }

    /** 丢弃挂起的更新 */
    cancel(): void {
        if (this.handle !== null) {
            this.scheduler.cancel(this.handle);
            this.handle = null;
        }
        this.pending = null;
    }

    get hasPending(): boolean {
        return this.pending !== null;
    }
}
