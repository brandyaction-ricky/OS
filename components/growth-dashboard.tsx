"use client";

import { ArrowRight, BarChart3, CircleAlert, CircleDollarSign, Filter, Link2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listRecords } from "@/lib/api-client";
import { buildPerformanceSignal } from "@/lib/performance-signals";
import type { OsRecord } from "@/lib/record-types";
import { matchesPerformanceBrand, usePerformanceFilters } from "./performance-filter-context";
import { useSession } from "./session-provider";

function period(record: OsRecord) {
  const value = record.metadata?.periodMonth ?? record.metadata?.week ?? record.metadata?.date;
  return typeof value === "string" ? value.slice(0, 7) : record.starts_at?.slice(0, 7) || record.created_at.slice(0, 7);
}
function manwon(value: number) { return `${(value / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원`; }

export function GrowthDashboard() {
  const { accessToken, demo } = useSession();
  const { brand, month } = usePerformanceFilters();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (demo) return;
    try {
      const results = await Promise.all(["revenue", "funnel", "kpi", "connection"].map((type) => listRecords(accessToken, type as "revenue" | "funnel" | "kpi" | "connection", "limit=200")));
      setRecords(results.flatMap((result) => result.records));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "성과 데이터를 불러오지 못했습니다."); }
  }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);

  const inScope = (record: OsRecord) => matchesPerformanceBrand(record.brand || "통합", brand);
  const revenue = records.filter((record) => record.record_type === "revenue" && period(record) === month && inScope(record));
  const funnels = records.filter((record) => record.record_type === "funnel" && period(record) === month && inScope(record));
  const kpis = records.filter((record) => record.record_type === "kpi" && period(record) === month && inScope(record)).slice(0, 8);
  const connections = records.filter((record) => record.record_type === "connection" && record.tags.includes("commerce-admin") && inScope(record));
  const actual = revenue.reduce((sum, record) => sum + Number(record.metadata.net ?? record.amount ?? 0), 0);
  const gross = revenue.reduce((sum, record) => sum + Number(record.metadata.gross ?? 0), 0);
  const orders = revenue.reduce((sum, record) => sum + Number(record.metadata.orders ?? 0), 0);
  const averageConversion = funnels.length ? funnels.reduce((sum, record) => sum + Number(record.metric_current ?? 0), 0) / funnels.length : 0;
  const brandRows = useMemo(() => [...new Set(revenue.map((record) => record.brand || "미분류"))].map((name) => ({
    name,
    amount: revenue.filter((item) => (item.brand || "미분류") === name).reduce((sum, item) => sum + Number(item.metadata.net ?? item.amount ?? 0), 0),
  })).sort((left, right) => right.amount - left.amount), [revenue]);

  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">성과 한눈에</span><h1>성과 통합 현황</h1><p>순매출, 퍼널 전환, 주간 KPI와 자사몰 어드민 연결을 같은 브랜드·기간으로 봅니다.</p></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <section className="metric-grid compact-metrics"><div className="metric-card"><div className="metric-top"><span>통합 순매출</span><CircleDollarSign size={16} /></div><div className="metric-value growth-money">{manwon(actual)}</div><div className="metric-caption">총매출 {manwon(gross)}</div></div><div className="metric-card"><div className="metric-top"><span>주문</span><BarChart3 size={16} /></div><div className="metric-value">{orders.toLocaleString("ko-KR")}</div><div className="metric-caption">선택 브랜드 합산</div></div><div className="metric-card"><div className="metric-top"><span>첫 단계→마지막 단계</span><Filter size={16} /></div><div className="metric-value">{averageConversion.toFixed(2)}%</div><div className="metric-caption">선택 퍼널 평균</div></div><div className="metric-card"><div className="metric-top"><span>주간 KPI</span><TrendingUp size={16} /></div><div className="metric-value">{kpis.length}</div><div className="metric-caption">선택 월 입력 지표</div></div></section>
    <section className="growth-grid"><article className="panel brand-performance"><div className="panel-header"><div><h2>브랜드별 순매출</h2><p>{month.replace("-", "년 ")}월 · 만원</p></div><Link className="panel-link" href="/performance/revenue">매출 상세 <ArrowRight size={13} /></Link></div><div>{brandRows.map((row) => <div key={row.name}><span><strong>{row.name}</strong><small>{manwon(row.amount)}</small></span><div><i style={{ width: `${actual ? Math.max(row.amount / actual * 100, 2) : 0}%` }} /></div><em>{actual ? Math.round(row.amount / actual * 100) : 0}%</em></div>)}{!brandRows.length ? <div className="quiet-state"><CircleDollarSign /><strong>선택 조건의 매출 없음</strong></div> : null}</div></article>
      <article className="panel"><div className="panel-header"><div><h2>주간 KPI 이상신호</h2><p>목표 ±10% · 전환 ±20% · 2주 연속 0</p></div><Link className="panel-link" href="/performance/weekly-kpi">KPI 입력 <ArrowRight size={13} /></Link></div><div className="funnel-signal-list">{kpis.map((item) => { const current = Number(item.metric_current ?? 0); const previous = Number(item.metadata.previousValue ?? 0); const signal = buildPerformanceSignal({ title: item.title, current, previous, target: item.metric_target, unit: item.metric_unit }); return <div key={item.id}><span className={signal.tone === "danger" ? "bad" : signal.tone === "positive" ? "good" : "neutral"}>{signal.label}</span><span><strong>{item.title}</strong><small>{item.brand || "통합"} · {current}{item.metric_unit}</small></span><em>{signal.detail}</em></div>; })}{!kpis.length ? <div className="quiet-state"><TrendingUp /><strong>KPI 입력 후 이상신호가 표시됩니다.</strong></div> : null}</div></article></section>
    <section className="panel growth-links"><Link href="/performance/revenue"><CircleDollarSign size={16} /><span><strong>매출 상세</strong><small>총매출·취소·환불·순매출</small></span><ArrowRight size={14} /></Link><Link href="/performance/funnels"><Filter size={16} /><span><strong>퍼널</strong><small>단계를 직접 구성해 전환 확인</small></span><ArrowRight size={14} /></Link><Link href="/performance/customers"><Link2 size={16} /><span><strong>자사몰 어드민</strong><small>{connections.length}개 연결 · 고객 원문은 외부 시스템에서 관리</small></span><ArrowRight size={14} /></Link></section>
  </>;
}
