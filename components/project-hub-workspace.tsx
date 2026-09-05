"use client";

import { ArrowUpRight, Check, CheckCircle2, Circle, CircleAlert, Copy, FileText, FolderGit2, GitBranch, GitCommitHorizontal, Loader2, Plus, RefreshCw, Rocket, Search, SlidersHorizontal, X } from "lucide-react";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createRecord, listRecords } from "@/lib/api-client";
import { buildDevelopmentHandoff, recordText as meta, repositoryUrl, safeWebUrl } from "@/lib/development-handoff";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import "./development-workspace.css";

const LABELS: Record<string, string> = { backlog: "접수", active: "수정 중", review: "검수 요청", done: "해결", blocked: "보류", working: "작업 중", tested: "검증 완료", dev_deployed: "Preview 배포", completed: "완료", ready: "배포 성공", failed: "배포 실패", deploying: "배포 중", rolled_back: "되돌림" };
const PRIORITY: Record<string, string> = { urgent: "긴급", high: "높음", normal: "보통", low: "낮음" };
const CATEGORIES: Record<string, string> = { bug: "오류 신고", usability: "사용성 개선", question: "사용 문의", feature: "기능 제안" };
const FLOW = ["backlog", "active", "review", "done", "blocked"];
const EMPTY_COUNTS: Record<string, number> = { backlog: 0, active: 0, review: 0, done: 0, blocked: 0 };
const PAGE_SIZE = 25;
type Modal = "project" | "request" | "edit" | "log" | "deployment" | null;
interface Inbox { requests: OsRecord[]; total: number; counts: Record<string, number> }

function previewRecord(input: Partial<OsRecord>): OsRecord {
  return { id: crypto.randomUUID(), record_type: "ai_job", title: "", description: "", status: "backlog", priority: "normal", stage: "", brand: "브랜디액션", team: "", owner_id: "demo-ricky", assignee_id: null, parent_id: null, due_date: null, starts_at: null, ends_at: null, progress: 0, metric_target: null, metric_current: null, metric_unit: "", amount: null, currency: "KRW", source_url: null, tags: [], metadata: {}, version: 1, created_by: "demo-ricky", updated_by: "demo-ricky", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), archived_at: null, ...input };
}
function date(value: string) { return new Date(value).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }); }
function Status({ value }: { value: string }) { return <span className={`dev-status dev-status-${value}`}><Circle size={11} />{LABELS[value] || value}</span>; }
function fullPageUrl(value: string) { return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? `https://brandyaction-os.vercel.app${value}` : value; }
function SafeLink({ url, children }: { url: string | null | undefined; children: React.ReactNode }) { const href = safeWebUrl(url); return href ? <a href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13} /></a> : null; }
async function requestApi<T>(token: string | null, query = "", body?: Record<string, unknown>, method = "GET"): Promise<T> {
  const response = await fetch(`/api/v1/development-requests${query ? `?${query}` : ""}`, { method, cache: "no-store", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "수정요청을 처리하지 못했습니다.");
  return data;
}
async function projectRecords(token: string | null, type: "project" | "development_log" | "deployment", parentId?: string) {
  const result: OsRecord[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await listRecords(token, type, new URLSearchParams({ limit: "200", offset: String(offset), ...(parentId ? { parentId } : {}) }).toString());
    result.push(...page.records);
    if (!page.records.length || result.length >= page.total) return result;
  }
}

export function ProjectHubWorkspace() {
  return <Suspense fallback={<div className="loading-state">개발 관리를 불러오는 중…</div>}><ProjectHubContent /></Suspense>;
}

function ProjectHubContent() {
  const searchParams = useSearchParams();
  const { accessToken, demo, profile, loading: sessionLoading } = useSession();
  const admin = profile?.role === "admin";
  const [projects, setProjects] = useState<OsRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [inbox, setInbox] = useState<Inbox>({ requests: [], total: 0, counts: EMPTY_COUNTS });
  const [history, setHistory] = useState<OsRecord[]>([]);
  const [selected, setSelected] = useState<OsRecord | null>(null);
  const [tab, setTab] = useState<"requests" | "history" | "guide">("requests");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [notice, setNotice] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [revision, setRevision] = useState(0);
  const [projectRevision, setProjectRevision] = useState(0);
  const [demoRequests, setDemoRequests] = useState<OsRecord[]>([]);
  const deepRequest = useRef("");
  const initialProject = useRef("");
  const modalRef = useRef<HTMLDivElement>(null);
  const current = projects.find(item => item.id === projectId) || null;
  const detailProject = projects.find(item => item.id === selected?.parent_id) || current;

  useEffect(() => {
    const params = searchParams;
    deepRequest.current = params.get("request") || "";
    initialProject.current = params.get("project") || "";
    if (FLOW.includes(params.get("status") || "")) setStatus(params.get("status") || "");
    if (params.get("scope") === "mine") setScope("mine");
    if (params.get("new") === "request") {
      const page = params.get("page");
      setPageUrl(page?.startsWith("/") && !page.startsWith("//") ? `${window.location.origin}${page}` : "");
      setModal("request");
    }
  }, [searchParams]);

  useEffect(() => {
    if (sessionLoading || (!demo && !accessToken)) return;
    let cancelled = false;
    if (demo) {
      const project = previewRecord({ id: "preview-os-project", record_type: "project", title: "브랜디액션 OS", description: "직원 요청부터 수정·검증·배포 기록까지 한 곳에서 관리합니다.", status: "active", metadata: { repository: "brandyaction-ricky/OS", productionUrl: "https://brandyaction-os.vercel.app" } });
      setProjects([project]); setProjectId(project.id); setLoading(false);
      return;
    }
    projectRecords(accessToken, "project").then(records => {
      if (cancelled) return;
      setProjects(records);
      setProjectId(previous => previous || records.find(item => item.id === initialProject.current)?.id || records.find(item => meta(item, "repository").replace(/\.git$/, "").endsWith("brandyaction-ricky/OS"))?.id || records[0]?.id || "");
      if (!records.length) setLoading(false);
    }).catch(reason => { if (!cancelled) { setError(reason.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [accessToken, demo, sessionLoading, projectRevision]);

  useEffect(() => {
    if (!deepRequest.current || demo || !accessToken) return;
    let cancelled = false;
    requestApi<Inbox>(accessToken, `id=${encodeURIComponent(deepRequest.current)}`).then(result => {
      if (cancelled) return;
      const item = result.requests[0];
      if (item) { setSelected(item); if (item.parent_id) setProjectId(item.parent_id); }
      else setError("요청을 찾지 못했습니다. 접근 권한과 링크를 확인해 주세요.");
      deepRequest.current = "";
    }).catch(reason => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [accessToken, demo, searchParams]);

  useEffect(() => { setOffset(0); }, [projectId, status, query, scope]);
  useEffect(() => {
    if (!projectId || sessionLoading || (!demo && !accessToken)) return;
    let cancelled = false;
    let pending = false;
    const load = async (quiet = false) => {
      if (pending) return;
      pending = true;
      if (!quiet) setLoading(true);
      try {
        let result: Inbox;
        if (demo) {
          const all = demoRequests.filter(item => item.parent_id === projectId && (!query || `${item.title} ${item.description}`.includes(query)) && (!scope || item.created_by === profile?.id));
          const filtered = all.filter(item => !status || item.status === status);
          result = { requests: filtered.slice(offset, offset + PAGE_SIZE), total: filtered.length, counts: Object.fromEntries(FLOW.map(value => [value, all.filter(item => item.status === value).length])) };
        } else result = await requestApi<Inbox>(accessToken, new URLSearchParams({ projectId, ...(status ? { status } : {}), ...(scope ? { scope } : {}), q: query, limit: String(PAGE_SIZE), offset: String(offset) }).toString());
        if (!cancelled) { setInbox(result); if (offset > 0 && offset >= result.total) setOffset(Math.max(0, Math.floor((result.total - 1) / PAGE_SIZE) * PAGE_SIZE)); setError(""); }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "요청을 불러오지 못했습니다."); }
      finally { pending = false; if (!cancelled) setLoading(false); }
    };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [accessToken, demo, demoRequests, projectId, profile?.id, query, status, scope, offset, revision, sessionLoading]);

  useEffect(() => {
    if (!projectId || demo || !accessToken) return;
    let cancelled = false;
    setHistory([]); setHistoryLoading(true); setHistoryError("");
    Promise.all([projectRecords(accessToken, "development_log", projectId), projectRecords(accessToken, "deployment", projectId)]).then(([logs, deployments]) => {
      if (!cancelled) setHistory([...logs, ...deployments].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }).catch(reason => { if (!cancelled) setHistoryError(reason.message); }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, demo, projectId, revision]);

  useEffect(() => {
    if (!modal && !copyFallback) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) { setModal(null); setCopyFallback(""); }
      if (event.key === "Tab") {
        const elements = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || []);
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [modal, copyFallback, saving]);

  const retryAll = () => { setProjectRevision(value => value + 1); changed(); };
  const changed = useCallback(() => { setRevision(value => value + 1); window.dispatchEvent(new Event("brandy-development-requests-changed")); }, []);
  const open = (value: Modal) => { setFormError(""); setModal(value); };
  const copy = async (request?: OsRecord | null) => {
    const project = request ? detailProject : current;
    if (!project) return;
    const text = buildDevelopmentHandoff(project, request, history.filter(item => item.parent_id === project.id));
    try { await navigator.clipboard.writeText(text); setNotice("Work에 전달할 내용을 복사했습니다. 새 채팅에 붙여넣으세요."); }
    catch { setCopyFallback(text); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || "").trim();
    setSaving(true); setFormError("");
    try {
      if (modal === "request" || modal === "edit") {
        const body = { title: value("title"), description: value("description"), parentId: value("parentId"), priority: value("priority"), category: value("category"), pageUrl: value("pageUrl"), steps: value("steps"), expectedResult: value("expectedResult"), attachmentUrl: value("attachmentUrl"), ...(modal === "edit" && selected ? { id: selected.id, expectedVersion: selected.version } : {}) };
        let saved: OsRecord;
        if (demo) {
          saved = previewRecord({ ...selected && modal === "edit" ? selected : {}, title: body.title, description: body.description, parent_id: body.parentId, priority: body.priority as OsRecord["priority"], metadata: { ...(modal === "edit" ? selected?.metadata : {}), kind: "development_request", pageUrl: body.pageUrl, category: body.category, steps: body.steps, expectedResult: body.expectedResult, attachmentUrl: body.attachmentUrl }, version: modal === "edit" ? (selected?.version || 0) + 1 : 1 });
          setDemoRequests(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
        } else ({ record: saved } = await requestApi<{ record: OsRecord }>(accessToken, "", body, modal === "edit" ? "PATCH" : "POST"));
        setSelected(saved); setProjectId(saved.parent_id || projectId); setStatus(""); setQuery(""); setSearch(""); setOffset(0); setTab("requests");
        setNotice(modal === "edit" ? "요청 내용을 수정했습니다." : "요청이 접수됐습니다. 개발 관리에서 처리 상태를 확인할 수 있습니다.");
      } else if (modal === "project") {
        const repository = value("repository");
        if (repository && !repositoryUrl(repository)) throw new Error("저장소는 owner/repository 또는 GitHub 저장소 주소로 입력해 주세요.");
        const body = { recordType: "project", title: value("title"), description: value("description"), status: "active", metadata: { repository, productionUrl: value("productionUrl") } };
        const saved = demo ? previewRecord({ record_type: "project", title: body.title, description: body.description, status: "active", metadata: body.metadata }) : (await createRecord(accessToken, body)).record;
        setProjects(previous => [...previous, saved]); setProjectId(saved.id); if (!demo) setProjectRevision(value => value + 1); setNotice("프로젝트를 등록했습니다.");
      } else if ((modal === "log" || modal === "deployment") && current) {
        const body = { recordType: modal === "log" ? "development_log" : "deployment", parentId: current.id, title: value("title"), description: value("description"), status: value("status"), stage: value("environment"), sourceUrl: value("resultUrl") || null, metadata: { repository: meta(current, "repository"), branch: value("branch"), commitSha: value("commitSha"), checks: value("checks").split("\n").filter(Boolean), nextSteps: value("nextSteps").split("\n").filter(Boolean), requestId: selected?.parent_id === current.id ? selected.id : null } };
        const saved = demo ? previewRecord({ record_type: body.recordType as OsRecord["record_type"], parent_id: current.id, title: body.title, description: body.description, status: body.status, stage: body.stage, source_url: body.sourceUrl, metadata: body.metadata }) : (await createRecord(accessToken, body)).record;
        if (demo) setHistory(previous => [saved, ...previous]);
        setTab("history"); setNotice("작업 결과를 기록했습니다.");
      }
      setModal(null); changed();
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "저장하지 못했습니다. 입력 내용은 유지됩니다."); }
    finally { setSaving(false); }
  };

  const saveResolution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(["status", "resolution", "branch", "commitSha", "prUrl", "deploymentUrl"].map(key => [key, String(form.get(key) || "").trim()]));
    await patchSelected(body);
  };
  const refreshSelected = async () => {
    if (!selected || saving) return;
    try {
      const result = await requestApi<Inbox>(accessToken, `id=${selected.id}`);
      setSelected(result.requests[0] || null); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "요청을 불러오지 못했습니다."); }
  };
  const patchSelected = async (body: Record<string, unknown>) => {
    if (!selected || saving) return;
    setSaving(true); setError("");
    try {
      const saved = demo ? { ...selected, status: String(body.status || selected.status), version: selected.version + 1, metadata: { ...selected.metadata, ...Object.fromEntries(Object.entries(body).filter(([key]) => key !== "status")) } } : (await requestApi<{ record: OsRecord }>(accessToken, "", { ...body, id: selected.id, expectedVersion: selected.version }, "PATCH")).record;
      setSelected(saved); setOffset(0);
      if (demo) setDemoRequests(previous => previous.map(item => item.id === saved.id ? saved : item));
      changed(); setNotice("처리 상태를 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const pending = useMemo(() => ["backlog", "active", "review", "blocked"].reduce((sum, key) => sum + (inbox.counts[key] || 0), 0), [inbox.counts]);

  return <div className="dev-workspace">
    <header className="dev-page-header"><div><div className="dev-kicker"><FolderGit2 size={15} /> 회사 운영 / 개발</div><h1>개발 관리 <span>요청부터 해결까지</span></h1><p>불편한 점을 남기고, 무엇이 바뀌었는지 함께 확인하세요.</p></div><div className="dev-actions"><button className="dev-button" disabled={!current} onClick={() => copy()}><Copy size={14} /> Work에서 이어하기</button><button className="dev-button primary" onClick={() => open("request")} disabled={saving || !projects.length}><Plus size={15} /> 수정 요청</button></div></header>
    {demo && <div className="dev-banner">미리보기 · 여기서 등록한 내용은 현재 화면에서만 유지됩니다.</div>}
    {notice && <div className="dev-notice" role="status"><CheckCircle2 size={15} />{notice}<button aria-label="안내 닫기" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {error && <div className="dev-error" role="alert"><CircleAlert size={15} />{error}<button onClick={retryAll}>다시 불러오기</button></div>}
    <div className="dev-project-bar"><label><FolderGit2 size={15} /><select aria-label="개발 프로젝트 선택" disabled={saving} value={projectId} onChange={event => { setProjectId(event.target.value); setSelected(null); }}>{!projects.length && <option value="">등록된 프로젝트 없음</option>}{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><SafeLink url={current ? repositoryUrl(meta(current, "repository")) : null}>GitHub 저장소</SafeLink>{admin && <button className="dev-text-button" onClick={() => open("project")}><Plus size={13} /> 프로젝트 추가</button>}</div>
    <div className="dev-tabs" role="tablist" aria-label="개발 관리 보기">{([["requests", "수정요청"], ["history", "개발·배포 기록"], ["guide", "운영 방법"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}{id === "requests" && <span>{loading ? "…" : pending}</span>}</button>)}</div>
    {tab === "requests" && <>
      <div className="dev-toolbar"><div className="dev-filters"><button className={!status ? "active" : ""} onClick={() => setStatus("")}>전체</button>{FLOW.map(value => <button key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{LABELS[value]}<span>{loading ? "·" : inbox.counts[value] || 0}</span></button>)}</div><div className="dev-search-tools"><form onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}><Search size={14} /><input aria-label="수정요청 검색" value={search} onChange={event => setSearch(event.target.value)} placeholder="요청 검색 후 Enter" /><button aria-label="검색 실행" type="submit"><ArrowUpRight size={13} /></button></form><button className={`dev-button ${scope ? "selected" : ""}`} onClick={() => setScope(value => value ? "" : "mine")}><SlidersHorizontal size={13} /> 내 요청</button><button className="dev-button" aria-label="요청 새로고침" onClick={changed} disabled={loading}><RefreshCw size={14} /></button></div></div>
      <div className={`dev-inbox-layout ${selected ? "has-detail" : ""}`}><section className="dev-inbox" aria-label="수정요청 목록">
        <div className="dev-list-head"><span>요청</span><span>상태 / 등록일</span></div>
        {loading ? <div className="dev-empty"><Loader2 className="dev-spin" size={22} /><p>요청을 불러오는 중입니다.</p></div> : inbox.requests.map(item => <button className={`dev-request-row ${selected?.id === item.id ? "selected" : ""}`} disabled={saving} key={item.id} onClick={() => { setSelected(item); setError(""); }}><span className={`dev-priority ${item.priority}`} title={`우선순위 ${PRIORITY[item.priority]}`} /><div className="dev-row-main"><small>{CATEGORIES[meta(item, "category")] || "수정요청"} · {item.id.slice(0, 8)}</small><strong>{item.title}</strong><span>{item.description}</span></div><div className="dev-row-meta"><Status value={item.status} /><time dateTime={item.created_at}>{date(item.created_at)}</time></div></button>)}
        {!loading && !inbox.requests.length && <div className="dev-empty"><CheckCircle2 size={28} /><h2>{projects.length ? "표시할 요청이 없습니다" : "첫 프로젝트를 등록하세요"}</h2><p>{status || query || scope ? "검색어와 필터를 바꾸면 다른 요청을 확인할 수 있습니다." : "직원이 남긴 불편함과 개선 제안이 이곳에 모입니다."}</p>{!projects.length ? admin && <button className="dev-button primary" onClick={() => open("project")}>회사 OS 프로젝트 등록</button> : <button className="dev-button" onClick={() => open("request")}><Plus size={14} /> 첫 수정요청 남기기</button>}</div>}
        {inbox.total > PAGE_SIZE && <div className="dev-pagination"><button disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>이전</button><span>{offset + 1}–{Math.min(offset + PAGE_SIZE, inbox.total)} / {inbox.total}</span><button disabled={offset + PAGE_SIZE >= inbox.total || loading} onClick={() => setOffset(value => value + PAGE_SIZE)}>다음</button></div>}
      </section>
      {selected && <aside className="dev-detail" aria-label="수정요청 상세"><div className="dev-detail-top"><span>요청 상세 · {selected.id.slice(0, 8)}</span><button className="dev-icon-button" aria-label="요청 상세 닫기" disabled={saving} onClick={() => setSelected(null)}><X size={17} /></button></div><div className="dev-detail-body"><Status value={selected.status} /><h2>{selected.title}</h2><div className="dev-detail-properties"><span>{CATEGORIES[meta(selected, "category")] || "수정요청"}</span><span>우선순위 {PRIORITY[selected.priority]}</span><span>{date(selected.created_at)} 등록</span></div><section><h3>현재 문제</h3><p>{selected.description}</p></section>{[["steps", "재현 순서"], ["expectedResult", "기대하는 결과"]].map(([key, label]) => meta(selected, key) && <section key={key}><h3>{label}</h3><p>{meta(selected, key)}</p></section>)}<div className="dev-detail-links"><SafeLink url={fullPageUrl(meta(selected, "pageUrl"))}>문제가 발생한 페이지</SafeLink><SafeLink url={meta(selected, "attachmentUrl")}>첨부 자료 확인</SafeLink></div><button className="dev-button dev-wide" onClick={() => copy(selected)}><Copy size={14} /> 이 요청을 Work에 전달</button>
      {(admin || (selected.created_by === profile?.id && selected.status === "backlog")) && <button className="dev-text-button" onClick={() => open("edit")}>요청 내용 수정</button>}
      <section className="dev-resolution"><h3><GitCommitHorizontal size={14} /> 처리 결과</h3><p>{meta(selected, "resolution") || "아직 처리 결과가 등록되지 않았습니다."}</p><div className="dev-detail-links"><SafeLink url={meta(selected, "prUrl")}>GitHub 변경 내역</SafeLink><SafeLink url={meta(selected, "deploymentUrl")}>반영 화면 확인</SafeLink></div>{meta(selected, "commitSha") && <small>커밋 {meta(selected, "commitSha").slice(0, 12)}</small>}</section>
      {admin ? <form key={`${selected.id}-${selected.version}`} className="dev-resolution-form" onSubmit={saveResolution}><h3>처리 상태 업데이트</h3>{!demo && <button type="button" className="dev-text-button" disabled={saving} onClick={refreshSelected}>최신 요청 다시 열기 · 입력 중인 내용 초기화</button>}<label>상태<select name="status" defaultValue={selected.status}>{FLOW.map(value => <option key={value} value={value}>{LABELS[value]}</option>)}</select></label><label>수정 내용·검증 결과<textarea name="resolution" rows={4} defaultValue={meta(selected, "resolution")} maxLength={10000} placeholder="무엇을 수정했고 어떻게 확인했나요? 해결 처리 시 필수" /></label><details><summary><GitBranch size={13} /> 코드·배포 연결</summary><label>브랜치<input name="branch" defaultValue={meta(selected, "branch")} maxLength={200} /></label><label>커밋 SHA<input name="commitSha" defaultValue={meta(selected, "commitSha")} pattern="[a-fA-F0-9]{7,40}" /></label><label>GitHub PR 주소<input type="url" name="prUrl" defaultValue={meta(selected, "prUrl")} placeholder="https://github.com/…/pull/…" /></label><label>Preview 또는 운영 주소<input type="url" name="deploymentUrl" defaultValue={meta(selected, "deploymentUrl")} /></label></details><button className="dev-button primary dev-wide" disabled={saving}>{saving ? "저장 중…" : "처리 결과 저장"}</button></form> : null}
      {selected.created_by === profile?.id && ["done", "review"].includes(selected.status) && <button className="dev-button dev-wide" disabled={saving} onClick={() => patchSelected({ status: "backlog" })}>아직 문제가 있어요 · 다시 요청</button>}
      </div></aside>}
      </div>
    </>}
    {tab === "history" && <section className="dev-history"><header><div><h2>변경과 배포의 기록</h2><p>작업 기록과 실제 배포 결과를 각각 남깁니다.</p></div>{admin && <div className="dev-actions"><button className="dev-button" disabled={!current} onClick={() => open("log")}><FileText size={14} /> 개발 기록</button><button className="dev-button" disabled={!current} onClick={() => open("deployment")}><Rocket size={14} /> 배포 기록</button></div>}</header>{historyError && <div className="dev-error" role="alert">{historyError}<button onClick={retryAll}>다시 불러오기</button></div>}{historyLoading ? <div className="dev-empty"><Loader2 className="dev-spin" size={22} />기록을 불러오는 중입니다.</div> : history.filter(item => item.parent_id === projectId).map(item => <article key={item.id}><span className="dev-history-icon">{item.record_type === "deployment" ? <Rocket size={16} /> : <GitCommitHorizontal size={16} />}</span><div><div className="dev-history-title"><h3>{item.title}</h3><Status value={item.status} /></div><p>{item.description}</p><small>{date(item.created_at)} · {item.stage || "환경 미기재"} {meta(item, "branch") && `· ${meta(item, "branch")}`} {meta(item, "commitSha") && `· ${meta(item, "commitSha").slice(0, 12)}`}</small>{Array.isArray(item.metadata.checks) && <ul>{item.metadata.checks.filter(check => typeof check === "string").map((check, index) => <li key={index}>{String(check)}</li>)}</ul>}{Array.isArray(item.metadata.nextSteps) && item.metadata.nextSteps.length > 0 && <p className="dev-next-steps">다음 작업: {item.metadata.nextSteps.map(String).join(" · ")}</p>}<SafeLink url={item.source_url}>결과 보기</SafeLink></div></article>)}{!historyLoading && !historyError && !history.some(item => item.parent_id === projectId) && <div className="dev-empty"><GitCommitHorizontal size={25} /><h3>아직 작업 기록이 없습니다</h3><p>Work에서 수정한 뒤 브랜치·커밋·검증 결과를 남기세요.</p></div>}</section>}
    {tab === "guide" && <section className="dev-guide"><div><span className="dev-kicker">팀과 함께</span><h2>불편한 순간, 바로 요청하세요.</h2><p>상단 ‘수정 요청’을 누르면 현재 페이지 주소가 자동으로 들어갑니다. 현재 문제와 원하는 결과를 적으면 리키님이 요청함에서 확인할 수 있습니다.</p><ol><li><strong>직원 · 요청 남기기</strong><span>페이지·문제·재현 순서·기대 결과를 기록합니다.</span></li><li><strong>리키 · Work에서 수정하기</strong><span>요청 상세의 ‘Work에 전달’을 복사해 새 채팅에서 작업을 시작합니다.</span></li><li><strong>개발 · GitHub에 버전 남기기</strong><span>작업 브랜치와 PR로 수정 내용을 저장하고 테스트·Preview를 확인합니다.</span></li><li><strong>운영 · 검수하고 결과 남기기</strong><span>같은 요청에 처리 결과와 반영 화면을 연결합니다. 문제가 남으면 다시 요청할 수 있습니다.</span></li></ol></div><aside><h3>세 곳의 역할</h3><p><strong>회사 OS</strong> 요청·처리 상태·개발·배포 기록</p><p><strong>ChatGPT Work</strong> 분석·코드 수정·검증</p><p><strong>GitHub</strong> 코드 버전·변경 검토·되돌리기</p><hr /><p>요청은 OS에 접수되며 열린 화면은 60초마다, 탭에 돌아오면 즉시 갱신됩니다.</p><p>Work 작업은 요청의 맥락을 전달해 시작합니다. 요청 등록만으로 자동 수정·배포가 실행되지는 않습니다.</p><button className="dev-button dev-wide" disabled={!current} onClick={() => copy()}><Copy size={14} /> 프로젝트 이어가기 복사</button></aside></section>}
    {(modal || copyFallback) && <div className="dev-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) { setModal(null); setCopyFallback(""); } }}><div ref={modalRef} className="dev-modal" role="dialog" aria-modal="true" aria-labelledby="dev-modal-title"><header><div><span className="dev-kicker">{copyFallback ? "Work 인수인계" : "개발 관리"}</span><h2 id="dev-modal-title">{copyFallback ? "아래 내용을 복사해 주세요" : modal === "project" ? "프로젝트 추가" : modal === "log" ? "개발 기록 남기기" : modal === "deployment" ? "배포 결과 남기기" : modal === "edit" ? "요청 내용 수정" : "무엇이 불편하셨나요?"}</h2></div><button disabled={saving} className="dev-icon-button" aria-label="입력창 닫기" onClick={() => { setModal(null); setCopyFallback(""); }}><X size={19} /></button></header>{copyFallback ? <div className="dev-modal-fields"><textarea aria-label="Work 전달 내용" readOnly rows={20} value={copyFallback} onFocus={event => event.target.select()} /></div> : <form onSubmit={submit}><div className="dev-modal-fields">{formError && <div className="dev-error" role="alert">{formError}</div>}
      {(modal === "request" || modal === "edit") ? <><label>프로젝트<select name="parentId" required defaultValue={modal === "edit" ? selected?.parent_id || projectId : projectId}>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><div className="dev-form-grid"><label>요청 종류<select name="category" defaultValue={modal === "edit" ? meta(selected, "category") || "bug" : "bug"}>{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>업무 영향<select name="priority" defaultValue={modal === "edit" ? selected?.priority : "normal"}><option value="normal">보통 · 사용은 가능해요</option><option value="high">높음 · 업무가 지연돼요</option><option value="urgent">긴급 · 업무를 못해요</option><option value="low">낮음 · 나중에 개선해도 돼요</option></select></label></div><label>제목<input name="title" required maxLength={240} defaultValue={modal === "edit" ? selected?.title : ""} placeholder="예: 원고를 저장해도 목록에 나타나지 않아요" /></label><label>문제가 발생한 페이지<input name="pageUrl" type="url" maxLength={2000} defaultValue={modal === "edit" ? fullPageUrl(meta(selected, "pageUrl")) : pageUrl} placeholder="https://brandyaction-os.vercel.app/…" /></label><label>현재 어떤 문제가 있나요?<textarea name="description" required rows={4} maxLength={10000} defaultValue={modal === "edit" ? selected?.description : ""} placeholder="누른 버튼과 화면에 나온 결과를 적어 주세요." /></label><label>어떤 결과를 원하시나요?<textarea name="expectedResult" required rows={3} maxLength={5000} defaultValue={modal === "edit" ? meta(selected, "expectedResult") : ""} placeholder="예: 저장 후 원고 목록에서 바로 확인하고 싶어요." /></label><label>재현 순서 <small>선택</small><textarea name="steps" rows={3} maxLength={5000} defaultValue={modal === "edit" ? meta(selected, "steps") : ""} placeholder="1. 원고 제작 열기\n2. 저장 누르기\n3. 목록에서 확인" /></label><label>스크린샷·영상 링크 <small>선택</small><input name="attachmentUrl" type="url" maxLength={2000} defaultValue={modal === "edit" ? meta(selected, "attachmentUrl") : ""} placeholder="팀에서 접근할 수 있는 자료 주소" /></label><p className="dev-field-help">요청 내용은 회사 구성원이 확인합니다. 비밀번호나 고객 개인정보는 입력하지 마세요.</p></> : modal === "project" ? <><label>프로젝트명<input name="title" required maxLength={240} defaultValue="브랜디액션 OS" /></label><label>목적과 완료 기준<textarea name="description" required rows={4} placeholder="이 프로젝트로 해결할 업무와 완료 기준" /></label><label>GitHub 저장소<input name="repository" defaultValue="brandyaction-ricky/OS" placeholder="owner/repository" /></label><label>운영 주소<input name="productionUrl" type="url" defaultValue="https://brandyaction-os.vercel.app" /></label></> : <><label>기록 제목<input name="title" required maxLength={240} placeholder="예: 수정요청 접수·처리 기능 반영" /></label><label>변경 내용과 결과<textarea name="description" required maxLength={10000} rows={5} /></label><div className="dev-form-grid"><label>환경<select name="environment" defaultValue="local"><option value="local">로컬</option><option value="dev">Preview</option><option value="production">운영</option></select></label><label>상태<select name="status" defaultValue={modal === "log" ? "working" : "ready"}>{(modal === "log" ? ["working", "tested", "dev_deployed", "review", "completed", "blocked"] : ["deploying", "ready", "failed", "rolled_back"]).map(value => <option key={value} value={value}>{LABELS[value]}</option>)}</select></label></div><label>브랜치<input name="branch" maxLength={200} placeholder="codex/수정주제-날짜" /></label><label>커밋 SHA<input name="commitSha" required={modal === "deployment"} pattern="[a-fA-F0-9]{7,40}" /></label><label>검증 내용 <small>한 줄에 하나씩</small><textarea name="checks" required rows={4} placeholder="테스트 통과\n원고 저장 후 새로고침하여 유지 확인\n모바일 확인 미실시" /></label><label>결과 또는 배포 주소<input name="resultUrl" type="url" required={modal === "deployment"} /></label><label>남은 문제와 다음 작업<textarea name="nextSteps" rows={3} /></label><p className="dev-field-help">이 양식은 이미 수행한 작업을 기록합니다. 저장으로 코드 배포가 실행되지는 않습니다.</p></>}
      </div><footer><button type="button" className="dev-button" disabled={saving} onClick={() => setModal(null)}>취소</button><button className="dev-button primary" disabled={saving || ((modal === "request" || modal === "edit") && !projects.length)}>{saving ? <><Loader2 className="dev-spin" size={14} /> 저장 중…</> : <><Check size={14} />{modal === "request" ? "요청 등록" : "저장"}</>}</button></footer></form>}</div></div>}
  </div>;
}
