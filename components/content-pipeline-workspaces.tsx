"use client";
import { ContentGenerationButton } from "./content-generation-button";
import { GENERATION_QUEUED_NOTICE, type GenerationMode } from "@/lib/content-generation-mode";

import { PageTitle } from "./page-title";

import { Check, CircleAlert, FileText, Plus, Search, Sparkles, Target, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDocument, createRecord, generateContent, getDocument, listDocumentFolders, listDocuments, listRecords, updateRecord } from "@/lib/api-client";
import { buildScriptDocumentInput, compareScriptDocuments, groupScriptVersions, isVisibleScript, matchesScriptStep, normalizeScriptRoot, scriptFileName, scriptProgress, SCRIPT_STEPS, SCRIPT_DOCUMENT_ROOT, SCRIPT_DOCUMENT_STATUSES, SCRIPT_FOLDER_NAME_LIMIT } from "@/lib/script-documents";
import { diffMarkdownLines, type LineChange } from "@/lib/line-diff";
import type { OsRecord } from "@/lib/record-types";
import type { KnowledgeDocument } from "@/lib/types";
import { ContentLinkedScripts } from "./content-linked-scripts";
import { useSession } from "./session-provider";

function value<T>(record: OsRecord | null | undefined, key: string, fallback: T): T {
  const found = record?.metadata?.[key];
  return found == null ? fallback : found as T;
}

function text(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }

const TOPIC_TABS = [
  ["channels", "1. 채널 모으기"], ["discovery", "2. 터진 영상 발굴"], ["niches", "3. 틈새 확정"],
] as const;

export function ContentTopicsWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [topics, setTopics] = useState<OsRecord[]>([]); const [plans, setPlans] = useState<OsRecord[]>([]);
  const [selectedId, setSelectedId] = useState(""); const [tab, setTab] = useState<(typeof TOPIC_TABS)[number][0]>("channels");
  const [query, setQuery] = useState(""); const [editorOpen, setEditorOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { if (demo) return; try { const [topicResult, packageResult] = await Promise.all([listRecords(accessToken, "content_topic", "limit=200"), listRecords(accessToken, "content_package", "limit=200")]); setTopics(topicResult.records); setPlans(packageResult.records.filter((item) => value<string>(item, "packageKind", "") === "topic_plan")); setSelectedId((current) => current || topicResult.records[0]?.id || ""); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "기획 자료를 불러오지 못했습니다."); } }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);
  const filtered = topics.filter((item) => !query || `${item.title} ${item.description} ${item.tags.join(" ")}`.toLocaleLowerCase("ko-KR").includes(query.toLocaleLowerCase("ko-KR")));
  const selected = topics.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  const plan = plans.find((item) => item.parent_id === selected?.id) ?? null;
  const result = value<Record<string, unknown>>(plan, "result", {});
  const candidates = Array.isArray(result.candidates) ? result.candidates as Array<Record<string, unknown>> : [];
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { const created = await createRecord(accessToken, { recordType: "content_topic", title: text(form, "title"), description: text(form, "problem"), status: "backlog", priority: "high", brand: text(form, "brand"), team: profile?.team || "콘텐츠", sourceUrl: text(form, "sourceUrl") || null, tags: text(form, "keywords").split(",").map((item) => item.trim()).filter(Boolean), metadata: { audience: text(form, "audience"), entryLanguage: text(form, "entryLanguage"), hierarchy: text(form, "hierarchy"), sourceChannel: text(form, "channel"), evidence: text(form, "evidence") } }); setEditorOpen(false); await load(); setSelectedId(created.record.id); setTab("niches"); } catch (reason) { setError(reason instanceof Error ? reason.message : "주제를 저장하지 못했습니다."); } finally { setBusy(false); } };
  const makePlan = async (mode: GenerationMode = "queue") => { if (!selected) return; setBusy(true); try { const response = await generateContent(accessToken, { mode, action: "topic_plan", sourceId: selected.id }); setError(response.queued ? GENERATION_QUEUED_NOTICE : ""); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "기획 브리핑을 만들지 못했습니다."); } finally { setBusy(false); } };
  const pick = async (index: number) => { if (!plan || !selected) return; const next = candidates.map((item, itemIndex) => ({ ...item, picked: itemIndex === index })); try { await Promise.all([updateRecord(accessToken, { id: plan.id, expectedVersion: plan.version, metadata: { ...plan.metadata, result: { ...result, candidates: next } } }), updateRecord(accessToken, { id: selected.id, expectedVersion: selected.version, status: "planned", stage: "기획확정", metadata: { ...selected.metadata, pickedCandidate: next[index], handoff: String(result.handoff ?? "") } })]); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "후보 채택을 저장하지 못했습니다."); } };
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>채널을 모으고 근거 영상을 탐색한 뒤, 회사 기획 정본으로 틈새와 다음 작업을 확정합니다.</p></div><button className="primary-button" onClick={() => setEditorOpen(true)}><Plus size={16} /> 탐색 후보 추가</button></header>
    {error ? <div className={`inline-alert ${error === GENERATION_QUEUED_NOTICE ? "success" : "danger"}`}><CircleAlert size={16} /> {error}</div> : null}
    <nav className="studio-tabs" aria-label="주제 기획 단계">{TOPIC_TABS.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "step" : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
    <section className="metric-grid compact-metrics"><div className="metric-card"><div className="metric-top"><span>탐색 후보</span><Target size={16} /></div><div className="metric-value">{topics.length}</div><div className="metric-caption">근거를 모으는 주제</div></div><div className="metric-card"><div className="metric-top"><span>기획 확정</span><Check size={16} /></div><div className="metric-value">{topics.filter((item) => item.status === "planned").length}</div><div className="metric-caption good">다음 공정 전달 가능</div></div><div className="metric-card"><div className="metric-top"><span>정본 브리핑</span><FileText size={16} /></div><div className="metric-value">{plans.length}</div><div className="metric-caption">AI 2패스 검수 포함</div></div></section>
    {tab === "channels" ? <section className="panel studio-manual"><h2>볼 채널과 발견 경로</h2><p>YouTube API 연결 전에는 영상 URL과 채널명을 후보로 저장합니다. 연결 후 같은 목록에서 조회수 대비 이상치와 반복 공식을 자동 수집합니다.</p><div className="procedure-chips"><span>시장 출발형</span><span>인사이트 출발형</span><span>본진 타깃 유지</span><span>근거 링크 필수</span></div></section> : null}
    {tab !== "channels" ? <section className="content-planning-layout"><aside className="panel source-list"><div className="records-toolbar"><div className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="주제·채널·키워드 검색" /></div></div>{filtered.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} aria-current={selected?.id === item.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}><span><strong>{item.title}</strong><small>{value(item, "sourceChannel", "직접 등록")} · {item.status === "planned" ? "기획 확정" : "근거 확인"}</small></span></button>)}{!filtered.length ? <div className="list-empty">탐색 후보가 없습니다.</div> : null}</aside><article className="panel planning-detail">{selected ? <><header><div><span className={`status-pill status-${selected.status}`}>{selected.status === "planned" ? "기획 확정" : "탐색 중"}</span><h2>{selected.title}</h2><p>{selected.description}</p></div><ContentGenerationButton className="primary-button" onGenerate={makePlan} disabled={busy}>{busy ? "정본 실행 중…" : "정본으로 후보 만들기"}</ContentGenerationButton></header><dl className="planning-facts"><div><dt>타깃</dt><dd>{value(selected, "audience", "미입력")}</dd></div><div><dt>입구 언어</dt><dd>{value(selected, "entryLanguage", "미입력")}</dd></div><div><dt>위계</dt><dd>{value(selected, "hierarchy", "미정")}</dd></div><div><dt>근거</dt><dd>{value(selected, "evidence", selected.source_url || "미입력")}</dd></div></dl>{candidates.length ? <div className="planning-candidates"><h3>제목·썸네일 출발 후보</h3>{candidates.map((candidate, index) => <article className={candidate.picked ? "picked" : ""} key={`${String(candidate.title)}-${index}`}><div><strong>{String(candidate.title ?? "제목 후보")}</strong><p>{String(candidate.thumbnailCopy ?? "")}</p><small>{String(candidate.narrative ?? candidate.evidence ?? "")}</small></div><button className="ghost-button" onClick={() => pick(index)}>{candidate.picked ? "★ 채택됨" : "☆ 채택"}</button></article>)}</div> : <div className="list-empty"><Sparkles size={20} /> 기획 정본을 실행하면 채택 가능한 후보와 HANDOFF가 생성됩니다.</div>}</> : null}</article></section> : null}
    {editorOpen ? <div className="drawer-backdrop" onMouseDown={() => !busy && setEditorOpen(false)}><form className="record-drawer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">탐색 입력</span><h2>새 주제 후보</h2></div><button type="button" className="icon-button" onClick={() => setEditorOpen(false)}><X size={18} /></button></div><label><span>주제</span><input name="title" required /></label><label><span>시청자가 겪는 현상·문제</span><textarea name="problem" required rows={4} /></label><div className="form-grid"><label><span>대표 시청자</span><input name="audience" placeholder="방향결핍형" /></label><label><span>콘텐츠 위계</span><select name="hierarchy"><option>유입형</option><option>전환형</option><option>판매형</option></select></label></div><label><span>검색되는 입구 언어</span><input name="entryLanguage" /></label><div className="form-grid"><label><span>채널명</span><input name="channel" /></label><label><span>브랜드</span><input name="brand" defaultValue="브랜디액션" /></label></div><label><span>근거·수치</span><textarea name="evidence" rows={3} /></label><label><span>근거 영상 URL</span><input type="url" name="sourceUrl" /></label><label><span>키워드</span><input name="keywords" placeholder="쉼표로 구분" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>취소</button><button className="primary-button" disabled={busy}>저장</button></div></form></div> : null}
  </>;
}

export function ContentScriptsWorkspace({ showPlanningHandoff = false, lockedSource }: { showPlanningHandoff?: boolean; lockedSource?:OsRecord } = {}) {
  const { accessToken, demo, profile } = useSession();
  const [root, setRoot] = useState(SCRIPT_DOCUMENT_ROOT);
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Omit<KnowledgeDocument, "content_md">[]>([]);
  const [folder, setFolder] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [reader, setReader] = useState<KnowledgeDocument | null>(null);
  const [readerError, setReaderError] = useState("");
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerRevision, setReaderRevision] = useState(0);
  const [versionDiff, setVersionDiff] = useState<{ olderId: string; latestId: string; changes: LineChange[] } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const listGeneration = useRef(0);
  const scopeGeneration = useRef(0);
  const saveInProgress = useRef(false);
  const editorRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    if (demo || !accessToken) { setLoading(false); return; }
    const generation = ++listGeneration.current;
    setLoading(true);
    setError("");
    try {
      const loaded: KnowledgeDocument[] = [];
      for (let offset = 0; ; offset += 200) {
        const result = await listDocuments(accessToken, `folder=${encodeURIComponent(root)}&statuses=${SCRIPT_DOCUMENT_STATUSES}&view=summary&limit=200&offset=${offset}`);
        if (generation !== listGeneration.current) return;
        loaded.push(...result.documents);
        if (loaded.length >= result.total || !result.documents.length) break;
      }
      const active = loaded.filter(isVisibleScript).sort(compareScriptDocuments);
      const grouped = active.filter((document) => document.folder !== root);
      setDocuments(active);
      const linked = lockedSource ? grouped.filter(document=>document.folder===lockedSource.metadata.scriptFolder || document.folder.split("/").at(-1)===lockedSource.title) : [];
      const linkedFolders = new Set(linked.map(document=>document.folder));
      setFolder((current) => lockedSource ? linkedFolders.size===1 ? linked[0].folder : "" : grouped.some((document) => document.folder === current) ? current : grouped[0]?.folder ?? "");
      setSelectedId((current) => {
        if (lockedSource && linkedFolders.size !== 1) return "";
        const candidates = lockedSource ? linked : grouped;
        if (candidates.some((document) => document.id === current)) return current;
        const preferredFolder = lockedSource ? linked[0]?.folder : grouped[0]?.folder;
        return groupScriptVersions(candidates.filter((document) => document.folder === preferredFolder))[0]?.latest.id ?? "";
      });
    } catch (reason) {
      if (generation === listGeneration.current) setError(reason instanceof Error ? reason.message : "원고 문서를 불러오지 못했습니다.");
    } finally {
      if (generation === listGeneration.current) setLoading(false);
    }
  }, [accessToken, demo, root, lockedSource]);

  useEffect(() => {
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem("os-script-document-root");
    if (saved) try { setRoot(normalizeScriptRoot(saved)); } catch { window.localStorage.removeItem("os-script-document-root"); }
    if (!demo && accessToken) void listDocumentFolders(accessToken).then(({ folders }) => setFolderOptions(folders)).catch(() => setFolderOptions([]));
  }, [accessToken, demo]);

  useEffect(() => {
    scopeGeneration.current += 1;
    setDocuments([]); setFolder(""); setSelectedId(""); setReader(null);
    setEditorOpen(false); setSaveError(""); setNotice("");
    saveInProgress.current = false; setSaving(false);
    return () => { scopeGeneration.current += 1; };
  }, [demo, profile?.id]);

  useEffect(() => {
    void load();
    return () => { listGeneration.current += 1; };
  }, [load]);

  const rootDocuments = useMemo(() => documents.filter((document) => document.folder === root), [documents, root]);
  const groupedDocuments = useMemo(() => documents.filter((document) => document.folder !== root), [documents, root]);
  const folders = useMemo(() => {
    const grouped = new Map<string, { name: string; count: number; updatedAt: string }>();
    for (const document of groupedDocuments) {
      const group = grouped.get(document.folder) ?? { name: document.folder, count: 0, updatedAt: "" };
      group.count += 1;
      if (document.updated_at > group.updatedAt) group.updatedAt = document.updated_at;
      grouped.set(document.folder, group);
    }
    return [...grouped.values()].map((group) => ({ ...group, progress: scriptProgress(groupedDocuments.filter((doc) => doc.folder === group.name)) })).sort((a, b) => Number(a.progress.published) - Number(b.progress.published) || b.name.localeCompare(a.name, "ko", { numeric: true }));
  }, [groupedDocuments]);
  const folderDocuments = useMemo(() => groupedDocuments.filter((document) => document.folder === folder).sort(compareScriptDocuments), [groupedDocuments, folder]);
  const visibleDocuments = useMemo(() => folderDocuments.filter(document => matchesScriptStep(document, stageFilter)), [folderDocuments, stageFilter]);
  const scriptGroups = useMemo(() => groupScriptVersions(visibleDocuments), [visibleDocuments]);
  const selected = visibleDocuments.find((document) => document.id === selectedId) ?? scriptGroups[0]?.latest ?? null;
  const selectedGroup = scriptGroups.find(group => group.documents.some(document => document.id === selected?.id));
  const readerId = selected?.id ?? "";
  const readerVersion = selected?.current_version;

  useEffect(() => {
    let active = true;
    setReader(null); setReaderError("");
    setVersionDiff(null); setDiffError(""); setDiffLoading(false);
    if (demo || !accessToken || !readerId) { setReaderLoading(false); return; }
    setReaderLoading(true);
    void getDocument(accessToken, readerId).then(({ document }) => {
      if (!active) return;
      if (document.status === "archived") throw new Error("보관된 원고입니다. 목록을 다시 불러와 주세요.");
      setReader(document);
    }).catch((reason) => {
      if (active) setReaderError(reason instanceof Error ? reason.message : "원고 본문을 불러오지 못했습니다.");
    }).finally(() => { if (active) setReaderLoading(false); });
    return () => { active = false; };
  }, [accessToken, demo, readerId, readerVersion, readerRevision]);

  const compareWithLatest = async () => {
    if (!accessToken || !reader || reader.id !== selected?.id || !selectedGroup || selectedGroup.latest.id === reader.id) return;
    setDiffLoading(true); setDiffError("");
    try {
      const { document: latest } = await getDocument(accessToken, selectedGroup.latest.id);
      setVersionDiff({ olderId: reader.id, latestId: latest.id, changes: diffMarkdownLines(reader.content_md || "", latest.content_md || "") });
    } catch (reason) {
      setDiffError(reason instanceof Error ? reason.message : "버전 비교를 불러오지 못했습니다.");
    } finally { setDiffLoading(false); }
  };

  useEffect(() => {
    if (!editorOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    editorRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saveInProgress.current) { event.preventDefault(); setEditorOpen(false); }
      if (event.key !== "Tab") return;
      const elements = editorRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])');
      const first = elements?.[0]; const last = elements?.[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [editorOpen]);

  const openEditor = () => { setSaveError(""); setNotice(""); setEditorOpen(true); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveInProgress.current) return;
    if (demo || !accessToken) { setSaveError("로그인한 운영 환경에서 원고를 저장할 수 있습니다."); return; }
    const form = new FormData(event.currentTarget);
    const scope = scopeGeneration.current;
    saveInProgress.current = true; setSaving(true); setSaveError("");
    try {
      const input = buildScriptDocumentInput({ title: text(form, "title"), folderName: text(form, "folderName"), content: text(form, "content"), root });
      const { document } = await createDocument(accessToken, input);
      if (scope !== scopeGeneration.current) return;
      // The successful response is authoritative. Do not turn a later list
      // refresh failure into an apparent save failure and invite duplicate saves.
      listGeneration.current += 1;
      setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
      setFolder(document.folder); setSelectedId(document.id); setLoading(false);
      setEditorOpen(false); setNotice("개인 초안으로 저장했습니다. 지식에서 이어서 편집할 수 있습니다.");
    } catch (reason) {
      if (scope === scopeGeneration.current) setSaveError(reason instanceof Error ? reason.message : "원고를 저장하지 못했습니다.");
    } finally {
      if (scope === scopeGeneration.current) { saveInProgress.current = false; setSaving(false); }
    }
  };

  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>영상별 원고를 만들고 모아봅니다. 수정 내역과 공유 상태는 지식 작업공간에서 관리합니다.</p></div><div className="header-actions">{selected ? <a className="secondary-button" href={`/knowledge?document=${encodeURIComponent(selected.id)}`}><FileText size={15} /> 지식에서 편집</a> : null}<button className="primary-button" onClick={openEditor} disabled={demo || !accessToken}><Plus size={16} /> 새 원고 작성</button></div></header>
    {demo ? <div className="inline-alert" role="status">데모에서는 원고를 저장할 수 없습니다. 로그인한 운영 환경에서 작성해 주세요.</div> : null}
    {error ? <div className={`inline-alert ${error === GENERATION_QUEUED_NOTICE ? "success" : "danger"}`} role="alert"><CircleAlert size={16} /> {error}<button className="ghost-button" onClick={() => void load()} disabled={loading}>다시 불러오기</button></div> : null}
    {notice ? <div className="inline-alert" role="status"><Check size={16} /> {notice}</div> : null}
    <ContentLinkedScripts showPlanningHandoff={showPlanningHandoff} lockedSourceId={lockedSource?.id} />
    {lockedSource && !loading && !folder ? <p className="inline-alert" role="status">이 영상과 연결된 문서 폴더가 없습니다. 아래에서 폴더를 선택하거나 새 원고를 작성하세요. 연결된 기획 원고는 위 공정에서 확인할 수 있습니다.</p> : null}
    <nav className="script-stage-filter" aria-label="원고 공정 산출물"><span>단계</span>{["all", ...SCRIPT_STEPS].map(step => <button type="button" key={step} aria-pressed={stageFilter === step} onClick={() => { setStageFilter(step); setSelectedId(""); }}>{step === "all" ? "전체" : step === "축" ? "축 확정" : step}<b>{loading ? "…" : folderDocuments.filter(document => matchesScriptStep(document, step)).length}</b></button>)}<span>선택한 영상 폴더 · 파일명 기준, 승인 여부 별도</span></nav>
    <section className="script-layout scripts-document-layout">
      <aside className="panel source-list script-folder-list"><div className="panel-header"><div><h2>영상 폴더</h2><p>{folders.length}개 작업 묶음 · 묶음 안 문서 {groupedDocuments.length}개</p></div><button className="ghost-button" onClick={() => void load()} disabled={loading || demo || !accessToken}>새로고침</button></div>
        <form className="script-root-picker" onSubmit={(event) => { event.preventDefault(); try { const next = normalizeScriptRoot(String(new FormData(event.currentTarget).get("root") ?? "")); window.localStorage.setItem("os-script-document-root", next); setError(""); setRoot(next); } catch (cause) { setError(cause instanceof Error ? cause.message : "기준 폴더를 확인해 주세요."); } }}>
          <label><span>기준 폴더</span><input name="root" list="script-root-options" defaultValue={root} key={root} maxLength={160} aria-label="원고 기준 폴더" /></label>
          <datalist id="script-root-options">{folderOptions.map((option) => <option key={option} value={option} />)}</datalist>
          <button className="secondary-button">적용</button>
        </form>
        {rootDocuments.length ? <p className="p2-caption">기준 폴더 바로 아래 문서 {rootDocuments.length}개는 영상 작업 묶음에서 제외됩니다. 해당 문서는 지식 작업공간에서 관리합니다.</p> : null}
        {folders.map((item) => <button key={item.name} className={folder === item.name ? "active" : ""} aria-current={folder === item.name ? "true" : undefined} onClick={() => { setFolder(item.name); setSelectedId(""); }}><span><strong>{item.name.replace(`${root}/`, "") || "원고"}</strong><small>{item.progress.published ? "발행 자료 있음" : "진행 중"} · 문서 {item.count}개 · 최근 {new Date(item.updatedAt).toLocaleString("ko-KR")}</small><span className="script-progress-dots" role="img" aria-label={SCRIPT_STEPS.map((stage,index) => `${stage} ${item.progress.completed[index] ? "파일 있음" : "파일 없음"}`).join(", ")}>{SCRIPT_STEPS.map((stage,index) => <i key={stage} data-present={item.progress.completed[index]} title={`${stage} · ${item.progress.completed[index] ? "파일 있음" : "파일 없음"}`} aria-hidden="true" />)}</span></span></button>)}
        {!folders.length ? <div className="list-empty" role="status">{loading ? "원고 목록을 불러오는 중입니다." : error ? "목록을 다시 불러와 주세요." : "아직 작성한 원고가 없습니다."}</div> : null}
      </aside>
      <article className="panel script-detail script-document-reader">{selected ? <>
        <header><div><span className={`status-pill status-${selected.status}`}>{selected.status === "canonical" ? "회사 정본" : selected.status === "team" ? "팀 공유" : selected.status === "reviewed" ? "검토 완료" : selected.status === "review" ? "검토 요청" : "개인 초안"}</span><h2>{selected.title}</h2><p>{selected.folder} · 최근 수정 {new Date(selected.updated_at).toLocaleString("ko-KR")}</p>{selected.status === "review" ? <p className="inline-alert warning">원고 검토·승인 대기 중입니다. 패키징·축·설계표는 승인 결과를 확인한 뒤 다음 단계로 진행해 주세요.</p> : null}</div><span className="count-badge">v{selected.current_version}</span></header>
        <nav aria-label="원고 파일">{scriptGroups.map(group => group.documents.length > 1 ? <details key={group.key} className="script-version-family" open={group.documents.some(document => document.id === selected.id)}><summary>{group.label} <small>{group.documents.length}개 · 최신 {scriptFileName(group.latest)}</small></summary><div>{group.documents.map(document => <button key={document.id} className={selected.id === document.id ? "active" : ""} aria-current={selected.id === document.id ? "true" : undefined} onClick={() => setSelectedId(document.id)}>{scriptFileName(document)}</button>)}</div></details> : <button key={group.key} className={selected.id === group.latest.id ? "active" : ""} aria-current={selected.id === group.latest.id ? "true" : undefined} onClick={() => setSelectedId(group.latest.id)}>{scriptFileName(group.latest)}</button>)}</nav>
        {reader && selectedGroup && selectedGroup.documents.length > 1 && selectedGroup.latest.id !== selected.id ? <div className="script-compare-toolbar"><span>이전 파일을 보는 중입니다.</span><button type="button" className="secondary-button" disabled={diffLoading || reader.id !== selected.id} onClick={() => void compareWithLatest()}>{diffLoading ? "비교 중…" : "최신 파일과 비교"}</button></div> : null}
        {diffError ? <p className="inline-alert danger" role="alert">{diffError}</p> : null}
        {versionDiff && versionDiff.olderId === selected.id && versionDiff.latestId === selectedGroup?.latest.id ? <section className="script-version-diff" aria-label="최신 파일과 줄별 비교"><header><strong>최신 파일과 비교</strong><button type="button" className="ghost-button" onClick={() => setVersionDiff(null)}>닫기</button></header><div>{versionDiff.changes.map((change, index) => <div key={index} className={`script-diff-${change.kind}`}><span aria-hidden="true">{change.kind === "added" ? "+" : change.kind === "removed" ? "−" : " "}</span><span>{change.oldLine ?? ""}</span><span>{change.newLine ?? ""}</span><code>{change.text || " "}</code></div>)}</div></section> : null}
        {readerError ? <div className={`inline-alert ${error === GENERATION_QUEUED_NOTICE ? "success" : "danger"}`} role="alert">{readerError}<button className="ghost-button" onClick={() => setReaderRevision((current) => current + 1)}>다시 불러오기</button></div> : readerLoading || reader?.id !== selected.id ? <div className="list-empty" role="status">본문을 불러오는 중입니다.</div> : <pre>{reader.content_md || "아직 본문이 없습니다. 지식에서 내용을 작성해 주세요."}</pre>}
      </> : <div className="empty-state"><div><FileText /><h3>{loading ? "원고를 불러오는 중입니다" : stageFilter !== "all" ? "이 단계의 원고가 없습니다" : "첫 원고를 작성해 보세요"}</h3><p>{stageFilter !== "all" ? "다른 단계 또는 전체를 선택해 보세요. 기존 문서는 변경되지 않습니다." : "제목과 영상 폴더명을 정하면 원고 작업을 시작할 수 있습니다."}</p><button className="primary-button" onClick={openEditor} disabled={demo || !accessToken}><Plus size={16} /> 새 원고 작성</button></div></div>}</article>
    </section>
    {editorOpen ? <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saveInProgress.current) setEditorOpen(false); }}><form ref={editorRef} className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="script-create-title" onSubmit={submit}>
      <div className="drawer-head"><div><span className="eyebrow">개인 초안</span><h2 id="script-create-title">새 원고 작성</h2></div><button type="button" className="icon-button" aria-label="원고 작성 닫기" disabled={saving} onClick={() => setEditorOpen(false)}><X size={18} /></button></div>
      <label><span>원고 제목</span><input name="title" required maxLength={200} placeholder="예: 도입부 초안" disabled={saving} /></label>
      <label><span>영상 폴더명</span><input name="folderName" required maxLength={SCRIPT_FOLDER_NAME_LIMIT} placeholder="예: 2026-09 나에게 맞는 일 찾기" disabled={saving} defaultValue={folder.startsWith(`${root}/`) && !folder.slice(root.length + 1).includes("/") ? folder.slice(root.length + 1) : ""} /></label>
      <label><span>원고 본문</span><textarea name="content" rows={14} maxLength={1_500_000} disabled={saving} placeholder="본문을 입력하세요. 비워두면 핵심 메시지·도입·본문·마무리 순서의 기본 틀을 만듭니다." /></label>
      {saveError ? <div className={`inline-alert ${error === GENERATION_QUEUED_NOTICE ? "success" : "danger"}`} role="alert">{saveError}</div> : null}
      <div className="drawer-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setEditorOpen(false)}>취소</button><button className="primary-button" disabled={saving || demo || !accessToken}>{saving ? "저장 중…" : "개인 초안 저장"}</button></div>
    </form></div> : null}
  </>;
}
