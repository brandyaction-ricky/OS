"use client";

import { PageTitle } from "./page-title";

import { BookCheck, Check, ChevronRight, CircleAlert, FileText, MessageSquareText, RotateCcw, Send, X } from "lucide-react";
import Link from "next/link";
import { KnowledgeReviewHistory } from "./knowledge-review-history";
import { KnowledgeProposalReview } from "./knowledge-proposal-review";
import { KnowledgeInlineProvider } from "./knowledge-inline";
import { MarkdownView } from "./knowledge-workspace";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, changeDocumentStatus, listDocuments, listDocumentVersions } from "@/lib/api-client";
import { getDemoKnowledgeDocuments, getDemoKnowledgeVersions, saveDemoKnowledgeDocument, addDemoKnowledgeEvent } from "@/lib/demo-knowledge-store";
import { diffMarkdownLines } from "@/lib/line-diff";
import type { DocumentStatus, KnowledgeDocument } from "@/lib/types";
import { statusLabel } from "./dashboard";
import { useSession } from "./session-provider";

function InboxContent() {
  const params = useSearchParams();
  const { demo, accessToken, profile } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(() => demo ? getDemoKnowledgeDocuments() : []);
  const [selectedId, setSelectedId] = useState(params.get("document"));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [completed, setCompleted] = useState<KnowledgeDocument | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [approvalLoaded, setApprovalLoaded] = useState(false);
  const [approvalError, setApprovalError] = useState(false);
  const [reviewMode, setReviewMode] = useState<"documents" | "proposals">("documents");
  const [reviewTab, setReviewTab] = useState<"changes" | "preview" | "comments">("changes");
  const [previousContent, setPreviousContent] = useState("");
  const [previousLoaded, setPreviousLoaded] = useState(false);

  const load = useCallback(async () => {
    if (demo) {setLoading(false);return;}
    if (!accessToken) return;
    setLoading(true);
    try { setDocuments((await listDocuments(accessToken, "limit=100&statuses=review,reviewed")).documents); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "검토함을 불러오지 못했습니다."); }
    finally {setLoading(false);}
  }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);

  const queue = useMemo(() => documents.filter((document) => ["review", "reviewed"].includes(document.status)), [documents]);
  const selected = queue.find((document) => document.id === selectedId) ?? queue[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setPreviousLoaded(false); setPreviousContent("");
    const versions = demo ? Promise.resolve({ versions: getDemoKnowledgeVersions(selected.id) }) : listDocumentVersions(accessToken, selected.id);
    versions.then((result) => {
      if (!active) return;
      const previous = result.versions.find((item) => item.version_no < selected.current_version);
      setPreviousContent(previous?.content_md ?? ""); setPreviousLoaded(true);
    }).catch(() => { if (active) setPreviousLoaded(true); });
    return () => { active = false; };
  }, [selected, accessToken, demo]);

  const reviewDiff = useMemo(() => selected && previousLoaded ? diffMarkdownLines(previousContent, selected.content_md) : [], [selected, previousContent, previousLoaded]);

  useEffect(() => {
    if (!selected) { setApprovalLoaded(true); setCanApprove(false); return; }
    if (demo) {
      setCanApprove(selected.owner_id !== profile?.id && profile?.role === "admin");
      setApprovalError(false);
      setApprovalLoaded(true);
      return;
    }
    let cancelled = false;
    setApprovalLoaded(false);
    apiRequest<{ canApprove: boolean }>(`/api/v1/approvals?documentId=${encodeURIComponent(selected.id)}`, { token: accessToken })
      .then((result) => { if (!cancelled) { setCanApprove(result.canApprove); setApprovalError(false); } })
      .catch(() => { if (!cancelled) { setCanApprove(false); setApprovalError(true); } })
      .finally(() => { if (!cancelled) setApprovalLoaded(true); });
    return () => { cancelled = true; };
  }, [selected, accessToken, demo, profile?.id, profile?.role]);

  const move = async (status: DocumentStatus) => {
    if (!selected || busy) return;
    if ((status === "reviewed" || status === "canonical") && !canApprove) { setError("작성자는 승인할 수 없습니다. 지정된 승인자 또는 유효한 위임자에게 요청해 주세요."); return; }
    if (status === "team" && !note.trim()) { setError("작성자가 수정할 수 있도록 보완 이유를 적어주세요."); return; }
    setBusy(true); setError("");
    try {
      const document = demo ? { ...selected, status, updated_at: new Date().toISOString() } : (await changeDocumentStatus(accessToken, selected.id, status, note)).document;
      if (demo) { saveDemoKnowledgeDocument(document); addDemoKnowledgeEvent(document, note); }
      setDocuments((current) => current.map((item) => item.id === document.id ? document : item));
      setNote(""); setCompleted(document);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <header className="page-header"><div className="page-title-group"><PageTitle /><p>팀의 경험을 확인하고 회사가 신뢰할 수 있는 정본으로 승인합니다.</p></div><div className="header-actions"><span className="review-count"><CircleAlert size={15} /> 검토 요청 {loading?"…":queue.filter((item) => item.status === "review").length}건</span></div></header>
      {error ? <div className="inline-alert danger">{error}<button onClick={() => setError("")}><X size={14} /></button></div> : null}
      {completed ? <p className="inline-alert" role="status">{completed.title} · {statusLabel(completed.status)} 상태로 변경했습니다. <Link href={`/knowledge?document=${completed.id}`}>변경한 원문 열기</Link></p> : null}
      <div className="knowledge-proposal-tabs" role="tablist" aria-label="검토 유형"><button type="button" role="tab" aria-selected={reviewMode === "documents"} onClick={() => setReviewMode("documents")}>문서 검토</button><button type="button" role="tab" aria-selected={reviewMode === "proposals"} onClick={() => setReviewMode("proposals")}>정본 변경 제안</button></div>
      {reviewMode === "proposals" ? <KnowledgeProposalReview /> :
      <section className="review-layout">
        <aside className="panel review-queue">
          <div className="panel-header"><div><h2>검토 목록</h2><p>최근 변경 순으로 표시합니다.</p></div></div>
          {queue.map((document) => <button key={document.id} className={selected?.id === document.id ? "active" : ""} onClick={() => { setSelectedId(document.id); setNote(""); }}><span className={`document-symbol status-${document.status}`}><FileText size={15} /></span><span><strong>{document.title}</strong><small>{document.team || "전체"} · v{document.current_version}</small></span><ChevronRight size={14} /></button>)}
          {loading ? <p role="status">검토 목록 불러오는 중…</p> : !queue.length && !error ? <div className="quiet-state"><BookCheck size={25} /><strong>모든 검토를 마쳤습니다</strong><span>새 요청이 들어오면 표시됩니다.</span></div> : null}
        </aside>
        <article className="panel review-document">
          {selected ? <>
            <header><div><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><h2>{selected.title}</h2><p>{selected.folder || "분류 없음"} · {selected.brand || "전체 브랜드"} · v{selected.current_version}</p></div></header>
            <div className="knowledge-proposal-tabs" role="tablist" aria-label="문서 검토 보기">{([ ["changes", "변경 사항"], ["preview", "미리보기"], ["comments", "댓글·이력"] ] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={reviewTab === id} key={id} onClick={() => setReviewTab(id)}>{label}</button>)}</div>
            {reviewTab === "changes" ? <div className="knowledge-proposal-diff"><p>{previousLoaded ? selected.current_version > 1 ? `직전 v${selected.current_version - 1}와 비교` : "첫 버전" : "이전 버전 불러오는 중…"}</p><div className="knowledge-proposal-lines">{reviewDiff.map((line, index) => <div key={`${line.kind}-${line.oldLine}-${line.newLine}-${index}`} className={`knowledge-proposal-line ${line.kind}`}><span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><b aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</b><code>{line.text || " "}</code></div>)}</div></div> : null}
            {reviewTab === "preview" ? <div className="review-content"><KnowledgeInlineProvider documentId={selected.id} revision={selected.current_version}><MarkdownView content={selected.content_md} onOpenLink={() => {}} /></KnowledgeInlineProvider><Link href={`/knowledge?document=${selected.id}`}>원문에서 읽기·편집</Link></div> : null}
            {reviewTab === "comments" ? <KnowledgeReviewHistory id={selected.id} token={accessToken} demo={demo} revision={selected.updated_at} /> : null}
            <div className="review-note"><MessageSquareText size={16} /><input aria-label="검토 사유" maxLength={500} disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} placeholder="승인 또는 보완 이유를 남겨주세요" /></div>
            {approvalLoaded && !canApprove ? <p className="inline-alert">{approvalError ? "승인 규칙을 확인할 수 없어 승인 동작을 잠갔습니다. 연결 상태를 확인해 주세요." : selected.owner_id === profile?.id ? "작성자는 자신의 문서를 승인할 수 없습니다." : "지정된 승인자 또는 유효한 위임자만 승인할 수 있습니다."}</p> : null}
            <footer>
              {selected.status === "review" ? <><button className="secondary-button" disabled={busy} onClick={() => move("team")}><RotateCcw size={15} /> 보완 요청</button><button className="primary-button" disabled={busy || !approvalLoaded || !canApprove} onClick={() => move("reviewed")}><Check size={15} /> 검토 완료</button></> : <><button className="secondary-button" disabled={busy} onClick={() => move("review")}><RotateCcw size={15} /> 검토로 되돌리기</button><button className="primary-button" disabled={busy || !approvalLoaded || !canApprove} title="작성자가 아닌 지정 승인자 또는 위임자만 공개할 수 있습니다" onClick={() => move("canonical")}><Send size={15} /> 회사 정본으로 공개</button></>}
            </footer>
          </> : <div className="empty-state"><div><span><BookCheck /></span><h3>검토할 문서가 없습니다</h3><p>팀원이 검토를 요청하면 문서 내용과 이력을 확인할 수 있습니다.</p></div></div>}
        </article>
        <aside className="panel review-checklist"><div className="panel-header"><h3>정본 확인 기준</h3></div><ul><li><span><Check size={12} /></span>실제 업무에서 검증된 내용인가</li><li><span><Check size={12} /></span>누가 보아도 같은 의미로 이해되는가</li><li><span><Check size={12} /></span>현재 정책과 충돌하지 않는가</li><li><span><Check size={12} /></span>근거와 원본을 추적할 수 있는가</li></ul><p>작성자와 최종 검토자를 분리하면 정본의 신뢰도가 높아집니다.</p></aside>
      </section>}
    </>
  );
}

export function ReviewInbox() { return <Suspense><InboxContent /></Suspense>; }
