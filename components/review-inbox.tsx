"use client";

import { BookCheck, Check, ChevronRight, CircleAlert, FileText, MessageSquareText, RotateCcw, Send, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { changeDocumentStatus, listDocuments } from "@/lib/api-client";
import { DEMO_DOCUMENTS } from "@/lib/demo-data";
import type { DocumentStatus, KnowledgeDocument } from "@/lib/types";
import { statusLabel } from "./dashboard";
import { useSession } from "./session-provider";

function InboxContent() {
  const params = useSearchParams();
  const { demo, accessToken } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(demo ? DEMO_DOCUMENTS : []);
  const [selectedId, setSelectedId] = useState(params.get("document"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    try { setDocuments((await listDocuments(accessToken, "limit=100&statuses=review,reviewed")).documents); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "검토함을 불러오지 못했습니다."); }
  }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);

  const queue = useMemo(() => documents.filter((document) => ["review", "reviewed"].includes(document.status)), [documents]);
  const selected = queue.find((document) => document.id === selectedId) ?? queue[0] ?? null;

  const move = async (status: DocumentStatus) => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const document = demo ? { ...selected, status, updated_at: new Date().toISOString() } : (await changeDocumentStatus(accessToken, selected.id, status, note)).document;
      setDocuments((current) => current.map((item) => item.id === document.id ? document : item));
      setNote("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <header className="page-header"><div className="page-title-group"><span className="eyebrow">검토함</span><h1>지식 검토함</h1><p>팀의 경험을 확인하고 회사가 신뢰할 수 있는 정본으로 승인합니다.</p></div><div className="header-actions"><span className="review-count"><CircleAlert size={15} /> 검토 요청 {queue.filter((item) => item.status === "review").length}건</span></div></header>
      {error ? <div className="inline-alert danger">{error}<button onClick={() => setError("")}><X size={14} /></button></div> : null}
      <section className="review-layout">
        <aside className="panel review-queue">
          <div className="panel-header"><div><h2>검토 목록</h2><p>요청 순으로 표시합니다.</p></div></div>
          {queue.map((document) => <button key={document.id} className={selected?.id === document.id ? "active" : ""} onClick={() => setSelectedId(document.id)}><span className={`document-symbol status-${document.status}`}><FileText size={15} /></span><span><strong>{document.title}</strong><small>{document.team || "전체"} · v{document.current_version}</small></span><ChevronRight size={14} /></button>)}
          {!queue.length ? <div className="quiet-state"><BookCheck size={25} /><strong>모든 검토를 마쳤습니다</strong><span>새 요청이 들어오면 표시됩니다.</span></div> : null}
        </aside>
        <article className="panel review-document">
          {selected ? <>
            <header><div><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><h2>{selected.title}</h2><p>{selected.folder || "분류 없음"} · {selected.brand || "전체 브랜드"} · v{selected.current_version}</p></div></header>
            <div className="review-content"><pre>{selected.content_md}</pre></div>
            <div className="review-note"><MessageSquareText size={16} /><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="승인 또는 보완 이유를 남겨주세요" /></div>
            <footer>
              {selected.status === "review" ? <><button className="secondary-button" disabled={busy} onClick={() => move("team")}><RotateCcw size={15} /> 보완 요청</button><button className="primary-button" disabled={busy} onClick={() => move("reviewed")}><Check size={15} /> 검토 완료</button></> : <><button className="secondary-button" disabled={busy} onClick={() => move("review")}><RotateCcw size={15} /> 검토로 되돌리기</button><button className="primary-button" disabled={busy} onClick={() => move("canonical")}><Send size={15} /> 회사 정본으로 공개</button></>}
            </footer>
          </> : <div className="empty-state"><div><span><BookCheck /></span><h3>검토할 문서가 없습니다</h3><p>팀원이 검토를 요청하면 문서 내용과 이력을 확인할 수 있습니다.</p></div></div>}
        </article>
        <aside className="panel review-checklist"><div className="panel-header"><h3>정본 확인 기준</h3></div><ul><li><span><Check size={12} /></span>실제 업무에서 검증된 내용인가</li><li><span><Check size={12} /></span>누가 보아도 같은 의미로 이해되는가</li><li><span><Check size={12} /></span>현재 정책과 충돌하지 않는가</li><li><span><Check size={12} /></span>근거와 원본을 추적할 수 있는가</li></ul><p>작성자와 최종 검토자를 분리하면 정본의 신뢰도가 높아집니다.</p></aside>
      </section>
    </>
  );
}

export function ReviewInbox() { return <Suspense><InboxContent /></Suspense>; }
