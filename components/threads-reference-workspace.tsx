"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { OsRecord } from "@/lib/record-types";
import type { ThreadsReferenceItem } from "@/lib/threads-reference";
import { useSession } from "./session-provider";
import "./threads-reference-workspace.css";

const METRICS = [["views", "조회"], ["likes", "좋아요"], ["comments", "댓글"], ["reposts", "재공유"]] as const;
const READ_SCOPES = { full: "전체 읽음", partial: "일부 읽음", preview: "미리보기만 확인", unavailable: "본문 확인 불가" } as const;
const PLATFORM_LABELS = { threads: "Threads", substack: "Substack", other: "기타" } as const;
type Mutate = (path: string, method: "POST" | "PATCH" | "PUT", body: unknown) => Promise<Record<string, unknown>>;
export type ReferenceCollectionContext = { canonicalUrl?: string; canonicalTitle: string; canonicalVersion?: number; error?: string };

function emptyReference(): ThreadsReferenceItem {
  return { id: crypto.randomUUID(), url: "", title: "", platform: "threads", author: "", publishedAt: null,
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

function hasReactionEvidence(item: ThreadsReferenceItem) {
  return Boolean(sourceHref(item.url) && item.author.trim() && !Number.isNaN(Date.parse(item.observedAt)) &&
    ["full", "partial"].includes(item.readScope) &&
    METRICS.some(([key]) => item.metrics[key]?.verified && typeof item.metrics[key].value === "number"));
}

function ReferenceFacts({ item }: { item: ThreadsReferenceItem }) {
  const href = sourceHref(item.url);
  return <>
    <div className="tr-source">
      <strong>{item.title}</strong>
      <small>{PLATFORM_LABELS[item.platform] ?? "기타"} · {item.author || "저자 확인 불가"}</small>
      {href ? <a href={href} target="_blank" rel="noopener noreferrer">원문 열기 ↗</a> : <small>원문 주소 확인 필요</small>}
      <small>게시 {dateLabel(item.publishedAt)}<br />관측 {dateLabel(item.observedAt)}</small>
      <small>{READ_SCOPES[item.readScope] ?? "읽은 범위 미확인"} · {item.capturedBy === "aside" ? "Aside 확인" : "직접 확인"}</small>
    </div>
    <div className="tr-reactions">
      <span className="ca-v07-status" data-status={hasReactionEvidence(item) ? "ready" : "nourl"}>{hasReactionEvidence(item) ? "확인한 반응 있음" : "반응 미확인"}</span>
      <dl className="tr-metrics">{METRICS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{item.metrics[key]?.verified && typeof item.metrics[key].value === "number" ? item.metrics[key].value.toLocaleString("ko-KR") : "확인 불가"}</dd></div>)}</dl>
      <p>{item.readNote || "읽은 범위·반응 근거 메모 없음"}</p>
    </div>
    <div className="tr-scene"><small>원문의 실제 장면</small><p>{item.scene || "아직 적지 않았습니다."}</p><small>독자의 질문</small><p>{item.readerQuestion || "아직 적지 않았습니다."}</p></div>
    <div className="tr-perspective"><small>우리가 더할 관점</small><p>{item.addedPerspective || "아직 적지 않았습니다."}</p></div>
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

function collectionInstruction(scope: string, count: number, context: ReferenceCollectionContext) {
  return `[Aside 브라우저 조사 · Threads 레퍼런스]\n먼저 OS의 현행 정본을 읽고, 정본 원문의 현행 타겟 링크를 따라 독자 정의 원문까지 읽어 이번 조사에 적용하세요.\n정본: ${context.canonicalTitle}${context.canonicalVersion ? ` · v${context.canonicalVersion}` : ""}\n${context.canonicalUrl}\n원문을 열 수 없으면 임의로 추정하지 말고 막힌 지점을 알리세요.\n이번 조사 범위: ${scope.trim() || "현행 정본과 타겟 독자에 맞는 해외 Threads·Substack 글"}\n모을 후보: 최대 ${count}개. 수를 채우기 위해 근거가 없는 글을 넣지 마세요.\n반응이 확인되는 해외 원문을 브라우저에서 직접 열고, 다음 항목을 짧게 기록하세요.\n- 원문 URL, 제목, 플랫폼, 저자, 게시일(모르면 확인 불가), 관측 시각\n- 조회·좋아요·댓글·재공유: 화면에서 확인한 숫자와 확인 불가를 각각 구분\n- 읽은 범위(전체/일부/미리보기/확인 불가), 접근 제한, 반응을 확인한 위치\n- 원문에 실제로 나온 장면, 독자가 궁금해하는 질문, 우리가 더할 관점\n본문을 전재하지 말고 필요한 장면만 요약하세요. 보이지 않는 숫자를 추정하거나 인기·성과로 단정하지 마세요.\n확인 결과는 아래 내 레퍼런스 수집함에 등록하고 기존 URL은 중복 등록하지 마세요. 출처가 부족한 자료는 반응 미확인으로 남기세요.\n사람이 주제로 선택하기 전에는 점수로 주제를 자동 선택하거나 원고를 쓰지 마세요. 팀 공유·승인·게시도 하지 마세요.\n등록 화면: ${location.origin}/automation/references`;
}

export function ThreadsReferenceWorkspace({ records, mutate, collectionContext }: { records: OsRecord[]; mutate: Mutate; collectionContext: ReferenceCollectionContext | null }) {
  const router = useRouter(), { demo } = useSession();
  const [query, setQuery] = useState(""), [platform, setPlatform] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]), [topicTitle, setTopicTitle] = useState("");
  const [editor, setEditor] = useState<{ record: OsRecord | null; item: ThreadsReferenceItem } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [collectionScope, setCollectionScope] = useState(""), [collectionCount, setCollectionCount] = useState(5);
  const entries = records.flatMap(record => referencesOf(record).slice(0, 1).map(item => ({ record, item })));
  const filtered = entries.filter(({ item }) => (platform === "all" || item.platform === platform) &&
    [item.title, item.author, item.scene, item.readerQuestion, item.addedPerspective].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = entries.filter(({ record }) => selectedIds.includes(record.id));
  const patch = (change: Partial<ThreadsReferenceItem>) => setEditor(current => current ? { ...current, item: { ...current.item, ...change } } : null);
  const openEditor = (record: OsRecord | null, item = emptyReference()) => {
    setEditor({ record, item: structuredClone(item) }); setError(""); setNotice(""); setRequestId(crypto.randomUUID());
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editor || busy) return;
    setError(""); setBusy(true);
    try {
      const item = editor.item;
      if (!sourceHref(item.url)) throw new Error("https로 시작하는 원문 주소를 입력해 주세요.");
      if (Number.isNaN(Date.parse(item.observedAt))) throw new Error("관측 시각을 입력해 주세요.");
      if (METRICS.some(([key]) => item.metrics[key].verified && (item.metrics[key].value === null || !Number.isSafeInteger(item.metrics[key].value) || item.metrics[key].value! < 0))) throw new Error("확인한 반응은 0 이상의 정수로 입력해 주세요.");
      const reference = { ...item, title: item.title.trim(), url: item.url.trim(), metrics: Object.fromEntries(METRICS.map(([key]) => [key, item.metrics[key].verified ? item.metrics[key] : { value: null, verified: false }])) };
      if (editor.record) await mutate(`/api/v1/content/automation/topics/${editor.record.id}`, "PATCH", { expectedVersion: editor.record.version, title: reference.title, metadata: { reference_items: [reference] } });
      else await mutate("/api/v1/content/automation/topics", "POST", { title: reference.title, source: "reference", sourceRef: reference.url, kind: "threads_reference", editorial_workflow: "threads_reference_v1", reference_items: [reference], requestId });
      setEditor(null); setNotice("내 레퍼런스에 저장했습니다."); setRequestId(crypto.randomUUID());
    } catch (issue) { setError(issue instanceof Error ? issue.message : "레퍼런스를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const promote = async (event: FormEvent) => {
    event.preventDefault(); if (!selected.length || busy) return;
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
    try { await mutate(`/api/v1/content/automation/topics/${record.id}/archive-reference`, "POST", { version: record.version }); setSelectedIds(current => current.filter(id => id !== record.id)); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "레퍼런스를 보관하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <div className="tr-workspace">
    <div className="ca-v07-toolbar"><input aria-label="레퍼런스 검색" placeholder="제목·질문·관점 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="레퍼런스 플랫폼" value={platform} onChange={event => setPlatform(event.target.value)}><option value="all">전체 플랫폼</option>{Object.entries(PLATFORM_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
      <button type="button" className="primary" onClick={() => openEditor(null)}>+ 원문 등록</button></div>
    <p>직접 읽었거나 Aside가 확인한 원문을 모읍니다. 필요한 원문을 골라 질문과 관점을 정하면 주제 기획으로 이어집니다.</p>
    <details className="ca-v07-brief"><summary>Aside에 원문 조사 맡기기</summary><div className="ca-v07-form-grid tr-collection-fields"><label>이번에 살펴볼 주제·범위<input value={collectionScope} maxLength={1000} placeholder="비워 두면 현재 정본과 타겟 기준으로 조사" onChange={event => setCollectionScope(event.target.value)} /></label>
      <label>후보 수<select value={collectionCount} onChange={event => setCollectionCount(Number(event.target.value))}>{[3, 5, 10].map(count => <option key={count} value={count}>최대 {count}개</option>)}</select></label></div>
      <p>복사한 지침을 Aside에 붙여 넣으세요. 확인한 원문은 내 수집함에 등록하고, 쓸 주제는 내가 고릅니다.</p>
      {collectionContext?.canonicalUrl ? <p><a href={sourceHref(collectionContext.canonicalUrl)} target="_blank" rel="noopener noreferrer">{collectionContext.canonicalTitle} ↗</a>{collectionContext.canonicalVersion ? ` · v${collectionContext.canonicalVersion}` : ""}</p> : <p role="status">{collectionContext?.error || "정본 연결을 확인해야 조사 지침을 복사할 수 있습니다."}</p>}
      <button type="button" disabled={!collectionContext?.canonicalUrl} onClick={async () => { if (!collectionContext?.canonicalUrl) return; try { await navigator.clipboard.writeText(collectionInstruction(collectionScope, collectionCount, collectionContext)); setNotice("조사 지침을 복사했습니다. Aside에 붙여 넣어 실행하세요."); } catch { setError("복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요."); } }}>Aside 조사 지침 복사</button></details>
    {demo ? <p className="ca-v07-note">데모 화면입니다. 입력 항목을 살펴볼 수 있으며 저장은 하지 않습니다.</p> : null}
    {notice ? <p role="status" className="ca-v07-notice">{notice}</p> : null}
    {error ? <p role="alert" className="ca-v07-error">{error}</p> : null}
    {editor ? <form className="ca-v07-card ca-v07-form tr-editor" onSubmit={event => void save(event)}>
      <div className="ca-v07-detail-head"><h2>{editor.record ? "원문 기록 수정" : "확인한 원문 등록"}</h2><button type="button" disabled={busy} onClick={() => setEditor(null)}>닫기</button></div>
      <div className="ca-v07-form-grid"><label>제목<input required maxLength={240} value={editor.item.title} onChange={event => patch({ title: event.target.value })} /></label>
        <label>원문 URL<input required type="url" value={editor.item.url} placeholder="https://…" onChange={event => patch({ url: event.target.value })} /></label>
        <label>플랫폼<select value={editor.item.platform} onChange={event => patch({ platform: event.target.value as ThreadsReferenceItem["platform"] })}>{Object.entries(PLATFORM_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>저자<input maxLength={200} value={editor.item.author} placeholder="확인한 이름 또는 계정" onChange={event => patch({ author: event.target.value })} /></label>
        <label>게시일<input type="date" value={editor.item.publishedAt?.slice(0, 10) ?? ""} onChange={event => patch({ publishedAt: event.target.value || null })} /><small>확인할 수 없으면 비워 두세요.</small></label>
        <label>관측 시각<input required type="datetime-local" value={localDateTime(editor.item.observedAt)} onChange={event => patch({ observedAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} /></label>
        <label>읽은 범위<select value={editor.item.readScope} onChange={event => patch({ readScope: event.target.value as ThreadsReferenceItem["readScope"] })}>{Object.entries(READ_SCOPES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>확인한 사람·도구<select value={editor.item.capturedBy} onChange={event => patch({ capturedBy: event.target.value as ThreadsReferenceItem["capturedBy"] })}><option value="human">직접 확인</option><option value="aside">Aside가 확인</option></select></label></div>
      <fieldset className="ca-v07-fields"><legend>화면에서 확인한 반응</legend><small>보이지 않는 숫자는 확인 불가로 둡니다. 확인한 0은 숫자 0을 입력하세요.</small>
        <div className="tr-metric-inputs">{METRICS.map(([key, label]) => <div key={key}><label>{label} 확인<select value={editor.item.metrics[key].verified ? "verified" : "unknown"} onChange={event => patch({ metrics: { ...editor.item.metrics, [key]: { value: null, verified: event.target.value === "verified" } } })}><option value="unknown">확인 불가</option><option value="verified">숫자 확인함</option></select></label>
          {editor.item.metrics[key].verified ? <label>{label} 수<input required type="number" min={0} step={1} value={editor.item.metrics[key].value ?? ""} onChange={event => patch({ metrics: { ...editor.item.metrics, [key]: { verified: true, value: event.target.value === "" ? null : Number(event.target.value) } } })} /></label> : <small>확인 불가</small>}</div>)}</div>
      </fieldset>
      <label>읽은 범위·반응 근거<textarea maxLength={3000} value={editor.item.readNote} placeholder="예: 본문 전체를 읽음. 게시물 아래 좋아요·댓글 수 확인. 조회 수는 표시되지 않음." onChange={event => patch({ readNote: event.target.value })} /></label>
      <div className="ca-v07-form-grid"><label>원문에 실제로 나온 장면<textarea maxLength={3000} value={editor.item.scene} placeholder="원문에서 누가 무엇을 했는지 짧게 요약" onChange={event => patch({ scene: event.target.value })} /></label>
        <label>독자가 궁금해하는 질문<textarea maxLength={2000} value={editor.item.readerQuestion} placeholder="이 장면을 본 독자가 묻고 싶은 것" onChange={event => patch({ readerQuestion: event.target.value })} /></label></div>
      <label>우리가 더할 관점<textarea maxLength={3000} value={editor.item.addedPerspective} placeholder="원문을 바탕으로 더 설명하거나 다르게 볼 지점" onChange={event => patch({ addedPerspective: event.target.value })} /></label>
      <div className="ca-v07-actions"><button type="button" disabled={busy} onClick={() => setEditor(null)}>취소</button><button className="primary" disabled={busy || demo}>{busy ? "저장 중…" : "내 레퍼런스에 저장"}</button></div>
    </form> : null}
    <div className="tr-list-head"><h2>내 레퍼런스 <small>{filtered.length}개</small></h2><span>원문 · 확인한 반응 · 질문 · 더할 관점</span></div>
    {filtered.length ? <div className="tr-comparison">{filtered.map(({ record, item }) => <article className={`tr-reference${selectedIds.includes(record.id) ? " is-selected" : ""}`} key={record.id}>
      <div className="tr-pick"><label className="ca-v07-check"><input type="checkbox" aria-label={`${item.title} 선택`} checked={selectedIds.includes(record.id)} onChange={event => { setSelectedIds(current => event.target.checked ? [...current, record.id] : current.filter(id => id !== record.id)); setRequestId(crypto.randomUUID()); }} />주제에 사용</label><div className="ca-v07-actions"><button type="button" disabled={busy} onClick={() => openEditor(record, item)}>수정</button><button type="button" disabled={busy || demo} title="수집 목록에서 숨깁니다. 주제에 가져온 근거는 유지됩니다." onClick={() => void archive(record)}>보관</button></div></div>
      <ReferenceFacts item={item} />
    </article>)}</div> : <div className="ca-v07-empty">{entries.length ? "검색 조건에 맞는 레퍼런스가 없습니다." : "아직 모은 원문이 없습니다. 원문을 확인하고 첫 레퍼런스를 등록하세요."}</div>}
    {selected.length ? <form className="ca-v07-card ca-v07-form tr-selection" onSubmit={event => void promote(event)}><h2>선택한 원문 {selected.length}개로 주제 만들기</h2>
      <ul>{selected.map(({ record, item }) => <li key={record.id}>{item.title}{!hasReactionEvidence(item) ? " · 반응 미확인" : ""}</li>)}</ul>
      <label>주제 후보 이름<input required maxLength={240} value={topicTitle} onChange={event => { setTopicTitle(event.target.value); setRequestId(crypto.randomUUID()); }} placeholder="선택한 원문으로 다룰 질문" /></label>
      <p>선택한 원문만 주제 기획으로 가져갑니다. 브리프를 정하고 제작을 시작하면 쓰레드를 집필할 수 있습니다.</p>
      <div className="ca-v07-actions"><button type="button" disabled={busy} onClick={() => setSelectedIds([])}>선택 해제</button><button className="primary" disabled={busy || demo || !topicTitle.trim()}>{busy ? "가져오는 중…" : "주제 후보로 가져오기"}</button><Link href="/automation/topics">주제 기획 보기 →</Link></div>
    </form> : null}
  </div>;
}
