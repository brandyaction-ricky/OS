"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { diffMarkdownLines } from "@/lib/line-diff";
import type { DocumentProposal, DocumentProposalComment, KnowledgeDocument } from "@/lib/types";
import { KnowledgeInlineProvider } from "./knowledge-inline";
import { MarkdownView } from "./knowledge-workspace";
import { useSession } from "./session-provider";
import { useSearchParams } from "next/navigation";

type ProposalResponse = { proposals: DocumentProposal[]; documents: KnowledgeDocument[]; comments: DocumentProposalComment[]; incomingLinks?: number | null };
type Tab = "changes" | "preview" | "comments";

export function KnowledgeProposalReview() {
  const requestedId=useSearchParams().get("proposal");
  const { accessToken, demo, profile } = useSession();
  const [proposals, setProposals] = useState<DocumentProposal[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [comments, setComments] = useState<DocumentProposalComment[]>([]);
  const [tab, setTab] = useState<Tab>("changes");
  const [context, setContext] = useState(false);
  const [lineNo, setLineNo] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (demo) { setLoaded(true); return; }
    try {
      const result = await apiRequest<ProposalResponse>("/api/v1/documents/proposals", { token: accessToken });
      setProposals(result.proposals);
      setDocuments(result.documents);
      setSelectedId((current) => current && result.proposals.some((item) => item.id === current) ? current : result.proposals[0]?.id ?? null);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "변경 제안을 불러오지 못했습니다."); }
    finally { setLoaded(true); }
  }, [accessToken, demo]);

  useEffect(() => { void load(); }, [load]);
  const selected = proposals.find((item) => item.id === selectedId) ?? null;
  const document = documents.find((item) => item.id === selected?.document_id) ?? null;
  const diff = useMemo(() => selected && document ? diffMarkdownLines(document.content_md, selected.content_md) : [], [selected, document]);
  const visibleDiff = useMemo(() => context ? diff : diff.filter((line, index) => line.kind !== "same" || diff.slice(Math.max(0, index - 3), Math.min(diff.length, index + 4)).some((near) => near.kind !== "same")), [context, diff]);

  useEffect(() => {
    if (!selected || !document || demo) { setCanApprove(false); return; }
    let active = true;
    setCanApprove(false);
    Promise.all([
      apiRequest<{ canApprove: boolean }>(`/api/v1/approvals?documentId=${encodeURIComponent(document.id)}`, { token: accessToken }),
      apiRequest<ProposalResponse>(`/api/v1/documents/proposals?id=${encodeURIComponent(selected.id)}`, { token: accessToken }),
    ]).then(([permission, detail]) => {
      if (!active) return;
      setCanApprove(permission.canApprove && selected.author_id !== profile?.id);
      setComments(detail.comments);
    }).catch((reason) => { if (active) { setCanApprove(false); setError(reason instanceof Error ? reason.message : "제안을 확인하지 못했습니다."); } });
    return () => { active = false; };
  }, [selected, document, accessToken, demo, profile?.id]);

  const decide = async (action: "approve" | "return" | "withdraw") => {
    if (!selected || busy) return;
    if (action === "return" && !note.trim()) { setError("보완 이유를 입력해 주세요."); return; }
    setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/documents/proposals", { method: "POST", token: accessToken,
        body: JSON.stringify({ action, proposalId: selected.id, ...(action === "withdraw" ? {} : { note }) }) });
      setNotice(action === "approve" ? "제안을 정본의 새 버전으로 반영했습니다." : action === "return" ? "보완을 요청했습니다." : "제안을 철회했습니다.");
      setNote(""); setComments([]); setSelectedId(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "제안을 처리하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const addComment = async () => {
    if (!selected || !lineNo || !comment.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ comment: DocumentProposalComment }>("/api/v1/documents/proposals", {
        method: "POST", token: accessToken, body: JSON.stringify({ action: "comment", proposalId: selected.id, lineNo, body: comment.trim() }),
      });
      setComments((current) => [...current, result.comment]); setComment(""); setTab("comments");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "댓글을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <section className="review-layout" aria-label="정본 변경 제안">
    <aside className="panel review-queue"><div className="panel-header"><div><h2>변경 제안 {proposals.length}건</h2><p>정본은 승인 전까지 그대로입니다.</p></div></div>
      {proposals.map((item) => <button type="button" key={item.id} className={item.id === selected?.id ? "active" : ""} onClick={() => { setSelectedId(item.id); setLineNo(null); setTab("changes"); setError(""); }}><span><strong>{item.title}</strong><small>기준 v{item.base_version} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</small></span></button>)}
      {loaded && !proposals.length ? <div className="quiet-state">대기 중인 정본 변경 제안이 없습니다.</div> : null}
    </aside>
    <article className="panel review-document">
      {notice ? <p className="inline-alert" role="status">{notice}</p> : null}
      {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
      {selected && document ? <>
        <header><div><span className="status-pill">변경 제안</span><h2>{selected.title}</h2><p>{document.folder || "분류 없음"} · 정본 v{document.current_version} / 제안 기준 v{selected.base_version}</p>{selected.title !== document.title ? <p>제목 변경: {document.title} → {selected.title}</p> : null}</div></header>
        {document.current_version !== selected.base_version ? <p className="inline-alert danger" role="alert">정본이 제안 작성 후 변경됐습니다. 현재 버전과 다시 비교해 주세요. 승인하면 서버에서 거절됩니다.</p> : null}
        <div className="knowledge-proposal-tabs" role="tablist" aria-label="제안 검토 보기">
          {([ ["changes", "변경 사항"], ["preview", "미리보기"], ["comments", `댓글 ${comments.length}`] ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        {tab === "changes" ? <div className="knowledge-proposal-diff"><button type="button" className="ghost-button" onClick={() => setContext(!context)}>{context ? "변경 없는 줄 접기" : "변경 없는 줄 모두 보기"}</button>{!visibleDiff.length ? <p>본문 변경은 없습니다. 제목이나 문서 속성을 확인해 주세요.</p> : null}<div className="knowledge-proposal-lines" aria-label="줄 단위 변경 비교">{visibleDiff.map((line, index) => { const targetLine = line.newLine ?? Math.min(line.oldLine ?? 1, selected.content_md.split("\n").length); return <button type="button" key={`${line.kind}-${line.oldLine}-${line.newLine}-${index}`} className={`knowledge-proposal-line ${line.kind}`} title={`${targetLine}번째 줄에 댓글`} onClick={() => { setLineNo(targetLine); setTab("comments"); }}><span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><b aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</b><code>{line.text || " "}</code></button>; })}</div></div> : null}
        {tab === "preview" ? <div className="review-content"><KnowledgeInlineProvider documentId={document.id} revision={selected.base_version}><MarkdownView content={selected.content_md} onOpenLink={() => {}} /></KnowledgeInlineProvider></div> : null}
        {tab === "comments" ? <div className="knowledge-proposal-comments"><label>줄 번호 <input type="number" min={1} max={selected.content_md.split("\n").length} value={lineNo ?? ""} onChange={(event) => setLineNo(Number(event.target.value) || null)} /></label><textarea aria-label="줄 댓글" placeholder="이 줄에서 확인할 내용을 적어주세요" value={comment} onChange={(event) => setComment(event.target.value)} /><button type="button" className="secondary-button" disabled={busy || !lineNo || !comment.trim()} onClick={() => void addComment()}>댓글 저장</button>{comments.map((item) => <p key={item.id}><strong>{item.line_no}줄</strong> · {item.body}</p>)}</div> : null}
        <div className="review-note"><input aria-label="승인 또는 보완 이유" placeholder="승인 또는 보완 이유" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></div>
        {!canApprove ? <p className="review-approval-hint">작성자는 자신의 제안을 승인할 수 없습니다. 지정 승인자 또는 위임자에게 검토를 요청해 주세요.</p> : null}
        <footer><button type="button" className="secondary-button" disabled={busy || selected.author_id !== profile?.id} onClick={() => void decide("withdraw")}>제안 철회</button><button type="button" className="secondary-button" disabled={busy || !canApprove} onClick={() => void decide("return")}>보완 요청</button><button type="button" className="primary-button" disabled={busy || !canApprove || document.current_version !== selected.base_version} onClick={() => void decide("approve")}>승인하고 반영</button></footer>
      </> : <div className="empty-state"><div><h3>변경 제안을 선택해 주세요</h3><p>새 제안이 들어오면 현재 정본과 비교해 승인할 수 있습니다.</p></div></div>}
    </article>
  </section>;
}
