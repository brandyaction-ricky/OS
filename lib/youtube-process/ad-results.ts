// 광고 성과 1단계 (로건 QA 10/30, 대표 결정 2026-10-31 「1단계부터」): the PD copies an ad's numbers from Meta Ads Manager onto its
// 내보내기 step; the OS works out CPM · CTR · CPA · ROAS · 3초 시청률, and the next ad's 대본 · 장면 AI reads which 구매 이유 and 헤드 카피 did
// well. 2단계 (Meta 광고 계정 연결) will fill the same numbers by itself.
export interface AdResult {
  id: string; from: string; to: string;
  spend: number; impressions: number; clicks: number; plays3s: number; purchases: number; revenue: number;
  note: string; at: string; by: string;
  /** What this ad said, kept when the numbers were entered so the history reads without opening each video. */
  appeal: string; headCopy: string;
}
export type AdNumbers = Pick<AdResult, "spend" | "impressions" | "clicks" | "plays3s" | "purchases" | "revenue">;

/** 「₩1,234,000」 · 「1.2만」 · 「3,456」 as a number (null when there is no number in it). */
export function adNumber(text: string) {
  const clean = text.replace(/[₩,\s원회건]/g, "");
  const match = clean.match(/^(\d+(?:\.\d+)?)(만)?$/);
  return match ? Math.round(Number(match[1]) * (match[2] ? 10_000 : 1)) : null;
}

const ratio = (top: number, bottom: number) => bottom > 0 ? top / bottom : null;
/** The rates Meta shows, from the counts (null when what it divides by is 0). */
export function adMetrics(row: AdNumbers) {
  const cpm = ratio(row.spend * 1000, row.impressions), ctr = ratio(row.clicks, row.impressions), cpa = ratio(row.spend, row.purchases);
  return { cpm, ctr, cpa, roas: ratio(row.revenue, row.spend), view3s: ratio(row.plays3s, row.impressions) };
}

export interface AdHistoryRow { projectId: string; title: string; result: AdResult }
/** The ads with money spent, best return first (then the cheapest purchase), for the next ad to learn from. */
export function rankAds(rows: AdHistoryRow[]) {
  const score = (row: AdHistoryRow) => { const m = adMetrics(row.result); return [m.roas ?? -1, -(m.cpa ?? Infinity)]; };
  return rows.filter(row => row.result.spend > 0).sort((a, b) => { const [ra, ca] = score(a), [rb, cb] = score(b); return rb - ra || cb - ca; });
}

const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const won = (value: number | null) => value === null ? "—" : `${Math.round(value).toLocaleString("ko-KR")}원`;
/** One line an AI (and a person) can read: what the ad said and how it did. */
export const adLine = (row: AdHistoryRow) => {
  const m = adMetrics(row.result);
  return `「${row.title}」 구매 이유: ${row.result.appeal || "—"} · 헤드 카피: ${row.result.headCopy || "—"} · ROAS ${m.roas === null ? "—" : `${m.roas.toFixed(2)}배`} · CPA ${won(m.cpa)} · CTR ${pct(m.ctr)} · 3초 시청률 ${pct(m.view3s)} · CPM ${won(m.cpm)}`;
};
/** What the next ad's AI reads: the best three and the weakest two (no more than five lines). */
export function pastAdsForAi(rows: AdHistoryRow[]) {
  const ranked = rankAds(rows);
  if (!ranked.length) return null;
  const best = ranked.slice(0, 3), weak = ranked.length > 3 ? ranked.slice(-Math.min(2, ranked.length - 3)) : [];
  return { best: best.map(adLine), weak: weak.map(adLine) };
}
export { pct as adPct, won as adWon };
