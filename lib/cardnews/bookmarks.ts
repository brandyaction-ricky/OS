export interface CardUrlBookmark { id: string; label: string; url: string }
export const CARD_BOOKMARK_MAX = 30;
export function validCardUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && value.length <= 500; } catch { return false; }
}
export function readCardBookmarks(value: string | null): CardUrlBookmark[] {
  try {
    const rows: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(rows) ? rows.filter((row): row is CardUrlBookmark => Boolean(row && typeof row === "object" && typeof row.id === "string" && typeof row.label === "string" && typeof row.url === "string" && validCardUrl(row.url))).slice(0, CARD_BOOKMARK_MAX) : [];
  } catch { return []; }
}
