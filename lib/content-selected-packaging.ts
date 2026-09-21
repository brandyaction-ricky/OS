import type { OsRecord } from "./record-types";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// Only the selected display text may enter the generation prompt.
export function selectedPackaging(records: OsRecord[], sourceId: string) {
  const packages = records.filter(record => record.parent_id === sourceId && record.record_type === "content_package" && !record.archived_at && record.metadata.packageKind === "title_package")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const record = packages[0];
  if (!record) return null;
  const result = object(record.metadata.result);
  const selected = (value: unknown): string[] | null => {
    if (!Array.isArray(value) || value.length > 100) return null;
    const texts: string[] = [];
    for (const raw of value) {
      const item = object(raw);
      if (item.picked !== true) continue;
      if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 4000) return null;
      texts.push(item.text.trim());
    }
    return texts;
  };
  const titles = selected(result.titles), copies = selected(result.copies);
  if (!titles || titles.length !== 1 || !copies?.length) return null;
  return { title: titles[0], thumbnailCopies: copies };
}
