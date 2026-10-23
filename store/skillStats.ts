/**
 * skillStats.ts — 技能统计的刷新信号
 *
 * 采纳回执与点赞点踩散落在 App / useAIChat，而统计只在技能面板展示。
 * 写入成功后广播一次「统计变脏」，由面板自己重新拉取，不做轮询。
 */

let revision = 0;
const listeners = new Set<() => void>();

export function getSkillStatsRevision(): number {
    return revision;
}

export function subscribeSkillStats(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** 回执成功一次就调用；数字本身没有含义，只用于触发订阅方重新求值 */
export function markSkillStatsDirty(): void {
    revision += 1;
    listeners.forEach((listener) => listener());
}
