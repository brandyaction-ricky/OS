"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  CircleAlert,
  CircleDollarSign,
  FileUp,
  Link2,
  Pencil,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { archiveRecord, createRecord, importPerformanceCsv, listRecords, updateRecord } from "@/lib/api-client";
import { parseRevenueCsv } from "@/lib/performance-csv";
import { buildPerformanceSignal } from "@/lib/performance-signals";
import type { OsRecord } from "@/lib/record-types";
import {
  matchesPerformanceBrand,
  performanceBrandLabel,
  usePerformanceFilters,
} from "./performance-filter-context";
import { useSession } from "./session-provider";

const money = (value: number) => `${(value / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원`;
const numberValue = (form: FormData, name: string) => Number(String(form.get(name) ?? "0").replace(/,/g, "")) || 0;
const today = () => new Date().toISOString().slice(0, 10);
const recordDate = (record: OsRecord) => String(record.metadata.date ?? record.starts_at ?? record.created_at).slice(0, 10);

function lastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
}

function rollingStart(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

type RevenueRange = "today" | "7d" | "30d" | "month" | "custom";

function dateInRange(date: string, range: RevenueRange, month: string, customFrom: string, customTo: string) {
  if (range === "today") return date === today();
  if (range === "7d") return date >= rollingStart(7) && date <= today();
  if (range === "30d") return date >= rollingStart(30) && date <= today();
  if (range === "custom") return date >= customFrom && date <= customTo;
  return date.startsWith(month);
}

export function RevenueWorkspace() {
  const { accessToken, demo } = useSession();
  const { brand, month } = usePerformanceFilters();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [range, setRange] = useState<RevenueRange>("month");
  const [customFrom, setCustomFrom] = useState(`${month}-01`);
  const [customTo, setCustomTo] = useState(lastDayOfMonth(month));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    try {
      setRecords((await listRecords(accessToken, "revenue", "limit=200")).records);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "매출을 불러오지 못했습니다.");
    }
  }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setCustomFrom(`${month}-01`);
    setCustomTo(lastDayOfMonth(month));
  }, [month]);

  const selected = useMemo(() => records.filter((item) =>
    matchesPerformanceBrand(item.brand, brand) && dateInRange(recordDate(item), range, month, customFrom, customTo),
  ), [brand, customFrom, customTo, month, range, records]);
  const totals = selected.reduce((sum, item) => {
    const data = item.metadata;
    const gross = Number(data.gross ?? item.amount ?? 0);
    const cancel = Number(data.cancel ?? 0);
    const refund = Number(data.refund ?? 0);
    return {
      gross: sum.gross + gross,
      cancel: sum.cancel + cancel,
      refund: sum.refund + refund,
      net: sum.net + Number(data.net ?? gross - cancel - refund),
      orders: sum.orders + Number(data.orders ?? 0),
      buyers: sum.buyers + Number(data.buyers ?? 0),
    };
  }, { gross: 0, cancel: 0, refund: 0, net: 0, orders: 0, buyers: 0 });
  const daily = useMemo(() => {
    const grouped = new Map<string, number>();
    selected.forEach((item) => grouped.set(recordDate(item), (grouped.get(recordDate(item)) ?? 0) + Number(item.metadata.net ?? item.amount ?? 0)));
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [selected]);
  const sources = useMemo(() => {
    const grouped = new Map<string, number>();
    selected.forEach((item) => {
      const source = String(item.metadata.source ?? "수기 입력");
      grouped.set(source, (grouped.get(source) ?? 0) + Number(item.metadata.net ?? item.amount ?? 0));
    });
    return [...grouped.entries()].sort((left, right) => right[1] - left[1]);
  }, [selected]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const gross = numberValue(form, "gross");
    const cancel = numberValue(form, "cancel");
    const refund = numberValue(form, "refund");
    const net = gross - cancel - refund;
    const rowBrand = String(form.get("brand"));
    if (net < 0) { setError("취소·환불 합계는 총매출보다 클 수 없습니다."); return; }
    try {
      await createRecord(accessToken, {
        recordType: "revenue",
        title: `${rowBrand} ${String(form.get("date"))} 매출`,
        description: "브랜드 매출 상세",
        status: "done",
        brand: rowBrand,
        amount: net,
        metricUnit: "원",
        metadata: {
          date: String(form.get("date")), gross, cancel, refund, net,
          orders: numberValue(form, "orders"), buyers: numberValue(form, "buyers"), source: String(form.get("source")),
        },
      });
      setOpen(false);
      setNotice("매출 기록을 저장했습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "매출을 저장하지 못했습니다.");
    }
  };

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = parseRevenueCsv(await file.text());
      const result = await importPerformanceCsv(accessToken, { kind: "revenue", rows });
      setNotice(`${result.imported.toLocaleString("ko-KR")}건의 매출을 가져왔습니다.`);
      setError("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "매출 CSV를 가져오지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  };

  const maximumDaily = Math.max(...daily.map(([, amount]) => amount), 1);
  return (
    <>
      <header className="page-header">
        <div className="page-title-group"><span className="eyebrow">매출 관리</span><h1>매출</h1><p>총매출에서 취소·환불을 제외한 순매출을 브랜드·기간별로 봅니다. 화면 금액은 만원 단위입니다.</p></div>
        <div className="page-actions">
          <label className="secondary-button file-button"><FileUp size={16} /> CSV 가져오기<input type="file" accept=".csv,text/csv" onChange={importCsv} /></label>
          <button className="primary-button" onClick={() => setOpen(true)}><Plus size={16} /> 매출 입력</button>
        </div>
      </header>
      {error ? <div className="inline-alert danger"><CircleAlert size={16} />{error}</div> : null}
      {notice ? <div className="inline-alert success">{notice}</div> : null}
      <section className="range-filter" aria-label="매출 기간">
        {(["today", "7d", "30d", "month", "custom"] as const).map((item) => (
          <button type="button" className={range === item ? "active" : ""} onClick={() => setRange(item)} key={item}>
            {{ today: "오늘", "7d": "7일", "30d": "30일", month: "이번 달", custom: "직접 선택" }[item]}
          </button>
        ))}
        {range === "custom" ? <div className="date-range"><input aria-label="시작일" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /><span>~</span><input aria-label="종료일" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></div> : null}
      </section>
      <section className="metric-grid compact-metrics">
        <div className="metric-card"><div className="metric-top"><span>순매출</span><CircleDollarSign size={16} /></div><div className="metric-value growth-money">{money(totals.net)}</div></div>
        <div className="metric-card"><div className="metric-top"><span>총매출</span><BarChart3 size={16} /></div><div className="metric-value growth-money">{money(totals.gross)}</div></div>
        <div className="metric-card"><div className="metric-top"><span>취소·환불</span><CircleAlert size={16} /></div><div className="metric-value growth-money">{money(totals.cancel + totals.refund)}</div></div>
        <div className="metric-card"><div className="metric-top"><span>주문 / 구매자</span><Target size={16} /></div><div className="metric-value">{totals.orders} / {totals.buyers}</div></div>
      </section>
      <section className="performance-analysis-grid">
        <article className="panel"><div className="panel-header"><div><h2>일별 매출 추이</h2><p>선택 기간 순매출 · 만원</p></div></div><div className="daily-revenue-chart">{daily.map(([date, amount]) => <div key={date}><time>{date.slice(5)}</time><span><i style={{ width: `${Math.max((amount / maximumDaily) * 100, 2)}%` }} /></span><strong>{money(amount)}</strong></div>)}{!daily.length ? <p className="small-empty">표시할 일별 매출이 없습니다.</p> : null}</div></article>
        <article className="panel"><div className="panel-header"><div><h2>유입원별 매출</h2><p>CSV·수기 입력 출처 기준</p></div></div><div className="source-revenue-list">{sources.map(([source, amount]) => <div key={source}><span>{source}</span><strong>{money(amount)}</strong></div>)}{!sources.length ? <p className="small-empty">표시할 유입원 데이터가 없습니다.</p> : null}</div></article>
      </section>
      <section className="panel records-panel"><div className="record-list">{selected.map((item) => <article className="record-row" key={item.id}><span className="priority-mark priority-normal" /><div className="record-main"><div><strong>{item.title}</strong><span className="status-pill status-done">확정</span></div><p>{item.brand} · {recordDate(item)} · {String(item.metadata.source ?? "수기")}</p></div><div className="record-measure"><strong>{money(Number(item.metadata.net ?? item.amount ?? 0))}</strong><small>순매출</small></div></article>)}{!selected.length ? <div className="empty-state"><div><CircleDollarSign /><h3>선택 조건의 매출 기록이 없습니다.</h3><p>매출 입력 또는 CSV 가져오기로 일자별 실적을 등록하세요.</p></div></div> : null}</div></section>
      <p className="csv-help">매출 CSV 열: 기준일, 브랜드, 총매출, 취소, 환불, 주문수, 구매자수, 출처 (영문 열 이름도 지원)</p>
      {open ? <div className="drawer-backdrop"><form className="record-drawer" onSubmit={submit}><div className="drawer-head"><h2>일자별 매출 입력</h2><button type="button" className="icon-button" onClick={() => setOpen(false)}><X size={18} /></button></div><div className="form-grid"><label><span>브랜드</span><select name="brand" defaultValue={brand === "all" ? "마이인" : performanceBrandLabel(brand)}><option>마이인</option><option>브랜디액션 에듀</option></select></label><label><span>기준일</span><input name="date" type="date" defaultValue={today()} required /></label></div><div className="form-grid three"><label><span>총매출(원)</span><input name="gross" type="number" min="0" required /></label><label><span>취소(원)</span><input name="cancel" type="number" min="0" defaultValue="0" /></label><label><span>환불(원)</span><input name="refund" type="number" min="0" defaultValue="0" /></label></div><div className="form-grid"><label><span>주문 수</span><input name="orders" type="number" min="0" defaultValue="0" /></label><label><span>구매자 수</span><input name="buyers" type="number" min="0" defaultValue="0" /></label></div><label><span>출처</span><input name="source" defaultValue="수기 입력" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>취소</button><button className="primary-button">저장</button></div></form></div> : null}
    </>
  );
}

export function WeeklyKpiWorkspace() {
  const { accessToken, demo } = useSession();
  const { brand, month } = usePerformanceFilters();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!demo) try { setRecords((await listRecords(accessToken, "kpi", "limit=200")).records); } catch (reason) { setError(reason instanceof Error ? reason.message : "KPI를 불러오지 못했습니다."); }
  }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);
  const selected = records.filter((item) => matchesPerformanceBrand(item.brand || "통합", brand) && String(item.metadata.week ?? item.starts_at ?? item.created_at).startsWith(month));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await createRecord(accessToken, { recordType: "kpi", title: String(form.get("title")), status: "done", brand: String(form.get("brand")), metricCurrent: numberValue(form, "current"), metricTarget: numberValue(form, "target"), metricUnit: String(form.get("unit")), startsAt: `${String(form.get("week"))}T00:00:00.000Z`, metadata: { week: String(form.get("week")), previousValue: numberValue(form, "previous"), source: String(form.get("source")) } });
      setOpen(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "KPI를 저장하지 못했습니다."); }
  };
  return <><header className="page-header"><div className="page-title-group"><span className="eyebrow">주간 KPI</span><h1>주간 KPI</h1><p>지난주와 이번 주 수치를 기록해 다음 회의 안건과 성과 경고에 자동으로 올립니다.</p></div><button className="primary-button" onClick={() => setOpen(true)}><Plus size={16} /> KPI 입력</button></header>{error ? <div className="inline-alert danger"><CircleAlert size={16} />{error}</div> : null}<section className="panel records-panel"><div className="record-list">{selected.map((item) => { const previous = Number(item.metadata.previousValue ?? 0); const current = Number(item.metric_current ?? 0); const signal = buildPerformanceSignal({ title: item.title, current, previous, target: item.metric_target, unit: item.metric_unit }); return <article className="record-row" key={item.id}><span className={`priority-mark ${signal.tone === "danger" ? "priority-high" : "priority-normal"}`} /><div className="record-main"><div><strong>{item.title}</strong><span className={`signal-pill ${signal.tone}`}>{signal.label}</span></div><p>{item.brand || "통합"} · {String(item.metadata.source ?? "수기")} · 목표 {item.metric_target ?? "미설정"}{item.metric_unit}</p></div><div className="record-measure"><strong>{current.toLocaleString("ko-KR")}{item.metric_unit}</strong><small>지난주 {previous.toLocaleString("ko-KR")}{item.metric_unit}</small></div></article>; })}{!selected.length ? <div className="empty-state"><div><Target /><h3>아직 입력된 KPI가 없습니다.</h3><p>“KPI 입력”으로 이번 주 지표를 기록하면 다음 회의 안건과 성과 경고에 자동으로 올라갑니다.</p></div></div> : null}</div></section>{open ? <div className="drawer-backdrop"><form className="record-drawer" onSubmit={submit}><div className="drawer-head"><h2>주간 KPI 입력</h2><button type="button" className="icon-button" onClick={() => setOpen(false)}><X size={18} /></button></div><label><span>지표명</span><input name="title" required placeholder="예: 유튜브→스토어 클릭률" /></label><div className="form-grid"><label><span>브랜드</span><select name="brand" defaultValue={performanceBrandLabel(brand)}><option>통합</option><option>마이인</option><option>브랜디액션 에듀</option></select></label><label><span>주 시작일</span><input name="week" type="date" required /></label></div><div className="form-grid three"><label><span>지난주</span><input name="previous" type="number" step="any" /></label><label><span>이번 주</span><input name="current" type="number" step="any" required /></label><label><span>목표</span><input name="target" type="number" step="any" /></label></div><div className="form-grid"><label><span>단위</span><input name="unit" placeholder="%, 명, 만원" /></label><label><span>출처</span><input name="source" placeholder="YouTube Studio" /></label></div><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>취소</button><button className="primary-button">저장</button></div></form></div> : null}</>;
}

interface FunnelStage { id: string; name: string; value: number }
const defaultStages = (): FunnelStage[] => ["영상 조회", "링크 클릭", "스토어 방문", "구매"].map((name, index) => ({ id: `stage-${Date.now()}-${index}`, name, value: 0 }));
function stagesFromRecord(record: OsRecord): FunnelStage[] {
  if (Array.isArray(record.metadata.stages)) return record.metadata.stages.map((stage, index) => { const value = stage as Record<string, unknown>; return { id: String(value.id ?? `stage-${index}`), name: String(value.name ?? `단계 ${index + 1}`), value: Number(value.value ?? 0) }; });
  return [
    { id: "views", name: "영상 조회", value: Number(record.metadata.views ?? 0) },
    { id: "clicks", name: "링크 클릭", value: Number(record.metadata.linkClicks ?? 0) },
    { id: "visits", name: "스토어 방문", value: Number(record.metadata.storeVisits ?? 0) },
    { id: "orders", name: "구매", value: Number(record.metadata.orders ?? 0) },
  ];
}

export function AcquisitionFunnelWorkspace() {
  const { accessToken, demo } = useSession();
  const { brand, month } = usePerformanceFilters();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OsRecord | null>(null);
  const [draftBrand, setDraftBrand] = useState("마이인");
  const [draftPeriod, setDraftPeriod] = useState(month);
  const [stages, setStages] = useState<FunnelStage[]>(defaultStages);
  const [error, setError] = useState("");
  const load = useCallback(async () => { if (!demo) try { setRecords((await listRecords(accessToken, "funnel", "limit=200")).records); } catch (reason) { setError(reason instanceof Error ? reason.message : "퍼널을 불러오지 못했습니다."); } }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);
  const selected = records.filter((item) => matchesPerformanceBrand(item.brand, brand) && String(item.metadata.periodMonth ?? item.created_at).startsWith(month));
  const openNew = () => { setEditing(null); setDraftBrand(brand === "all" ? "마이인" : performanceBrandLabel(brand)); setDraftPeriod(month); setStages(defaultStages()); setOpen(true); };
  const openEdit = (record: OsRecord) => { setEditing(record); setDraftBrand(record.brand); setDraftPeriod(String(record.metadata.periodMonth ?? month)); setStages(stagesFromRecord(record)); setOpen(true); };
  const changeStage = (id: string, field: "name" | "value", value: string) => setStages((current) => current.map((stage) => stage.id === id ? { ...stage, [field]: field === "value" ? Number(value) : value } : stage));
  const moveStage = (index: number, direction: -1 | 1) => setStages((current) => { const next = [...current]; const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stages.length < 2 || stages.some((stage) => !stage.name.trim() || stage.value < 0)) { setError("퍼널은 이름과 값이 있는 2개 이상의 단계가 필요합니다."); return; }
    const first = stages[0].value;
    const final = stages[stages.length - 1].value;
    const input = { title: `${draftBrand} ${stages[0].name}→${stages[stages.length - 1].name}`, status: "active", brand: draftBrand, metricCurrent: first ? (final / first) * 100 : 0, metricUnit: "%", metadata: { ...(editing?.metadata ?? {}), periodMonth: draftPeriod, stages } };
    try {
      if (editing) await updateRecord(accessToken, { id: editing.id, expectedVersion: editing.version, ...input });
      else await createRecord(accessToken, { recordType: "funnel", ...input });
      setOpen(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "퍼널을 저장하지 못했습니다."); }
  };
  return <><header className="page-header"><div className="page-title-group"><span className="eyebrow">유입 퍼널</span><h1>퍼널</h1><p>유입 퍼널과 제품 퍼널의 단계·이름·값·순서를 필요할 때 직접 바꿉니다.</p></div><button className="primary-button" onClick={openNew}><Plus size={16} /> 퍼널 입력</button></header>{error ? <div className="inline-alert danger"><CircleAlert size={16} />{error}</div> : null}<section className="growth-grid funnel-grid">{selected.map((item) => { const flow = stagesFromRecord(item); return <article className="panel" key={item.id}><div className="panel-header"><div><h2>{item.title}</h2><p>{String(item.metadata.periodMonth ?? month)}</p></div><button className="secondary-button small-button" onClick={() => openEdit(item)}><Pencil size={14} /> 단계 편집</button></div><div className="acquisition-flow" style={{ gridTemplateColumns: `repeat(${Math.min(flow.length, 5)}, minmax(0, 1fr))` }}>{flow.map((stage, index) => <div key={stage.id}><span>{stage.name}</span><strong>{stage.value.toLocaleString("ko-KR")}</strong><small>{index ? `${flow[index - 1].value ? ((stage.value / flow[index - 1].value) * 100).toFixed(1) : "0.0"}% 전환` : "퍼널 시작"}</small></div>)}</div></article>; })}{!selected.length ? <div className="panel empty-state"><div><BarChart3 /><h3>선택 조건의 퍼널이 없습니다.</h3><p>“퍼널 입력”에서 단계를 추가하고 순서를 정해 저장하세요.</p></div></div> : null}</section>{open ? <div className="drawer-backdrop"><form className="record-drawer wide-drawer" onSubmit={submit}><div className="drawer-head"><h2>{editing ? "퍼널 단계 편집" : "퍼널 입력"}</h2><button type="button" className="icon-button" onClick={() => setOpen(false)}><X size={18} /></button></div><div className="form-grid"><label><span>브랜드</span><select value={draftBrand} onChange={(event) => setDraftBrand(event.target.value)}><option>마이인</option><option>브랜디액션 에듀</option></select></label><label><span>기준월</span><input type="month" value={draftPeriod} onChange={(event) => setDraftPeriod(event.target.value)} /></label></div><div className="funnel-stage-editor"><div className="stage-editor-head"><strong>단계 목록</strong><button type="button" className="secondary-button small-button" onClick={() => setStages((current) => [...current, { id: `stage-${Date.now()}`, name: `단계 ${current.length + 1}`, value: 0 }])}><Plus size={14} /> 단계 추가</button></div>{stages.map((stage, index) => <div className="stage-editor-row" key={stage.id}><span>{index + 1}</span><input aria-label={`${index + 1}단계 이름`} value={stage.name} onChange={(event) => changeStage(stage.id, "name", event.target.value)} required /><input aria-label={`${index + 1}단계 값`} type="number" min="0" value={stage.value} onChange={(event) => changeStage(stage.id, "value", event.target.value)} required /><div><button type="button" className="icon-button" aria-label="위로" disabled={index === 0} onClick={() => moveStage(index, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-button" aria-label="아래로" disabled={index === stages.length - 1} onClick={() => moveStage(index, 1)}><ArrowDown size={14} /></button><button type="button" className="icon-button danger-button" aria-label="삭제" disabled={stages.length <= 2} onClick={() => setStages((current) => current.filter((item) => item.id !== stage.id))}><Trash2 size={14} /></button></div></div>)}</div><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>취소</button><button className="primary-button">{editing ? "변경 저장" : "저장"}</button></div></form></div> : null}</>;
}

export function CommerceAdminLinks({ title }: { title: string }) {
  const { accessToken, demo } = useSession();
  const { brand } = usePerformanceFilters();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OsRecord | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => { if (!demo) try { setRecords((await listRecords(accessToken, "connection", "limit=200")).records.filter((item) => item.tags.includes("commerce-admin"))); } catch (reason) { setError(reason instanceof Error ? reason.message : "관리 링크를 불러오지 못했습니다."); } }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);
  const selected = records.filter((item) => matchesPerformanceBrand(item.brand, brand));
  const openNew = () => { setEditing(null); setError(""); setOpen(true); };
  const openEdit = (record: OsRecord) => { setEditing(record); setError(""); setOpen(true); };
  const closeDrawer = () => { if (!busyId) { setOpen(false); setEditing(null); } };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      title: String(form.get("title")),
      description: String(form.get("description")),
      status: "healthy",
      brand: String(form.get("brand")),
      sourceUrl: String(form.get("url")),
      tags: ["commerce-admin"],
    };
    setBusyId(editing?.id ?? "new");
    setError("");
    try {
      if (editing) await updateRecord(accessToken, { id: editing.id, expectedVersion: editing.version, ...input });
      else await createRecord(accessToken, { recordType: "connection", ...input });
      setOpen(false);
      setEditing(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "관리 링크를 저장하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  };
  const remove = async (record: OsRecord) => {
    if (!window.confirm(`“${record.title}” 관리 링크를 삭제할까요?`)) return;
    setBusyId(record.id);
    setError("");
    try {
      await archiveRecord(accessToken, record.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "관리 링크를 삭제하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  };
  return <><header className="page-header"><div className="page-title-group"><span className="eyebrow">자사몰 어드민 연결</span><h1>{title}</h1><p>고객 개인정보를 OS에 복제하지 않고, 브랜드별 관리자 화면과 핵심 운영 메모만 연결합니다.</p></div><button className="primary-button" onClick={openNew}><Plus size={16} /> 관리 링크 추가</button></header>{error ? <div className="inline-alert danger"><CircleAlert size={16} />{error}</div> : null}<section className="commerce-admin-links panel">{selected.map((item) => <article key={item.id}><a href={item.source_url ?? "#"} target="_blank" rel="noreferrer"><Link2 size={16} /><span><strong>{item.title}</strong><small>{item.brand || "전체"} · {item.description || "외부 관리자"}</small></span><ArrowUpRight size={14} /></a><div className="commerce-admin-actions"><button type="button" className="icon-button" aria-label={`${item.title} 수정`} title="수정" disabled={Boolean(busyId)} onClick={() => openEdit(item)}><Pencil size={14} /></button><button type="button" className="icon-button danger-button" aria-label={`${item.title} 삭제`} title="삭제" disabled={Boolean(busyId)} onClick={() => remove(item)}><Trash2 size={14} /></button></div></article>)}{!selected.length ? <div className="empty-state full-span"><div><Link2 /><h3>아직 연결된 관리자 링크가 없습니다.</h3><p>“관리 링크 추가”로 마이인·브랜디액션 에듀 관리자 URL을 연결하세요.</p></div></div> : null}</section>{open ? <div className="drawer-backdrop" onMouseDown={closeDrawer}><form className="record-drawer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><h2>{editing ? "자사몰 어드민 수정" : "자사몰 어드민 연결"}</h2><button type="button" className="icon-button" disabled={Boolean(busyId)} onClick={closeDrawer}><X size={18} /></button></div><label><span>이름</span><input name="title" required placeholder="마이인 주문 관리자" defaultValue={editing?.title ?? ""} /></label><label><span>브랜드</span><select name="brand" defaultValue={editing?.brand || (brand === "all" ? "마이인" : performanceBrandLabel(brand))}><option>마이인</option><option>브랜디액션 에듀</option></select></label><label><span>관리자 URL</span><input name="url" type="url" required defaultValue={editing?.source_url ?? ""} /></label><label><span>설명</span><textarea name="description" rows={4} defaultValue={editing?.description ?? ""} /></label><div className="drawer-actions"><button type="button" className="secondary-button" disabled={Boolean(busyId)} onClick={closeDrawer}>취소</button><button className="primary-button" disabled={Boolean(busyId)}>{busyId ? "저장 중…" : editing ? "변경 저장" : "저장"}</button></div></form></div> : null}</>;
}
