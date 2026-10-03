export interface AppealReadinessSource {
  source_url?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function appealReadinessMissing(topic: AppealReadinessSource | null): string[] {
  if (!topic) return ["대표 시청자", "사람들이 찾는 말", "콘텐츠 위계", "시장 근거 영상 주소"];
  const fields = [
    ["대표 시청자", topic.metadata?.audience],
    ["사람들이 찾는 말", topic.metadata?.entryLanguage],
    ["콘텐츠 위계", topic.metadata?.hierarchy],
    ["시장 근거 영상 주소", topic.source_url],
  ] as const;
  return fields.filter(([, value]) => typeof value !== "string" || !value.trim()).map(([label]) => label);
}
