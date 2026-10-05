"use client";

import {
  Archive,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FileText,
  ImageIcon,
  Library,
  MessageSquareText,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, archiveRecord, createRecord, listRecords, updateRecord } from "@/lib/api-client";
import {
  DEFAULT_CONTENT_AUTOMATION_SETTINGS,
  type ContentAutomationSettings,
} from "@/lib/content-automation-settings";
import { demoRecord } from "@/lib/demo-record";
import type { OsRecord } from "@/lib/record-types";
import { useSearchParams } from "next/navigation";
import { PageTitle } from "./page-title";
import { useSession } from "./session-provider";

const LIBRARY_TYPES = ["content_topic", "content_script", "content_package", "content_short", "content_publish"] as const;
type LibraryType = typeof LIBRARY_TYPES[number];
type SettingsResponse = { settings: ContentAutomationSettings; version: number; configured: boolean; canManage: boolean; updatedAt: string | null };

const TYPE_LABEL: Record<LibraryType, string> = {
  content_topic: "프로젝트",
  content_script: "원고",
  content_package: "제목·시안",
  content_short: "쇼츠",
  content_publish: "게시물",
};

const STATUS_LABEL: Record<string, string> = {
  backlog: "대기",
  active: "진행 중",
  draft: "초안",
  review: "검토",
  ready: "승인됨",
  scheduled: "예약",
  published: "게시됨",
  blocked: "막힘",
  done: "완료",
};

function contentJob(row: OsRecord) {
  return Boolean(row.metadata.contentAction || row.metadata.generationMode || row.metadata.generatedBy === "claude-queue" || row.tags.includes("콘텐츠"));
}

function automationSource(row: OsRecord) {
  return row.record_type === "content_topic" && (row.metadata.automationSource === true || row.metadata.pipelineEnabled === true);
}

function recordHref(row: OsRecord) {
  const topicId = row.record_type === "content_topic" ? row.id : row.parent_id;
  const suffix = topicId ? `?topic=${encodeURIComponent(topicId)}` : "";
  if (row.record_type === "content_script") return `/content/scripts${suffix}`;
  if (row.record_type === "content_package") return `/content/packages${suffix}`;
  if (row.record_type === "content_short") return `/content/shorts${suffix}`;
  if (row.record_type === "content_publish") return `/automation/review${topicId ? `?sourceId=${encodeURIComponent(topicId)}&publication=${encodeURIComponent(row.id)}` : ""}`;
  return `/content/topics${suffix}`;
}

function dashboardDemo(owner: string) {
  const topic = demoRecord({ id: "11111111-1111-4111-8111-111111111111", recordType: "content_topic", title: "예시 · 브랜드 운영 가이드", status: "active", stage: "파생 제작", metadata: { automationSource: true } }, owner);
  const publication = demoRecord({ id: "22222222-2222-4222-8222-222222222222", recordType: "content_publish", title: "예시 · Threads 초안", status: "review", parentId: topic.id, metadata: { automationOutput: true, platform: "threads" } }, owner);
  const job = demoRecord({ id: "33333333-3333-4333-8333-333333333333", recordType: "ai_job", title: "예시 · 채널 초안 생성", status: "backlog", parentId: topic.id, metadata: { contentAction: "derivatives", generationMode: "queue" }, tags: ["콘텐츠"] }, owner);
  const comment = demoRecord({ id: "44444444-4444-4444-8444-444444444444", recordType: "content_comment", title: "실무에 적용하는 첫 단계가 궁금해요", status: "unanswered", parentId: publication.id, metadata: { platform: "threads" } }, owner);
  return { topics: [topic], publications: [publication], jobs: [job], comments: [comment], metrics: [] as OsRecord[] };
}

export function ContentAutomationDashboard() {
  const { accessToken, demo, profile } = useSession();
  const [data, setData] = useState(() => dashboardDemo(profile?.id ?? "demo"));
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (demo) { setData(dashboardDemo(profile?.id ?? "demo")); setLoading(false); return; }
    setLoading(true);
    try {
      const [topics, publications, jobs, comments, metrics] = await Promise.all([
        listRecords(accessToken, "content_topic", "limit=200"),
        listRecords(accessToken, "content_publish", "limit=200"),
        listRecords(accessToken, "ai_job", "limit=200&excludeKind=development_request"),
        listRecords(accessToken, "content_comment", "limit=200"),
        listRecords(accessToken, "content_metric", "limit=200"),
      ]);
      setData({ topics: topics.records.filter(automationSource), publications: publications.records, jobs: jobs.records.filter(contentJob), comments: comments.records, metrics: metrics.records });
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "자동화 현황을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [accessToken, demo, profile?.id]);
  useEffect(() => { void load(); }, [load]);

  const pending = data.publications.filter((row) => ["draft", "review", "ready", "blocked"].includes(row.status));
  const queued = data.jobs.filter((row) => ["backlog", "active", "blocked"].includes(row.status));
  const unanswered = data.comments.filter((row) => row.status === "unanswered");
  const current = [
    ...pending.map((row) => ({ row, kind: "최종 점검", href: recordHref(row) })),
    ...unanswered.map((row) => ({ row, kind: "댓글", href: "/content/comments" })),
    ...queued.filter((row) => row.status === "blocked").map((row) => ({ row, kind: "Claude 요청", href: `/automation/requests?job=${encodeURIComponent(row.id)}` })),
  ].slice(0, 8);

  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>콘텐츠 요청부터 검토·발행·댓글·성과까지 지금 처리할 항목을 모아봅니다.</p></div><div className="header-actions"><Link className="secondary-button" href="/automation/library"><Library size={15} /> 라이브러리</Link><Link className="primary-button" href="/content/topics"><Plus size={15} /> 새 콘텐츠</Link></div></header>
    {error ? <div className="inline-alert danger" role="alert"><CircleAlert size={16} />{error}</div> : null}
    <section className="metric-grid compact-metrics automation-metrics" aria-label="콘텐츠 자동화 요약">
      {[{ label: "프로젝트", value: data.topics.length, icon: Sparkles }, { label: "최종 점검", value: pending.length, icon: CheckCircle2 }, { label: "Claude 요청", value: queued.length, icon: Bot }, { label: "답할 댓글", value: unanswered.length, icon: MessageSquareText }].map((item) => <Link className="metric-card" href={item.label === "프로젝트" ? "/automation/library?type=content_topic" : item.label === "최종 점검" ? "/automation/review" : item.label === "Claude 요청" ? "/automation/requests" : "/content/comments"} key={item.label}><div className="metric-top"><span>{item.label}</span><item.icon size={16} /></div><div className="metric-value">{loading ? "—" : item.value}</div><div className="metric-caption">실제 OS 기록 기준</div></Link>)}
    </section>
    <div className="automation-dashboard-grid">
      <section className="panel automation-turn"><div className="panel-header"><div><h2>지금 내 차례</h2><p>검토·답글·막힌 요청 순서</p></div><span className="count-badge">{current.length}</span></div>{current.length ? <div className="automation-list">{current.map(({ row, kind, href }) => <Link href={href} key={row.id}><span className={`state-dot ${row.status === "blocked" ? "bad" : row.status === "ready" ? "good" : "waiting"}`} /><span><strong>{row.title}</strong><small>{kind} · {STATUS_LABEL[row.status] ?? row.status}</small></span><em>열기</em></Link>)}</div> : <div className="quiet-state"><CheckCircle2 /><strong>지금 처리할 항목이 없습니다.</strong><span>새 요청이나 검토 항목이 생기면 여기에 표시됩니다.</span></div>}</section>
      <section className="panel automation-projects"><div className="panel-header"><div><h2>프로젝트</h2><p>자동화가 켜진 콘텐츠</p></div><Link href="/automation/library?type=content_topic">전체 보기</Link></div>{data.topics.length ? <div className="automation-list">{data.topics.slice(0, 8).map((row) => <Link href={recordHref(row)} key={row.id}><Sparkles size={15} /><span><strong>{row.title}</strong><small>{row.stage || STATUS_LABEL[row.status] || row.status}</small></span><em>{data.publications.filter((item) => item.parent_id === row.id).length}개 결과</em></Link>)}</div> : <div className="quiet-state"><Sparkles /><strong>자동화 프로젝트가 없습니다.</strong><span>주제·기획에서 콘텐츠를 등록해 시작하세요.</span></div>}</section>
    </div>
    <section className="panel automation-requests-preview"><div className="panel-header"><div><h2>최근 Claude 요청</h2><p>구독 대기열과 바로 받기 기록</p></div><Link href="/automation/requests">요청함 열기</Link></div><div className="automation-list">{data.jobs.slice(0, 6).map((row) => <Link key={row.id} href={`/automation/requests?job=${encodeURIComponent(row.id)}`}><Bot size={15} /><span><strong>{row.title}</strong><small>{row.metadata.generationMode === "api" ? "바로 받기" : "구독 대기열"} · {STATUS_LABEL[row.status] ?? row.status}</small></span><time>{new Date(row.updated_at).toLocaleDateString("ko-KR")}</time></Link>)}{!data.jobs.length ? <div className="quiet-state"><Bot /><strong>요청 기록이 없습니다.</strong><span>콘텐츠 화면에서 생성 요청을 보내면 기록됩니다.</span></div> : null}</div></section>
  </>;
}

export function ContentAutomationLibrary() {
  const search = useSearchParams();
  const { accessToken, demo, profile } = useSession();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const requestedType = search.get("type");
  const [type, setType] = useState<"all" | LibraryType>(LIBRARY_TYPES.includes(requestedType as LibraryType) ? requestedType as LibraryType : "all");
  const [status, setStatus] = useState("all");
  useEffect(() => {
    if (demo) {
      const sample = dashboardDemo(profile?.id ?? "demo");
      setRecords([...sample.topics, ...sample.publications, demoRecord({ recordType: "content_script", title: "예시 · 롱폼 원고", status: "ready", parentId: sample.topics[0].id }, profile?.id ?? "demo")]);
      setLoading(false); return;
    }
    setLoading(true);
    Promise.all(LIBRARY_TYPES.map((recordType) => listRecords(accessToken, recordType, "limit=200")))
      .then((pages) => { setRecords(pages.flatMap((page) => page.records)); setError(""); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "라이브러리를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [accessToken, demo, profile?.id]);
  const filtered = useMemo(() => records.filter((row) => (type === "all" || row.record_type === type) && (status === "all" || row.status === status) && (!query.trim() || `${row.title} ${row.description} ${row.tags.join(" ")}`.toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR")))), [query, records, status, type]);
  const statuses = [...new Set(records.map((row) => row.status))].sort();
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>원본 프로젝트와 생성된 원고·시안·쇼츠·게시물을 같은 연결 관계로 찾습니다.</p></div><div className="header-actions"><Link className="primary-button" href="/content/topics"><Plus size={15} /> 새 콘텐츠</Link></div></header>
    {error ? <div className="inline-alert danger" role="alert"><CircleAlert size={16} />{error}</div> : null}
    <section className="panel automation-library"><div className="automation-toolbar"><label><Search size={14} /><input aria-label="라이브러리 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목·본문·태그 검색" /></label><select aria-label="콘텐츠 종류" value={type} onChange={(event) => setType(event.target.value as "all" | LibraryType)}><option value="all">모든 종류</option>{LIBRARY_TYPES.map((value) => <option value={value} key={value}>{TYPE_LABEL[value]}</option>)}</select><select aria-label="콘텐츠 상태" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">모든 상태</option>{statuses.map((value) => <option value={value} key={value}>{STATUS_LABEL[value] ?? value}</option>)}</select><span>{loading ? "불러오는 중…" : `${filtered.length}개`}</span></div><div className="automation-library-grid">{filtered.map((row) => <Link href={recordHref(row)} key={row.id}><div className="automation-library-icon">{row.record_type === "content_publish" ? <CalendarClock /> : row.record_type === "content_package" ? <ImageIcon /> : <FileText />}</div><span className="status-pill">{TYPE_LABEL[row.record_type as LibraryType]}</span><h2>{row.title}</h2><p>{row.description || "설명이 없습니다."}</p><footer><span>{STATUS_LABEL[row.status] ?? row.status}</span><time>{new Date(row.updated_at).toLocaleDateString("ko-KR")}</time></footer></Link>)}{!loading && !filtered.length ? <div className="quiet-state"><Library /><strong>조건에 맞는 콘텐츠가 없습니다.</strong><span>필터를 지우거나 새 콘텐츠를 등록하세요.</span></div> : null}</div></section>
  </>;
}

type TemplateDraft = { name: string; brand: string; background: string; primary: string; accent: string; font: string; titleLimit: number; bodyLimit: number; footer: string; previewTitle: string; previewBody: string };
const DEFAULT_TEMPLATE: TemplateDraft = { name: "새 카드뉴스 시안", brand: "브랜디액션", background: "#111214", primary: "#f7f8f8", accent: "#5e6ad2", font: "Pretendard", titleLimit: 34, bodyLimit: 110, footer: "BRANDYACTION", previewTitle: "한 장에 한 메시지만 담습니다", previewBody: "제목과 본문 길이를 정해 두면 채널마다 일관된 카드뉴스를 만들 수 있습니다." };
function templateDraft(row?: OsRecord | null): TemplateDraft {
  if (!row) return { ...DEFAULT_TEMPLATE };
  const value = (key: keyof TemplateDraft) => row.metadata[key];
  return { name: row.title, brand: row.brand || DEFAULT_TEMPLATE.brand, background: String(value("background") ?? DEFAULT_TEMPLATE.background), primary: String(value("primary") ?? DEFAULT_TEMPLATE.primary), accent: String(value("accent") ?? DEFAULT_TEMPLATE.accent), font: String(value("font") ?? DEFAULT_TEMPLATE.font), titleLimit: Number(value("titleLimit") ?? DEFAULT_TEMPLATE.titleLimit), bodyLimit: Number(value("bodyLimit") ?? DEFAULT_TEMPLATE.bodyLimit), footer: String(value("footer") ?? DEFAULT_TEMPLATE.footer), previewTitle: String(value("previewTitle") ?? DEFAULT_TEMPLATE.previewTitle), previewBody: String(value("previewBody") ?? DEFAULT_TEMPLATE.previewBody) };
}

export function ContentAutomationTemplates() {
  const { accessToken, demo, profile } = useSession();
  const [rows, setRows] = useState<OsRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<TemplateDraft>(DEFAULT_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async (preferredId?: string) => {
    if (demo) {
      const row = demoRecord({ id: "55555555-5555-4555-8555-555555555555", recordType: "content_package", title: "브랜디 기본 카드", status: "active", brand: "브랜디액션", metadata: { packageKind: "cardnews_template", ...DEFAULT_TEMPLATE } }, profile?.id ?? "demo");
      setRows([row]); if (!preferredId) { setSelectedId(row.id); setDraft(templateDraft(row)); } return;
    }
    try {
      const result = await listRecords(accessToken, "content_package", "limit=200");
      const templates = result.records.filter((row) => row.metadata.packageKind === "cardnews_template");
      setRows(templates);
      const next = templates.find((row) => row.id === preferredId) ?? templates[0] ?? null;
      setSelectedId(next?.id ?? "");
      if (next) setDraft(templateDraft(next));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "카드뉴스 시안을 불러오지 못했습니다."); }
  }, [accessToken, demo, profile?.id]);
  useEffect(() => { void load(); }, [load]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const choose = (row: OsRecord) => { setSelectedId(row.id); setDraft(templateDraft(row)); setNotice(""); setError(""); };
  const startNew = () => { setSelectedId(""); setDraft({ ...DEFAULT_TEMPLATE }); setNotice(""); setError(""); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (demo) {
        const saved = demoRecord({ recordType: "content_package", title: draft.name, status: "active", brand: draft.brand, metadata: { packageKind: "cardnews_template", templateVersion: 1, ...draft } }, profile?.id ?? "demo", selected ?? undefined);
        setRows((current) => selected ? current.map((row) => row.id === selected.id ? saved : row) : [saved, ...current]); setSelectedId(saved.id); setNotice("모의 시안을 저장했습니다. 실제 데이터는 변경하지 않았습니다."); return;
      }
      const payload = { title: draft.name, brand: draft.brand, description: "카드뉴스 색·글꼴·글자 수 기본값", status: "active", tags: ["카드뉴스", "시안"], metadata: { ...(selected?.metadata ?? {}), packageKind: "cardnews_template", templateVersion: 1, ...draft } };
      const saved = selected ? (await updateRecord(accessToken, { id: selected.id, expectedVersion: selected.version, ...payload })).record : (await createRecord(accessToken, { recordType: "content_package", ...payload })).record;
      await load(saved.id); setNotice("카드뉴스 시안을 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "카드뉴스 시안을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selected || !window.confirm(`‘${selected.title}’ 시안을 보관할까요? 기존 콘텐츠는 바뀌지 않습니다.`)) return;
    setBusy(true); setError("");
    try { if (!demo) await archiveRecord(accessToken, selected.id); setRows((current) => current.filter((row) => row.id !== selected.id)); startNew(); setNotice("시안을 보관했습니다."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "시안을 보관하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>브랜드별 카드뉴스의 색·글꼴·글자 수를 저장하고 게시 전 화면을 확인합니다.</p></div><div className="header-actions"><button className="secondary-button" onClick={startNew}><Plus size={15} /> 새 시안</button></div></header>
    {error ? <div className="inline-alert danger" role="alert"><CircleAlert size={16} />{error}</div> : null}{notice ? <div className="inline-alert" role="status"><CheckCircle2 size={16} />{notice}</div> : null}
    <div className="automation-template-layout"><aside className="panel automation-template-list"><div className="panel-header"><div><h2>저장한 시안</h2><p>{rows.length}개</p></div></div>{rows.map((row) => <button className={row.id === selectedId ? "active" : ""} onClick={() => choose(row)} key={row.id}><ImageIcon size={15} /><span><strong>{row.title}</strong><small>{row.brand || "브랜드 미지정"}</small></span></button>)}{!rows.length ? <div className="quiet-state"><ImageIcon /><strong>저장한 시안이 없습니다.</strong></div> : null}</aside><form className="panel automation-template-form" onSubmit={save}><div className="automation-template-preview" aria-label="카드뉴스 미리보기" aria-live="polite" style={{ background: draft.background, color: draft.primary, fontFamily: draft.font }}><span style={{ background: draft.accent }}>01</span><small>{draft.brand || "브랜드"}</small><h2>{draft.previewTitle.slice(0, draft.titleLimit) || "제목을 입력하세요"}</h2><p>{draft.previewBody.slice(0, draft.bodyLimit) || "본문을 입력하세요"}</p><footer>{draft.footer}</footer></div><div className="automation-template-fields"><div className="automation-template-copy"><label>미리보기 제목<textarea rows={2} value={draft.previewTitle} onChange={(event) => setDraft({ ...draft, previewTitle: event.target.value })} /></label><small className={draft.previewTitle.length > draft.titleLimit ? "over-limit" : ""}>{draft.previewTitle.length}/{draft.titleLimit}자</small><label>미리보기 본문<textarea rows={4} value={draft.previewBody} onChange={(event) => setDraft({ ...draft, previewBody: event.target.value })} /></label><small className={draft.previewBody.length > draft.bodyLimit ? "over-limit" : ""}>{draft.previewBody.length}/{draft.bodyLimit}자</small></div><div className="form-grid"><label>시안 이름<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>브랜드<input maxLength={120} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label></div><div className="form-grid template-colors"><label>배경색<input type="color" value={draft.background} onChange={(event) => setDraft({ ...draft, background: event.target.value })} /></label><label>글자색<input type="color" value={draft.primary} onChange={(event) => setDraft({ ...draft, primary: event.target.value })} /></label><label>강조색<input type="color" value={draft.accent} onChange={(event) => setDraft({ ...draft, accent: event.target.value })} /></label></div><div className="form-grid"><label>글꼴<select value={draft.font} onChange={(event) => setDraft({ ...draft, font: event.target.value })}><option>Pretendard</option><option>Gmarket Sans</option><option>Noto Sans KR</option><option>system-ui</option></select></label><label>꼬리표<input maxLength={80} value={draft.footer} onChange={(event) => setDraft({ ...draft, footer: event.target.value })} /></label></div><div className="form-grid"><label>제목 최대 글자<input type="number" min={10} max={100} value={draft.titleLimit} onChange={(event) => setDraft({ ...draft, titleLimit: Number(event.target.value) })} /></label><label>본문 최대 글자<input type="number" min={30} max={500} value={draft.bodyLimit} onChange={(event) => setDraft({ ...draft, bodyLimit: Number(event.target.value) })} /></label></div><div className="drawer-actions">{selected ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void remove()}><Archive size={14} /> 보관</button> : null}<button className="primary-button" disabled={busy || !draft.name.trim() || draft.previewTitle.length > draft.titleLimit || draft.previewBody.length > draft.bodyLimit}><Save size={14} /> {busy ? "저장 중…" : "시안 저장"}</button></div></div></form></div>
  </>;
}

export function ContentAutomationSettings() {
  const { accessToken, demo } = useSession();
  const [settings, setSettings] = useState<ContentAutomationSettings>(DEFAULT_CONTENT_AUTOMATION_SETTINGS);
  const [version, setVersion] = useState(0);
  const [canManage, setCanManage] = useState(demo);
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    apiRequest<SettingsResponse>("/api/v1/content/automation/settings", { token: accessToken })
      .then((result) => { setSettings(result.settings); setVersion(result.version); setCanManage(result.canManage); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "자동화 설정을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [accessToken, demo]);
  const toggleChannel = (channel: "youtube" | "instagram" | "threads") => setSettings((current) => ({ ...current, enabledChannels: current.enabledChannels.includes(channel) ? current.enabledChannels.filter((value) => value !== channel) : [...current.enabledChannels, channel] }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!canManage) return; setBusy(true); setError(""); setNotice("");
    try {
      if (demo) { setNotice("모의 설정을 저장했습니다. 실제 데이터는 변경하지 않았습니다."); return; }
      const result = await apiRequest<SettingsResponse>("/api/v1/content/automation/settings", { method: "PATCH", token: accessToken, body: JSON.stringify({ expectedVersion: version, settings }) });
      setSettings(result.settings); setVersion(result.version); setNotice("회사 자동화 설정을 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "자동화 설정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>생성 요청 방식과 검토·수집 기본값을 정합니다. 외부 게시에는 항상 사람 승인이 필요합니다.</p></div></header>
    {error ? <div className="inline-alert danger" role="alert"><CircleAlert size={16} />{error}</div> : null}{notice ? <div className="inline-alert" role="status"><CheckCircle2 size={16} />{notice}</div> : null}{!canManage && !loading ? <div className="inline-alert"><Settings2 size={16} />설정은 모든 직원이 볼 수 있고 관리자만 변경할 수 있습니다.</div> : null}
    <form className="automation-settings-grid" onSubmit={save}><section className="panel"><div className="panel-header"><div><h2>요청 방식</h2><p>기본은 구독 대기열이며 바로 받기는 비용이 발생할 수 있습니다.</p></div><Bot size={17} /></div><label className="automation-option"><input type="radio" name="generationMode" checked={settings.generationMode === "queue"} onChange={() => setSettings({ ...settings, generationMode: "queue" })} disabled={!canManage} /><span><strong>구독 대기열</strong><small>Claude 요청함에 저장하고 외부 발행 없이 결과만 받습니다.</small></span></label><label className="automation-option"><input type="radio" name="generationMode" checked={settings.generationMode === "api"} onChange={() => setSettings({ ...settings, generationMode: "api" })} disabled={!canManage} /><span><strong>바로 받기</strong><small>명시적으로 요청할 때만 API를 사용합니다.</small></span></label><label className="automation-field">구독 대기열 요청 기준<textarea rows={5} maxLength={1_000} value={settings.promptPrefix} disabled={!canManage} onChange={(event) => setSettings({ ...settings, promptPrefix: event.target.value })} /><small>대기 작업 기록에 함께 저장하며 회사 정본보다 우선하지 않습니다.</small></label></section><section className="panel"><div className="panel-header"><div><h2>검토·발행 기준</h2><p>자동 생성 결과는 승인 전 게시할 수 없습니다.</p></div><CheckCircle2 size={17} /></div><label className="automation-field">구독 대기열 재시도 한도<input type="number" min={0} max={5} value={settings.retryLimit} disabled={!canManage} onChange={(event) => setSettings({ ...settings, retryLimit: Number(event.target.value) })} /></label><label className="automation-field">예약 전 확인 알림(분)<input type="number" min={0} max={10_080} value={settings.publishLeadMinutes} disabled={!canManage} onChange={(event) => setSettings({ ...settings, publishLeadMinutes: Number(event.target.value) })} /></label><div className="automation-readonly-rule"><strong>항상 적용</strong><span>문안·계정·파일·원본 버전이 바뀌면 재승인</span><span>게시 결과가 불명확하면 자동 재게시 금지</span></div></section><section className="panel"><div className="panel-header"><div><h2>쓰는 채널</h2><p>연결된 계정이 있어야 수집·게시할 수 있습니다.</p></div><Sparkles size={17} /></div>{(["youtube", "instagram", "threads"] as const).map((channel) => <label className="automation-option" key={channel}><input type="checkbox" checked={settings.enabledChannels.includes(channel)} onChange={() => toggleChannel(channel)} disabled={!canManage} /><span><strong>{channel === "youtube" ? "YouTube" : channel === "instagram" ? "인스타그램" : "Threads"}</strong><small>채널 연결과 팀 공유 권한을 매번 확인합니다.</small></span></label>)}<label className="automation-option"><input type="checkbox" checked={settings.autoCollect} disabled={!canManage} onChange={(event) => setSettings({ ...settings, autoCollect: event.target.checked })} /><span><strong>성과·댓글 자동 수집</strong><small>서버 예약 작업이 켜진 환경에서만 실행됩니다.</small></span></label></section><section className="panel"><div className="panel-header"><div><h2>쇼츠 기본값</h2><p>새 쇼츠 제안 기록에 저장해 후속 편집·렌더링에서 확인합니다.</p></div><FileText size={17} /></div>{[["voicePreset", "음성"], ["bgmPreset", "배경 음악"], ["captionPreset", "자막"]] .map(([key, label]) => <label className="automation-field" key={key}>{label}<input maxLength={80} value={settings.shorts[key as keyof ContentAutomationSettings["shorts"]]} disabled={!canManage} onChange={(event) => setSettings({ ...settings, shorts: { ...settings.shorts, [key]: event.target.value } })} /></label>)}</section><div className="automation-settings-actions"><span>{loading ? "설정 불러오는 중…" : `설정 버전 ${version || "기본"}`}</span><button className="primary-button" disabled={!canManage || busy || loading}><Save size={14} />{busy ? "저장 중…" : "설정 저장"}</button></div></form>
  </>;
}
