"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { KnowledgeDocument } from "@/lib/types";
import type { Candidate, Person } from "@/lib/knowledge/model";

/**
 * 정본으로 가는 길 (대표 2026-11-28): every document shows where it stands — 내 초안 → 팀 공유 → 정본 요청 → 정본 —
 * and only the one next step as a button. Statuses map: draft · team · review/reviewed · canonical.
 */
export const STAGES = ["내 초안", "팀 공유", "정본 요청", "정본"] as const;
export function documentStage(status: KnowledgeDocument["status"]) {
  return status === "canonical" ? 3 : status === "review" || status === "reviewed" ? 2 : status === "team" ? 1 : 0;
}
/** Status words people read; the space badge alone showed review and reviewed as 팀 문서. */
export function statusLabel(status: KnowledgeDocument["status"]) {
  return status === "review" ? "정본 요청 중" : status === "reviewed" ? "등록 대기" : null;
}
/** Who decides a request when nobody is chosen: the person who registers company canon, else the first approver. */
export function defaultApprover(people: Person[], self: string) {
  const approvers = people.filter(p => p.can_approve && p.member_kind === "staff");
  return (approvers.find(p => p.publisher) ?? approvers.find(p => p.id === self) ?? approvers[0])?.id ?? "";
}
export function inDays(days: number, from = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(from.getTime() + days * 86400000));
}

export function DocumentStage({ document: doc, candidates, people, mine, onShare, onUnshare, onRequest, onWithdraw }: {
  document: KnowledgeDocument; candidates: Candidate[]; people: Person[]; mine: boolean;
  onShare: () => void; onUnshare: () => void; onRequest: () => void; onWithdraw: (id: string) => void;
}) {
  if (doc.meeting_record_id || doc.status === "archived") return null;
  const at = documentStage(doc.status);
  const name = (id?: string | null) => people.find(p => p.id === id)?.display_name ?? "승인자";
  const own = candidates.filter(c => c.document_id === doc.id).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const open = own.find(c => c.status === "open"), approved = own.find(c => c.status === "approved");
  const returned = doc.status === "team" ? own.find(c => c.status === "returned" && c === own[0]) : undefined;
  let note: ReactNode = null, action: ReactNode = null, second: ReactNode = null;
  if (doc.status === "draft") {
    note = "나만 보는 초안이에요. 팀이 함께 보고 고치려면 공유하세요.";
    if (mine) action = <button className="kw-primary" onClick={onShare}>팀에 공유하기</button>;
  } else if (doc.status === "team") {
    note = returned ? <><strong>보완 요청</strong> · {name(returned.decided_by)}: {returned.decision_note || "메모 없음"}</> : "팀이 함께 보는 문서예요. 회사 기준으로 쓰려면 정본으로 요청하세요.";
    if (mine) { action = <button className="kw-primary" onClick={onRequest}>{returned ? "고쳐서 다시 요청하기" : "정본으로 요청하기"}</button>; second = <button onClick={onUnshare}>내 노트로 되돌리기</button>; }
  } else if (doc.status === "review") {
    note = <>{name(open?.requested_approver_id)} 검토 대기{open?.submit_note ? <> · 「{open.submit_note}」</> : null}</>;
    action = <Link className="kw-stage-link" href={`/knowledge/review?id=${open?.id ?? ""}`}>검토 화면에서 보기</Link>;
    if (open && open.submitted_by && mine) second = <button onClick={() => onWithdraw(open.id)}>요청 취소</button>;
  } else if (doc.status === "reviewed") {
    note = <>승인됨 · 정본 등록 대기{approved?.approved_version && approved.approved_version !== doc.current_version ? " · 승인 뒤 내용이 바뀌어 다시 확인을 받아요" : ""}</>;
    action = <Link className="kw-stage-link" href={`/knowledge/review?id=${approved?.id ?? ""}`}>검토 화면에서 보기</Link>;
  } else {
    note = "회사 정본이에요. 고칠 점은 변경 제안으로 보내면 승인 뒤 새 버전이 돼요.";
    action = <Link className="kw-stage-link" href={`/knowledge/canon/${doc.id}/propose`}>변경 제안하기</Link>;
  }
  return <section className="kw-stage" aria-label="정본으로 가는 단계">
    <ol>{STAGES.map((label, i) => <li key={label} data-state={i < at ? "done" : i === at ? "now" : "next"} aria-current={i === at ? "step" : undefined}>
      <b><span>{i < at ? <Check size={12} aria-hidden/> : i + 1}</span>{label}</b></li>)}</ol>
    <div className="kw-stage-row"><p data-tone={returned ? "warn" : undefined}>{note}</p><div className="kw-actions">{second}{action}</div></div>
  </section>;
}
