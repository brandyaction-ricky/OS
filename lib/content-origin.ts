export type ContentOrigin = 'own' | 'market' | 'test';
export type ContentOriginFilter = ContentOrigin | 'all';
export const CONTENT_ORIGIN_LABELS = { own: '우리 콘텐츠', market: '시장 레퍼런스', test: '테스트', all: '전체 종류' } as const;
type OriginRecord = { title?: string; metadata?: Record<string, unknown>; parent_id?: string | null };
export function contentOrigin(record: OriginRecord): ContentOrigin {
  const origin = record.metadata?.origin;
  if (origin === 'own' || origin === 'market' || origin === 'test') return origin;
  if (/\[(?:테스트|QA테스트|운영검수|E2E)\]/i.test(record.title ?? '')) return 'test';
  if (['channel', 'outlier'].includes(String(record.metadata?.studioKind)) || record.metadata?.packageKind === 'market_reference') return 'market';
  return 'own';
}
export function filterContentOrigin<T extends OriginRecord>(records: T[], origin: ContentOriginFilter = 'own'): T[] {
  return origin === 'all' ? records : records.filter(record => contentOrigin(record) === origin);
}
export function sourceSelection(records: Array<OriginRecord & { id: string }>, current = '', requested = ''): string {
  if (records.some(record => record.id === current)) return current;
  const own = filterContentOrigin(records);
  return own.find(record => record.id === requested)?.id ?? own[0]?.id ?? '';
}
export function linkedContentOrigin(record: OriginRecord, sources: Array<OriginRecord & { id: string }>): ContentOrigin {
  if (contentOrigin(record) === 'test') return 'test';
  const parent = sources.find(source => source.id === record.parent_id);
  return parent ? contentOrigin(parent) : contentOrigin(record);
}
