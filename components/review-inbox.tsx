"use client";

import { BookCheck, Check, ChevronRight, CircleAlert, FileText, MessageSquareText, RotateCcw, Send, X } from "lucide-react";
import Link from "next/link";
import { KnowledgeReviewHistory } from "./knowledge-review-history";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { changeDocumentStatus, listDocuments } from "@/lib/api-client";
import { getDemoKnowledgeDocuments, saveDemoKnowledgeDocument, addDemoKnowledgeEvent } from "@/lib/demo-knowledge-store";
import type { DocumentStatus, KnowledgeDocument } from "@/lib/types";
import { statusLabel } from "./dashboard";
import { useSession } from "./session-provider";

function InboxContent() {
  const params = useSearchParams();
  const { demo, accessToken, profile } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(() => demo ? getDemoKnowledgeDocuments() : []);
  const [selectedId, setSelectedId] = useState(params.get("document"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [completed, setCompleted] = useState<KnowledgeDocument | null>(null);

  const load = useCallback(async () => {
    if (demo) return;
    try { setDocuments((await listDocuments(accessToken, "limit=100&statuses=review,reviewed")).documents); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "검토함을 불러오지 못했습니다."); }
  }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);

  const queue = useMemo(() => documents.filter((document) => ["review", "reviewed"].includes(document.status)), [documents]);
  const selected = queue.find((document) => document.id === selectedId) ?? queue[0] ?? null;

  const move = async (status: DocumentStatus) => {
    if (!selected || busy) return;
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
      <header className="page-header"><div className="page-title-group"><span className="eyebrow">검토함</span><h1>지식 검토함</h1><p>팀의 경험을 확인하고 회사가 신뢰할 수 있는 정본으로 승인합니다.</p></div><div className="header-actions"><span className="review-count"><CircleAlert size={15} /> 검토 요청 {queue.filter((item) => item.status === "review").length}건</span></div></header>
      {error ? <div className="inline-alert danger">{error}<button onClick={() => setError("")}><X size={14} /></button></div> : null}
      {completed ? <p className="inline-alert" role="status">{completed.title} · {statusLabel(completed.status)} 상태로 변경했습니다. <Link href={`/knowledge?document=${completed.id}`}>변경한 원문 열기</Link></p> : null}
      <section className="review-layout">
        <aside className="panel review-queue">
          <div className="panel-header"><div><h2>검토 목록</h2><p>최근 변경 순으로 표시합니다.</p></div></div>
          {queue.map((document) => <button key={document.id} className={selected?.id === document.id ? "active" : ""} onClick={() => { setSelectedId(document.id); setNote(""); }}><span className={`document-symbol status-${document.status}`}><FileText size={15} /></span><span><strong>{document.title}</strong><small>{document.team || "전체"} · v{document.current_version}</small></span><ChevronRight size={14} /></button>)}
          {!queue.length ? <div className="quiet-state"><BookCheck size={25} /><strong>모든 검토를 마쳤습니다</strong><span>새 요청이 들어오면 표시됩니다.</span></div> : null}
        </aside>
        <article className="panel review-document">
          {selected ? <>
            <header><div><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><h2>{selected.title}</h2><p>{selected.folder || "분류 없음"} · {selected.brand || "전체 브랜드"} · v{selected.current_version}</p></div></header>
            <div className="review-content"><pre>{selected.content_md}</pre><Link href={`/knowledge?document=${selected.id}`}>원문에서 읽기·편집</Link></div><KnowledgeReviewHistory id={selected.id} token={accessToken} demo={demo} revision={selected.updated_at} />
            <div className="review-note"><MessageSquareText size={16} /><input aria-label="검토 사유" maxLength={500} disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} placeholder="승인 또는 보완 이유를 남겨주세요" /></div>
            <footer>
              {selected.status === "review" ? <><button className="secondary-button" disabled={busy} onClick={() => move("team")}><RotateCcw size={15} /> 보완 요청</button><button className="primary-button" disabled={busy} onClick={() => move("reviewed")}><Check size={15} /> 검토 완료</button></> : <><button className="secondary-button" disabled={busy} onClick={() => move("review")}><RotateCcw size={15} /> 검토로 되돌리기</button><button className="primary-button" disabled={busy || (selected.owner_id !== profile?.id && profile?.role !== "admin")} title="작성자 또는 관리자가 공개할 수 있습니다" onClick={() => move("canonical")}><Send size={15} /> 회사 정본으로 공개</button></>}
            </footer>
          </> : <div className="empty-state"><div><span><BookCheck /></span><h3>검토할 문서가 없습니다</h3><p>팀원이 검토를 요청하면 문서 내용과 이력을 확인할 수 있습니다.</p></div></div>}
        </article>
        <aside className="panel review-checklist"><div className="panel-header"><h3>정본 확인 기준</h3></div><ul><li><span><Check size={12} /></span>실제 업무에서 검증된 내용인가</li><li><span><Check size={12} /></span>누가 보아도 같은 의미로 이해되는가</li><li><span><Check size={12} /></span>현재 정책과 충돌하지 않는가</li><li><span><Check size={12} /></span>근거와 원본을 추적할 수 있는가</li></ul><p>작성자와 최종 검토자를 분리하면 정본의 신뢰도가 높아집니다.</p></aside>
      </section>
    </>
  );
}

export function ReviewInbox() { return <Suspense><InboxContent /></Suspense>; }
