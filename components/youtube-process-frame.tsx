"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Clock, Info, PauseCircle } from "lucide-react";
import { editedSinceDecision, GATE_FIELDS, GATE_NAME } from "@/lib/youtube-process/confirm";
import { projectName, stepHref, YP_FLOW, YP_KIND_LABEL, YP_STAGE_INDEX, type YpGate } from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";
import { useYoutubeCanConfirm } from "./use-youtube-confirm";
import { ConfirmActions } from "./youtube-process-confirm";
import { errorMessage, isConflict, youtubeProcessClient, type YpBundle, type YpMember } from "./youtube-process-data";
import { YoutubeFlow, type YpAction } from "./youtube-process-flow";

export const LAST_KEY = "brandy-yp-last-project";
export const md = (iso?: string) => { if (!iso) return ""; const date = new Date(iso); return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };
export const daysSince = (iso?: string) => iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : 0;
export const hhmm = () => { const date = new Date(); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };

/** One step screen's project: loaded from ?project= (or the last one opened), with its step records and finals. */
export function useYpBundle() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = params.get("project");
  const { accessToken, demo, profile } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const canConfirm = useYoutubeCanConfirm(true, accessToken, demo, profile?.role === "admin");
  const [bundle, setBundle] = useState<YpBundle | null>(null);
  const [members, setMembers] = useState<YpMember[]>([]);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (id) return;
    let last = "";
    try { last = localStorage.getItem(LAST_KEY) ?? ""; } catch { /* the list is the fallback */ }
    router.replace(last ? `${pathname}?project=${encodeURIComponent(last)}` : "/content/projects");
  }, [id, pathname, router]);
  const reload = useCallback(async () => {
    if (!client || !id) return;
    setError(""); setConflict(false);
    try {
      const [next, people] = await Promise.all([client.bundle(id), client.members().catch(() => [] as YpMember[])]);
      setBundle(next); setMembers(people);
      try { localStorage.setItem(LAST_KEY, next.project.id); } catch { /* convenience only */ }
    } catch (reason) { setError(errorMessage(reason)); }
  }, [client, id]);
  useEffect(() => { void reload(); }, [reload]);
  const fail = useCallback((reason: unknown) => { if (isConflict(reason)) setConflict(true); else setError(errorMessage(reason)); }, []);
  return { client, id, bundle, setBundle, members, reload, error, setError, conflict, fail, canConfirm, demo, accessToken, profile };
}
export type YpPage = ReturnType<typeof useYpBundle>;

/** A gate's request · cancel for the progress line (S0) and the re-request reason (S11-5). */
export function useGate(page: YpPage, gate: YpGate) {
  const [busy, setBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const act = async (action: "request" | "cancel", reply?: string) => {
    const project = page.bundle?.project;
    if (!page.client || !project) return;
    if (action === "request" && !reply && project.yp.gates[gate].state === "changes" && !editedSinceDecision(project, gate)) { setReplyOpen(true); return; }
    setBusy(true); page.setError("");
    try {
      const result = await page.client.gate(project.id, gate, action, project.version, reply);
      setReplyOpen(false);
      page.setBundle(current => current ? { ...current, project: result.project } : current);
    } catch (reason) { page.fail(reason); } finally { setBusy(false); }
  };
  return { busy, act, replyOpen, setReplyOpen };
}

/** The one 'what to do now' control (지시서 4-1 표) for a confirm step. */
export function gateAction(page: YpPage, gate: YpGate, view: number, control: ReturnType<typeof useGate>, missing: string): YpAction {
  const project = page.bundle!.project;
  const current = project.yp.stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[project.yp.stage];
  if (view !== current && current < YP_FLOW.length) return { kind: "link", label: `지금 단계로: ${YP_FLOW[current]}`, href: stepHref(current, project.id) };
  const info = project.yp.gates[gate];
  if (info.state === "wait") return { kind: "status", status: `대표 컨펌 대기 · ${daysSince(info.requestedAt)}일`, secondary: { label: "요청 취소", onClick: () => void control.act("cancel") } };
  return { kind: "button", label: `${GATE_NAME[gate]} ${["changes", "hold"].includes(info.state) ? "다시 요청" : "요청"}`, reason: missing, busy: control.busy, onClick: () => void control.act("request") };
}
/** '지금 단계로' when looking at another step, else the step's own action. */
export function stepAction(page: YpPage, view: number, own: YpAction): YpAction {
  const project = page.bundle!.project;
  const current = project.yp.stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[project.yp.stage];
  return view !== current && current < YP_FLOW.length ? { kind: "link", label: `지금 단계로: ${YP_FLOW[current]}`, href: stepHref(current, project.id) } : own;
}

/** 칸 묶음 (시안 fsec). */
export function YpSection({ n, title, gq, need, rev, extra, id, children, className = "" }: { n?: number; title: string; gq?: string; need?: boolean | null; rev?: boolean; extra?: ReactNode; id?: string; className?: string; children: ReactNode }) {
  return <section className={`yp-fsec ${className}${rev ? " yp-rev" : ""}`} id={id}>
    <div className="yp-fsec-h">{n ? <span className="yp-n">{n}</span> : null}<b>{title}</b>{need === true ? <span className="yp-need">필수</span> : need === false ? <span className="yp-opt">선택</span> : null}
      {gq ? <span className="yp-gq">{gq}</span> : null}{rev ? <span className="yp-revtag">고칠 칸</span> : null}<span className="yp-sp" />{extra}</div>
    <div className="yp-fsec-b">{children}</div>
  </section>;
}

/** The wait · 수정 요청 · 보류 · OK line of a confirm step (S2 · S3 · S6). */
export function GateBanner({ page, gate, okExtra }: { page: YpPage; gate: YpGate; okExtra?: ReactNode }) {
  const project = page.bundle!.project;
  const info = project.yp.gates[gate] as typeof project.yp.gates[YpGate] & { pdReply?: string };
  const name = GATE_NAME[gate];
  if (info.state === "wait") return <div className="yp-cwait" role="status">
    <div className="yp-cwait-h"><Clock size={16} className="yp-i" aria-hidden="true" /><b>{name} · 대표 대기</b><span className="yp-hint">{md(info.requestedAt)} 올라감 · 대기 {daysSince(info.requestedAt)}일 · 6시간마다 다시 알림 (22~08시 제외)</span></div>
    {info.pdReply ? <p className="yp-reply-note"><b>PD 답글</b> · 고친 칸 없이 다시 요청: “{info.pdReply}”</p> : null}
    {page.canConfirm && page.client ? <ConfirmActions project={project} gate={gate} client={page.client} onDone={() => void page.reload()} />
      : <p className="yp-hint">{gate === "draft" ? "바꾸고 싶은 건 대표가 [수정 요청]에 메모로 남겨요. OK가 나면 제목 · 썸네일 A · B · (C)가 확정돼요." : gate === "review" ? "대표 OK가 나야 업로드로 넘어가요. 수정 요청이면 최종 검수로 돌아와요." : "OK가 나면 다음 단계가 열려요."} 기다리는 동안 고치려면 위 [요청 취소]를 누르세요.</p>}
  </div>;
  if (info.state === "changes") return <div className="yp-note yp-warn" role="status"><AlertTriangle size={16} className="yp-i" aria-hidden="true" /><div><b>대표 수정 요청 · {md(info.decidedAt)}</b><br />메모: “{info.memo}”<br />고칠 칸: {(info.fields ?? []).map(field => GATE_FIELDS[gate][field] ?? field).join(", ")}. 고친 뒤 위 [{name} 다시 요청]을 누르세요. 고칠 게 없다고 판단하면 이유와 함께 그대로 다시 요청할 수 있어요.</div></div>;
  if (info.state === "hold") return <div className="yp-note yp-bad" role="status"><PauseCircle size={16} className="yp-i" aria-hidden="true" /><div><b>보류됨 · {md(info.decidedAt)} · 대표</b><br />사유: “{info.reason}”<br />손본 뒤 다시 요청할 수 있어요.</div></div>;
  if (info.state === "ok") return <div className="yp-note yp-ok" role="status"><Check size={16} className="yp-i" aria-hidden="true" /><div><b>{name} OK · {md(info.decidedAt)} · 대표</b>{okExtra}</div></div>;
  return null;
}

/** The re-request reason form (S11-5): asked when nothing changed since the 수정 요청. */
export function ReplyForm({ control }: { control: ReturnType<typeof useGate> }) {
  const [text, setText] = useState("");
  if (!control.replyOpen) return null;
  return <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); if (text.trim()) void control.act("request", text.trim()); }}>
    <label>고친 칸이 없어요. 다시 요청하는 이유를 한 줄 써 주세요 (대표 화면에 ‘PD 답글’로 보여요)<input className="yp-in" maxLength={200} value={text} onChange={event => setText(event.target.value)} /></label>
    <div><button type="submit" className="yp-btn yp-pri" disabled={control.busy || !text.trim()}>이유와 함께 다시 요청</button> <button type="button" className="yp-btn" onClick={() => control.setReplyOpen(false)}>취소</button></div>
  </form>;
}

/** 영상 주제 card with 더 보기 (시안 subjHTML · moreHTML). */
export function Subject({ page }: { page: YpPage }) {
  const [open, setOpen] = useState(false);
  const project = page.bundle!.project;
  const pd = page.members.find(member => member.id === project.assigneeId)?.name ?? "—";
  return <>
    <section className="yp-subj"><div className="yp-subj-m"><div className="yp-subj-k">영상 주제</div><div className="yp-subj-t">{projectName(project)}</div>
      <div className="yp-subj-meta"><span className="yp-tag">{project.yp.topic.type ? YP_KIND_LABEL[project.yp.topic.type] : "유형 없음"}</span><span>담당 PD: {pd}</span></div></div>
      <button type="button" className="yp-btn" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "접기" : "더 보기"} {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></section>
    {open ? <section className="yp-card yp-more"><div className="yp-card-b"><dl className="yp-kv">
      <dt>정밀 타겟</dt><dd>{project.yp.topic.target || "—"}</dd>
      <dt>레퍼런스</dt><dd>{project.yp.topic.refs.length ? project.yp.topic.refs.map(ref => <div key={ref.url}><a href={ref.url} target="_blank" rel="noreferrer">{ref.title ?? ref.url}</a></div>) : "없음"}</dd>
      <dt>전달 사항</dt><dd>{project.yp.topic.note || "없음"}</dd>
      <dt>주제 화면</dt><dd><Link className="yp-lnk" href={stepHref(0, project.id)}>주제 보기 →</Link></dd></dl></div></section> : null}
  </>;
}

/** Every step screen: progress line, page title, the step's own heading (시안 stageHead) and the shared notices. */
export function YpFrame({ page, view, action, header, title, sub, savedAt, onSave, saveDisabled, children }: {
  page: YpPage; view: number; action: YpAction | null; header: ReactNode; title: string; sub: string; savedAt?: string; onSave?: () => void; saveDisabled?: boolean; children?: ReactNode;
}) {
  if (!page.id) return <>{header}<p className="yp-hint" role="status">프로젝트를 여는 중이에요…</p></>;
  if (!page.bundle) return <>{header}{page.error ? <div className="yp-note yp-warn" role="alert"><div>{page.error} <button type="button" className="yp-lnk" onClick={() => void page.reload()}>다시 불러오기</button></div></div>
    : <p className="yp-hint" role="status">프로젝트를 불러오는 중이에요…</p>}</>;
  return <>
    {action ? <YoutubeFlow project={page.bundle.project} view={view} action={action} /> : null}
    {header}
    <div className="yp-shead"><div><h2>{title}</h2><p className="yp-sub">{sub}</p></div>
      {onSave ? <div className="yp-stool">{savedAt ? <span className="yp-stamp"><i />저장됨 {savedAt}</span> : null}<button type="button" className="yp-btn yp-sm" disabled={saveDisabled} onClick={onSave}>임시 저장</button></div> : null}</div>
    {page.conflict ? <div className="yp-note yp-warn" role="alert"><div>다른 사람이 먼저 고쳤어요. <button type="button" className="yp-lnk" onClick={() => void page.reload()}>새로 불러오기</button> (지금 쓴 내용은 사라져요)</div></div> : null}
    {page.error ? <div className="yp-note yp-warn" role="alert"><div>{page.error}</div></div> : null}
    {children}
  </>;
}

/** A step not reached yet (시안 lockedPage). */
export function LockedStep({ page, name }: { page: YpPage; name: string }) {
  const project = page.bundle!.project;
  const current = project.yp.stage === "done" ? 0 : YP_STAGE_INDEX[project.yp.stage];
  return <div className="yp-locked"><Info size={18} className="yp-i" aria-hidden="true" /><div><b>{name} 단계는 아직 열리지 않았어요</b><p>지금 단계는 {YP_FLOW[current]}이에요. <Link className="yp-lnk" href={stepHref(current, project.id)}>지금 단계로 가기 →</Link></p></div></div>;
}
