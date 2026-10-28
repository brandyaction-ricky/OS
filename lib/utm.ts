// 링크관리 · UTM 링크 (기능요청서 2026-10-28): shared choices for the four UTM keys, and the one place that
// turns an address plus those choices into the final link. Pure, so the screen preview and the server agree.
export const UTM_KINDS = ["source", "medium", "campaign", "content"] as const;
export type UtmKind = typeof UTM_KINDS[number];
export const UTM_KIND_LABEL: Record<UtmKind, string> = { source: "유입 출처", medium: "마케팅 방식", campaign: "캠페인명", content: "콘텐츠/소재 구분" };
export const UTM_BRANDS = [
  { label: "마이인", brand: "마이인" },
  { label: "브랜디에듀", brand: "브랜디액션 에듀" },
  { label: "브랜디액션", brand: "브랜디액션" },
] as const;

export type UtmCodes = { source: string; medium: string; campaign: string; content?: string | null };
export type UtmConflict = { key: string; before: string; after: string | null };

export const normalizeUtmCode = (value: string) => value.trim().toLowerCase();
export const validUtmCode = (code: string) => /^[a-z0-9_-]{1,80}$/.test(code);

/** An address staff may tag: http(s) only, no user:password, no script/data schemes. */
export function parseOriginUrl(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { error: "http:// 또는 https://로 시작하는 주소를 넣어 주세요." }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "http:// 또는 https:// 주소만 쓸 수 있어요." };
  if (url.username || url.password) return { error: "아이디·비밀번호가 들어간 주소는 쓸 수 없어요." };
  if (url.href.length > 2000) return { error: "주소가 너무 길어요 (2,000자 이내)." };
  return { url };
}

const KEY = (kind: UtmKind) => `utm_${kind}`;

/** UTM values already in the address that this form would change or drop. */
export function utmConflicts(origin: URL, codes: UtmCodes): UtmConflict[] {
  return UTM_KINDS.flatMap(kind => {
    const after = codes[kind] || null, present = origin.searchParams.getAll(KEY(kind));
    if (!present.length || (present.length === 1 && present[0] === after)) return [];
    return [{ key: KEY(kind), before: present.join(", "), after }];
  });
}

/** Keeps the path, other query (utm_term, gclid, …) and hash; each of the four keys appears once; no empty utm_content. */
export function buildUtmUrl(origin: URL, codes: UtmCodes): string {
  const url = new URL(origin.href);
  for (const kind of UTM_KINDS) {
    url.searchParams.delete(KEY(kind));
    const value = codes[kind];
    if (value) url.searchParams.set(KEY(kind), value);
  }
  return url.href;
}
