"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatKpiValue, kpiProgress, kstMonth } from "@/lib/kpi";
import "./team-kpi.css";

type KpiTask = { id: string; title: string; status: string; dueDate: string | null; assignee: string | null };
type Kpi = { id: string; title: string; unit: string; target: number | null; current: number | null; metric: "revenue" | "manual"; version: number; updatedAt: string; tasks: KpiTask[] };
type Revenue = { net: number; paid: number; canceled: number; count: number; canceledCount: number; syncedAt: string | null };
type Round = { key: string; product: string; from: string; to: string; label: string; named: boolean; settingsId: string | null; courseFrom: string | null; courseTo: string | null; revenue: Revenue; logDocumentId: string | null; kpis: Kpi[] };
type MonthBusiness = { key: "myin"; label: string; mode: "month"; revenue: Revenue; logDocumentId: string | null; kpis: Kpi[] };
type RoundBusiness = { key: "edu"; label: string; mode: "rounds"; rounds: Round[] };
type KpiData = { canSeeFinance: boolean; businesses: (MonthBusiness | RoundBusiness)[] };
type Send = (method: "POST" | "PATCH", body: Record<string, unknown>) => Promise<boolean>;
const shiftMonth = (month: string, step: number) => { const [y, m] = month.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + step, 1)); return d.toISOString().slice(0, 7); };
const num = (value: string) => value.trim() === "" ? null : Number(value.replace(/[,\s원]/g, ""));
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

// 마이인 by month; 브랜디에듀 by sales round, found automatically from Toss payments per product
// (lib/kpi-runs). Revenue is the Toss net sales (totals only). Targets, other metrics, round
// names, course dates and split days are entered here; every change lands in the KPI log.
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
          <header className="tm-row"><h3 className="card-title">{business.label}</h3>
            <div className="tm-row tm-kpi-head"><button type="button" className="secondary-button compact" aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
              <strong>{month.replace("-", "년 ")}월</strong>
              <button type="button" className="secondary-button compact" aria-label="다음 달" disabled={month >= kstMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div></header>
          <ScopeKpi revenue={business.revenue} kpis={business.kpis} logDocumentId={business.logDocumentId}
            scope={{ business: "myin", month }} busy={busy} send={send} />
        </article>
      : <RoundsCard key={business.key} business={business} canSeeFinance={data.canSeeFinance} busy={busy} send={send} />)}</div>}
  </section>;
}

const roundStatus = (round: Round, day: string) => daysBetween(round.to, day) < 14 ? "판매 중" : round.courseTo && round.courseTo >= day ? "교육 중" : "지난 회차";

// Same layout as the month card, with a round picker in place of the month arrows.
// Rounds that netted nothing (fully refunded tests) are hidden unless they already have KPIs.
function RoundsCard({ business, canSeeFinance, busy, send }: { business: RoundBusiness; canSeeFinance: boolean; busy: boolean; send: Send }) {
  const day = today(), rounds = business.rounds.filter(round => round.revenue.net > 0 || round.kpis.length);
  const [picked, setPicked] = useState(""), [editing, setEditing] = useState(false);
  const round = rounds.find(item => item.key === picked) ?? rounds.find(item => roundStatus(item, day) !== "지난 회차") ?? rounds[0];
  return <article className="panel panel-pad tm-kpi-card">
    <header className="tm-row"><h3 className="card-title">{business.label}</h3>
      {canSeeFinance ? <Link className="tm-muted" href="/finance/settlements">월 정산 →</Link> : null}</header>
    {round ? <>
      <div className="tm-row tm-kpi-head">
        <select aria-label="판매 회차" value={round.key} onChange={e => { setPicked(e.target.value); setEditing(false); }}>
          {rounds.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
        <span className="tm-kpi-chip" data-live={roundStatus(round, day) !== "지난 회차" || undefined}>{roundStatus(round, day)}</span>
        <button type="button" className="secondary-button compact" onClick={() => setEditing(!editing)}>회차 설정</button></div>
      <small className="tm-muted">판매 {round.from}~{round.to}{round.courseFrom ? ` · 교육 ${round.courseFrom}~${round.courseTo ?? ""}` : ""}</small>
      {editing ? <RoundSettings key={round.key} round={round} busy={busy} send={send} done={() => setEditing(false)} /> : null}
      <ScopeKpi key={round.key} revenue={round.revenue} kpis={round.kpis} logDocumentId={round.logDocumentId}
        scope={{ business: "edu", roundKey: round.key }} busy={busy} send={send} />
    </> : <p className="tm-muted">아직 토스 결제가 없습니다.</p>}
  </article>;
}

function RoundSettings({ round, busy, send, done }: { round: Round; busy: boolean; send: Send; done: () => void }) {
  const [name, setName] = useState(round.named ? round.label : ""), [courseFrom, setCourseFrom] = useState(round.courseFrom ?? ""), [courseTo, setCourseTo] = useState(round.courseTo ?? ""), [splitDay, setSplitDay] = useState("");
  return <div className="tm-kpi-cohort-form">
    <label className="tm-kpi-wide">회차 이름<input value={name} placeholder={round.label} onChange={e => setName(e.target.value)} maxLength={80} /></label>
    <label>교육 시작<input type="date" value={courseFrom} onChange={e => setCourseFrom(e.target.value)} /></label>
    <label>교육 끝<input type="date" value={courseTo} onChange={e => setCourseTo(e.target.value)} /></label>
    <div className="tm-row"><button type="button" className="primary-button compact" disabled={busy} onClick={() => void send("POST", { action: "round", roundKey: round.key,
      ...(name.trim() ? { name: name.trim() } : {}), courseFrom: courseFrom || null, courseTo: courseTo || null }).then(ok => { if (ok) done(); })}>저장</button></div>
    <label className="tm-kpi-wide">두 회차가 붙었으면 나눌 날짜<input type="date" min={round.from} max={round.to} value={splitDay} onChange={e => setSplitDay(e.target.value)} /></label>
    <div className="tm-row"><button type="button" className="secondary-button compact" disabled={busy || !splitDay || splitDay <= round.from || splitDay > round.to}
      onClick={() => { if (window.confirm(`${round.product}의 판매를 ${splitDay}부터 다음 회차로 나눌까요?`)) void send("POST", { action: "split", product: round.product, day: splitDay }).then(ok => { if (ok) done(); }); }}>나누기</button></div>
  </div>;
}

type Scope = { business: "myin"; month: string } | { business: "edu"; roundKey: string };
function ScopeKpi({ revenue: r, kpis, logDocumentId, scope, busy, send }: { revenue: Revenue; kpis: Kpi[]; logDocumentId: string | null; scope: Scope; busy: boolean; send: Send }) {
  const revenueKpi = kpis.find(kpi => kpi.metric === "revenue"), others = kpis.filter(kpi => kpi.metric !== "revenue");
  const [target, setTarget] = useState(""), [adding, setAdding] = useState(false), [title, setTitle] = useState(""), [unit, setUnit] = useState("건"), [newTarget, setNewTarget] = useState("");
  const progress = kpiProgress(r.net, revenueKpi?.target);
  return <>
    <div className="tm-kpi-revenue">
      <div className="tm-row"><span className="tm-muted">순매출</span>{logDocumentId ? <Link className="tm-muted" href={`/knowledge/doc/${logDocumentId}`}>로그 →</Link> : null}</div>
      <strong>{formatKpiValue(r.net, "원")}</strong>
      <small className="tm-muted">결제 {formatKpiValue(r.paid, "원")} · 취소 {formatKpiValue(r.canceled, "원")} · {r.count}건</small>
      <Bar progress={progress} />
      <p>{revenueKpi ? <>목표 {formatKpiValue(revenueKpi.target, "원")} · <b>달성 {progress === null ? "—" : `${progress}%`}</b></> : <span className="tm-muted">목표 없음</span>}</p>
      <div className="tm-row"><input aria-label="매출 목표" inputMode="numeric" placeholder="목표 금액 (원)" value={target} onChange={e => setTarget(e.target.value)} />
        <button type="button" className="secondary-button compact" disabled={busy || num(target) === null || Number.isNaN(num(target))} onClick={() => void send(revenueKpi ? "PATCH" : "POST", revenueKpi
          ? { id: revenueKpi.id, expectedVersion: revenueKpi.version, target: num(target) }
          : { action: "kpi", ...scope, metric: "revenue", title: "매출", target: num(target) }).then(ok => { if (ok) setTarget(""); })}>{revenueKpi ? "목표 고치기" : "목표 정하기"}</button></div>
      {revenueKpi ? <LinkedTasks tasks={revenueKpi.tasks} /> : null}
      {r.syncedAt ? <small className="tm-muted">토스 반영 {new Date(r.syncedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small> : null}
    </div>
    {others.length ? <h4>그 밖의 지표</h4> : null}
    {others.map(kpi => <ManualKpi key={kpi.id} kpi={kpi} busy={busy} send={send} />)}
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
  if (!tasks.length) return null;
  const done = tasks.filter(task => task.status === "done").length;
  return <details className="tm-kpi-tasks"><summary>연결된 업무 {tasks.length}건 · 완료 {done}</summary><ul>{tasks.map(task => <li key={task.id}>
    <Link href={`/organization/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</Link>
    <span className="tm-muted">{task.status === "done" ? "완료" : task.status === "blocked" ? "막힘" : "진행"}{task.assignee ? ` · ${task.assignee}` : ""}{task.dueDate ? ` · ${task.dueDate}` : ""}</span></li>)}</ul></details>;
}

function Bar({ progress }: { progress: number | null }) {
  return <div className="tm-kpi-bar" aria-label={progress === null ? "목표 없음" : `달성 ${progress}%`}><i style={{ width: `${Math.min(100, progress ?? 0)}%` }} data-over={progress !== null && progress >= 100 ? "true" : undefined} /></div>;
}
