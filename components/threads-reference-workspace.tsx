"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { OsRecord } from "@/lib/record-types";
import { evaluateThreadsReference, REFERENCE_POLICY, type ThreadsReferenceItem } from "@/lib/threads-reference";
import { useSession } from "./session-provider";
import "./threads-reference-workspace.css";

const METRICS = [["views", "조회"], ["likes", "좋아요"], ["comments", "댓글"], ["reposts", "재공유"]] as const;
const READ_SCOPES = { full: "전체 읽음", partial: "일부 읽음", preview: "미리보기만 확인", unavailable: "본문 확인 불가" } as const;
const PLATFORM_LABELS = { threads: "Threads", substack: "Substack", other: "기타" } as const;
const QUALITY_LABELS = { recommended: "추천 후보", pending: "검증 대기", reference_only: "내용 참고", all: "전체" } as const;
type QualityFilter = keyof typeof QUALITY_LABELS;
type Mutate = (path: string, method: "POST" | "PATCH" | "PUT", body: unknown) => Promise<Record<string, unknown>>;
type ComparisonDraft = { url: string; likes: string; publishedAt: string };
export type ReferenceCollectionContext = { canonicalUrl?: string; canonicalTitle: string; canonicalVersion?: number; error?: string };

function emptyReference(): ThreadsReferenceItem {
  return { id: crypto.randomUUID(), url: "", title: "", koreanTitle: "", summary: "", suggestedTopic: "", relevanceNote: "", audienceNote: "", platform: "threads", author: "", publishedAt: null,
    observedAt: new Date().toISOString(), metrics: { views: { value: null, verified: false }, likes: { value: null, verified: false }, comments: { value: null, verified: false }, reposts: { value: null, verified: false } },
    scene: "", readerQuestion: "", addedPerspective: "", readScope: "unavailable", readNote: "", capturedBy: "human" };
}

function referencesOf(record: OsRecord): ThreadsReferenceItem[] {
  return Array.isArray(record.metadata.reference_items) ? record.metadata.reference_items as ThreadsReferenceItem[] : [];
}

function sourceHref(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}

function dateLabel(value: string | null) {
  if (!value) return "확인 불가";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return Number.isNaN(Date.parse(value)) ? "확인 불가" : new Date(value).toLocaleString("ko-KR");
}

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function referenceTitle(item: ThreadsReferenceItem) { return item.koreanTitle?.trim() || "한국어 내용 제목 확인 필요"; }

function ReferenceFacts({ item }: { item: ThreadsReferenceItem }) {
  const href = sourceHref(item.url), quality = evaluateThreadsReference(item);
  return <>
    <div className="tr-content">
      <h3>{referenceTitle(item)}</h3>
      <small className="tr-original-title">원제: {item.title || "확인 필요"}</small>
      <p className="tr-summary">{item.summary || "한국어 내용 요약을 보완하면 원문을 비교하기 쉽습니다."}</p>
      <div className="tr-meaning-grid"><div><small>독자의 질문</small><p>{item.readerQuestion || "아직 적지 않았습니다."}</p></div>
        <div><small>우리가 더할 관점</small><p>{item.addedPerspective || "아직 적지 않았습니다."}</p></div>
        <div><small>주제 기획 이름 제안</small><p>{item.suggestedTopic || "아직 제안하지 않았습니다."}</p></div>
        <div><small>우리 독자와 연결되는 이유</small><p>{item.relevanceNote || "독자 적합성 확인이 필요합니다."}</p></div></div>
    </div>
    <div className="tr-quality" data-quality={quality.status}>
      <span className="ca-v07-status" data-status={quality.status === "recommended" ? "ready" : "nourl"}>{quality.label}</span>
      <p>{quality.evidenceLabel}</p>
      {quality.reasons.length ? <ul>{quality.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
    </div>
    <details className="tr-source-evidence"><summary>원문·반응 근거 보기</summary><div className="tr-evidence-grid">
      <div className="tr-source"><strong>{PLATFORM_LABELS[item.platform] ?? "기타"} · {item.author || "저자 확인 불가"}</strong>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer">원문 열기 ↗</a> : <small>원문 주소 확인 필요</small>}
        <small>게시 {dateLabel(item.publishedAt)}<br />관측 {dateLabel(item.observedAt)}</small>
        <small>{READ_SCOPES[item.readScope] ?? "읽은 범위 미확인"} · {item.capturedBy === "aside" ? "Aside 확인" : "직접 확인"}</small>
        <small>읽은 범위·반응 근거</small><p>{item.readNote || "근거 메모 없음"}</p>
      </div>
      <div className="tr-reactions"><dl className="tr-metrics">{METRICS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{item.metrics[key]?.verified && typeof item.metrics[key].value === "number" ? item.metrics[key].value.toLocaleString("ko-KR") : "확인 불가"}</dd></div>)}</dl>
        <small>실제 독자 반응·질문</small><p>{item.audienceNote || "댓글 내용과 반응 확인이 필요합니다."}</p></div>
      <div><small>원문의 실제 장면</small><p>{item.scene || "아직 적지 않았습니다."}</p></div>
      {item.comparison ? <div className="tr-comparison-evidence"><small>Substack 비교 근거</small><p>{item.comparison.basis}</p>
        <p>비교 글 {item.comparison.posts.length}개 · 좋아요 중앙값 {quality.comparisonMedian === null ? "확인 불가" : quality.comparisonMedian.toLocaleString("ko-KR")}</p>
        <ul>{item.comparison.posts.map((post, index) => <li key={`${post.url}:${index}`}><a href={sourceHref(post.url)} target="_blank" rel="noopener noreferrer">비교 글 {index + 1} ↗</a> · {post.publishedAt} · 좋아요 {post.likes.toLocaleString("ko-KR")}</li>)}</ul></div> : null}
    </div></details>
  </>;
}

export function ReferenceEvidencePanel({ topic }: { topic: OsRecord }) {
  const references = referencesOf(topic);
  if (!references.length) return null;
  return <details className="ca-v07-brief tr-evidence" open><summary>선택한 레퍼런스 {references.length}개</summary>
    <p>주제로 가져올 때 확인한 원문과 반응입니다. 현재 수치는 원문에서 다시 확인하세요.</p>
    {references.map((item, index) => <article className="tr-evidence-row" key={`${item.id}:${index}`}><ReferenceFacts item={item} /></article>)}
  </details>;
}

export function collectionInstruction(scope: string, count: number, context: ReferenceCollectionContext) {
  const limit = Math.max(1, Math.min(3, count));
  return `[Aside 브라우저 조사 · Threads 레퍼런스]\n먼저 OS의 현행 정본을 읽고, 정본 원문의 현행 타겟 링크를 따라 독자 정의 원문까지 읽어 이번 조사에 적용하세요.\n정본: ${context.canonicalTitle}${context.canonicalVersion ? ` · v${context.canonicalVersion}` : ""}\n${context.canonicalUrl}\n원문을 열 수 없으면 임의로 추정하지 말고 막힌 지점을 알리세요.\n이번 조사 범위: ${scope.trim() || "현행 정본과 타겟 독자에 맞는 해외 Threads·Substack 글"}\n추천 후보는 최대 ${limit}개입니다. 이는 처음 발견한 글 ${limit}개를 모으라는 뜻이 아닙니다. 저자·검색어·관련 글로 탐색을 넓히고, 기준을 모두 통과한 글만 추천하세요. 후보 0개도 정상 결과이며 수를 채우기 위해 약한 글을 추천하지 마세요.\n\n초기 운영 기준 v${REFERENCE_POLICY.version} (일반적인 바이럴의 정의가 아니라 이 수집함의 추천 조건):\n- Threads: 화면에서 직접 확인한 조회 ${REFERENCE_POLICY.threadsMinViews.toLocaleString("ko-KR")}회 이상. 좋아요·댓글만으로 조회를 추정하지 마세요. 조회가 보이지 않으면 검증 대기입니다.\n- Substack: 직접 확인한 좋아요 ${REFERENCE_POLICY.substackMinLikes}개 이상이면서, 같은 저자의 서로 다른 비교 글 ${REFERENCE_POLICY.substackMinComparisonPosts}개 이상에서 확인한 좋아요 중앙값의 ${REFERENCE_POLICY.substackMinLift}배 이상. 비교 글은 최대 10개이며 해당 원문을 비교 표본에 넣지 마세요. 각 URL·게시일(YYYY-MM-DD)·좋아요 수를 기록하고, 같은 저자·유사한 글 형식·발행 후 경과기간을 비교할 수 있는 이유를 설명하세요. 비교 근거가 부족하면 검증 대기입니다.\n- 공통: 본문 전체를 읽고 원문의 실제 장면, 독자의 질문, 우리가 더할 관점, 우리 독자와 연결되는 이유를 기록하세요. 댓글 수만 세지 말고 의미 있는 댓글을 직접 읽어 실제 반응과 반복되는 질문을 요약하세요. 독자 반응을 확인하지 못했으면 추천하지 마세요.\n- 최근 글을 우선 탐색하세요. 오래된 글은 지금 다시 다룰 이유와 현재 독자의 상황을 함께 설명하세요.\n\n모든 항목은 한국어로 짧고 구체적으로 정리하세요:\n- 원문 URL·원제·플랫폼·저자·게시일(모르면 확인 불가)·관측 시각\n- 한국어 내용 제목(koreanTitle)·한국어 요약(summary)·독자가 궁금해하는 질문(readerQuestion)\n- 주제 기획 이름 제안(suggestedTopic): 우리가 다룰 질문·내부 기획 이름. 첫 줄 카피는 집필 단계에서 만듭니다.\n- 원문의 실제 장면(scene)·더할 관점(addedPerspective)·독자 적합성(relevanceNote)·실제로 읽은 독자 반응과 질문(audienceNote)\n- 조회·좋아요·댓글·재공유: 화면에서 확인한 숫자와 확인 불가를 각각 구분\n- 읽은 범위(전체/일부/미리보기/확인 불가), 접근 제한, 반응을 확인한 위치\n- Substack 비교 근거(comparison): basis와 posts의 URL·좋아요 수·게시일\n본문을 전재하지 말고 필요한 장면만 요약하세요. 보이지 않는 숫자는 추정하지 마세요.\n확인 결과는 아래 내 레퍼런스 수집함에 등록하고 기존 URL은 중복 등록하지 마세요. 기준 미달은 내용 참고, 미확인은 검증 대기로 보관할 수 있습니다. 최종 보고에서는 추천 기준을 통과한 후보만 최대 ${limit}개 제시하고, 내용 참고·검증 대기는 별도로 분리하세요.\n사람이 주제로 선택하기 전에는 자동으로 주제를 선택·승격하거나 원고를 쓰지 마세요. 팀 공유·승인·게시도 하지 마세요.\n등록 화면: ${location.origin}/automation/references`;
}

export function ThreadsReferenceWorkspace({ records, mutate, collectionContext }: { records: OsRecord[]; mutate: Mutate; collectionContext: ReferenceCollectionContext | null }) {
  const router = useRouter(), { demo } = useSession();
  const [query, setQuery] = useState(""), [platform, setPlatform] = useState("all"), [qualityFilter, setQualityFilter] = useState<QualityFilter>("recommended");
  const [selectedIds, setSelectedIds] = useState<string[]>([]), [topicTitle, setTopicTitle] = useState("");
  const [editor, setEditor] = useState<{ record: OsRecord | null; item: ThreadsReferenceItem } | null>(null);
  const [comparisonBasis, setComparisonBasis] = useState(""), [comparisonRows, setComparisonRows] = useState<ComparisonDraft[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [collectionScope, setCollectionScope] = useState(""), [collectionCount, setCollectionCount] = useState(3);
  const entries = records.flatMap(record => referencesOf(record).slice(0, 1).map(item => ({ record, item, quality: evaluateThreadsReference(item) })));
  const counts = { all: entries.length, recommended: 0, pending: 0, reference_only: 0 };
  entries.forEach(({ quality }) => { counts[quality.status] += 1; });
  const filtered = entries.filter(({ item, quality }) => (qualityFilter === "all" || quality.status === qualityFilter) && (platform === "all" || item.platform === platform) &&
    [item.title, item.koreanTitle, item.summary, item.suggestedTopic, item.author, item.scene, item.readerQuestion, item.addedPerspective].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = selectedIds.flatMap(id => entries.filter(({ record, quality }) => record.id === id && quality.status === "recommended"));
  const patch = (change: Partial<ThreadsReferenceItem>) => setEditor(current => current ? { ...current, item: { ...current.item, ...change } } : null);
  const clearSelection = () => { setSelectedIds([]); setTopicTitle(""); setRequestId(crypto.randomUUID()); };
  const toggleSelection = (id: string, checked: boolean) => {
    const entry = entries.find(({ record }) => record.id === id);
    if (!entry || entry.quality.status !== "recommended" || (checked && selected.length >= 3)) return;
    const next = checked ? [...selected.map(({ record }) => record.id), id] : selected.map(({ record }) => record.id).filter(value => value !== id);
    if (!next.length) setTopicTitle("");
    else if (!selected.length && checked) setTopicTitle(entry.item.suggestedTopic?.trim() || "");
    setSelectedIds(next); setRequestId(crypto.randomUUID());
  };
  const openEditor = (record: OsRecord | null, item = emptyReference()) => {
    setEditor({ record, item: structuredClone(item) }); setComparisonBasis(item.comparison?.basis ?? "");
    setComparisonRows(item.comparison?.posts.map(post => ({ ...post, likes: String(post.likes) })) ?? []);
    setError(""); setNotice(""); setRequestId(crypto.randomUUID());
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editor || busy) return;
    setError(""); setBusy(true);
    try {
      const item = editor.item;
      if (!sourceHref(item.url)) throw new Error("https로 시작하는 원문 주소를 입력해 주세요.");
      if (Number.isNaN(Date.parse(item.observedAt))) throw new Error("관측 시각을 입력해 주세요.");
      if (METRICS.some(([key]) => item.metrics[key].verified && (item.metrics[key].value === null || !Number.isSafeInteger(item.metrics[key].value) || item.metrics[key].value! < 0))) throw new Error("확인한 반응은 0 이상의 정수로 입력해 주세요.");
      const rows = comparisonRows.filter(row => row.url.trim() || row.likes.trim() || row.publishedAt);
      if (item.platform === "substack" && rows.some(row => !sourceHref(row.url.trim()) || !/^\d+$/.test(row.likes) || !Number.isSafeInteger(Number(row.likes)) || !/^\d{4}-\d{2}-\d{2}$/.test(row.publishedAt))) throw new Error("비교 글마다 https 주소·0 이상의 좋아요 수·게시일을 입력해 주세요. 작성 중인 내용은 그대로 남아 있습니다.");
      const comparison = item.platform === "substack" && (comparisonBasis.trim() || rows.length) ? { basis: comparisonBasis.trim(), posts: rows.map(row => ({ url: row.url.trim(), likes: Number(row.likes), publishedAt: row.publishedAt })) } : undefined;
      const reference: ThreadsReferenceItem = { ...item, title: item.title.trim(), url: item.url.trim(), comparison,
        metrics: { ...item.metrics, ...Object.fromEntries(METRICS.map(([key]) => [key, item.metrics[key].verified ? item.metrics[key] : { value: null, verified: false }])) } };
      if (editor.record) await mutate(`/api/v1/content/automation/topics/${editor.record.id}`, "PATCH", { expectedVersion: editor.record.version, title: reference.title, metadata: { reference_items: [reference] } });
      else await mutate("/api/v1/content/automation/topics", "POST", { title: reference.title, source: "reference", sourceRef: reference.url, kind: "threads_reference", editorial_workflow: "threads_reference_v1", reference_items: [reference], requestId });
      const quality = evaluateThreadsReference(reference);
      if (editor.record && quality.status !== "recommended") {
        const remaining = selected.filter(({ record }) => record.id !== editor.record!.id);
        setSelectedIds(remaining.map(({ record }) => record.id)); if (!remaining.length) setTopicTitle("");
      }
      setQualityFilter(quality.status); setEditor(null); setNotice(`${quality.label}(으)로 저장했습니다. 주제에 사용할 추천 후보는 직접 선택해 주세요.`); setRequestId(crypto.randomUUID());
    } catch (issue) { setError(issue instanceof Error ? issue.message : "레퍼런스를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const promote = async (event: FormEvent) => {
    event.preventDefault(); if (!selected.length || busy) return;
    if (selected.length > 3 || selected.some(({ quality }) => quality.status !== "recommended")) { setError("검증을 마친 추천 후보를 최대 3개 선택해 주세요."); return; }
    setBusy(true); setError("");
    try {
      const response = await mutate("/api/v1/content/automation/topics", "POST", { title: topicTitle.trim(), source: "reference", referenceIds: selected.map(({ record }) => record.id), requestId });
      router.push(`/automation/topics?sel=${(response.topic as OsRecord).id}`);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "주제 후보로 가져오지 못했습니다."); }
    finally { setBusy(false); }
  };
  const archive = async (record: OsRecord) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await mutate(`/api/v1/content/automation/topics/${record.id}/archive-reference`, "POST", { version: record.version }); const remaining = selected.filter(entry => entry.record.id !== record.id); setSelectedIds(remaining.map(entry => entry.record.id)); if (!remaining.length) setTopicTitle(""); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "레퍼런스를 보관하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <div className="tr-workspace">
    <div className="ca-v07-toolbar"><input aria-label="레퍼런스 검색" placeholder="한국어 제목·질문·관점 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="레퍼런스 플랫폼" value={platform} onChange={event => setPlatform(event.target.value)}><option value="all">전체 플랫폼</option>{Object.entries(PLATFORM_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
      <button type="button" className="primary" onClick={() => openEditor(null)}>+ 원문 등록</button></div>
    <p>한국어 요약과 독자의 질문을 비교하고, 검증을 마친 추천 후보만 주제 기획으로 가져옵니다. 내용 참고·검증 대기 자료도 수집함에 보관됩니다.</p>
    <details className="ca-v07-brief"><summary>Aside에 원문 조사 맡기기</summary><div className="ca-v07-form-grid tr-collection-fields"><label>이번에 살펴볼 주제·범위<input value={collectionScope} maxLength={1000} placeholder="비워 두면 현재 정본과 타겟 기준으로 조사" onChange={event => setCollectionScope(event.target.value)} /></label>
      <label>추천 후보 수<select value={collectionCount} onChange={event => setCollectionCount(Number(event.target.value))}>{[1, 2, 3].map(count => <option key={count} value={count}>최대 {count}개</option>)}</select></label></div>
      <p>탐색 범위는 넓히되 기준을 통과한 글만 최대 3개 추천합니다. 추천 후보가 0개여도 정상입니다.</p>
      <p>초기 운영 기준: Threads 조회 10만 회 이상 / Substack 좋아요 100개 이상이며 같은 저자의 비교 글 5개 이상 중앙값의 2배 이상. 본문 전체·독자 적합성·실제 댓글 반응도 확인합니다.</p>
      {collectionContext?.canonicalUrl ? <p><a href={sourceHref(collectionContext.canonicalUrl)} target="_blank" rel="noopener noreferrer">{collectionContext.canonicalTitle} ↗</a>{collectionContext.canonicalVersion ? ` · v${collectionContext.canonicalVersion}` : ""}</p> : <p role="status">{collectionContext?.error || "정본 연결을 확인해야 조사 지침을 복사할 수 있습니다."}</p>}
      <button type="button" disabled={!collectionContext?.canonicalUrl} onClick={async () => { if (!collectionContext?.canonicalUrl) return; try { await navigator.clipboard.writeText(collectionInstruction(collectionScope, collectionCount, collectionContext)); setNotice("조사 지침을 복사했습니다. Aside에 붙여 넣어 실행하세요."); } catch { setError("복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요."); } }}>Aside 조사 지침 복사</button></details>
    {demo ? <p className="ca-v07-note">데모 화면입니다. 입력 항목을 살펴볼 수 있으며 저장은 하지 않습니다.</p> : null}
    {notice ? <p role="status" className="ca-v07-notice">{notice}</p> : null}
    {error ? <p role="alert" className="ca-v07-error">{error}</p> : null}
    {editor ? <form className="ca-v07-card ca-v07-form tr-editor" onSubmit={event => void save(event)}>
      <div className="ca-v07-detail-head"><h2>{editor.record ? "원문 기록 수정" : "확인한 원문 등록"}</h2><button type="button" disabled={busy} onClick={() => setEditor(null)}>닫기</button></div>
      <p>확인하지 못한 항목은 비워 두고 저장할 수 있습니다. 추천 후보가 되려면 한국어 설명과 아래의 근거를 모두 보완해야 합니다.</p>
      <div className="ca-v07-form-grid"><label>원문 제목<input required maxLength={240} value={editor.item.title} onChange={event => patch({ title: event.target.value })} /></label>
        <label>한국어 내용 제목<input maxLength={240} value={editor.item.koreanTitle ?? ""} onChange={event => patch({ koreanTitle: event.target.value })} placeholder="원문이 무엇을 다루는지 한국어로" /></label>
        <label>원문 URL<input required type="url" value={editor.item.url} placeholder="https://…" onChange={event => patch({ url: event.target.value })} /></label>
        <label>플랫폼<select value={editor.item.platform} onChange={event => patch({ platform: event.target.value as ThreadsReferenceItem["platform"] })}>{Object.entries(PLATFORM_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>저자<input maxLength={200} value={editor.item.author} placeholder="확인한 이름 또는 계정" onChange={event => patch({ author: event.target.value })} /></label>
        <label>게시일<input type="date" value={editor.item.publishedAt?.slice(0, 10) ?? ""} onChange={event => patch({ publishedAt: event.target.value || null })} /><small>확인할 수 없으면 비워 두세요.</small></label>
        <label>관측 시각<input required type="datetime-local" value={localDateTime(editor.item.observedAt)} onChange={event => patch({ observedAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} /></label>
        <label>읽은 범위<select value={editor.item.readScope} onChange={event => patch({ readScope: event.target.value as ThreadsReferenceItem["readScope"] })}>{Object.entries(READ_SCOPES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>확인한 사람·도구<select value={editor.item.capturedBy} onChange={event => patch({ capturedBy: event.target.value as ThreadsReferenceItem["capturedBy"] })}><option value="human">직접 확인</option><option value="aside">Aside가 확인</option></select></label></div>
      <label>한국어 내용 요약<textarea maxLength={3000} value={editor.item.summary ?? ""} placeholder="원문의 핵심 내용과 맥락을 짧게 요약" onChange={event => patch({ summary: event.target.value })} /></label>
      <label>주제 기획 이름 제안<input maxLength={240} value={editor.item.suggestedTopic ?? ""} onChange={event => patch({ suggestedTopic: event.target.value })} /><small>우리가 다룰 질문 · 내부 기획 이름, 첫 줄 카피는 집필 단계</small></label>
      <fieldset className="ca-v07-fields"><legend>화면에서 확인한 반응</legend><small>보이지 않는 숫자는 확인 불가로 둡니다. 확인한 0은 숫자 0을 입력하세요.</small>
        <div className="tr-metric-inputs">{METRICS.map(([key, label]) => <div key={key}><label>{label} 확인<select value={editor.item.metrics[key].verified ? "verified" : "unknown"} onChange={event => patch({ metrics: { ...editor.item.metrics, [key]: { value: null, verified: event.target.value === "verified" } } })}><option value="unknown">확인 불가</option><option value="verified">숫자 확인함</option></select></label>
          {editor.item.metrics[key].verified ? <label>{label} 수<input required type="number" min={0} step={1} value={editor.item.metrics[key].value ?? ""} onChange={event => patch({ metrics: { ...editor.item.metrics, [key]: { verified: true, value: event.target.value === "" ? null : Number(event.target.value) } } })} /></label> : <small>확인 불가</small>}</div>)}</div>
      </fieldset>
      {editor.item.platform === "substack" ? <fieldset className="ca-v07-fields tr-comparison-editor"><legend>같은 저자의 Substack 비교 글</legend>
        <p>대상 원문을 제외한 글 5개 이상, 최대 10개를 확인하세요. 서로 다른 URL·좋아요 수·게시일이 필요합니다.</p>
        <label>비교 가능한 이유<textarea maxLength={3000} value={comparisonBasis} placeholder="같은 저자의 유사한 글 형식인지, 발행 후 경과기간을 어떻게 맞췄는지" onChange={event => setComparisonBasis(event.target.value)} /></label>
        {comparisonRows.map((row, index) => <div className="tr-comparison-input-row" key={index}>
          <label>비교 글 {index + 1} URL<input value={row.url} placeholder="https://…" onChange={event => setComparisonRows(current => current.map((entry, i) => i === index ? { ...entry, url: event.target.value } : entry))} /></label>
          <label>비교 글 {index + 1} 좋아요<input inputMode="numeric" value={row.likes} onChange={event => setComparisonRows(current => current.map((entry, i) => i === index ? { ...entry, likes: event.target.value } : entry))} /></label>
          <label>비교 글 {index + 1} 게시일<input type="date" value={row.publishedAt} onChange={event => setComparisonRows(current => current.map((entry, i) => i === index ? { ...entry, publishedAt: event.target.value } : entry))} /></label>
          <button type="button" aria-label={`비교 글 ${index + 1} 삭제`} onClick={() => setComparisonRows(current => current.filter((_, i) => i !== index))}>삭제</button>
        </div>)}
        <button type="button" disabled={comparisonRows.length >= 10} onClick={() => setComparisonRows(current => [...current, { url: "", likes: "", publishedAt: "" }])}>+ 비교 글 추가</button>
        <small>작성 중인 값은 입력하는 동안 그대로 유지하며, 저장할 때 확인합니다.</small>
      </fieldset> : null}
      <label>읽은 범위·반응 근거<textarea maxLength={3000} value={editor.item.readNote} placeholder="예: 본문 전체를 읽음. 게시물 아래 좋아요·댓글 수 확인. 조회 수는 표시되지 않음." onChange={event => patch({ readNote: event.target.value })} /></label>
      <div className="ca-v07-form-grid"><label>원문에 실제로 나온 장면<textarea maxLength={3000} value={editor.item.scene} placeholder="원문에서 누가 무엇을 했는지 짧게 요약" onChange={event => patch({ scene: event.target.value })} /></label>
        <label>독자가 궁금해하는 질문<textarea maxLength={2000} value={editor.item.readerQuestion} placeholder="이 장면을 본 독자가 묻고 싶은 것" onChange={event => patch({ readerQuestion: event.target.value })} /></label></div>
      <label>우리가 더할 관점<textarea maxLength={3000} value={editor.item.addedPerspective} placeholder="원문을 바탕으로 더 설명하거나 다르게 볼 지점" onChange={event => patch({ addedPerspective: event.target.value })} /></label>
      <div className="ca-v07-form-grid"><label>우리 독자와 연결되는 이유<textarea maxLength={3000} value={editor.item.relevanceNote ?? ""} placeholder="현행 타겟 독자의 어떤 상황·고민과 연결되는지" onChange={event => patch({ relevanceNote: event.target.value })} /></label>
        <label>실제로 읽은 독자 반응·질문<textarea maxLength={3000} value={editor.item.audienceNote ?? ""} placeholder="댓글을 직접 읽고 의미 있는 반응과 반복되는 질문을 구체적으로 요약" onChange={event => patch({ audienceNote: event.target.value })} /></label></div>
      <div className="ca-v07-actions"><button type="button" disabled={busy} onClick={() => setEditor(null)}>취소</button><button className="primary" disabled={busy || demo}>{busy ? "저장 중…" : "내 레퍼런스에 저장"}</button></div>
    </form> : null}
    <div className="tr-list-head"><h2>내 레퍼런스 <small>전체 {entries.length}개</small></h2><span>추천 후보만 선택 가능 · 최대 3개</span></div>
    <div className="tr-quality-filters" role="group" aria-label="레퍼런스 검증 상태">{(Object.keys(QUALITY_LABELS) as QualityFilter[]).map(key => <button key={key} type="button" aria-pressed={qualityFilter === key} onClick={() => setQualityFilter(key)}>{QUALITY_LABELS[key]} {counts[key]}개</button>)}</div>
    {filtered.length ? <div className="tr-comparison">{filtered.map(({ record, item, quality }) => {
      const checked = selected.some(entry => entry.record.id === record.id), unavailable = quality.status !== "recommended";
      const reason = unavailable ? quality.reasons.join(" · ") || "추천 기준 확인이 필요합니다." : !checked && selected.length >= 3 ? "추천 후보는 최대 3개까지 선택할 수 있습니다." : "";
      return <article className={`tr-reference${checked ? " is-selected" : ""}`} key={record.id}>
        <div className="tr-pick"><div><label className="ca-v07-check"><input type="checkbox" aria-label={`${referenceTitle(item)} 선택`} aria-describedby={reason ? `selection-reason-${record.id}` : undefined} checked={checked} disabled={busy || unavailable || (!checked && selected.length >= 3)} onChange={event => toggleSelection(record.id, event.target.checked)} />주제에 사용</label>
          {reason ? <small id={`selection-reason-${record.id}`} className="tr-selection-reason">{reason}</small> : null}</div><div className="ca-v07-actions"><button type="button" disabled={busy} onClick={() => openEditor(record, item)}>수정</button><button type="button" disabled={busy || demo} title="수집 목록에서 숨깁니다. 주제에 가져온 근거는 유지됩니다." onClick={() => void archive(record)}>보관</button></div></div>
        <ReferenceFacts item={item} />
      </article>;
    })}</div> : <div className="ca-v07-empty">{qualityFilter === "recommended" && !counts.recommended ? <><strong>추천 후보 0개</strong><p>아직 추천 기준을 모두 통과한 원문이 없습니다. 수를 채울 필요는 없습니다.</p><p>검증 대기에서 부족한 근거를 보완하거나 내용 참고·전체에서 모은 자료를 살펴보세요.</p></> : entries.length ? "이 조건에 맞는 레퍼런스가 없습니다." : "아직 모은 원문이 없습니다. 원문을 확인하고 첫 레퍼런스를 등록하세요."}</div>}
    {selected.length ? <form className="ca-v07-card ca-v07-form tr-selection" onSubmit={event => void promote(event)}><h2>선택한 원문 {selected.length}개로 주제 만들기</h2>
      <ul>{selected.map(({ record, item }) => <li key={record.id}>{referenceTitle(item)}</li>)}</ul>
      <label>주제 후보 이름<input aria-label="주제 후보 이름" aria-describedby="tr-topic-name-help" required maxLength={240} value={topicTitle} onChange={event => { setTopicTitle(event.target.value); setRequestId(crypto.randomUUID()); }} placeholder="선택한 원문으로 다룰 질문" /></label><small id="tr-topic-name-help">우리가 다룰 질문 · 내부 기획 이름, 첫 줄 카피는 집필 단계</small>
      <p>첫 원문의 제안을 채워 두었습니다. 이름은 직접 바꿀 수 있고, 원문을 더 선택해도 입력한 이름은 유지됩니다.</p>
      <div className="tr-topic-suggestions">{selected.map(({ record, item }) => item.suggestedTopic ? <button type="button" key={record.id} disabled={busy} onClick={() => { setTopicTitle(item.suggestedTopic!); setRequestId(crypto.randomUUID()); }}>제안 사용: {item.suggestedTopic}</button> : null)}</div>
      <p>선택한 원문만 주제 기획으로 가져갑니다. 브리프를 정하고 제작을 시작하면 쓰레드를 집필할 수 있습니다.</p>
      <div className="ca-v07-actions"><button type="button" disabled={busy} onClick={clearSelection}>선택 해제</button><button className="primary" disabled={busy || demo || !topicTitle.trim()}>{busy ? "가져오는 중…" : "주제 후보로 가져오기"}</button><Link href="/automation/topics">주제 기획 보기 →</Link></div>
    </form> : null}
  </div>;
}
