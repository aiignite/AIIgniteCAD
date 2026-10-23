/**
 * metrics.ts — 进程内指标注册表
 *
 * 轻量实现，避免为单体服务引入 Prometheus 客户端依赖：
 * 计数器、仪表盘与直方图（保留最近 2048 个样本用于 P50/P95/P99）。
 * 指标通过 GET /api/metrics 暴露，供监控系统定时抓取。
 */

export interface HistogramSnapshot {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramSnapshot>;
}

const MAX_SAMPLES = 2048;

const percentile = (sorted: number[], ratio: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(ratio * sorted.length) - 1),
  );
  return sorted[index];
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

class MetricsRegistry {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private samples = new Map<string, number[]>();

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  decrement(name: string, value = 1): void {
    this.increment(name, -value);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observe(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const series = this.samples.get(name) ?? [];
    series.push(value);
    if (series.length > MAX_SAMPLES) {
      series.splice(0, series.length - MAX_SAMPLES);
    }
    this.samples.set(name, series);
  }

  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [name, value] of this.counters) counters[name] = value;

    const gauges: Record<string, number> = {};
    for (const [name, value] of this.gauges) gauges[name] = value;

    const histograms: Record<string, HistogramSnapshot> = {};
    for (const [name, values] of this.samples) {
      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((total, value) => total + value, 0);
      histograms[name] = {
        count: sorted.length,
        min: round(sorted[0] ?? 0),
        max: round(sorted[sorted.length - 1] ?? 0),
        avg: round(sorted.length ? sum / sorted.length : 0),
        p50: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
        p99: round(percentile(sorted, 0.99)),
      };
    }

    return { counters, gauges, histograms };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.samples.clear();
  }
}

export const metrics = new MetricsRegistry();

/** 安全计算比率；分母为 0 时返回 0 */
export const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? round(numerator / denominator) : 0;
