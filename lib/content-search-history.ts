export interface ContentSearchHistoryRecord {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ContentSearchHistorySummary {
  key: string;
  query: string;
  count: number;
  latestAt: string;
  latestActorId: string;
  resultCount: number | null;
  topViewCount: number | null;
}

export function summarizeContentSearchHistory(records: ContentSearchHistoryRecord[]): ContentSearchHistorySummary[] {
  const groups = new Map<string, ContentSearchHistorySummary>();
  for (const record of records) {
    const query = String(record.metadata.query ?? record.title).trim();
    const key = query.toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
    if (!key) continue;
    const latestAt = String(record.metadata.searchedAt ?? record.created_at);
    const previous = groups.get(key);
    const resultCount = Number(record.metadata.resultCount);
    const topViewCount = Number(record.metadata.topViewCount);
    if (previous) {
      previous.count += 1;
      if (latestAt <= previous.latestAt) continue;
    }
    groups.set(key, {
      key, query, count: previous?.count ?? 1, latestAt,
      latestActorId: record.created_by,
      resultCount: record.metadata.resultCount == null || !Number.isFinite(resultCount) ? null : resultCount,
      topViewCount: record.metadata.topViewCount == null || !Number.isFinite(topViewCount) ? null : topViewCount,
    });
  }
  return [...groups.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt) || a.query.localeCompare(b.query, "ko"));
}
