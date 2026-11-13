"use client";

import "./content-performance.css";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { PageTitle } from "./page-title";
import { ChannelMetricsPanel } from "./channel-metrics-panel";
import { useContentWork } from "./content-work-provider";
import { PerformanceDailyChart } from "./performance-daily-chart";
import { VideoSalesPanel, useVideoSales } from "./video-sales-panel";
import { ContentOriginFilter } from "./content-origin-filter";
import { useSession } from "./session-provider";
import { archiveRecord, createDocument, createRecord, listAllRecordsOfType, listMetricSummary, listMetricWindow, recentAllRecordsOfType, recentMetricSummary, updateRecord } from "@/lib/api-client";
import { summarizeDayRows, videoRows, viewsByDay, type MetricSummary, type SummaryDay } from "@/lib/content-metric-summary";
import { dedupeMetricSnapshots, fixedWeek, groupMetricDimension, metricDisplay, metricValue, summarizeMetrics } from "@/lib/content-metrics";
import { isYoutubeMetricPlatform } from "@/lib/channel-metrics";
import { demoMetricWindow } from "@/lib/content-performance-demo";
import { DEFAULT_PERIOD, PERIODS, addDays, changeLabel, kstDay, previousRange, rangeLabel, readPeriod, spanDays, youtubeFormat, type PeriodId } from "@/lib/performance-period";
import type { OsRecord } from "@/lib/record-types";
import { filterContentOrigin, linkedContentOrigin, type ContentOriginFilter as OriginFilter } from "@/lib/content-origin";

// 영상 성과 (2026-11-12 대표: 다른 화면 규칙에 맞추고, 기간을 바로 고르고, 보기·쓰기 편하게).
// One period row scopes every tab below it; the tabs keep each job on its own page instead of one long scroll.
const METRICS = [{ key: "views", label: "조회", suffix: "" }, { key: "ctr", label: "클릭률", suffix: "%" }, { key: "retention", label: "시청 지속률", suffix: "%" }, { key: "subscribers", label: "구독자 순증", suffix: "" }, { key: "purchases", label: "구매", suffix: "" }, { key: "revenue", label: "기여 매출", suffix: "원" }] as const;
const FIELDS = [{ key: "impressions", label: "노출" }, { key: "views", label: "조회" }, { key: "clicks", label: "클릭" }, { key: "ctr", label: "클릭률(CTR) %" }, { key: "retention", label: "시청지속률 %" }, { key: "subscribers", label: "구독자 순증" }, { key: "purchases", label: "구매" }, { key: "revenue", label: "기여 매출 (원)" }];
const TABS = [["summary", "요약"], ["videos", "영상별"], ["days", "경과일 비교"], ["sales", "매출"], ["learn", "가설"], ["records", "측정 기록"]] as const;
type Tab = typeof TABS[number][0];
const FORMATS = [["all", "전체"], ["long", "롱폼"], ["shorts", "숏폼"]] as const;
type Format = typeof FORMATS[number][0];
const GROUPS = [["video", "영상"], ["hierarchy", "위계"], ["topic", "주제"], ["hookType", "훅 형식"], ["traffic", "유입원"]] as const;
const dayOf = (record: OsRecord) => (record.starts_at ?? record.created_at).slice(0, 10);
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const count = (value: number | null) => value === null ? "—" : value.toLocaleString("ko-KR");
const SOURCES: Record<string, string> = { youtube_analytics_daily: "유튜브 분석 · 하루", youtube_data_api: "유튜브 조회수 · 시간별", "YouTube Analytics API": "유튜브 분석", manual: "직접 입력" };

export function ContentPerformanceDashboard({ youtubeOnly = false }: { youtubeOnly?: boolean } = {}) {
  const work = useContentWork();
  const { accessToken, demo, profile } = useSession();
  const search = useSearchParams(), router = useRouter(), pathname = usePathname();
  const today = kstDay(), period = readPeriod(search, today), { from, to } = period;
  const tab: Tab = TABS.find(([id]) => id === search.get("tab"))?.[0] ?? "summary";
  // The tab and the period live in the address, so a reload, the back button or a shared link shows the same view.
  const setAddress = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) if (value === null) next.delete(key); else next.set(key, value);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };
  const choosePeriod = (id: PeriodId) => setAddress(id === "custom" ? { period: "custom", from, to } : { period: id === DEFAULT_PERIOD ? null : id, from: null, to: null });
  const chooseTab = (id: Tab) => setAddress({ tab: id === "summary" ? null : id });

  const [records, setRecords] = useState<OsRecord[]>([]), [before, setBefore] = useState<OsRecord[]>([]), [snapshots, setSnapshots] = useState<OsRecord[] | null>(null), [days, setDays] = useState<SummaryDay[]>([]);
  const [hypotheses, setHypotheses] = useState<OsRecord[]>([]), [allSources, setSources] = useState<OsRecord[]>([]), [loading, setLoading] = useState(!demo);
  const [origin, setOrigin] = useState<OriginFilter>("own"), [format, setFormat] = useState<Format>("all");
  const [brand, setBrand] = useState("all"), [hierarchy, setHierarchy] = useState("all"), [localSourceId, setLocalSourceId] = useState("all");
  const sources = filterContentOrigin(allSources, origin);
  const sourceId = work ? work.topicId || "all" : localSourceId;
  const setSourceId = (id: string) => { setLocalSourceId(id); work?.select(id === "all" ? "" : id); };
  const [dimension, setDimension] = useState("video"), [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "views", desc: true }), [find, setFind] = useState("");
  const [weekA, setWeekA] = useState(""), [weekB, setWeekB] = useState(""), [weekRecords, setWeekRecords] = useState<Record<string, OsRecord[]>>({});
  const [editing, setEditing] = useState<OsRecord | null>(null), [open, setOpen] = useState(false);
  const [hypothesis, setHypothesis] = useState(""), [hypothesisEdit, setHypothesisEdit] = useState<OsRecord | null>(null), [learningTargetId, setLearningTargetId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reportId, setReportId] = useState(""), [reload, setReload] = useState(0);
  const visibleMetrics = useCallback((metrics: OsRecord[]) => youtubeOnly ? metrics.filter((item) => isYoutubeMetricPlatform(item.metadata.platform)) : metrics, [youtubeOnly]);
  const daily = (metrics: OsRecord[]) => visibleMetrics(metrics).filter((item) => item.metadata.channelSnapshotVersion !== 1);

  const load = useCallback(async () => {
    if (demo) return;
    const apply = (decisions: OsRecord[], topics: OsRecord[]) => {
      setSources(topics); setHypotheses(decisions.filter((item) => item.metadata.kind === "content_hypothesis" && (!youtubeOnly || ["all", "yt_long", "yt_shorts", "YouTube", "YouTube Shorts", "long", "shorts"].includes(String(item.metadata.platformFilter ?? "all")))));
    };
    // A revisit shows this tab's last figures at once; the fresh reads below replace them.
    const recent = [recentAllRecordsOfType(accessToken, "decision"), recentAllRecordsOfType(accessToken, "content_topic")];
    if (recent.every(Boolean)) apply(recent[0]!, recent[1]!);
    const [decisions, topics] = await Promise.all([listAllRecordsOfType(accessToken, "decision"), listAllRecordsOfType(accessToken, "content_topic")]);
    apply(decisions, topics);
  }, [accessToken, demo, youtubeOnly]);
  useEffect(() => { load().catch((reason) => setError(reason.message)); }, [load]);
  // The chosen days, and the same number of days right before them for 「직전 7일보다」, each as one small answer: YouTube
  // Analytics days and videos added up on the server (one record per video here), plus the window's other rows. The hourly
  // tracked-channel rows come only for 시장 레퍼런스 · 전체 — they are the slow part.
  const observed = origin !== "own";
  const summaryRecords = (summary: MetricSummary) => [...daily(summary.rows), ...videoRows(summary.videos, profile?.id)];
  const demoSummary = (start: string, end: string): MetricSummary => ({ ...summarizeDayRows(demoMetricWindow(start, end)), rows: [] });
  useEffect(() => {
    const prev = previousRange(from, to);
    if (demo) { const now = demoSummary(from, to); setRecords(summaryRecords(now)); setDays(now.days); setBefore(summaryRecords(demoSummary(prev.from, prev.to))); setLoading(false); return; }
    let active = true;
    const apply = (summary: MetricSummary) => { setRecords(summaryRecords(summary)); setDays(summary.days); };
    const recent = recentMetricSummary(accessToken, from, to, observed);
    if (recent) { apply(recent); setLoading(false); } else setLoading(true);
    listMetricSummary(accessToken, from, to, observed).then((summary) => { if (active) apply(summary); }).catch((reason) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    listMetricSummary(accessToken, prev.from, prev.to, observed).then((summary) => { if (active) setBefore(summaryRecords(summary)); }).catch(() => { if (active) setBefore([]); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- summaryRecords() is visibleMetrics() plus fixed shaping
  }, [accessToken, demo, from, to, reload, visibleMetrics, observed]);
  // 경과일 비교 reads, only when opened, the D1 · D7 · D28 rows of posts published in the period (they are taken later,
  // so the window is the publish dates). The other tabs never carry them.
  useEffect(() => {
    if (demo || tab !== "days") return;
    let active = true; setSnapshots(null);
    listMetricWindow(accessToken, from, to, true).then((metrics) => { if (active) setSnapshots(visibleMetrics(metrics).filter((item) => item.metadata.channelSnapshotVersion === 1)); }).catch((reason) => { if (active) { setSnapshots([]); setError(reason.message); } });
    return () => { active = false; };
  }, [accessToken, demo, tab, from, to, reload, visibleMetrics]);
  useEffect(() => {
    if (demo || tab !== "learn") return;
    let active = true;
    for (const start of [weekA, weekB]) {
      const week = fixedWeek(start);
      if (week) void listMetricSummary(accessToken, week.start, week.end, observed).then((summary) => { if (active) setWeekRecords((current) => ({ ...current, [start]: summaryRecords(summary) })); }).catch((reason) => { if (active) setError(reason.message); });
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- summaryRecords() is visibleMetrics() plus fixed shaping
  }, [accessToken, demo, tab, weekA, weekB, reload, visibleMetrics, observed]);

  const perform = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); setReload((value) => value + 1); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했습니다."); } finally { setBusy(false); } };
  const inScope = useCallback((item: OsRecord) => (origin === "all" || linkedContentOrigin(item, allSources) === origin) && (sourceId === "all" || item.parent_id === sourceId)
    && (brand === "all" || item.brand === brand) && (format === "all" || youtubeFormat(item.metadata) === format) && (hierarchy === "all" || item.metadata.hierarchy === hierarchy), [allSources, origin, sourceId, brand, format, hierarchy]);
  const within = useCallback((rows: OsRecord[], start: string, end: string) => dedupeMetricSnapshots(rows.filter(inScope).filter((item) => { const date = dayOf(item); return date >= start && date <= end; })), [inScope]);
  const filtered = useMemo(() => within(records, from, to), [records, from, to, within]);
  const prev = previousRange(from, to);
  const previous = useMemo(() => within(before, prev.from, prev.to), [before, prev.from, prev.to, within]);
  // A period's figures add up day rows only: an hourly row carries a video's running total, which is not what the chosen days gained.
  const dayRows = useMemo(() => filtered.filter((row) => row.metadata.metricMode !== "cumulative"), [filtered]);
  const totals = summarizeMetrics(dayRows), previousTotals = summarizeMetrics(previous.filter((row) => row.metadata.metricMode !== "cumulative"));
  // The chart adds the server's per-day sums (our channel's YouTube Analytics days, so only when the filters keep them) and any
  // other day rows of the window by their own date.
  const daysInScope = (origin === "own" || origin === "all") && sourceId === "all" && (brand === "all" || brand === "브랜디액션") && hierarchy === "all";
  const dailyViews = useMemo(() => {
    const byDay = daysInScope ? viewsByDay(days, format) : new Map<string, number>();
    for (const row of filtered) if (row.metadata.metricMode !== "cumulative" && !row.metadata.summary) { const value = metricValue(row, "views"); if (value !== null) byDay.set(dayOf(row), (byDay.get(dayOf(row)) ?? 0) + value); }
    return Array.from({ length: spanDays(from, to) }, (_, index) => { const day = addDays(from, index); return { day, views: byDay.get(day) ?? null }; });
  }, [filtered, from, to, days, format, daysInScope]);
  const recentGap = to >= addDays(today, -1) && dailyViews.slice(-2).some((day) => day.views === null);
  const groups = useMemo(() => {
    const rows = groupMetricDimension(filtered, dimension).filter((group) => !find.trim() || group.title.toLowerCase().includes(find.trim().toLowerCase()));
    const value = (group: typeof rows[number]) => sort.key === "title" ? null : sort.key === "count" ? group.count : (group as unknown as Record<string, number | null>)[sort.key];
    return rows.sort((a, b) => sort.key === "title" ? (sort.desc ? -1 : 1) * a.title.localeCompare(b.title, "ko") : ((value(b) ?? -Infinity) - (value(a) ?? -Infinity)) * (sort.desc ? 1 : -1));
  }, [filtered, dimension, find, sort]);
  const topVideos = useMemo(() => groupMetricDimension(dayRows, "video").filter((group) => group.views !== null).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5), [dayRows]);
  const compare = [weekA, weekB].map((start) => { const week = fixedWeek(start); const data = week ? within(weekRecords[start] ?? [], week.start, week.end) : []; return { week, count: data.length, totals: summarizeMetrics(data) }; });
  const sales = useVideoSales(from, tab === "summary" ? to : "");
  // 필터 더 보기 closes when the next press lands outside it, like a menu.
  const moreFilters = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { const box = moreFilters.current; if (box?.open && !box.contains(event.target as Node)) box.open = false; };
    document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close);
  }, []);
  const extraFilters = Number(brand !== "all") + Number(hierarchy !== "all") + Number(sourceId !== "all");
  const resetFilters = () => { setBrand("all"); setHierarchy("all"); setSourceId("all"); setOrigin("own"); setFormat("all"); };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await perform(async () => {
      const numeric = Object.fromEntries(FIELDS.map(({ key }) => [key, text(form, key) === "" ? null : Number(text(form, key))]));
      const payload = { title: text(form, "title"), description: text(form, "note"), status: "measuring", brand: text(form, "brand"), team: profile?.team || "콘텐츠", parentId: text(form, "sourceId") || null, sourceUrl: text(form, "sourceUrl") || null, startsAt: `${text(form, "date")}T12:00:00Z`, metricCurrent: numeric.views, metricUnit: "조회", metadata: { ...(editing?.metadata ?? {}), ...numeric, platform: text(form, "platform"), hierarchy: text(form, "hierarchy"), topic: text(form, "topic"), hookType: text(form, "hookType"), traffic: text(form, "traffic"), contentId: text(form, "contentId"), metricMode: text(form, "metricMode"), source: "manual", dataSource: "manual", measuredAt: new Date().toISOString() } };
      if (editing) await updateRecord(accessToken, { id: editing.id, expectedVersion: editing.version, ...payload }); else await createRecord(accessToken, { recordType: "content_metric", ...payload });
      setOpen(false); setEditing(null);
    });
  };
  const saveHypothesis = () => perform(async () => {
    if (!learningTargetId) throw new Error("학습을 적용할 다음 콘텐츠를 선택해 주세요.");
    if (!filtered.length) throw new Error("검증 근거로 연결할 성과 기록이 없습니다.");
    const metadata = { ...(hypothesisEdit?.metadata ?? {}), kind: "content_hypothesis", periodFrom: from, periodTo: to, brandFilter: brand, platformFilter: format, hierarchyFilter: hierarchy, sampleCount: filtered.length, evidenceMetricIds: filtered.map((item) => item.id), verifiedLearning: false };
    if (hypothesisEdit) await updateRecord(accessToken, { id: hypothesisEdit.id, expectedVersion: hypothesisEdit.version, parentId: learningTargetId, title: hypothesis.slice(0, 240), description: hypothesis, status: "review", metadata });
    else await createRecord(accessToken, { recordType: "decision", parentId: learningTargetId, title: hypothesis.slice(0, 240), description: hypothesis, status: "review", stage: "콘텐츠 가설", metadata });
    setHypothesis(""); setHypothesisEdit(null);
  });
  const decideHypothesis = (item: OsRecord, status: string) => perform(async () => {
    const evidence = Array.isArray(item.metadata.evidenceMetricIds) ? item.metadata.evidenceMetricIds : [];
    if (status === "adopted" && (!item.parent_id || evidence.length === 0)) throw new Error("다음 콘텐츠와 성과 근거가 연결된 가설만 채택할 수 있습니다.");
    await updateRecord(accessToken, { id: item.id, expectedVersion: item.version, status, metadata: { ...item.metadata, verifiedLearning: status === "adopted", verifiedAt: status === "adopted" ? new Date().toISOString() : null, verifiedBy: status === "adopted" ? profile?.id : null, decidedAt: new Date().toISOString(), decidedBy: profile?.id } });
  });
  const weeklyReport = () => perform(async () => {
    const { document } = await createDocument(accessToken, { title: `콘텐츠 성과 검토 ${from} ~ ${to}`, folder: "콘텐츠/성과/주간리포트", tags: ["콘텐츠", "주간리포트"], content: `# 콘텐츠 성과 검토\n\n기간: ${from} ~ ${to} · 브랜드: ${brand} · 형식: ${format} · 위계: ${hierarchy}\n\n## 1. 확인한 사실\n표본 ${filtered.length}건. ${METRICS.map((item) => `${item.label}: ${metricDisplay(totals[item.key], item.suffix)}`).join(" · ")}\n\n## 2. 검토할 가설\n${hypotheses.filter((item) => item.status === "review").map((item) => `- ${item.description}`).join("\n") || "- 등록된 가설 없음"}\n\n## 3. 다음 주 실험\n- A/B 기간, 대상 영상, 변경 변수와 성공 기준을 사람이 입력\n\n## 4. 사람 판정\n- 채택 / 폐기 / 관찰 / 수정 결정 대기\n- 미연결 값은 0으로 해석하지 않음. 자동 정본 반영·외부 발행 없음.\n` }); setReportId(document.id);
  });

  const compareText = prev.days === 1 ? "전날보다" : `직전 ${prev.days}일보다`;
  const card = (label: string, value: string, change: ReturnType<typeof changeLabel>, note?: string) => <div className="metric" key={label}>
    <div className="metric-label">{label}</div><p className="metric-value">{value}</p>
    <div className="metric-note">{change ? <><b className="perf-change" data-tone={change.tone}>{change.text}</b> {compareText}</> : note ?? `${compareText} 비교할 기록 없음`}</div></div>;
  const sortHead = (key: string, label: string, numeric = true) => <th key={key} className={numeric ? "perf-num" : undefined} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
    <button type="button" className="perf-sort" onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : key !== "title" }))}>{label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}</button></th>;

  return <div className="perf-root">
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>기간을 고르면 아래 숫자가 모두 그 기간으로 바뀌어요.</p></div>
      <div className="header-actions">
        <button type="button" className="secondary-button with-icon" disabled={busy} onClick={() => void perform(load)}><RefreshCw size={14} aria-hidden="true" />새로고침</button>
        <button type="button" className="secondary-button" disabled={busy || !filtered.length} onClick={weeklyReport}>주간 보고서 만들기</button>
        <button type="button" className="primary-button" onClick={() => { setEditing(null); setOpen(true); }}>성과 기록</button>
      </div></header>

    <section className="panel perf-filters" aria-label="기간과 필터">
      <div className="os-toolbar perf-periods" role="group" aria-label="기간">
        {PERIODS.map((item) => <button type="button" key={item.id} className="os-chip" aria-pressed={period.id === item.id} onClick={() => choosePeriod(item.id)}>{item.label}</button>)}
      </div>
      <div className="os-toolbar">
        {period.id === "custom" ? <span className="perf-range-inputs"><input type="date" aria-label="시작일" value={from} max={to} onChange={(event) => event.target.value && setAddress({ period: "custom", from: event.target.value, to })} /><span aria-hidden="true">~</span><input type="date" aria-label="종료일" value={to} min={from} max={today} onChange={(event) => event.target.value && setAddress({ period: "custom", from, to: event.target.value })} /></span> : null}
        <b className="perf-range">{rangeLabel(from, to)}</b>
        <span className="os-spacer" />
        {youtubeOnly ? <div className="segmented" role="group" aria-label="영상 형식">{FORMATS.map(([value, label]) => <button type="button" key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>{label}</button>)}</div> : null}
        <ContentOriginFilter value={origin} onChange={(value) => { setOrigin(value); setSourceId("all"); setLearningTargetId(""); }} />
        <details ref={moreFilters} className="perf-more-filters"><summary className="secondary-button compact">필터 더 보기{extraFilters ? ` · ${extraFilters}` : ""}</summary>
          <div className="perf-more-body">
            <label className="perf-field">기준 콘텐츠<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="all">전체</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label className="perf-field">브랜드<select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="all">전체</option>{[...new Set(records.map((item) => item.brand).filter(Boolean))].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="perf-field">위계<select value={hierarchy} onChange={(event) => setHierarchy(event.target.value)}><option value="all">전체</option>{["유입형", "전환형", "판매형"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <button type="button" className="secondary-button compact" onClick={resetFilters}>필터 처음으로</button>
          </div></details>
      </div>
    </section>

    <div className="page-tabs" role="tablist" aria-label="영상 성과 보기">{TABS.map(([id, label]) => <button type="button" role="tab" key={id} className="page-tab" aria-selected={tab === id} onClick={() => chooseTab(id)}>{label}</button>)}</div>
    {error ? <div className="os-callout" data-tone="danger" role="alert"><div className="os-callout-body">{error}</div></div> : null}
    {reportId ? <div className="os-callout" data-tone="ok" role="status"><div className="os-callout-body"><Link href={`/knowledge/doc/${reportId}`}>저장된 주간 보고서 열기</Link></div></div> : null}

    <div className={loading && filtered.length ? "perf-body is-loading" : "perf-body"} aria-busy={loading}>
      {tab === "summary" ? <>
        <section className="perf-metrics" aria-label="기간 합계">
          {loading && !filtered.length ? METRICS.slice(0, 5).map((item) => <div className="metric" key={item.key}><div className="metric-label">{item.label}</div><span className="skeleton perf-skeleton" /></div>) : <>
            {card("조회수", count(totals.views), changeLabel(totals.views, previousTotals.views))}
            {card("시청 지속률", totals.retention === null ? "—" : `${totals.retention.toFixed(1)}%`, changeLabel(totals.retention, previousTotals.retention, true))}
            {card("구독자 순증", totals.subscribers === null ? "—" : `${totals.subscribers > 0 ? "+" : ""}${totals.subscribers.toLocaleString("ko-KR")}`, changeLabel(totals.subscribers, previousTotals.subscribers))}
            {card("클릭률(노출 대비)", totals.ctr === null ? "—" : `${totals.ctr.toFixed(1)}%`, changeLabel(totals.ctr, previousTotals.ctr, true), totals.ctr === null ? "아직 수집 전이에요" : undefined)}
            {card("유튜브 매출 · 마이인", sales.sales ? `${sales.sales.totals.youtube.l.net.toLocaleString("ko-KR")}원` : "—", null, sales.sales ? `구매 ${sales.sales.totals.youtube.l.orders.toLocaleString("ko-KR")}건 · 결제 직전 유입 기준` : sales.demo ? "연습 화면에서는 불러오지 않아요" : sales.error || "불러오는 중…")}
          </>}
        </section>
        <div className="perf-grid">
          <section className="panel perf-panel"><div className="card-head"><span className="card-title">일별 조회 흐름</span><span className="section-meta">{recentGap ? "최근 이틀은 유튜브가 아직 집계 중이라 비어 있을 수 있어요" : "하루 단위 기록만 더해요"}</span></div><PerformanceDailyChart days={dailyViews} /></section>
          <section className="panel perf-panel"><div className="card-head"><span className="card-title">조회 많은 영상</span><button type="button" className="secondary-button compact" onClick={() => chooseTab("videos")}>영상별 전체 보기</button></div>
            {topVideos.length ? <ol className="perf-top">{topVideos.map((video, index) => <li key={video.key}><span className="perf-rank">{index + 1}</span><span className="perf-top-title">{video.title}</span><b>{count(video.views)}</b><small>{video.retention === null ? "" : `지속 ${video.retention.toFixed(0)}%`}</small></li>)}</ol>
              : <div className="empty-state">이 기간에 잰 영상이 없어요. 기간을 넓혀 보세요.</div>}</section>
        </div>
        <section className="panel perf-panel"><div className="card-head"><span className="card-title">콘텐츠 전환 단계</span><span className="section-meta">‘—’는 아직 안 잰 단계예요</span></div>
          <div className="perf-flow">{([["노출", totals.impressions], ["조회", totals.views], ["클릭", totals.clicks], ["구매", totals.purchases]] as [string, number | null][]).map(([label, value]) => <div key={label}><span>{label}</span><b>{count(value)}</b></div>)}</div></section>
      </> : null}

      {tab === "videos" ? <section className="panel perf-panel" aria-label="성과 비교">
        <div className="os-toolbar">
          <div className="segmented" role="group" aria-label="묶음 기준">{GROUPS.map(([key, label]) => <button type="button" key={key} aria-pressed={dimension === key} onClick={() => setDimension(key)}>{label}</button>)}</div>
          <span className="os-spacer" />
          <input type="search" className="perf-find" aria-label="이름으로 찾기" placeholder="이름으로 찾기" value={find} onChange={(event) => setFind(event.target.value)} />
        </div>
        {groups.length ? <div className="perf-table-wrap"><table className="data-table"><thead><tr>{sortHead("title", "구분", false)}{sortHead("count", "측정")}{METRICS.map((item) => sortHead(item.key, item.label))}</tr></thead>
          <tbody>{groups.map((group) => <tr key={group.key}><td className="cell-title">{group.title}</td><td className="perf-num">{group.count}</td>{METRICS.map((item) => <td key={item.key} className="perf-num">{group[item.key] === null ? "—" : metricDisplay(group[item.key], item.suffix)}</td>)}</tr>)}</tbody></table></div>
          : <div className="empty-state">{find ? "찾는 이름이 없어요." : "선택 기간에 측정된 성과가 없습니다."}</div>}
        <p className="section-meta">같은 영상의 시간별 기록은 하나로 묶었어요 · ‘—’는 아직 안 잰 값이에요 · 머리글을 누르면 정렬돼요</p>
      </section> : null}

      {tab === "days" ? <ChannelMetricsPanel records={(snapshots ?? []).filter((row) => sourceId === "all" || row.parent_id === sourceId)} loading={!demo && snapshots === null} youtubeOnly={youtubeOnly} from={from} to={to} platform={format === "long" ? "yt_long" : format === "shorts" ? "yt_shorts" : "all"} /> : null}

      {tab === "sales" ? youtubeOnly ? <VideoSalesPanel from={from} to={to} /> : <div className="empty-state">매출은 유튜브 영상 성과에서만 보여요.</div> : null}

      {tab === "learn" ? <>
        <section className="panel perf-panel"><div className="card-head"><div><span className="card-title">A/B 주차 비교</span><p className="section-meta">두 주의 시작일을 고르면 각각 7일을 비교해요. 표본 수를 보고 사람이 판정해요.</p></div></div>
          <div className="os-toolbar"><label className="perf-field">A 주 시작<input type="date" value={weekA} onChange={(event) => setWeekA(event.target.value)} /></label><label className="perf-field">B 주 시작<input type="date" value={weekB} onChange={(event) => setWeekB(event.target.value)} /></label></div>
          <div className="perf-table-wrap"><table className="data-table"><thead><tr><th>지표</th>{compare.map((item, index) => <th key={index} className="perf-num">{index ? "B" : "A"} · {item.week ? `${item.week.start} ~ ${item.week.end}` : "날짜 고르기"}</th>)}</tr></thead>
            <tbody><tr><td>표본</td>{compare.map((item, index) => <td key={index} className="perf-num">{item.count}건</td>)}</tr>{METRICS.map((metric) => <tr key={metric.key}><td>{metric.label}</td>{compare.map((item, index) => <td key={index} className="perf-num">{item.totals[metric.key] === null ? "—" : metricDisplay(item.totals[metric.key], metric.suffix)}</td>)}</tr>)}</tbody></table></div></section>
        <section className="panel perf-panel"><div className="card-head"><div><span className="card-title">다음 제작 가설</span><p className="section-meta">지금 기간·필터의 성과 기록을 근거로 붙여 저장해요. 사람이 채택한 가설만 검증된 학습이 돼요.</p></div></div>
          <div className="perf-form">
            <label className="perf-field">적용할 다음 콘텐츠<select value={learningTargetId} onChange={(event) => setLearningTargetId(event.target.value)}><option value="">선택해 주세요</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label className="perf-field">가설<textarea aria-label="가설 내용" value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} rows={3} placeholder="예: 첫 문장을 시청자 장면으로 바꾸면 1분 지속률이 오른다" /></label>
            <div><button type="button" className="primary-button" disabled={busy || !hypothesis.trim() || !learningTargetId || !filtered.length} onClick={saveHypothesis}>{hypothesisEdit ? "가설 수정 저장" : "성과 근거와 함께 가설 추가"}</button>{!filtered.length ? <span className="section-meta"> 이 기간에 근거로 붙일 성과 기록이 없어요</span> : null}</div>
          </div>
          {hypotheses.length ? <ul className="perf-hypotheses">{hypotheses.map((item) => <li key={item.id}><p>{item.description}</p><small className="section-meta">{String(item.metadata.periodFrom ?? "")} ~ {String(item.metadata.periodTo ?? "")} · 표본 {String(item.metadata.sampleCount ?? "미정")} · 적용 {sources.find((source) => source.id === item.parent_id)?.title ?? "미연결"}</small>
            <div className="os-toolbar"><select aria-label={`${item.title} 판정`} disabled={busy} value={item.status} onChange={(event) => void decideHypothesis(item, event.target.value)}>{[["review", "검토 대기"], ["adopted", "채택"], ["discarded", "폐기"], ["observing", "관찰"], ["revising", "수정"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <button type="button" className="secondary-button compact" onClick={() => { setHypothesisEdit(item); setHypothesis(item.description); setLearningTargetId(item.parent_id ?? ""); }}>수정</button>
              <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void perform(() => archiveRecord(accessToken, item.id))}>휴지통</button></div></li>)}</ul>
            : <div className="empty-state">아직 저장한 가설이 없어요.</div>}
        </section>
      </> : null}

      {tab === "records" ? <section className="panel perf-panel" aria-label="측정 기록">
        <div className="card-head"><span className="card-title">측정 기록 <span className="os-count">{filtered.length}</span></span><button type="button" className="secondary-button compact" onClick={() => { setEditing(null); setOpen(true); }}>성과 기록</button></div>
        {filtered.length ? <div className="perf-table-wrap"><table className="data-table is-compact"><thead><tr><th>영상</th><th>기준일</th><th>출처</th><th>측정 방식</th><th>관리</th></tr></thead>
          <tbody>{[...filtered].sort((a, b) => dayOf(b).localeCompare(dayOf(a))).map((item) => <tr key={item.id}><td className="cell-title">{item.title}</td><td>{item.metadata.summary ? `${dayOf(item)}까지` : dayOf(item)}</td><td>{SOURCES[String(item.metadata.dataSource)] ?? String(item.metadata.dataSource ?? "출처 미입력")}</td><td>{item.metadata.summary ? `${Number(item.metadata.days) || 0}일 합계` : item.metadata.metricMode === "cumulative" ? "누적" : "당일"}</td>
            <td>{item.metadata.summary ? <span className="section-meta">자동 수집</span> : <span className="perf-row-actions"><button type="button" className="secondary-button compact" onClick={() => { setEditing(item); setOpen(true); }}>수정</button><button type="button" className="secondary-button compact" disabled={busy} onClick={() => void perform(() => archiveRecord(accessToken, item.id))}>휴지통</button></span>}</td></tr>)}</tbody></table></div>
          : <div className="empty-state">이 기간에 측정 기록이 없어요.</div>}
      </section> : null}
    </div>

    {open ? <div className="drawer-backdrop"><form className="record-drawer" key={editing?.id ?? "new"} onSubmit={save}><div className="drawer-head"><h2>{editing ? "영상 성과 수정" : "영상 성과 기록"}</h2><button type="button" className="secondary-button compact" disabled={busy} onClick={() => setOpen(false)}>닫기</button></div><p>확인하지 못한 수치는 비워 두세요. 0은 실제 측정값으로 저장됩니다.</p><label>기준 콘텐츠<select required name="sourceId" defaultValue={editing?.parent_id ?? ""}><option value="">선택해 주세요</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>영상 제목<input required name="title" defaultValue={editing?.title} /></label><label>브랜드<input name="brand" defaultValue={editing?.brand || "브랜디액션"} /></label><label>측정일<input type="date" required name="date" defaultValue={editing ? dayOf(editing) : today} /></label><label>콘텐츠 ID 또는 YouTube 영상 ID<input name="contentId" defaultValue={String(editing?.metadata.contentId ?? "")} /></label><label>영상 URL<input type="url" name="sourceUrl" defaultValue={editing?.source_url ?? ""} /></label><div className="form-grid"><label>플랫폼<select name="platform" defaultValue={String(editing?.metadata.platform ?? "YouTube")}>{(youtubeOnly ? ["YouTube", "YouTube Shorts"] : ["YouTube", "YouTube Shorts", "Instagram", "Threads"]).map((value) => <option key={value}>{value}</option>)}</select></label><label>측정 방식<select name="metricMode" defaultValue={String(editing?.metadata.metricMode ?? "daily")}><option value="daily">해당 날짜 증가분</option><option value="cumulative">측정 시점 누적값</option></select></label></div><label>위계<select name="hierarchy" defaultValue={String(editing?.metadata.hierarchy ?? "유입형")}>{["유입형", "전환형", "판매형"].map((value) => <option key={value}>{value}</option>)}</select></label><div className="form-grid">{FIELDS.map((field) => <label key={field.key}>{field.label}<input type="number" step="any" name={field.key} min={field.key === "subscribers" ? undefined : 0} max={["ctr", "retention"].includes(field.key) ? 100 : undefined} defaultValue={editing ? metricValue(editing, field.key) ?? "" : ""} /></label>)}</div>{[["topic", "주제"], ["hookType", "훅 형식"], ["traffic", "유입원"]].map(([key, label]) => <label key={key}>{label}<input name={key} defaultValue={String(editing?.metadata[key] ?? "")} /></label>)}<label>판정 메모<textarea name="note" defaultValue={editing?.description} /></label><div className="drawer-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>취소</button><button className="primary-button" disabled={busy}>성과 저장</button></div></form></div> : null}
  </div>;
}
