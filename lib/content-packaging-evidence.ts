import type { OsRecord } from "./record-types";

type Selection = { state: "missing" | "single" | "multiple" | "invalid"; texts: string[] };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function selection(value: unknown): Selection {
  if (value == null) return { state: "missing", texts: [] };
  if (!Array.isArray(value) || value.length > 100) return { state: "invalid", texts: [] };
  const texts: string[] = [];
  for (const candidate of value) {
    const item = object(candidate);
    if (!item || (item.picked !== undefined && typeof item.picked !== "boolean")) return { state: "invalid", texts: [] };
    if (item.picked !== true) continue;
    const text = item.text ?? item.title;
    if (typeof text !== "string" || !text.trim() || text.length > 4000) return { state: "invalid", texts: [] };
    texts.push(text.trim());
  }
  return { state: texts.length === 0 ? "missing" : texts.length === 1 ? "single" : "multiple", texts };
}

// Describes stored choices only. It never reinterprets stars/statuses as approval.
export function packagingEvidence(sourceId: string, records: OsRecord[], memoCopy = "") {
  const packages = records.filter(record => record.record_type === "content_package" && record.parent_id === sourceId && !record.archived_at && object(record.metadata)?.packageKind === "title_package");
  const unknown = { state: "missing", texts: [] } as Selection;
  const base = { approval: "unverified" as const, policy: "unverified" as const, executionAllowed: false as const };
  if (!packages.length) return { ...base, status: "missing" as const, package: null, titles: unknown, copies: unknown, copyDiffers: false };
  if (packages.some(record => !Number.isFinite(Date.parse(record.created_at)) || !Number.isSafeInteger(record.version) || record.version < 1))
    return { ...base, status: "invalid" as const, package: null, titles: unknown, copies: unknown, copyDiffers: false };
  const ordered = [...packages].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (ordered.length > 1 && Date.parse(ordered[0].created_at) === Date.parse(ordered[1].created_at))
    return { ...base, status: "ambiguous" as const, package: null, titles: unknown, copies: unknown, copyDiffers: false };
  const latest = ordered[0];
  const result = object(object(latest.metadata)?.result);
  const titles = selection(result?.titles), copies = selection(result?.copies);
  return { ...base, status: result ? "loaded" as const : "invalid" as const,
    package: { id: latest.id, version: latest.version }, titles, copies,
    copyDiffers: copies.state === "single" && Boolean(memoCopy.trim()) && copies.texts[0] !== memoCopy.trim() };
}
