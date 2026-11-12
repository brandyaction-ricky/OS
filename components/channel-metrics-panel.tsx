"use client";
import { useState } from "react";
import { METRIC_LABELS, YOUTUBE_ANALYTICS_METRICS, compareMetricSamples, sampleSummary, metricSamples, measuredValue, type Snapshot } from "@/lib/channel-metrics";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import { demoRecord } from "@/lib/demo-record";

const NAMES: Record<string, string> = { yt_long: "롱폼", yt_shorts: "숏폼", instagram: "인스타", threads: "Threads" };
const DAYS: readonly [Snapshot, string][] = [["d1", "게시 후 1일"], ["d7", "게시 후 7일"], ["d28", "게시 후 28일"]];
const number = (value: number | null) => value === null ? "—" : value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

/**
 * 게시 후 경과일 비교: posts published in [from, to] side by side at the same age (D1 · D7 · D28) — the page's period and
 * 롱폼/숏폼 choice decide which. A missing day stays "—", never filled with today's value.
 */
export function ChannelMetricsPanel({ records, loading, youtubeOnly = false, from = "", to = "", platform = "all" }: { records: OsRecord[]; loading: boolean; youtubeOnly?: boolean; from?: string; to?: string; platform?: string }) {
  const { demo, profile } = useSession();
  const [snapshot, setSnapshot] = useState<Snapshot>("d7"), [metric, setMetric] = useState("views"), [examples, setExamples] = useState<OsRecord[]>([]);
  const data = demo ? examples : records;
  const kinds = (youtubeOnly ? ["yt_long", "yt_shorts"] : ["instagram", "threads"]).filter((kind) => platform === "all" || platform === kind);
  const samples = metricSamples(data, metric, from, to);
  const visible = samples.filter((row) => row.metadata.snapshot === snapshot && kinds.includes(String(row.metadata.platform)));
  const values = (kind: string) => visible.filter((row) => row.metadata.platform === kind).map((row) => measuredValue(row.metadata.value)!).filter(Number.isFinite);
  const latest = data.map((row) => String(row.metadata.measuredAt ?? "")).sort().at(-1);
  const loadExamples = () => setExamples((youtubeOnly ? ["yt_long", "yt_shorts"] : ["instagram", "threads"]).flatMap((kind) => Array.from({ length: 6 }, (_, index) => demoRecord({ recordType: "content_metric", title: `연습용 ${NAMES[kind]} 게시물 ${index + 1}`, metadata: { source: "api", platform: kind, snapshot: "d7", metric: "views", value: 100 + index * 20 + (kind === "threads" || kind === "yt_shorts" ? 50 : 0), publishId: `${kind}-${index}`, publishedAt: new Date(Date.now() - 7 * 86400000).toISOString(), measuredAt: new Date().toISOString(), mock: true } }, profile?.id ?? "demo"))));
  const metricChoices = Object.entries(METRIC_LABELS).filter(([value]) => !youtubeOnly || (YOUTUBE_ANALYTICS_METRICS as readonly string[]).includes(value));
  return <section className="panel perf-panel" aria-label="게시 후 경과일 비교">
    <div className="card-head"><div><span className="card-title">게시 후 경과일 비교</span><p className="section-meta">이 기간에 올린 영상을 올린 지 같은 날짜끼리 비교해요.</p></div>
      {demo ? <button type="button" className="secondary-button compact" onClick={loadExamples}>연습용 성과 불러오기</button> : null}</div>
    <div className="os-toolbar">
      <div className="segmented" role="group" aria-label="경과일">{DAYS.map(([value, label]) => <button type="button" key={value} aria-pressed={snapshot === value} onClick={() => setSnapshot(value)}>{label}</button>)}</div>
      <label className="perf-field">지표<select value={metric} onChange={(event) => setMetric(event.target.value)}>{metricChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {loading ? <div className="perf-metrics" role="status" aria-label="성과 불러오는 중">{kinds.map((kind) => <div className="metric" key={kind}><span className="skeleton perf-skeleton" /></div>)}</div> : <>
      <div className="perf-metrics">{kinds.map((kind) => { const stats = sampleSummary(values(kind)); return <div className="metric" key={kind}>
        <div className="metric-label">{NAMES[kind]} · {DAYS.find(([value]) => value === snapshot)![1]} {METRIC_LABELS[metric]} (가운데 값)</div>
        <p className="metric-value">{number(stats.median)}</p>
        <div className="metric-note">{stats.n ? `영상 ${stats.n}개 · 범위 ${number(stats.min)}~${number(stats.max)}${stats.n < 5 ? " · 5개가 안 돼 비교 보류" : ""}` : "이 기간에 올린 영상의 기록이 없어요"}</div></div>; })}</div>
      {!youtubeOnly && platform === "all" ? <p className="section-meta">{compareMetricSamples(values("instagram"), values("threads"))} · 플랫폼별 집계 정의 차이를 고려해야 합니다.</p> : null}
      <div className="perf-table-wrap"><table className="data-table" aria-label="경과일별 성과 비교"><thead><tr><th>구분</th>{DAYS.map(([value, label]) => <th key={value} className="perf-num">{label}</th>)}</tr></thead>
        <tbody>{kinds.map((kind) => <tr key={kind}><th scope="row" className="cell-title">{NAMES[kind]}</th>{DAYS.map(([day]) => { const stats = sampleSummary(samples.filter((row) => row.metadata.platform === kind && row.metadata.snapshot === day).map((row) => measuredValue(row.metadata.value)!)); return <td key={day} className="perf-num"><strong>{number(stats.median)}</strong><small className="perf-sub">{stats.n ? `영상 ${stats.n}개 · ${number(stats.min)}~${number(stats.max)}` : "기록 없음"}</small></td>; })}</tr>)}</tbody></table></div>
      <div className="perf-table-wrap"><table className="data-table is-compact" aria-label="선택 경과일 측정 기록"><thead><tr><th>게시물</th><th>구분</th><th className="perf-num">{METRIC_LABELS[metric]}</th><th>출처</th></tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id}><td>{row.title}</td><td>{NAMES[String(row.metadata.platform)] ?? String(row.metadata.platform)}</td><td className="perf-num">{number(measuredValue(row.metadata.value))}</td><td>{row.metadata.mock ? "연습용" : "자동 수집"}</td></tr>)}</tbody></table></div>
      {!visible.length ? <div className="empty-state">선택 범위의 측정값이 없습니다. 미측정은 0이 아닙니다.</div> : null}
      <p className="section-meta">{demo ? "연습용 수치 · 실제 플랫폼 조회 없음" : latest ? `마지막 저장 ${new Date(latest).toLocaleString("ko-KR")} · ‘—’는 아직 안 잰 것이고 0이 아니에요` : "아직 모은 수치가 없어요 · 매일 아침 자동으로 모아요"}</p>
    </>}
  </section>;
}
