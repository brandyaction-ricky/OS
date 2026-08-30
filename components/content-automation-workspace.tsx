"use client";

import { Archive, ArrowRight, CalendarDays, CheckCircle2, CircleAlert, FileText, Film, Instagram, Layers3, NotebookPen, Plus, Send, Sparkles, Upload, X, Youtube } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { archiveRecord, createRecord, generateContent, importContentSnapshot, listRecords, updateRecord } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

type AutomationView = "pipeline" | "review";
type ReviewSort = "due" | "stage" | "channel";
type ReviewGroup = "source" | "channel";
interface OutputTemplate { format: string; platform: "shorts" | "threads" | "column" | "instagram" | "essay"; count: number; days: number[] }

const OUTPUT_TEMPLATES: OutputTemplate[] = [
  { format: "유튜브 쇼츠", platform: "shorts", count: 3, days: [1, 1, 1] },
  { format: "Threads 글", platform: "threads", count: 3, days: [1, 3, 5] },
  { format: "SEO 칼럼", platform: "column", count: 1, days: [2] },
  { format: "인스타 카드뉴스", platform: "instagram", count: 1, days: [2] },
  { format: "에세이", platform: "essay", count: 1, days: [6] },
];
const STATUS_LABEL: Record<string, string> = { draft: "초안", review: "검토", ready: "최종 승인", scheduled: "예약", published: "발행", blocked: "수정 요청", active: "제작 중", done: "완료" };
const REVIEW_STEPS = ["review", "ready", "scheduled", "published"];

function metadata(record: OsRecord, key: string) { const value = record.metadata?.[key]; return typeof value === "string" ? value : ""; }
function outputPlatform(record: OsRecord) { const platform = metadata(record, "platform").toLowerCase(); return platform === "youtube" ? "shorts" : platform || "threads"; }
function platformLabel(platform: string) { return ({ shorts: "유튜브 쇼츠", youtube: "유튜브 쇼츠", threads: "Threads", column: "SEO 칼럼", instagram: "인스타그램", essay: "에세이" } as Record<string, string>)[platform] ?? platform; }
function platformIcon(platform: string) {
  if (["shorts", "youtube"].includes(platform)) return <Youtube size={15} />;
  if (platform === "instagram") return <Instagram size={15} />;
  if (platform === "column") return <FileText size={15} />;
  if (platform === "essay") return <NotebookPen size={15} />;
  return <Send size={15} />;
}
function localDateTime(value: string | null) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function defaultSchedule() { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(18, 0, 0, 0); return date.toISOString(); }

export function ContentAutomationWorkspace({ initialView = "pipeline" }: { initialView?: AutomationView }) {
  const { accessToken, demo, profile } = useSession();
  const [sources, setSources] = useState<OsRecord[]>([]); const [outputs, setOutputs] = useState<OsRecord[]>([]);
  const [view, setView] = useState<AutomationView>(initialView); const [selectedId, setSelectedId] = useState(""); const [sourceOpen, setSourceOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [platformFilter, setPlatformFilter] = useState("all");
  const [reviewSort, setReviewSort] = useState<ReviewSort>("due"); const [reviewGroup, setReviewGroup] = useState<ReviewGroup>("source"); const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [importNotice, setImportNotice] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [topics, publishes] = await Promise.all([listRecords(accessToken, "content_topic", "limit=200"), listRecords(accessToken, "content_publish", "limit=200")]);
      const automationSources = topics.records.filter((record) => record.metadata?.automationSource === true);
      setSources(automationSources); setOutputs(publishes.records.filter((record) => record.metadata?.automationOutput === true));
      setSelectedId((current) => current || automationSources[0]?.id || ""); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "콘텐츠 자동화 항목을 불러오지 못했습니다."); }
  }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);

  const selected = sources.find((source) => source.id === selectedId) ?? sources[0] ?? null;
  const selectedOutputs = outputs.filter((output) => output.parent_id === selected?.id);
  const reviewCount = outputs.filter((output) => ["draft", "review", "ready", "blocked"].includes(output.status)).length;
  const scheduledCount = outputs.filter((output) => output.status === "scheduled").length;
  const publishedCount = outputs.filter((output) => output.status === "published").length;
  const reviewGroups = useMemo(() => {
    const stageRank = (status: string) => ["blocked", "draft", "review", "ready"].indexOf(status);
    const items = outputs.filter((output) => ["draft", "review", "ready", "blocked"].includes(output.status)).filter((output) => platformFilter === "all" || outputPlatform(output) === platformFilter).sort((a, b) => reviewSort === "stage" ? stageRank(a.status) - stageRank(b.status) : reviewSort === "channel" ? outputPlatform(a).localeCompare(outputPlatform(b), "ko") : String(a.starts_at ?? "9999").localeCompare(String(b.starts_at ?? "9999")));
    const map = new Map<string, OsRecord[]>();
    for (const item of items) { const key = reviewGroup === "source" ? String(item.parent_id) : outputPlatform(item); map.set(key, [...(map.get(key) ?? []), item]); }
    return [...map.entries()].map(([key, groupItems]) => ({ key, title: reviewGroup === "source" ? sources.find((source) => source.id === key)?.title ?? "원본 미확인" : platformLabel(key), source: reviewGroup === "source" ? sources.find((source) => source.id === key) ?? null : null, items: groupItems }));
  }, [outputs, platformFilter, reviewGroup, reviewSort, sources]);

  const submitSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const value = (name: string) => String(form.get(name) ?? "").trim(); setBusy(true); setError("");
    try {
      const { record } = await createRecord(accessToken, { recordType: "content_topic", title: value("title"), description: value("transcript"), status: "active", priority: "high", brand: value("brand"), team: value("team"), sourceUrl: value("sourceUrl") || null, metadata: { automationSource: true, publishDate: value("publishDate"), audience: value("audience"), coreMessage: value("coreMessage") }, tags: ["롱폼", "멀티채널"] });
      setSourceOpen(false); await load(); setSelectedId(record.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "원본 콘텐츠를 저장하지 못했습니다."); } finally { setBusy(false); }
  };
  const generateOutputs = async (source: OsRecord) => {
    if (outputs.some((output) => output.parent_id === source.id)) { setError("이미 파생 콘텐츠가 생성된 원본입니다. 기존 묶음을 검토해 주세요."); return; }
    setBusy(true); setError("");
    try { const result = await generateContent(accessToken, { action: "derivatives", sourceId: source.id, platforms: ["shorts", "threads", "column", "instagram", "essay"] }); if (result.queued) setError("Claude 연결 대기 작업으로 저장했습니다. 설정 > 연결에서 키를 등록하면 실행할 수 있습니다."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "파생 콘텐츠를 생성하지 못했습니다."); } finally { setBusy(false); }
  };
  const setOutputStatus = async (output: OsRecord, status: string, startsAt?: string) => { try { await updateRecord(accessToken, { id: output.id, expectedVersion: output.version, status, ...(startsAt ? { startsAt } : {}) }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "콘텐츠 상태를 변경하지 못했습니다."); } };
  const completeGroup = async (items: OsRecord[]) => { setBusy(true); setError(""); for (const item of items.filter((entry) => ["draft", "review"].includes(entry.status))) await setOutputStatus(item, "ready"); setBusy(false); };
  const scheduleGroup = async (items: OsRecord[]) => { setBusy(true); setError(""); for (const item of items.filter((entry) => entry.status === "ready")) { const value = scheduleDrafts[item.id] || localDateTime(item.starts_at) || localDateTime(defaultSchedule()); await setOutputStatus(item, "scheduled", new Date(value).toISOString()); } setBusy(false); };
  const scheduleOutput = async (output: OsRecord) => { const value = scheduleDrafts[output.id] || localDateTime(output.starts_at) || localDateTime(defaultSchedule()); if (!value) return setError("예약 날짜와 시간을 선택해 주세요."); await setOutputStatus(output, "scheduled", new Date(value).toISOString()); };
  const archiveSource = async (source: OsRecord) => { if (!window.confirm(`\"${source.title}\" 원본을 보관할까요? 연결된 파생 콘텐츠는 유지됩니다.`)) return; setBusy(true); setError(""); try { await archiveRecord(accessToken, source.id); await load(); setSelectedId(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "원본을 보관하지 못했습니다."); } finally { setBusy(false); } };
  const importSnapshot = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) return setError("콘텐츠 스냅샷은 5MB 이하 JSON 파일만 가져올 수 있습니다.");
    setBusy(true); setError(""); setImportNotice("");
    try {
      const snapshot = JSON.parse(await file.text()) as unknown;
      const { counts } = await importContentSnapshot(accessToken, snapshot);
      setImportNotice(`원본 ${counts.sources} · 파생 ${counts.derivatives} · 성과 ${counts.metrics}건 동기화 (신규 ${counts.created}, 갱신 ${counts.updated}${counts.skipped ? `, 건너뜀 ${counts.skipped}` : ""})`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "콘텐츠 스냅샷을 가져오지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">멀티채널 자동화</span><h1>{view === "review" ? "검토·발행 대기목록" : "멀티채널 자동화"}</h1><p>최종 롱폼 1개를 쇼츠·Threads·SEO 칼럼·카드뉴스·에세이로 전환하고 검토·예약합니다.</p></div><div className="header-actions"><Link className="secondary-button" href="/content/calendar"><CalendarDays size={16} /> 발행 캘린더</Link>{profile?.role === "admin" ? <label className="secondary-button content-import-button"><Upload size={15} /> 로컬 자료 가져오기<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { importSnapshot(event.target.files?.[0]); event.target.value = ""; }} /></label> : null}<button className="secondary-button" onClick={() => setView(view === "pipeline" ? "review" : "pipeline")}><CheckCircle2 size={16} /> {view === "pipeline" ? `대기목록 ${reviewCount}` : "자동화 현황"}</button><button className="primary-button" onClick={() => setSourceOpen(true)}><Plus size={16} /> 롱폼 등록</button></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    {importNotice ? <div className="inline-alert success"><CheckCircle2 size={16} /> {importNotice}</div> : null}
    <section className="metric-grid compact-metrics automation-metrics"><button className="metric-card" onClick={() => setView("pipeline")}><div className="metric-top"><span>원본 롱폼</span><span className="metric-icon"><Film size={16} /></span></div><div className="metric-value">{sources.length}</div><div className="metric-caption">자동화 현황 보기</div></button><button className="metric-card" onClick={() => setView("review")}><div className="metric-top"><span>검토 대기</span><span className="metric-icon"><Sparkles size={16} /></span></div><div className="metric-value">{reviewCount}</div><div className="metric-caption warn">사람 판단 필요</div></button><Link className="metric-card" href="/content/calendar"><div className="metric-top"><span>예약 발행</span><span className="metric-icon"><CalendarDays size={16} /></span></div><div className="metric-value">{scheduledCount}</div><div className="metric-caption">캘린더 보기</div></Link><button className="metric-card" onClick={() => setView("review")}><div className="metric-top"><span>발행 완료</span><span className="metric-icon"><CheckCircle2 size={16} /></span></div><div className="metric-value">{publishedCount}</div><div className="metric-caption good">성과 측정 가능</div></button></section>
    {view === "pipeline" ? <section className="automation-layout"><aside className="panel source-list"><div className="panel-header"><div><h2>원본 콘텐츠</h2><p>최종 롱폼 기준</p></div></div>{sources.map((source) => <button className={selected?.id === source.id ? "active" : ""} key={source.id} onClick={() => setSelectedId(source.id)}><span className="platform-icon youtube">{platformIcon("shorts")}</span><span><strong>{source.title}</strong><small>{source.brand || "공통"} · 파생 {outputs.filter((item) => item.parent_id === source.id).length}개</small></span><ArrowRight size={14} /></button>)}{!sources.length ? <div className="list-empty"><Film size={20} /><span>최종 롱폼을 등록하세요.</span></div> : null}</aside><div className="panel automation-detail">{selected ? <><header><div><span className="status-pill status-active">원본 롱폼</span><h2>{selected.title}</h2><p>{metadata(selected, "coreMessage") || "핵심 메시지를 입력하세요."}</p></div><div className="automation-source-actions"><button className="ghost-button" disabled={busy} onClick={() => archiveSource(selected)}><Archive size={14} /> 보관</button><button className="primary-button" disabled={busy || selectedOutputs.length > 0} onClick={() => generateOutputs(selected)}><Sparkles size={15} /> {selectedOutputs.length ? "파생물 생성 완료" : "정본으로 파생물 생성"}</button></div></header><div className="output-plan">{OUTPUT_TEMPLATES.map((template) => <div key={template.platform}><span className={`platform-icon ${template.platform}`}>{platformIcon(template.platform)}</span><span><strong>{template.format}</strong><small>{template.count}개 · {template.days.map((day) => `D+${day}`).join(", ")}</small></span><em>{selectedOutputs.filter((item) => outputPlatform(item) === template.platform).length}/{template.count}</em></div>)}</div>{selectedOutputs.length ? <div className="output-list">{selectedOutputs.map((output) => <div key={output.id}><span className={`platform-icon ${outputPlatform(output)}`}>{platformIcon(outputPlatform(output))}</span><span><strong>{output.title}</strong><small>{output.starts_at ? new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(output.starts_at)) : "일정 미정"}</small></span><span className={`status-pill status-${output.status}`}>{STATUS_LABEL[output.status] ?? output.status}</span></div>)}</div> : <div className="automation-guide"><Layers3 size={28} /><h3>정본 실행 대기</h3><p>채널별 회사 절차를 실행 시점에 읽고 생성한 뒤, 자가검수 결과와 함께 사람 검토 단계에 올립니다.</p></div>}</> : <div className="empty-state"><div><span><Youtube /></span><h3>원본 롱폼을 선택하세요.</h3></div></div>}</div></section> : <><section className="panel review-toolbar" aria-label="검토 대기목록 보기 설정"><label>채널<select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}><option value="all">전체 채널</option>{OUTPUT_TEMPLATES.map((item) => <option key={item.platform} value={item.platform}>{item.format}</option>)}</select></label><label>정렬<select value={reviewSort} onChange={(event) => setReviewSort(event.target.value as ReviewSort)}><option value="due">마감 임박순</option><option value="stage">진행 단계순</option><option value="channel">채널순</option></select></label><label>묶어 보기<select value={reviewGroup} onChange={(event) => setReviewGroup(event.target.value as ReviewGroup)}><option value="source">영상별</option><option value="channel">채널별</option></select></label></section><section className="review-bundles">{reviewGroups.map((group) => <article className="panel review-bundle" key={group.key}><header><div><span className="platform-icon youtube">{group.source ? <Youtube size={15} /> : platformIcon(group.key)}</span><span><strong>{group.title}</strong><small>{group.source?.brand || "공통"} · 확인 {group.items.length}개</small></span></div><div className="review-bulk-actions"><button className="secondary-button compact" disabled={busy || !group.items.some((item) => ["draft", "review"].includes(item.status))} onClick={() => completeGroup(group.items)}><CheckCircle2 size={14} /> 일괄 검토 완료</button><button className="primary-button compact" disabled={busy || !group.items.some((item) => item.status === "ready")} onClick={() => scheduleGroup(group.items)}><CalendarDays size={14} /> 승인완료 일괄 예약</button></div></header><div>{group.items.map((output) => { const platform = outputPlatform(output); const step = Math.max(0, REVIEW_STEPS.indexOf(output.status)); return <div className="review-output" key={output.id}><span className={`platform-icon ${platform}`}>{platformIcon(platform)}</span><span className="review-output-copy"><strong>{output.title}</strong><small>{platformLabel(platform)} · {output.description}</small>{platform === "shorts" && output.source_url ? <a href={output.source_url} target="_blank" rel="noreferrer">원본 영상에서 구간 확인</a> : null}<ol className="review-stepper" aria-label="발행 진행 단계">{["검토", "승인", "예약", "발행"].map((label, index) => <li className={index < step ? "done" : index === step ? "active" : ""} key={label}><span />{label}</li>)}</ol></span><div className="review-actions">{output.status === "blocked" ? <button className="ghost-button" onClick={() => setOutputStatus(output, "review")}>검토로 되돌리기</button> : <button className="ghost-button" onClick={() => setOutputStatus(output, "blocked")}>수정 요청</button>}{output.status === "draft" ? <button className="primary-button compact" onClick={() => setOutputStatus(output, "review")}>검토 시작</button> : output.status === "review" ? <button className="primary-button compact" onClick={() => setOutputStatus(output, "ready")}>검토 완료</button> : output.status === "ready" ? <><input aria-label={`${output.title} 예약 일시`} type="datetime-local" value={scheduleDrafts[output.id] ?? localDateTime(output.starts_at)} onChange={(event) => setScheduleDrafts((current) => ({ ...current, [output.id]: event.target.value }))} /><button className="primary-button compact" onClick={() => scheduleOutput(output)}>최종 승인·예약</button></> : null}</div></div>; })}</div></article>)}{!reviewGroups.length ? <div className="panel empty-state"><div><span><CheckCircle2 /></span><h3>확인할 파생 콘텐츠가 없습니다.</h3><p>새 원본에서 파생물을 생성하면 검토→최종 승인→예약 순으로 표시됩니다.</p></div></div> : null}</section></>}
    {sourceOpen ? <div className="drawer-backdrop" onMouseDown={() => !busy && setSourceOpen(false)}><form className="record-drawer" onSubmit={submitSource} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">원본 콘텐츠</span><h2>최종 롱폼 등록</h2></div><button type="button" className="icon-button" onClick={() => setSourceOpen(false)}><X size={18} /></button></div><label><span>콘텐츠 제목</span><input name="title" required placeholder="유튜브 최종 롱폼 제목" /></label><label><span>원본 영상 URL</span><input type="url" name="sourceUrl" required placeholder="https://youtube.com/…" /></label><div className="form-grid"><label><span>브랜드</span><input name="brand" placeholder="브랜디액션" /></label><label><span>담당 팀</span><input name="team" defaultValue={profile?.team ?? "콘텐츠"} /></label></div><label><span>기준 발행일</span><input type="date" name="publishDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label><span>타깃 시청자</span><input name="audience" placeholder="방향을 잃은 직장인" /></label><label><span>핵심 메시지</span><textarea name="coreMessage" required rows={4} /></label><label><span>최종 스크립트·자막 원문</span><textarea name="transcript" required rows={10} placeholder="파생 콘텐츠 생성의 기준 원문" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setSourceOpen(false)}>취소</button><button className="primary-button" disabled={busy}>{busy ? "저장 중…" : "원본 등록"}</button></div></form></div> : null}
  </>;
}
