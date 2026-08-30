"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleAlert,
  CircleDollarSign,
  Eye,
  Gauge,
  Plus,
  RefreshCw,
  ShoppingBag,
  Target,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRecord, listRecords } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

function meta<T>(record: OsRecord | null | undefined, key: string, fallback: T): T {
  const found = record?.metadata?.[key];
  return found == null ? fallback : found as T;
}

function formText(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function number(form: FormData, key: string) { return Number(formText(form, key) || 0); }
function money(value: number) { return `${Math.round(value).toLocaleString("ko-KR")}원`; }

export function ContentPerformanceDashboard() {
  const { accessToken, demo, profile } = useSession();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [brand, setBrand] = useState("all");
  const [range, setRange] = useState("30");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    setBusy(true);
    try {
      setRecords((await listRecords(accessToken, "content_metric", "limit=200")).records);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "영상 성과를 불러오지 못했습니다.");
    } finally { setBusy(false); }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const cutoff = range === "all" ? null : new Date(Date.now() - Number(range) * 86_400_000);
    return records.filter((record) => (brand === "all" || record.brand === brand) && (!cutoff || new Date(record.starts_at ?? record.created_at) >= cutoff));
  }, [brand, range, records]);

  const totals = useMemo(() => ({
    views: filtered.reduce((sum, item) => sum + Number(meta(item, "views", item.metric_current ?? 0)), 0),
    impressions: filtered.reduce((sum, item) => sum + Number(meta(item, "impressions", 0)), 0),
    clicks: filtered.reduce((sum, item) => sum + Number(meta(item, "clicks", 0)), 0),
    purchases: filtered.reduce((sum, item) => sum + Number(meta(item, "purchases", meta(item, "conversions", 0))), 0),
    revenue: filtered.reduce((sum, item) => sum + Number(meta(item, "revenue", 0)), 0),
    subscribers: filtered.reduce((sum, item) => sum + Number(meta(item, "subscribers", 0)), 0),
    ctr: filtered.length ? filtered.reduce((sum, item) => sum + Number(meta(item, "ctr", 0)), 0) / filtered.length : 0,
    retention: filtered.length ? filtered.reduce((sum, item) => sum + Number(meta(item, "retention", 0)), 0) / filtered.length : 0,
  }), [filtered]);

  const daily = useMemo(() => {
    const map = new Map<string, { views: number; revenue: number }>();
    for (const record of filtered) {
      const key = (record.starts_at ?? record.created_at).slice(0, 10);
      const current = map.get(key) ?? { views: 0, revenue: 0 };
      current.views += Number(meta(record, "views", record.metric_current ?? 0));
      current.revenue += Number(meta(record, "revenue", 0));
      map.set(key, current);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  }, [filtered]);
  const maxDailyViews = Math.max(...daily.map(([, value]) => value.views), 1);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await createRecord(accessToken, {
        recordType: "content_metric",
        title: formText(form, "title"),
        description: formText(form, "note"),
        status: "measuring",
        priority: "normal",
        stage: "성과 측정",
        brand: formText(form, "brand"),
        team: profile?.team || "콘텐츠",
        sourceUrl: formText(form, "sourceUrl") || null,
        startsAt: new Date(`${formText(form, "date")}T12:00:00`).toISOString(),
        metricCurrent: number(form, "views"),
        metricUnit: "조회",
        tags: ["영상성과", formText(form, "platform")].filter(Boolean),
        metadata: {
          platform: formText(form, "platform"), hierarchy: formText(form, "hierarchy"),
          views: number(form, "views"), impressions: number(form, "impressions"), clicks: number(form, "clicks"),
          ctr: number(form, "ctr"), retention: number(form, "retention"), purchases: number(form, "purchases"),
          conversions: number(form, "purchases"), revenue: number(form, "revenue"), subscribers: number(form, "subscribers"),
          traffic: formText(form, "traffic"), measuredAt: new Date().toISOString(),
        },
      });
      setOpen(false); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "성과 기록을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const brands = [...new Set(records.map((record) => record.brand).filter(Boolean))];
  const conversionRate = totals.views ? totals.purchases / totals.views * 100 : 0;

  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">채널 성과 판정</span><h1>영상 성과</h1><p>조회·CTR·시청지속에서 구매·매출까지 한 화면에서 확인하고, 콘텐츠 위계별 역할을 판정합니다.</p></div><div className="header-actions"><button className="secondary-button" disabled={busy} onClick={load}><RefreshCw className={busy ? "spin" : ""} size={15} /> 새로고침</button><button className="primary-button" onClick={() => setOpen(true)}><Plus size={15} /> 성과 기록</button></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <section className="panel content-performance-filters"><div><strong>영상 성과 대시보드</strong><span>실측 데이터 기준 · API 연결 데이터와 수기 기록을 동일 구조로 저장</span></div><label>브랜드<select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="all">전체</option>{brands.map((item) => <option key={item}>{item}</option>)}</select></label><label>기간<select value={range} onChange={(event) => setRange(event.target.value)}><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option><option value="all">전체</option></select></label></section>
    <section className="metric-grid content-performance-metrics">
      <div className="metric-card"><div className="metric-top"><span>총 조회</span><Eye size={16} /></div><div className="metric-value">{totals.views.toLocaleString("ko-KR")}</div><div className="metric-caption"><ArrowUpRight size={12} /> 선택 기간 합계</div></div>
      <div className="metric-card"><div className="metric-top"><span>평균 CTR</span><Target size={16} /></div><div className="metric-value">{totals.ctr.toFixed(1)}%</div><div className="metric-caption">패키징 신호</div></div>
      <div className="metric-card"><div className="metric-top"><span>평균 지속률</span><Gauge size={16} /></div><div className="metric-value">{totals.retention.toFixed(1)}%</div><div className="metric-caption">전달력 신호</div></div>
      <div className="metric-card"><div className="metric-top"><span>구매</span><ShoppingBag size={16} /></div><div className="metric-value">{totals.purchases.toLocaleString("ko-KR")}</div><div className="metric-caption">조회 대비 {conversionRate.toFixed(2)}%</div></div>
      <div className="metric-card"><div className="metric-top"><span>기여 매출</span><CircleDollarSign size={16} /></div><div className="metric-value money-value">{money(totals.revenue)}</div><div className="metric-caption good">콘텐츠 귀속 기준</div></div>
      <div className="metric-card"><div className="metric-top"><span>구독자 순증</span><Users size={16} /></div><div className="metric-value">{totals.subscribers.toLocaleString("ko-KR")}</div><div className="metric-caption">영상별 순증 합계</div></div>
    </section>
    <section className="performance-analysis-grid content-analysis-grid">
      <article className="panel daily-revenue-chart"><div className="panel-header"><div><h2>일별 조회 흐름</h2><p>최근 기록일 기준 최대 14일</p></div><BarChart3 size={17} /></div>{daily.map(([date, values]) => <div key={date}><time>{date.slice(5)}</time><span><i style={{ width: `${Math.max(2, values.views / maxDailyViews * 100)}%` }} /></span><strong>{values.views.toLocaleString("ko-KR")}</strong></div>)}{!daily.length ? <p className="small-empty">기간 내 기록이 없습니다.</p> : null}</article>
      <article className="panel conversion-funnel"><div className="panel-header"><div><h2>콘텐츠 전환 퍼널</h2><p>노출 → 조회 → 클릭 → 구매</p></div></div>{[
        ["노출", totals.impressions, 100], ["조회", totals.views, totals.impressions ? totals.views / totals.impressions * 100 : 0], ["클릭", totals.clicks, totals.views ? totals.clicks / totals.views * 100 : 0], ["구매", totals.purchases, totals.clicks ? totals.purchases / totals.clicks * 100 : 0],
      ].map(([label, value, rate], index) => <div key={String(label)}><span><i style={{ width: `${Math.max(12, 100 - index * 18)}%` }} /></span><strong>{String(label)}</strong><em>{Number(value).toLocaleString("ko-KR")}</em><small>{Number(rate).toFixed(1)}%</small></div>)}</article>
      <article className="panel source-revenue-list"><div className="panel-header"><div><h2>매출 기여 상위 영상</h2><p>수기·연동 귀속 매출 기준</p></div></div>{[...filtered].sort((a, b) => Number(meta(b, "revenue", 0)) - Number(meta(a, "revenue", 0))).slice(0, 6).map((record) => <div key={record.id}><span>{record.title}</span><strong>{money(Number(meta(record, "revenue", 0)))}</strong></div>)}{!filtered.length ? <p className="small-empty">성과 기록이 없습니다.</p> : null}</article>
    </section>
    <section className="panel performance-table content-performance-table"><div className="panel-header"><div><h2>전체 영상</h2><p>조회수 하나가 아니라 패키징·지속·전환 신호를 함께 판정합니다.</p></div><span>{filtered.length}개</span></div>{filtered.length ? <table><thead><tr><th>영상</th><th>위계</th><th>플랫폼</th><th>조회</th><th>CTR</th><th>지속률</th><th>구매</th><th>매출</th><th>판정</th></tr></thead><tbody>{filtered.map((record) => { const ctr = Number(meta(record, "ctr", 0)); const retention = Number(meta(record, "retention", 0)); const purchases = Number(meta(record, "purchases", meta(record, "conversions", 0))); const signal = ctr >= 5 && retention >= 35 ? "확장" : ctr < 3 ? "패키징 점검" : retention < 25 ? "원고 점검" : purchases > 0 ? "전환 유지" : "관찰"; return <tr key={record.id}><td><strong>{record.title}</strong><small>{record.brand || "공통"}</small></td><td>{meta(record, "hierarchy", "미정")}</td><td>{meta(record, "platform", "YouTube")}</td><td>{Number(meta(record, "views", record.metric_current ?? 0)).toLocaleString("ko-KR")}</td><td>{ctr.toFixed(1)}%</td><td>{retention.toFixed(1)}%</td><td>{purchases}</td><td>{money(Number(meta(record, "revenue", 0)))}</td><td><span className={`performance-signal ${signal === "확장" ? "good" : signal.includes("점검") ? "warning" : ""}`}>{signal === "확장" ? <ArrowUpRight size={12} /> : signal.includes("점검") ? <ArrowDownRight size={12} /> : <Check size={12} />}{signal}</span></td></tr>; })}</tbody></table> : <div className="compact-empty"><BarChart3 size={26} /><strong>측정된 영상이 없습니다.</strong><span>성과 기록을 추가하면 대시보드와 퍼널이 계산됩니다.</span></div>}</section>

    {open ? <div className="drawer-backdrop" onMouseDown={() => !busy && setOpen(false)}><form className="record-drawer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">실측 데이터</span><h2>영상 성과 기록</h2></div><button type="button" className="icon-button" onClick={() => setOpen(false)}><X size={18} /></button></div><label><span>영상 제목</span><input name="title" required /></label><div className="form-grid"><label><span>브랜드</span><input name="brand" defaultValue="브랜디액션" /></label><label><span>측정일</span><input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label></div><div className="form-grid"><label><span>플랫폼</span><select name="platform"><option>YouTube</option><option>YouTube Shorts</option><option>Instagram</option><option>Threads</option></select></label><label><span>콘텐츠 위계</span><select name="hierarchy"><option>유입형</option><option>전환형</option><option>판매형</option></select></label></div><div className="form-grid"><label><span>노출</span><input type="number" name="impressions" min="0" /></label><label><span>조회</span><input type="number" name="views" min="0" /></label></div><div className="form-grid"><label><span>클릭</span><input type="number" name="clicks" min="0" /></label><label><span>CTR %</span><input type="number" name="ctr" min="0" max="100" step="0.1" /></label></div><div className="form-grid"><label><span>시청지속률 %</span><input type="number" name="retention" min="0" max="100" step="0.1" /></label><label><span>구독자 순증</span><input type="number" name="subscribers" /></label></div><div className="form-grid"><label><span>구매</span><input type="number" name="purchases" min="0" /></label><label><span>기여 매출</span><input type="number" name="revenue" min="0" /></label></div><label><span>주요 유입 경로</span><input name="traffic" placeholder="탐색, 추천, 검색, 외부" /></label><label><span>영상 URL</span><input type="url" name="sourceUrl" /></label><label><span>판정 메모</span><textarea name="note" rows={4} /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>취소</button><button className="primary-button" disabled={busy}>성과 저장</button></div></form></div> : null}
  </>;
}
