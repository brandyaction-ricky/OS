"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatKpiValue, kpiProgress, kstMonth } from "@/lib/kpi";
import "./team-kpi.css";

type KpiTask = { id: string; title: string; status: string; dueDate: string | null; assignee: string | null };
type Kpi = { id: string; title: string; unit: string; target: number | null; current: number | null; metric: "revenue" | "manual"; version: number; updatedAt: string; tasks: KpiTask[] };
type Revenue = { net: number; paid: number; canceled: number; count: number; canceledCount: number; syncedAt: string | null };
type Cohort = { id: string; name: string; product: string; salesFrom: string; salesTo: string; courseFrom: string; courseTo: string; version: number; revenue: Revenue; logDocumentId: string | null; kpis: Kpi[] };
type MonthBusiness = { key: "myin"; label: string; mode: "month"; revenue: Revenue; logDocumentId: string | null; kpis: Kpi[] };
type CohortBusiness = { key: "edu"; label: string; mode: "cohort"; cohorts: Cohort[] };
type KpiData = { canSeeFinance: boolean; businesses: (MonthBusiness | CohortBusiness)[] };
type Send = (method: "POST" | "PATCH", body: Record<string, unknown>) => Promise<boolean>;
const shiftMonth = (month: string, step: number) => { const [y, m] = month.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + step, 1)); return d.toISOString().slice(0, 7); };
const num = (value: string) => value.trim() === "" ? null : Number(value.replace(/[,\s원]/g, ""));
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

// 마이인 by month and 브랜디에듀 by cohort (기수). Revenue is the Toss net sales (totals only):
// orders paid in the month, or the cohort product's payments in its recruiting window, less
// cancellations. Targets and other metrics are entered here; every change lands in the KPI log.
export function TeamKpiView({ token }: { token: string }) {
  const [month, setMonth] = useState(kstMonth()), [data, setData] = useState<KpiData | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await apiRequest<KpiData>(`/api/v1/kpi?month=${month}`, { token })); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [month, token]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const send: Send = async (method, body) => {
    setBusy(true); setError("");
    try { await apiRequest("/api/v1/kpi", { method, token, body: JSON.stringify(body) }); await load(); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  return <section className="tm-kpi">
    {error ? <div className="tm-callout" data-tone="danger" role="alert">{error}</div> : null}
    {!data ? <p className="tm-muted">불러오는 중…</p> : <div className="tm-kpi-grid">{data.businesses.map(business => business.mode === "month"
      ? <article className="panel panel-pad tm-kpi-card" key={business.key}>
          <header className="tm-row"><h3 className="card-title">{business.label} · 월 KPI</h3></header>
          <div className="tm-row tm-kpi-head"><button type="button" className="secondary-button compact" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
            <strong>{month.replace("-", "년 ")}월</strong>
            <button type="button" className="secondary-button compact" disabled={month >= kstMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
            <span className="tm-muted">매출 = 그 달 토스 결제 − 취소·환불</span></div>
          <ScopeKpi revenueLabel="순매출 (토스 결제 기준)" revenue={business.revenue} kpis={business.kpis} logDocumentId={business.logDocumentId}
            scope={{ business: "myin", month }} busy={busy} send={send} />
        </article>
      : <CohortCard key={business.key} business={business} canSeeFinance={data.canSeeFinance} busy={busy} send={send} />)}</div>}
  </section>;
}

function CohortCard({ business, canSeeFinance, busy, send }: { business: CohortBusiness; canSeeFinance: boolean; busy: boolean; send: Send }) {
  const day = today(), [open, setOpen] = useState(!business.cohorts.length), [form, setForm] = useState({ name: "", product: "", salesFrom: "", salesTo: "", courseFrom: "", courseTo: "" });
  const field = (key: keyof typeof form, label: string, type = "text") => <label>{label}<input type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>;
  return <article className="panel panel-pad tm-kpi-card">
    <header className="tm-row"><h3 className="card-title">{business.label} · 기수 KPI</h3>
      {canSeeFinance ? <Link className="tm-muted" href="/finance/settlements">월 정산 입금 보기 (관리자) →</Link> : null}</header>
    <span className="tm-muted">기수 매출 = 그 기수 상품의 모집 기간 토스 결제 − 취소·환불</span>
    {business.cohorts.map(cohort => <details className="tm-kpi-cohort" key={cohort.id} open={cohort.courseTo >= day}>
      <summary><strong>{cohort.name}</strong> <span className="tm-muted">{cohort.courseTo < day ? "종료" : cohort.salesTo < day ? "교육 중·예정" : "모집 중"} · 모집 {cohort.salesFrom}~{cohort.salesTo} · 교육 {cohort.courseFrom}~{cohort.courseTo}{cohort.product ? ` · 상품 "${cohort.product}"` : ""}</span></summary>
      <ScopeKpi revenueLabel="기수 매출 (토스 결제 기준)" revenue={cohort.revenue} kpis={cohort.kpis} logDocumentId={cohort.logDocumentId}
        scope={{ business: "edu", cohortId: cohort.id }} busy={busy} send={send} />
      <button type="button" className="secondary-button compact" disabled={busy} onClick={() => { if (window.confirm(`${cohort.name} 기수를 지울까요? KPI 로그에는 남습니다.`)) void send("PATCH", { id: cohort.id, expectedVersion: cohort.version, archive: true }); }}>기수 삭제</button>
    </details>)}
    {open ? <div className="tm-kpi-cohort-form">
      {field("name", "기수 이름 (예: AI 문샷 챌린지 2기)")}{field("product", "토스 상품명 (주문명에 들어가는 말)")}
      {field("salesFrom", "모집 시작", "date")}{field("salesTo", "모집 마감", "date")}{field("courseFrom", "교육 시작", "date")}{field("courseTo", "교육 끝", "date")}
      <div className="tm-row"><button type="button" className="primary-button compact" disabled={busy || !form.name.trim() || !form.salesFrom || !form.salesTo || !form.courseFrom || !form.courseTo}
        onClick={() => void send("POST", { action: "cohort", ...form }).then(ok => { if (ok) { setOpen(false); setForm({ name: "", product: "", salesFrom: "", salesTo: "", courseFrom: "", courseTo: "" }); } })}>기수 추가</button>
        {business.cohorts.length ? <button type="button" className="secondary-button compact" onClick={() => setOpen(false)}>취소</button> : null}</div>
    </div> : <button type="button" className="secondary-button compact" onClick={() => setOpen(true)}>+ 기수 추가</button>}
  </article>;
}

type Scope = { business: "myin"; month: string } | { business: "edu"; cohortId: string };
function ScopeKpi({ revenueLabel, revenue: r, kpis, logDocumentId, scope, busy, send }: { revenueLabel: string; revenue: Revenue; kpis: Kpi[]; logDocumentId: string | null; scope: Scope; busy: boolean; send: Send }) {
  const revenueKpi = kpis.find(kpi => kpi.metric === "revenue"), others = kpis.filter(kpi => kpi.metric !== "revenue");
  const [target, setTarget] = useState(""), [adding, setAdding] = useState(false), [title, setTitle] = useState(""), [unit, setUnit] = useState("건"), [newTarget, setNewTarget] = useState("");
  const progress = kpiProgress(r.net, revenueKpi?.target);
  return <>
    <div className="tm-kpi-revenue">
      <div className="tm-row"><span className="tm-muted">{revenueLabel}</span>{logDocumentId ? <Link className="tm-muted" href={`/knowledge/doc/${logDocumentId}`}>KPI 로그 →</Link> : null}</div>
      <strong>{formatKpiValue(r.net, "원")}</strong>
      <span className="tm-muted">결제 {formatKpiValue(r.paid, "원")} · 취소·환불 {formatKpiValue(r.canceled, "원")} · {r.count}건{r.canceledCount ? ` (취소 포함 ${r.canceledCount}건)` : ""}</span>
      <Bar progress={progress} />
      {revenueKpi ? <p>목표 {formatKpiValue(revenueKpi.target, "원")} · 달성 {progress === null ? "—" : `${progress}%`}</p> : <p className="tm-muted">매출 목표가 아직 없습니다.</p>}
      <div className="tm-row"><input aria-label="매출 목표" inputMode="numeric" placeholder={revenueKpi?.target ? String(revenueKpi.target) : "목표 금액 (원)"} value={target} onChange={e => setTarget(e.target.value)} />
        <button type="button" className="secondary-button compact" disabled={busy || num(target) === null || Number.isNaN(num(target))} onClick={() => void send(revenueKpi ? "PATCH" : "POST", revenueKpi
          ? { id: revenueKpi.id, expectedVersion: revenueKpi.version, target: num(target) }
          : { action: "kpi", ...scope, metric: "revenue", title: "매출", target: num(target) }).then(ok => { if (ok) setTarget(""); })}>{revenueKpi ? "목표 고치기" : "목표 정하기"}</button></div>
      {revenueKpi ? <LinkedTasks tasks={revenueKpi.tasks} /> : null}
      {r.syncedAt ? <small className="tm-muted">토스 마지막 반영 {new Date(r.syncedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small> : null}
    </div>
    <h4>그 밖의 지표</h4>
    {others.length ? others.map(kpi => <ManualKpi key={kpi.id} kpi={kpi} busy={busy} send={send} />) : <p className="tm-muted">수강생·완주율·판매 건수처럼 회의에서 볼 지표를 추가하세요.</p>}
    {adding ? <div className="tm-kpi-add"><input aria-label="지표 이름" placeholder="지표 이름" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} />
      <input aria-label="단위" placeholder="단위" value={unit} onChange={e => setUnit(e.target.value)} maxLength={10} />
      <input aria-label="목표" inputMode="numeric" placeholder="목표" value={newTarget} onChange={e => setNewTarget(e.target.value)} />
      <button type="button" className="primary-button compact" disabled={busy || !title.trim()} onClick={() => void send("POST", { action: "kpi", ...scope, metric: "manual", title, unit, target: num(newTarget) })
        .then(ok => { if (ok) { setAdding(false); setTitle(""); setNewTarget(""); } })}>추가</button>
      <button type="button" className="secondary-button compact" onClick={() => setAdding(false)}>취소</button></div>
      : <button type="button" className="secondary-button compact" onClick={() => setAdding(true)}>+ 지표 추가</button>}
  </>;
}

function ManualKpi({ kpi, busy, send }: { kpi: Kpi; busy: boolean; send: Send }) {
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
