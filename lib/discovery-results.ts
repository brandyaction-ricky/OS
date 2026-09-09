export interface DiscoveryBaseline {
  state: string; sampleCount: number; ratio: number | null; robustZ: number | null; outlier: boolean; reason: string;
}
type Video = { id: string; title: string; durationSeconds: number; publishedAt: string | null; viewCount: number; live?: boolean };

export function discoveryResults<T extends Video>(items: T[], baselines: Record<string, DiscoveryBaseline>, options: { format: string; days: string; sort: string; outliersOnly: boolean }, now = Date.now()) {
  return items.filter((item) => {
    if (item.live || /재업로드|재업|reupload|예고편/i.test(item.title)) return false;
    if (options.format !== "short" && /#shorts|쇼츠/i.test(item.title)) return false;
    if (options.format === "long" && item.durationSeconds < 240) return false;
    if (options.format === "short" && item.durationSeconds >= 240) return false;
    const published = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    if (options.days !== "all" && (!Number.isFinite(published) || now - published > Number(options.days) * 86_400_000 || published > now)) return false;
    return options.format === "short" || !options.outliersOnly || baselines[item.id]?.outlier === true;
  }).sort((a, b) => {
    if (options.sort === "recent") return String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id);
    if (options.sort === "ratio") return (baselines[b.id]?.ratio ?? -1) - (baselines[a.id]?.ratio ?? -1) || (baselines[b.id]?.robustZ ?? -1) - (baselines[a.id]?.robustZ ?? -1) || b.viewCount - a.viewCount;
    return b.viewCount - a.viewCount || a.id.localeCompare(b.id);
  });
}

// A user-triggered search is bounded to 20 videos with three concurrent comparisons.
// One failed channel must not discard successful comparisons or become a zero score.
export async function measureDiscovery<T extends Video>(items: T[], measure: (item: T) => Promise<DiscoveryBaseline>, report: (id: string, result: DiscoveryBaseline) => void) {
  const queue = items.filter((item) => item.durationSeconds >= 240 && !item.live).slice(0, 20);
  let index = 0; let failed = 0;
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (index < queue.length) {
      const item = queue[index++];
      try { report(item.id, await measure(item)); }
      catch { failed++; report(item.id, { state: "failed", sampleCount: 0, ratio: null, robustZ: null, outlier: false, reason: "비교 데이터를 읽지 못했습니다. 다시 비교해 주세요." }); }
    }
  }));
  return { attempted: queue.length, failed };
}
