"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatKpiValue, kpiProgress, kstMonth } from "@/lib/kpi";
import "./team-kpi.css";

type KpiTask = { id: string; title: string; status: string; dueDate: string | null; assignee: string | null };
type Kpi = { id: string; title: string; unit: string; target: number | null; current: number | null; metric: "revenue" | "manual"; version: number; updatedAt: string; tasks: KpiTask[] };
type Business = { key: "myin" | "edu"; label: string; logDocumentId: string | null; kpis: Kpi[];
  revenue: { net: number; paid: number; canceled: number; count: number; canceledCount: number; syncedAt: string | null } };
const shiftMonth = (month: string, step: number) => { const [y, m] = month.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + step, 1)); return d.toISOString().slice(0, 7); };
const num = (value: string) => value.trim() === "" ? null : Number(value.replace(/[,\s원]/g, ""));

// Monthly KPIs side by side for 마이인 and 브랜디에듀. Revenue is the Toss net sales (orders paid
// this month less cancellations, totals only); targets and other metrics are entered here and
// every change lands in the business's KPI log document.
export function TeamKpiView({ token }: { token: string }) {
  const [month, setMonth] = useState(kstMonth()), [data, setData] = useState<Business[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData((await apiRequest<{ businesses: Business[] }>(`/api/v1/kpi?month=${month}`, { token })).businesses); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [month, token]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const send = async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { await apiRequest("/api/v1/kpi", { method, token, body: JSON.stringify(body) }); await load(); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  return <section className="tm-kpi">
    <div className="tm-row tm-kpi-head"><button type="button" className="secondary-button compact" onClick={() => setMonth(shiftMonth(month, -1))}>‹ 이전 달</button>
      <strong>{month.replace("-", "년 ")}월 KPI</strong>
      <button type="button" className="secondary-button compact" disabled={month >= kstMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>다음 달 ›</button>
      <span className="tm-muted">매출 = 그 달 토스 결제 − 취소·환불 (매일 아침 6:30 자동 반영)</span></div>
    {error ? <div className="tm-callout" data-tone="danger" role="alert">{error}</div> : null}
    {!data ? <p className="tm-muted">불러오는 중…</p> : <div className="tm-kpi-grid">{data.map(business => <BusinessKpi key={business.key} business={business} month={month} busy={busy} send={send} />)}</div>}
  </section>;
}

function BusinessKpi({ business, month, busy, send }: { business: Business; month: string; busy: boolean; send: (method: "POST" | "PATCH", body: Record<string, unknown>) => Promise<boolean> }) {
  const revenueKpi = business.kpis.find(kpi => kpi.metric === "revenue"), others = business.kpis.filter(kpi => kpi.metric !== "revenue");
  const [target, setTarget] = useState(""), [adding, setAdding] = useState(false), [title, setTitle] = useState(""), [unit, setUnit] = useState("건"), [newTarget, setNewTarget] = useState("");
  const r = business.revenue, progress = kpiProgress(r.net, revenueKpi?.target);
  return <article className="panel panel-pad tm-kpi-card">
    <header className="tm-row"><h3 className="card-title">{business.label}</h3>{business.logDocumentId ? <Link className="tm-muted" href={`/knowledge/doc/${business.logDocumentId}`}>KPI 로그 →</Link> : <span className="tm-muted">KPI 로그는 첫 기록 때 만들어집니다</span>}</header>
    <div className="tm-kpi-revenue">
      <span className="tm-muted">순매출 (토스 결제 기준)</span>
      <strong>{formatKpiValue(r.net, "원")}</strong>
      <span className="tm-muted">결제 {formatKpiValue(r.paid, "원")} · 취소·환불 {formatKpiValue(r.canceled, "원")} · {r.count}건{r.canceledCount ? ` (취소 포함 ${r.canceledCount}건)` : ""}</span>
      <Bar progress={progress} />
      {revenueKpi ? <p>목표 {formatKpiValue(revenueKpi.target, "원")} · 달성 {progress === null ? "—" : `${progress}%`}</p> : <p className="tm-muted">매출 목표가 아직 없습니다.</p>}
      <div className="tm-row"><input aria-label={`${business.label} 매출 목표`} inputMode="numeric" placeholder={revenueKpi?.target ? String(revenueKpi.target) : "목표 금액 (원)"} value={target} onChange={e => setTarget(e.target.value)} />
        <button type="button" className="secondary-button compact" disabled={busy || num(target) === null || Number.isNaN(num(target))} onClick={() => void send(revenueKpi ? "PATCH" : "POST", revenueKpi
          ? { id: revenueKpi.id, expectedVersion: revenueKpi.version, target: num(target) }
          : { business: business.key, month, metric: "revenue", title: "순매출", target: num(target) }).then(ok => { if (ok) setTarget(""); })}>{revenueKpi ? "목표 고치기" : "목표 정하기"}</button></div>
      {revenueKpi ? <LinkedTasks tasks={revenueKpi.tasks} /> : null}
      {r.syncedAt ? <small className="tm-muted">토스 마지막 반영 {new Date(r.syncedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small> : null}
    </div>
    <h4>그 밖의 지표</h4>
    {others.length ? others.map(kpi => <ManualKpi key={kpi.id} kpi={kpi} busy={busy} send={send} />) : <p className="tm-muted">가입·문의·판매 건수처럼 회의에서 볼 지표를 추가하세요.</p>}
    {adding ? <div className="tm-kpi-add"><input aria-label="지표 이름" placeholder="지표 이름 (예: 정밀 진단 판매)" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} />
      <input aria-label="단위" placeholder="단위" value={unit} onChange={e => setUnit(e.target.value)} maxLength={10} />
      <input aria-label="목표" inputMode="numeric" placeholder="목표" value={newTarget} onChange={e => setNewTarget(e.target.value)} />
      <button type="button" className="primary-button compact" disabled={busy || !title.trim()} onClick={() => void send("POST", { business: business.key, month, metric: "manual", title, unit, target: num(newTarget) })
        .then(ok => { if (ok) { setAdding(false); setTitle(""); setNewTarget(""); } })}>추가</button>
      <button type="button" className="secondary-button compact" onClick={() => setAdding(false)}>취소</button></div>
      : <button type="button" className="secondary-button compact" onClick={() => setAdding(true)}>+ 지표 추가</button>}
  </article>;
}

function ManualKpi({ kpi, busy, send }: { kpi: Kpi; busy: boolean; send: (method: "POST" | "PATCH", body: Record<string, unknown>) => Promise<boolean> }) {
  const [current, setCurrent] = useState(""), [target, setTarget] = useState(""), progress = kpiProgress(kpi.current, kpi.target);
  const changed = current.trim() !== "" || target.trim() !== "";
  return <div className="tm-kpi-row">
    <div className="tm-row"><strong>{kpi.title}</strong><span>{formatKpiValue(kpi.current, kpi.unit)} / {formatKpiValue(kpi.target, kpi.unit)}{progress === null ? "" : ` · ${progress}%`}</span></div>
    <Bar progress={progress} />
    <LinkedTasks tasks={kpi.tasks} />
    <div className="tm-row"><input aria-label={`${kpi.title} 실적`} inputMode="numeric" placeholder="실적" value={current} onChange={e => setCurrent(e.target.value)} />
      <input aria-label={`${kpi.title} 목표`} inputMode="numeric" placeholder="목표" value={target} onChange={e => setTarget(e.target.value)} />
      <button type="button" className="secondary-button compact" disabled={busy || !changed} onClick={() => void send("PATCH", { id: kpi.id, expectedVersion: kpi.version,
        ...(current.trim() !== "" ? { current: num(current) } : {}), ...(target.trim() !== "" ? { target: num(target) } : {}) }).then(ok => { if (ok) { setCurrent(""); setTarget(""); } })}>저장</button>
      <button type="button" className="secondary-button compact" disabled={busy} onClick={() => { if (window.confirm(`${kpi.title} 지표를 지울까요? KPI 로그에는 남습니다.`)) void send("PATCH", { id: kpi.id, expectedVersion: kpi.version, archive: true }); }}>삭제</button></div>
  </div>;
}

// Meeting tasks whose review named this KPI.
function LinkedTasks({ tasks }: { tasks: KpiTask[] }) {
  if (!tasks.length) return <small className="tm-muted">연결된 업무 없음 · 회의 검수에서 업무에 이 KPI를 고르면 여기 모입니다.</small>;
  const done = tasks.filter(task => task.status === "done").length;
  return <details className="tm-kpi-tasks"><summary>연결된 업무 {tasks.length}건 · 완료 {done}</summary><ul>{tasks.map(task => <li key={task.id}>
    <Link href={`/organization/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</Link>
    <span className="tm-muted">{task.status === "done" ? "완료" : task.status === "blocked" ? "막힘" : "진행"}{task.assignee ? ` · ${task.assignee}` : ""}{task.dueDate ? ` · ${task.dueDate}` : ""}</span></li>)}</ul></details>;
}

function Bar({ progress }: { progress: number | null }) {
  return <div className="tm-kpi-bar" aria-label={progress === null ? "목표 없음" : `달성 ${progress}%`}><i style={{ width: `${Math.min(100, progress ?? 0)}%` }} data-over={progress !== null && progress >= 100 ? "true" : undefined} /></div>;
}
