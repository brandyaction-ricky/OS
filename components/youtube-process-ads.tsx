"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { adMetrics, adNumber, adPct, adWon, type AdHistoryRow, type AdNumbers } from "@/lib/youtube-process/ad-results";
import { stepHref } from "@/lib/youtube-process/project";
import { errorMessage, type YpClient } from "./youtube-process-data";
import { YpSection, type YpPage } from "./youtube-process-frame";

// 광고 성과 1단계 (로건 QA 10/30, 대표 결정 2026-10-31): numbers copied from Meta Ads Manager, the rates worked out here, and the next
// ad's 대본 · 장면 AI reading which earlier ads paid back.
const FIELDS: [keyof AdNumbers, string, string][] = [["spend", "지출 금액", "예) 120,000"], ["impressions", "노출", "예) 48,210"], ["clicks", "링크 클릭", "예) 731"],
  ["plays3s", "3초 이상 재생", "예) 11,904"], ["purchases", "구매", "예) 4"], ["revenue", "구매 전환값 (매출)", "예) 236,000"]];
const ROAS = (value: number | null) => value === null ? "—" : `${value.toFixed(2)}배`;
const today = () => new Date().toISOString().slice(0, 10);
const weekAgo = () => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

/** 내보내기 › 광고 성과: one row per period the ad ran. */
export function AdResultsSection({ page, n }: { page: YpPage; n: number }) {
  const project = page.bundle!.project, upload = page.bundle!.stages.upload;
  const [form, setForm] = useState<Record<string, string>>({ from: weekAgo(), to: today(), note: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const ads = upload.data.ads ?? [];
  const numbers = Object.fromEntries(FIELDS.map(([key]) => [key, adNumber(form[key] ?? "")])) as Record<keyof AdNumbers, number | null>;
  const missing = FIELDS.filter(([key]) => numbers[key] === null).map(([, label]) => label);
  const change = async (body: Parameters<YpClient["saveAdResult"]>[2]) => {
    if (!page.client) return;
    setBusy(true); setError("");
    try { await page.client.saveAdResult(project.id, upload.version, body); await page.reload(); if (body.entry) setForm({ from: weekAgo(), to: today(), note: "" }); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <YpSection n={n} title="광고 성과" gq="메타 광고 관리자 숫자를 그대로 붙여 넣어요">
    {ads.length ? <div className="yp-scroll-x"><table className="yp-adtab"><thead><tr><th>기간</th><th>지출</th><th>CPM</th><th>CTR</th><th>3초 시청률</th><th>CPA</th><th>ROAS</th><th /></tr></thead>
      <tbody>{ads.map(row => { const m = adMetrics(row); return <tr key={row.id}><td>{row.from.slice(5)} ~ {row.to.slice(5)}{row.note ? <small className="yp-muted"> · {row.note}</small> : null}</td>
        <td>{adWon(row.spend)}</td><td>{adWon(m.cpm)}</td><td>{adPct(m.ctr)}</td><td>{adPct(m.view3s)}</td><td>{adWon(m.cpa)}</td><td><b>{ROAS(m.roas)}</b></td>
        <td><button type="button" className="yp-ib yp-xs" aria-label={`${row.from} 성과 지우기`} disabled={busy} onClick={() => { if (window.confirm("이 기간의 광고 성과를 지울까요?")) void change({ remove: row.id }); }}><X size={12} /></button></td></tr>; })}</tbody></table></div>
      : <p className="yp-hint yp-mt0">아직 적은 성과가 없어요. 광고를 며칠 돌린 뒤 기간별로 적어요.</p>}
    <form className="yp-adform" onSubmit={event => { event.preventDefault(); if (!missing.length) void change({ entry: { from: form.from, to: form.to, note: form.note.trim(), ...(numbers as Record<keyof AdNumbers, number>) } }); }}>
      <label>시작한 날<input className="yp-in" type="date" value={form.from} max={form.to} onChange={event => setForm(value => ({ ...value, from: event.target.value }))} /></label>
      <label>끝난 날<input className="yp-in" type="date" value={form.to} min={form.from} onChange={event => setForm(value => ({ ...value, to: event.target.value }))} /></label>
      {FIELDS.map(([key, label, hint]) => <label key={key}>{label}<input className="yp-in" inputMode="numeric" value={form[key] ?? ""} placeholder={hint} onChange={event => setForm(value => ({ ...value, [key]: event.target.value }))} /></label>)}
      <label className="yp-adform-note">메모 (선택)<input className="yp-in" maxLength={300} value={form.note} placeholder="예) 4:5 피드 광고 · 타겟 25~34" onChange={event => setForm(value => ({ ...value, note: event.target.value }))} /></label>
      <div className="yp-row-btns yp-adform-note"><button type="submit" className="yp-btn yp-pri yp-sm" disabled={busy || missing.length > 0}>{busy ? "저장하는 중…" : "이 기간 성과 적기"}</button>
        {missing.length && missing.length < FIELDS.length ? <span className="yp-hint">비어 있거나 숫자가 아닌 칸: {missing.join(" · ")} (없으면 0)</span> : null}</div>
    </form>
    {error ? <p className="yp-errline" role="alert">{error}</p> : null}
    <p className="yp-hint">CPM · CTR · CPA · ROAS · 3초 시청률은 OS가 계산해요. 다음 광고의 대본 · 장면을 만드는 AI가 잘 된 구매 이유와 헤드 카피를 참고해요.</p>
  </YpSection>;
}

/** 주제 찾기 › 광고: the ads with numbers, best return first, so the next one starts from what paid back. */
export function AdHistoryCard({ client }: { client: YpClient | null }) {
  const [rows, setRows] = useState<AdHistoryRow[] | null>(null);
  useEffect(() => { if (client) client.adHistory().then(setRows, () => setRows([])); }, [client]);
  return <section className="yp-card yp-mt14"><div className="yp-card-h">지난 광고 성과 {rows?.length ? `${rows.length}` : ""}</div>
    <div className="yp-card-b">{rows === null ? <p className="yp-hint" role="status">불러오는 중이에요…</p>
      : rows.length ? <ul className="yp-hist">{rows.slice(0, 5).map(row => { const m = adMetrics(row.result); return <li key={`${row.projectId}-${row.result.id}`} className="yp-adrow">
        <span className="yp-grow"><Link className="yp-lnk" href={stepHref(5, row.projectId)}><b>{row.title}</b></Link><br />
          <span className="yp-muted yp-sub13">구매 이유 {row.result.appeal || "—"} · 헤드 카피 {row.result.headCopy || "—"}</span></span>
        <span className="yp-adnum"><b>ROAS {ROAS(m.roas)}</b><br /><span className="yp-muted">CPA {adWon(m.cpa)} · CTR {adPct(m.ctr)}</span></span></li>; })}</ul>
      : <p className="yp-pempty">아직 적은 광고 성과가 없어요. 광고를 내보낸 뒤 내보내기 › 광고 성과에 숫자를 적어요.</p>}
      {rows?.length ? <p className="yp-hint">새 광고의 대본 · 장면 AI가 위쪽(잘 된 광고)을 참고하고 아래쪽(약한 광고)은 피해요.</p> : null}</div></section>;
}
