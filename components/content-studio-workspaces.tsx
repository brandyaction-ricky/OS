"use client";

import Link from "next/link";
import { PageTitle } from "./page-title";

import { CheckCircle2, CircleAlert, Clipboard, ExternalLink, Film, PackageCheck, Pencil, Play, Save, Scissors, Search, Sparkles, UploadCloud, Youtube } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, completeYoutubeUpload, createRecord, createYoutubeUploadSession, generateContent, getYoutubeOAuthStatus, listAllRecordsOfType, listRecords, searchYoutubeMarket, updateRecord, uploadYoutubeFile, type YoutubeMarketItem, type YoutubeOAuthStatus } from "@/lib/api-client";
import type { ReleaseWorkflowState } from "@/lib/content-release-workflow";
import { sanitizePublicCopyValue } from "@/lib/content-safety";
import { normalizeYoutubeKitCopy } from "@/lib/content-input";
import { finalizeYoutubeUpload, type PendingYoutubeCompletion } from "@/lib/youtube-upload-flow";
import type { OsRecord } from "@/lib/record-types";
import { filterContentOrigin, sourceSelection, type ContentOriginFilter as OriginFilter } from "@/lib/content-origin";
import { ContentOriginFilter } from "./content-origin-filter";
import { useSession } from "./session-provider";

function metadata<T>(record: OsRecord | null | undefined, key: string, fallback: T): T {
  const value = record?.metadata?.[key]; return value == null ? fallback : value as T;
}

function SourcePicker({ sources, value, onChange }: { sources: OsRecord[]; value: string; onChange: (value: string) => void }) {
  return <select aria-label="기준 콘텐츠 선택" value={value} onChange={(event) => onChange(event.target.value)}><option value="">기준 콘텐츠 선택</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select>;
}

function CandidateList({ title, items, onPick }: { title: string; items: Array<Record<string, unknown>>; onPick?: (index: number) => void }) {
  return <section className="panel candidate-panel"><div className="panel-header"><div><h2>{title}</h2><p>{items.length}개 후보 · 별표 항목은 저장 후보</p></div></div>{items.length ? <div className="candidate-list">{items.map((item, index) => <article className={item.picked ? "picked" : ""} key={`${String(item.text ?? item)}-${index}`}><span>{index + 1}</span><div><strong>{String(item.text ?? item)}</strong>{item.why ? <p>{String(item.why)}</p> : null}{item.hook ? <small>{String(item.hook)}</small> : null}</div>{onPick ? <button type="button" className="candidate-pick" aria-pressed={Boolean(item.picked)} onClick={() => onPick(index)}>{item.picked ? "★ 채택됨" : "☆ 채택"}</button> : <em>{item.picked ? "★" : "☆"}</em>}</article>)}</div> : <div className="list-empty"><Sparkles size={20} /><span>정본으로 후보를 생성하면 여기에 표시됩니다.</span></div>}</section>;
}

export function ContentPackageWorkspace() {
  const { accessToken, demo } = useSession();
  const [allSources, setSources] = useState<OsRecord[]>([]);
  const [origin, setOrigin] = useState<OriginFilter>("own");
  const sources = filterContentOrigin(allSources, origin); const [packages, setPackages] = useState<OsRecord[]>([]);
  const [sourceId, setSourceId] = useState(""); const [tab, setTab] = useState<"search" | "title" | "thumbnail" | "saved">("search");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [marketQuery, setMarketQuery] = useState(""); const [marketBusy, setMarketBusy] = useState(false); const [marketResults, setMarketResults] = useState<YoutubeMarketItem[]>([]);
  const load = useCallback(async () => { if (demo) return; try { const [sourceResult, packageResult] = await Promise.all([listAllRecordsOfType(accessToken, "content_topic").then(records => ({ records })), listRecords(accessToken, "content_package", "limit=200")]); setSources(sourceResult.records); setPackages(packageResult.records.filter((item) => metadata<string>(item, "packageKind", "") === "title_package")); setSourceId((current) => sourceSelection(sourceResult.records, current, new URLSearchParams(window.location.search).get("sourceId") ?? ""));  } catch (reason) { setError(reason instanceof Error ? reason.message : "패키징 자료를 불러오지 못했습니다."); } }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);
  const latest = packages.find((item) => item.parent_id === sourceId) ?? null; const result = metadata<Record<string, unknown>>(latest, "result", {});
  const titles = Array.isArray(result.titles) ? result.titles as Array<Record<string, unknown>> : [];
  const copies = Array.isArray(result.copies) ? result.copies as Array<Record<string, unknown>> : [];
  const prompts = Array.isArray(result.designPrompts) ? result.designPrompts.map((text) => ({ text })) : [];
  const generate = async () => { if (!sourceId) return; setBusy(true); try { const response = await generateContent(accessToken, { action: "title_package", sourceId, marketEvidence: marketResults.map(({ title, channelTitle, viewCount, url }) => ({ title, channelTitle, viewCount, url })) }); setError(response.queued ? "Claude 연결 대기 작업으로 저장했습니다." : ""); await load(); if (!response.queued) setTab("title"); } catch (reason) { setError(reason instanceof Error ? reason.message : "후보를 생성하지 못했습니다."); } finally { setBusy(false); } };
  const searchMarket = async () => { const query = marketQuery.trim() || sources.find((source) => source.id === sourceId)?.title || ""; if (query.length < 2) return setError("시장 검색어를 두 글자 이상 입력해 주세요."); setMarketBusy(true); setError(""); try { const response = await searchYoutubeMarket(accessToken, query); setMarketResults(response.items); if (!response.items.length) setError("검색된 시장 영상이 없습니다. 검색어를 더 넓혀보세요."); } catch (reason) { setError(reason instanceof Error ? reason.message : "시장 영상을 검색하지 못했습니다."); } finally { setMarketBusy(false); } };
  const pick = async (kind: "titles" | "copies", index: number) => { if (!latest) return; const items = kind === "titles" ? titles : copies; const next = items.map((item, itemIndex) => ({ ...item, picked: itemIndex === index ? !item.picked : item.picked })); try { await updateRecord(accessToken, { id: latest.id, expectedVersion: latest.version, metadata: { ...latest.metadata, result: { ...result, [kind]: next } } }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "채택 상태를 저장하지 못했습니다."); } };
  return <><header className="page-header"><div className="page-title-group"><PageTitle /><p>시장 근거와 회사 패키징 정본으로 제목·카피·디자인 프롬프트를 만듭니다. 이미지는 생성하지 않습니다.</p></div><div className="header-actions"><ContentOriginFilter value={origin} onChange={value => { setOrigin(value); setSourceId(""); }} /><SourcePicker sources={sources} value={sourceId} onChange={setSourceId} /><button className="primary-button" disabled={!sourceId || busy} onClick={generate}><Sparkles size={15} /> {busy ? "정본 실행 중…" : "이 콘텐츠로 만들기"}</button></div></header>{error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}<nav className="studio-tabs" aria-label="제목·썸네일 작업 단계">{[["search", "1. 검색"], ["title", "2. 제목"], ["thumbnail", "3. 썸네일"], ["saved", "★ 저장함"]].map(([key, label]) => <button className={tab === key ? "active" : ""} aria-current={tab === key ? "step" : undefined} key={key} onClick={() => setTab(key as typeof tab)}>{label}</button>)}</nav>{tab === "search" ? <><section className="panel studio-manual"><PackageCheck size={28} /><h2>시장 근거 → 정본 실행 → 후보 채택</h2><p>YouTube에서 실제로 조회된 제목·썸네일을 모은 뒤 그 근거를 Claude와 패키징 정본에 함께 전달합니다.</p><div className="market-search"><input value={marketQuery} onChange={(event) => setMarketQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") searchMarket(); }} placeholder="시장 검색어 · 비워두면 선택한 주제 제목" /><button className="secondary-button" disabled={marketBusy} onClick={searchMarket}><Search size={15} /> {marketBusy ? "검색 중…" : "YouTube 시장 검색"}</button></div><div className="procedure-chips"><span>과장 금지</span><span>실제 약속만</span><span>일상어</span><span>이미지 생성 안 함</span></div></section>{marketResults.length ? <section className="market-video-grid">{marketResults.map((item) => <a className="panel market-video" href={item.url} target="_blank" rel="noreferrer" key={item.id}><span className="market-thumb" style={{ backgroundImage: `url(${item.thumbnail})` }} /><span><strong>{item.title}</strong><small>{item.channelTitle} · 조회 {item.viewCount.toLocaleString("ko-KR")}</small></span><ExternalLink size={13} /></a>)}</section> : null}</> : null}{tab === "title" ? <CandidateList title="제목 후보" items={titles} onPick={(index) => pick("titles", index)} /> : null}{tab === "thumbnail" ? <div className="studio-two"><CandidateList title="썸네일 카피" items={copies} onPick={(index) => pick("copies", index)} /><CandidateList title="디자인 프롬프트" items={prompts} /></div> : null}{tab === "saved" ? <div className="studio-two"><CandidateList title="저장한 제목" items={titles.filter((item) => item.picked)} /><CandidateList title="저장한 썸네일 카피" items={copies.filter((item) => item.picked)} /></div> : null}</>;
}

export function ContentShortsWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [allSources, setSources] = useState<OsRecord[]>([]);
  const [origin, setOrigin] = useState<OriginFilter>("own");
  const sources = filterContentOrigin(allSources, origin); const [clips, setClips] = useState<OsRecord[]>([]); const [sourceId, setSourceId] = useState("");
  const [count, setCount] = useState(5); const [reframe, setReframe] = useState("pad"); const [captions, setCaptions] = useState(false); const [tighten, setTighten] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { if (demo) return; try { const [sourceResult, clipResult] = await Promise.all([listAllRecordsOfType(accessToken, "content_topic").then(records => ({ records })), listRecords(accessToken, "content_short", "limit=200")]); setSources(sourceResult.records); setClips(clipResult.records); setSourceId((current) => sourceSelection(sourceResult.records, current, new URLSearchParams(window.location.search).get("sourceId") ?? ""));  } catch (reason) { setError(reason instanceof Error ? reason.message : "숏폼 작업을 불러오지 못했습니다."); } }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);
  const visible = clips.filter((clip) => clip.parent_id === sourceId); const selected = visible.filter((clip) => metadata(clip, "selected", true));
  const propose = async () => { if (!sourceId) return; setBusy(true); try { const response = await generateContent(accessToken, { action: "shorts_proposal", sourceId, count }); setError(response.queued ? "Claude 연결 대기 작업으로 저장했습니다." : ""); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "쇼츠 구간을 제안하지 못했습니다."); } finally { setBusy(false); } };
  const toggle = async (clip: OsRecord) => { try { await updateRecord(accessToken, { id: clip.id, expectedVersion: clip.version, metadata: { ...clip.metadata, selected: !metadata(clip, "selected", true) } }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "채택 상태를 저장하지 못했습니다."); } };
  const requestRender = async () => { if (!selected.length) return; setBusy(true); try { for (const clip of selected) await updateRecord(accessToken, { id: clip.id, expectedVersion: clip.version, status: "ready", stage: "제작대기", progress: 45, metadata: { ...clip.metadata, reframe, captions, tighten, renderState: "queued" } }); await createRecord(accessToken, { recordType: "ai_job", title: `[숏폼 제작] ${sources.find((source) => source.id === sourceId)?.title ?? "원본"}`, description: `승인된 ${selected.length}개 구간을 ffmpeg 워커에서 제작합니다.`, status: "backlog", priority: "high", team: profile?.team || "콘텐츠", parentId: sourceId, metadata: { contentAction: "shorts_render", sourceId, clipIds: selected.map((clip) => clip.id), reframe, captions, tighten }, tags: ["숏폼", "렌더", "승인완료"] }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "제작 작업을 등록하지 못했습니다."); } finally { setBusy(false); } };
  return <><header className="page-header"><div className="page-title-group"><PageTitle /><p>먼저 구간만 제안하고 사람이 채택한 구간만 워커에서 렌더합니다. 기본 세로 화면은 원본을 자르지 않는 pad입니다.</p></div><div className="header-actions"><ContentOriginFilter value={origin} onChange={value => { setOrigin(value); setSourceId(""); }} /><SourcePicker sources={sources} value={sourceId} onChange={setSourceId} /><input type="number" min="1" max="12" value={count} onChange={(event) => setCount(Number(event.target.value))} /><button className="primary-button" disabled={!sourceId || busy} onClick={propose}><Scissors size={15} /> 구간 제안</button></div></header>{error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}<section className="panel shorts-controls"><div><label>세로 화면<select value={reframe} onChange={(event) => setReframe(event.target.value)}><option value="pad">전체 보존 · 흐린 배경</option><option value="top">상단 확대 · 아래 여백</option><option value="crop">중앙 크롭 · 예외</option></select></label><label><input type="checkbox" checked={captions} onChange={(event) => setCaptions(event.target.checked)} /> 자동 자막 넣기</label><label><input type="checkbox" checked={tighten} onChange={(event) => setTighten(event.target.checked)} /> 무음 줄이기</label></div><button className="primary-button" disabled={!selected.length || busy} onClick={requestRender}><Play size={15} /> 채택 {selected.length}개 제작 요청</button></section><section className="clip-proposals">{visible.map((clip) => <article className={`panel clip-proposal ${metadata(clip, "selected", true) ? "selected" : ""}`} key={clip.id}><header><button onClick={() => toggle(clip)}>{metadata(clip, "selected", true) ? "✓ 채택" : "＋ 채택"}</button><span className={`status-pill status-${clip.status}`}>{clip.stage || clip.status}</span></header><h3>{clip.title}</h3><p>{clip.description}</p><div><span>{Number(metadata(clip, "start", 0)).toFixed(1)}초</span><span>→</span><span>{Number(metadata(clip, "end", 0)).toFixed(1)}초</span></div><small>{metadata<string>(clip, "renderState", "not_started") === "queued" ? "워커 제작 대기" : "렌더 전 제안"}</small></article>)}{!visible.length ? <div className="panel empty-state"><div><span><Film /></span><h3>제안된 구간이 없습니다.</h3><p>원본을 선택하고 구간 제안을 실행하세요. 렌더링은 아직 시작되지 않습니다.</p></div></div> : null}</section></>;
}

const KIT_FIELDS = [["title", "영상 제목"], ["description", "유튜브 설명"], ["tags", "태그"], ["chapters", "챕터"], ["pinnedComment", "고정 댓글"], ["kakao", "카카오톡"], ["cafe", "네이버 카페"], ["post", "게시글"], ["checklist", "업로드 체크리스트"]] as const;

export function YoutubeKitWorkspace({lockedSource}:{lockedSource?:OsRecord} = {}) {
  const { accessToken, demo } = useSession();
  const [allSources, setSources] = useState<OsRecord[]>(lockedSource?[lockedSource]:[]);
  const [origin, setOrigin] = useState<OriginFilter>("own");
  const sources = lockedSource ? allSources.filter(row=>row.id===lockedSource.id) : filterContentOrigin(allSources, origin); const [kits, setKits] = useState<OsRecord[]>([]); const [sourceId, setSourceId] = useState(lockedSource?.id??"");
  const [oauth, setOauth] = useState<YoutubeOAuthStatus | null>(null); const [file, setFile] = useState<File | null>(null); const [privacy, setPrivacy] = useState<"private" | "unlisted">("private");
  const [pipeline, setPipeline] = useState<{ source: OsRecord; approved: boolean[]; release: ReleaseWorkflowState } | null>(null);
  const [releaseNote, setReleaseNote] = useState(""); const [scheduledAt, setScheduledAt] = useState(""); const [uploadProgress, setUploadProgress] = useState(0); const [uploadedUrl, setUploadedUrl] = useState("");
  const [pendingCompletions, setPendingCompletions] = useState<Record<string, PendingYoutubeCompletion | null>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [copied, setCopied] = useState(""); const [editing, setEditing] = useState(false); const [draft, setDraft] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [sourceResult, packageResult, oauthResult] = await Promise.all([listAllRecordsOfType(accessToken, "content_topic").then(records => ({ records })), listRecords(accessToken, "content_package", "limit=200"), getYoutubeOAuthStatus(accessToken)]);
      setSources(sourceResult.records); setKits(packageResult.records.filter((item) => metadata<string>(item, "packageKind", "") === "youtube_kit")); setOauth(oauthResult);
      setSourceId((current) => lockedSource ? (sourceResult.records.some(row=>row.id===lockedSource.id)?lockedSource.id:"") : sourceSelection(sourceResult.records, current, new URLSearchParams(window.location.search).get("sourceId") ?? ""));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "유튜브 발행 정보를 불러오지 못했습니다."); }
  }, [accessToken, demo, lockedSource]);
  useEffect(() => { load(); }, [load]);
  const loadPipeline = useCallback(async () => {
    if (!sourceId || demo) { setPipeline(null); return; }
    setPipeline(await apiRequest<{ source: OsRecord; approved: boolean[]; release: ReleaseWorkflowState }>(`/api/v1/content/pipeline?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken }));
  }, [accessToken, demo, sourceId]);
  useEffect(() => { loadPipeline().catch((reason) => setError(reason instanceof Error ? reason.message : "발행 승인 상태를 불러오지 못했습니다.")); }, [loadPipeline]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("youtube");
    if (result === "connected") setUploadedUrl("");
    if (result === "denied") setError("Google 채널 연결이 취소되었습니다.");
    if (result === "failed") setError("Google 채널 연결을 완료하지 못했습니다. OAuth 설정과 클라이언트 시크릿을 확인해 주세요.");
    if (result) { const query=new URLSearchParams(window.location.search);query.delete("youtube");window.history.replaceState(null,"",`${window.location.pathname}?${query}`); }
  }, []);
  const kit = kits.find((item) => item.parent_id === sourceId) ?? null; const result = metadata<Record<string, unknown>>(kit, "result", {});
  const pendingCompletion = kit ? pendingCompletions[kit.id] ?? null : null;
  const kitIsStale = Boolean(kit && metadata<number>(kit, "rulesVersion", 0) < 4);
  const previousUpload = metadata<Record<string, string>>(kit, "youtubeUpload", {});
  useEffect(() => { const stored = metadata<Record<string, unknown>>(kit, "result", {}); const next: Record<string, string> = {}; for (const [key] of KIT_FIELDS) { const value = stored[key]; next[key] = Array.isArray(value) ? value.join("\n") : String(value ?? ""); } setDraft(next); setEditing(false); setFile(null); setUploadProgress(0); setUploadedUrl(""); }, [kit]);
  const generate = async () => { if (!sourceId || (kit && !window.confirm("현재 원고와 절차로 새 발행 키트를 만들까요? 기존 키트는 이력으로 남습니다."))) return; setBusy(true); try { const response = await generateContent(accessToken, { action: "youtube_kit", sourceId }); setError(response.queued ? "Claude 연결 대기 작업으로 저장했습니다." : ""); await Promise.all([load(), loadPipeline()]); } catch (reason) { setError(reason instanceof Error ? reason.message : "발행 키트를 만들지 못했습니다."); } finally { setBusy(false); } };
  const toggleChecklist = async (index: number) => { if (!kit) return; setBusy(true); setError(""); try { const checked = metadata<number[]>(kit, "checkedItems", []); await updateRecord(accessToken, { id: kit.id, expectedVersion: kit.version, metadata: { ...kit.metadata, checkedItems: checked.includes(index) ? checked.filter((item) => item !== index) : [...checked, index] } }); await Promise.all([load(), loadPipeline()]); } catch (reason) { setError(reason instanceof Error ? reason.message : "체크리스트를 저장하지 못했습니다."); } finally { setBusy(false); } };
  const copy = async (key: string, value: unknown) => { await navigator.clipboard.writeText(Array.isArray(value) ? value.join("\n") : String(value ?? "")); setCopied(key); setTimeout(() => setCopied(""), 1200); };
  const save = async () => { if (!kit) return; setBusy(true); setError(""); try { const cleaned = sanitizePublicCopyValue({ ...result, ...Object.fromEntries(KIT_FIELDS.map(([key]) => [key, ["tags", "chapters", "checklist"].includes(key) ? draft[key].split("\n").map((line) => line.trim()).filter(Boolean) : draft[key]])) }) as Record<string, unknown>; const next = normalizeYoutubeKitCopy(cleaned); await updateRecord(accessToken, { id: kit.id, expectedVersion: kit.version, metadata: { ...kit.metadata, result: next, rulesVersion: 4, checkedItems: [] } }); await Promise.all([load(), loadPipeline()]); setEditing(false); } catch (reason) { setError(reason instanceof Error ? reason.message : "발행 키트를 저장하지 못했습니다."); } finally { setBusy(false); } };
  const saveRelease = async () => {
    if (!pipeline || !oauth?.channelId) return;
    setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/content/pipeline", { method: "POST", token: accessToken, body: JSON.stringify({ operation: "release_plan", sourceId, expectedVersion: pipeline.source.version, channelId: oauth.channelId, channelTitle: oauth.channelTitle ?? "YouTube 채널", privacyStatus: privacy, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : "" }) });
      await loadPipeline();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "발행 조건을 저장하지 못했습니다."); } finally { setBusy(false); }
  };
  const decideRelease = async (approved: boolean) => {
    if (!pipeline) return;
    setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/content/pipeline", { method: "POST", token: accessToken, body: JSON.stringify({ operation: "release_review", sourceId, expectedVersion: pipeline.source.version, signature: pipeline.release.signature, approved, note: releaseNote }) });
      setReleaseNote(""); await loadPipeline();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "발행 승인을 저장하지 못했습니다."); } finally { setBusy(false); }
  };
  const releaseMatches = Boolean(pipeline?.release.approved && pipeline.release.plan?.channelId === oauth?.channelId && pipeline.release.plan?.privacyStatus === privacy);
  const upload = async () => {
    if (!kit || (!pendingCompletion && (!file || !releaseMatches)) || !oauth?.connected || busy) return;
    setBusy(true); setError(""); setUploadedUrl(""); setUploadProgress(0);
    try {
      const completed = await finalizeYoutubeUpload({
        kitId: kit.id, privacyStatus: privacy, pending: pendingCompletion,
        upload: async () => {
          if (!file) throw new Error("업로드할 영상을 선택해 주세요.");
          const session = await createYoutubeUploadSession(accessToken, { kitId: kit.id, fileName: file.name, fileSize: file.size, mimeType: file.type || "video/mp4", privacyStatus: privacy, finalApproval: true });
          return uploadYoutubeFile(session.uploadUrl, file, setUploadProgress);
        },
        complete: (input) => completeYoutubeUpload(accessToken, input),
        remember: (pending) => setPendingCompletions((current) => ({ ...current, [kit.id]: pending })),
      });
      setUploadedUrl(completed.videoUrl); setFile(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "YouTube 업로드를 완료하지 못했습니다."); } finally { setBusy(false); }
  };
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>정본으로 발행 키트를 만든 뒤 관리자 승인으로 연결 채널에 비공개 또는 일부공개 업로드합니다.</p></div><div className="header-actions">{!lockedSource ? <ContentOriginFilter value={origin} onChange={value => { setOrigin(value); setSourceId(""); }} /> : null}<SourcePicker sources={sources} value={sourceId} onChange={setSourceId} />{kit ? editing ? <button className="primary-button" disabled={busy} onClick={save}><Save size={15} /> 수정 저장</button> : <button className="secondary-button" onClick={() => setEditing(true)}><Pencil size={15} /> 키트 수정</button> : null}<button className="primary-button" disabled={!sourceId || busy} onClick={generate}><Youtube size={15} /> {busy ? "처리 중…" : kit ? "발행 키트 재생성" : "발행 키트 만들기"}</button></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <section className="panel youtube-connection"><div><span className="platform-icon youtube"><Youtube size={17}/></span><span><strong>{oauth?.connected?oauth.channelTitle:"YouTube 채널 동의 확인 필요"}</strong><small>채널 동의와 해제는 설정의 작동 상태에서 관리합니다.</small></span></div><Link className="secondary-button" href="/settings/connections">채널 연결 관리</Link></section>
    <section className="panel kit-guide"><span><strong>1</strong> 기준 롱폼 선택</span><span><strong>2</strong> 정본으로 키트 만들기</span><span><strong>3</strong> 최종 영상 검수</span><span><strong>4</strong> 발행 조건 승인 후 업로드</span></section>
    {kitIsStale ? <div className="inline-alert warning"><CircleAlert size={16} /><span><strong>이 키트는 이전 규칙으로 만들어졌습니다.</strong> 최신 정본과 공개 문안 필터를 적용하려면 ‘발행 키트 만들기’를 다시 실행하세요.</span></div> : null}
    <section className="kit-grid">{KIT_FIELDS.map(([key, label]) => { const value = result[key]; return <article className="panel kit-card" key={key}><header><div><PackageCheck size={15} /><strong>{label}</strong></div><button className="ghost-button" disabled={!value && !draft[key]} onClick={() => copy(key, editing ? draft[key] : value)}><Clipboard size={13} /> {copied === key ? "복사됨" : "복사"}</button></header>{editing ? <textarea aria-label={`${label} 수정`} value={draft[key] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /> : key === "checklist" && Array.isArray(value) ? <div className="kit-checklist">{value.map((item, index) => <label key={index}><input type="checkbox" disabled={busy} checked={metadata<number[]>(kit, "checkedItems", []).includes(index)} onChange={() => toggleChecklist(index)} />{String(item)}</label>)}</div> : <pre>{Array.isArray(value) ? value.join("\n") : String(value ?? "생성된 내용이 없습니다.")}</pre>}</article>; })}</section>
    {pendingCompletion ? <div className="inline-alert warning"><CircleAlert size={16} /><span>영상 전송은 완료됐습니다. 업로드 결과를 다시 확인하면 기존 영상의 OS 기록만 저장합니다.</span></div> : null}
    <section className="panel youtube-upload-panel"><div className="panel-header"><div><h2>발행 승인</h2><p>최종 영상 검수와 별개로 채널·공개 범위를 저장하고 승인합니다. 조건이 바뀌면 재승인이 필요합니다.</p></div><span className={`status-pill status-${releaseMatches ? "ready" : "review"}`}>{releaseMatches ? "발행 승인 완료" : "승인 대기"}</span></div><div className="youtube-upload-form"><label><span>연결 채널</span><input value={oauth?.channelTitle ?? "연결 필요"} readOnly /></label><label><span>공개 범위</span><select value={privacy} disabled={busy || Boolean(pendingCompletion)} onChange={(event) => setPrivacy(event.target.value as typeof privacy)}><option value="private">비공개</option><option value="unlisted">일부공개</option></select></label><label><span>예정 시각 (선택)</span><input type="datetime-local" value={scheduledAt} disabled={busy} onChange={(event) => setScheduledAt(event.target.value)} /></label><button className="secondary-button" disabled={busy || !oauth?.connected || !pipeline?.approved[2]} onClick={saveRelease}>현재 조건 저장</button><label className="youtube-final-approval"><span>승인·수정 메모</span><input value={releaseNote} onChange={(event) => setReleaseNote(event.target.value)} placeholder="확인 내용 또는 수정 사유" /></label><div className="pipeline-actions"><button className="primary-button" disabled={busy || !pipeline?.release.canApprove || pipeline?.release.approved} onClick={() => decideRelease(true)}>발행 승인</button><button className="secondary-button" disabled={busy || !releaseNote.trim()} onClick={() => decideRelease(false)}>수정 요청</button></div></div>{pipeline?.release.blocker ? <p className="inline-alert warning">{pipeline.release.blocker}</p> : null}{pipeline?.release.lastDecision ? <p className="metric-caption">최근 기록 · {pipeline.release.lastDecision.approved ? "승인" : "수정 요청"} · {new Date(pipeline.release.lastDecision.at).toLocaleString("ko-KR")}</p> : null}</section>
    <section className="panel youtube-upload-panel"><div className="panel-header"><div><h2>최종 영상 업로드</h2><p>발행 승인된 조건일 때만 영상이 브라우저에서 Google로 직접 전송됩니다.</p></div><UploadCloud size={18} /></div><div className="youtube-upload-form"><label><span>영상 파일</span><input type="file" accept="video/*" disabled={busy || Boolean(pendingCompletion)} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><button className="primary-button" disabled={!kit || (!pendingCompletion && (!file || !releaseMatches)) || !oauth?.connected || editing || busy} onClick={upload}><UploadCloud size={15} /> {pendingCompletion ? (busy ? "업로드 결과 확인 중…" : "업로드 결과 다시 확인") : busy && uploadProgress ? `업로드 ${uploadProgress}%` : "승인 조건으로 YouTube 업로드"}</button></div>{uploadProgress > 0 ? <progress aria-label="YouTube 업로드 진행률" max="100" value={uploadProgress}>{uploadProgress}%</progress> : null}{uploadedUrl || previousUpload.videoUrl ? <a className="youtube-upload-result" href={uploadedUrl || previousUpload.videoUrl} target="_blank" rel="noreferrer"><CheckCircle2 size={15} /> 업로드된 영상 확인 <ExternalLink size={13} /></a> : null}</section>
  </>;
}
