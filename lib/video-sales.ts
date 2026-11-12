// 마이인 영상별 매출 (OS 개발 요청 2026-11-11; 대표 확정: 구매 전 유입이 기본, 최초 유입은 보조): MYIN's money per UTM combination,
// matched to YouTube videos. Pure (no server imports) so the matching can be tested on its own.
// - view "l" = 구매 전 유입 (the order's latest non-direct touch), "f" = 최초 유입. The same order is in both; never add them.
// - A video is its YouTube id: utm_content that is the id itself (case kept), or an OS upload's own "yp-xxxxxxxx" code.
// - The same code on two videos is a 충돌 and is not split; an id-like code the OS cannot find is 미매핑; other YouTube
//   content (a profile link, no content at all) is 프로필·기타; a touch with no source is 미상. Nothing is guessed.

export interface SalesRow { view: "l" | "f"; d: string; src: string | null; med: string | null; cmp: string | null; cnt: string | null; orders: number; gross: number; refunded: number; net: number }
export interface SalesVideo { videoId: string; title: string; channelTitle?: string }
export interface SalesMaps {
  /** OS upload codes (utm_content "yp-xxxxxxxx") → the video ids they were put on. */
  codes: Record<string, string[]>;
  /** Videos the OS knows (uploads, plus ids looked up on YouTube), by exact id. */
  videos: Record<string, SalesVideo>;
}
export interface Money { orders: number; net: number }
type ByView = Record<"l" | "f", Money>;
export type SalesKind = "video" | "conflict" | "unmapped" | "nonVideo";

const zero = (): Money => ({ orders: 0, net: 0 });
const views = (): ByView => ({ l: zero(), f: zero() });
const add = (money: Money, row: SalesRow) => { money.orders += row.orders; money.net += row.net; };
export const isYoutubeSource = (src: string | null) => /youtu/i.test(src ?? "");
const ID = /^[A-Za-z0-9_-]{11}$/, CODE = /^yp-[0-9a-f]{8}$/;

/** Which video (or which bucket) one YouTube row's utm_content names. */
export function classifyContent(cnt: string | null, maps: SalesMaps): { kind: SalesKind; videoIds: string[] } {
  if (!cnt) return { kind: "nonVideo", videoIds: [] };
  if (CODE.test(cnt)) {
    const ids = [...new Set(maps.codes[cnt] ?? [])];
    return ids.length === 1 ? { kind: "video", videoIds: ids } : ids.length > 1 ? { kind: "conflict", videoIds: ids } : { kind: "unmapped", videoIds: [] };
  }
  if (ID.test(cnt)) return maps.videos[cnt] ? { kind: "video", videoIds: [cnt] } : { kind: "unmapped", videoIds: [] };
  return { kind: "nonVideo", videoIds: [] };
}

export function videoSales(rows: SalesRow[], maps: SalesMaps) {
  const totals = { all: views(), youtube: views(), video: views(), conflict: views(), unmapped: views(), nonVideo: views(), otherSource: views(), unknown: views() };
  const videos = new Map<string, SalesVideo & { money: ByView; codes: Set<string>; daily: Map<string, Money> }>();
  const buckets = { conflict: new Map<string, { cnt: string; videoIds: string[]; money: ByView }>(), unmapped: new Map<string, { cnt: string; money: ByView }>(),
    nonVideo: new Map<string, { cnt: string | null; cmp: string | null; money: ByView }>() };
  for (const row of rows) {
    add(totals.all[row.view], row);
    if (!row.src) { add(totals.unknown[row.view], row); continue; }
    if (!isYoutubeSource(row.src)) { add(totals.otherSource[row.view], row); continue; }
    add(totals.youtube[row.view], row);
    const { kind, videoIds } = classifyContent(row.cnt, maps);
    add(totals[kind][row.view], row);
    if (kind === "video") {
      const id = videoIds[0], known = maps.videos[id] ?? { videoId: id, title: "제목 확인 필요" };
      const entry = videos.get(id) ?? { ...known, videoId: id, money: views(), codes: new Set<string>(), daily: new Map<string, Money>() };
      add(entry.money[row.view], row);
      entry.codes.add(row.cnt!);
      if (row.view === "l") { const day = entry.daily.get(row.d) ?? zero(); add(day, row); entry.daily.set(row.d, day); }
      videos.set(id, entry);
    } else if (kind === "conflict") {
      const entry = buckets.conflict.get(row.cnt!) ?? { cnt: row.cnt!, videoIds, money: views() };
      add(entry.money[row.view], row); buckets.conflict.set(row.cnt!, entry);
    } else if (kind === "unmapped") {
      const entry = buckets.unmapped.get(row.cnt!) ?? { cnt: row.cnt!, money: views() };
      add(entry.money[row.view], row); buckets.unmapped.set(row.cnt!, entry);
    } else {
      const key = `${row.cnt ?? ""}|${row.cmp ?? ""}`, entry = buckets.nonVideo.get(key) ?? { cnt: row.cnt, cmp: row.cmp, money: views() };
      add(entry.money[row.view], row); buckets.nonVideo.set(key, entry);
    }
  }
  const byNet = <T extends { money: ByView }>(list: T[]) => list.sort((a, b) => b.money.l.net - a.money.l.net || b.money.f.net - a.money.f.net);
  return {
    totals,
    videos: byNet([...videos.values()]).map(({ codes, daily, ...video }) => ({ ...video, codes: [...codes], daily: [...daily].map(([d, money]) => ({ d, ...money })).sort((a, b) => a.d.localeCompare(b.d)) })),
    conflicts: byNet([...buckets.conflict.values()]), unmapped: byNet([...buckets.unmapped.values()]), nonVideo: byNet([...buckets.nonVideo.values()]),
  };
}
export type VideoSales = ReturnType<typeof videoSales>;
