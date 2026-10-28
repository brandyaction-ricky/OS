"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Clock, Info, PauseCircle } from "lucide-react";
import { editedSinceDecision, GATE_FIELDS, gateName } from "@/lib/youtube-process/confirm";
import { projectName, stepHref, stepName, YP_FLOW, YP_KIND_LABEL, YP_STAGE_INDEX, type YpGate, type YpProject } from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";
import { useYoutubeCanConfirm, YP_CONFIRM_EVENT } from "./use-youtube-confirm";
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
    // 「project=new」 is the topic screen before its first save: a new 숏폼's research panel mounts as the project is made, while the
    // address still says new, and asked for a project "new" (「프로젝트를 찾지 못했습니다」, 시안 2 2026-10-28). The saved id follows.
    if (!client || !id || id === "new") return;
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

/** A gate's PD 컨펌 (owner decision 2026-10-26) · legacy request cancel for the progress line (S0), and the re-request reason (S11-5). */
export function useGate(page: YpPage, gate: YpGate) {
  const [busy, setBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const act = async (action: "confirm" | "request" | "cancel", reply?: string) => {
    const project = page.bundle?.project;
    if (!page.client || !project) return;
    if (action === "request" && !reply && project.yp.gates[gate].state === "changes" && !editedSinceDecision(project, gate)) { setReplyOpen(true); return; }
    setBusy(true); page.setError("");
    try {
      const result = await page.client.gate(project.id, gate, action, project.version, reply);
      setReplyOpen(false);
      page.setBundle(current => current ? { ...current, project: result.project } : current);
      // The confirm is usually sent from the step's last button; its OK line (and the next step's link) sit at the top.
      if (action !== "cancel") window.scrollTo({ top: 0, behavior: "smooth" });
      window.dispatchEvent(new Event(YP_CONFIRM_EVENT));
    } catch (reason) { page.fail(reason); } finally { setBusy(false); }
  };
  return { busy, act, replyOpen, setReplyOpen };
}

/** The one 'what to do now' control (지시서 4-1 표) for a confirm step. */
export function gateAction(page: YpPage, gate: YpGate, view: number, control: ReturnType<typeof useGate>, missing: string): YpAction {
  const project = page.bundle!.project;
  const current = project.yp.stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[project.yp.stage];
  if (view !== current && current < YP_FLOW.length) return { kind: "link", label: `이어서 하기 · ${stepName(current, project.yp.topic.type)}`, href: stepHref(current, project.id) };
  // A request still waiting from before 2026-10-26 can be confirmed by the PD as well.
  return { kind: "button", label: `${gateName(gate, project.yp.topic.type)}하고 다음으로`, reason: missing, busy: control.busy, onClick: () => void control.act("confirm") };
}
/** '지금 단계로' when looking at another step, else the step's own action. */
export function stepAction(page: YpPage, view: number, own: YpAction): YpAction {
  const project = page.bundle!.project;
  const current = project.yp.stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[project.yp.stage];
  // A finished video keeps every step readable but offers no step's button (a request on 주제 would only be refused).
  if (current >= YP_FLOW.length) return own.kind === "status" ? own : { kind: "status", status: "끝난 영상이에요" };
  return view !== current ? { kind: "link", label: `이어서 하기 · ${stepName(current, project.yp.topic.type)}`, href: stepHref(current, project.id) } : own;
}

/** The sentence under a confirm step's title: what to do now, or that there is nothing to do while the 대표 decides. */
export function gateSub(project: YpProject | undefined, gate: YpGate, todo: string, done: string) {
  const state = project?.yp.gates[gate].state;
  if (state === "wait") return "대표 컨펌 요청이 남아 있어요. 이제 PD가 직접 컨펌하면 다음으로 넘어가요.";
  if (state === "changes") return "대표 수정 요청을 반영하고 컨펌해요. 모든 칸을 고칠 수 있어요.";
  if (state === "hold") return "보류됐어요. 손본 뒤 컨펌할 수 있어요.";
  if (state === "ok") return done;
  return todo;
}

/** 칸 묶음 (시안 fsec). */
export function YpSection({ n, title, gq, need, rev, extra, id, children, className = "" }: { n?: number; title: string; gq?: string; need?: boolean | null; rev?: boolean; extra?: ReactNode; id?: string; className?: string; children: ReactNode }) {
  return <section className={`yp-fsec ${className}${rev ? " yp-rev" : ""}`} id={id}>
    <div className="yp-fsec-h">{n ? <span className="yp-n">{n}</span> : null}<b>{title}</b>{need === true ? <span className="yp-need">필수</span> : need === false ? <span className="yp-opt">선택</span> : null}
      {gq ? <span className="yp-gq">{gq}</span> : null}{rev ? <span className="yp-revtag">대표가 짚은 칸</span> : null}<span className="yp-sp" />{extra}</div>
    <div className="yp-fsec-b">{children}</div>
  </section>;
}

/** The wait · 수정 요청 · 보류 · OK line of a confirm step (S2 · S3 · S6). */
export function GateBanner({ page, gate, okExtra }: { page: YpPage; gate: YpGate; okExtra?: ReactNode }) {
  const project = page.bundle!.project;
  const info = project.yp.gates[gate] as typeof project.yp.gates[YpGate] & { pdReply?: string };
  const name = gateName(gate, project.yp.topic.type);
  if (info.state === "wait") return <div className="yp-cwait" role="status">
    <div className="yp-cwait-h"><Clock size={16} className="yp-i" aria-hidden="true" /><b>{name} 대기</b><span className="yp-hint">{md(info.requestedAt)} 요청{daysSince(info.requestedAt) ? ` · ${daysSince(info.requestedAt)}일째` : ""}</span></div>
    {info.pdReply ? <p className="yp-reply-note"><b>PD 답글</b> · 고친 칸 없이 다시 요청: “{info.pdReply}”</p> : null}
    {page.canConfirm && page.client ? <ConfirmActions project={project} gate={gate} client={page.client} onDone={() => void page.reload()} />
      : <p className="yp-hint">아래 [{name}하고 다음으로]를 누르면 PD 컨펌으로 넘어가요.</p>}
  </div>;
  if (info.state === "changes") return <div className="yp-note yp-warn" role="status"><AlertTriangle size={16} className="yp-i" aria-hidden="true" /><div><b>대표 수정 요청 · {md(info.decidedAt)}</b><br />메모: “{info.memo}”<br />{info.fields?.length ? `특히 볼 칸: ${info.fields.map(field => GATE_FIELDS[gate][field] ?? field).join(", ")} · ` : ""}모든 칸을 고칠 수 있어요</div></div>;
  if (info.state === "hold") return <div className="yp-note yp-bad" role="status"><PauseCircle size={16} className="yp-i" aria-hidden="true" /><div><b>보류됨 · {md(info.decidedAt)} · 대표</b><br />사유: “{info.reason}”<br />손본 뒤 컨펌할 수 있어요.</div></div>;
  if (info.state === "ok") return <div className="yp-note yp-ok" role="status"><Check size={16} className="yp-i" aria-hidden="true" /><div><b>{name} OK{info.decidedAt ? ` · ${md(info.decidedAt)}` : ""} · {info.self ? "PD 컨펌" : "대표"}</b>{okExtra}<GateNotes project={project} gate={gate} /></div></div>;
  return <GateNotes project={project} gate={gate} />;
}

/** 대표 노트 on a step (owner decision 2026-10-26): the 대표 reads PD-confirmed steps and leaves notes instead of confirming. */
export function GateNotes({ project, gate }: { project: YpProject; gate: YpGate }) {
  const notes = (project.yp.notes ?? []).filter(note => note.gate === gate);
  if (!notes.length) return null;
  return <ul className="yp-gnotes">{notes.map(note => <li key={note.at}><b>대표 노트 · {md(note.at)}</b> “{note.text}”</li>)}</ul>;
}

/** The re-request reason form (S11-5): asked when nothing changed since the 수정 요청. */
export function ReplyForm({ control }: { control: ReturnType<typeof useGate> }) {
  const [text, setText] = useState("");
  if (!control.replyOpen) return null;
  return <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); if (text.trim()) void control.act("request", text.trim()); }}>
    <label>고친 칸 없이 다시 요청하는 이유 (대표에게 보여요)<input className="yp-in" maxLength={200} value={text} onChange={event => setText(event.target.value)} /></label>
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
      <dt>참고 영상</dt><dd>{project.yp.topic.refs.length ? project.yp.topic.refs.map(ref => <div key={ref.url}><a href={ref.url} target="_blank" rel="noreferrer">{ref.title ?? ref.url}</a></div>) : "없음"}</dd>
      <dt>전달 사항</dt><dd>{project.yp.topic.note || "없음"}</dd>
      <dt>주제 화면</dt><dd><Link className="yp-lnk" href={stepHref(0, project.id)}>주제 보기 →</Link></dd></dl></div></section> : null}
  </>;
}

/** Every step screen: progress line, page title, the step's own heading (시안 stageHead) and the shared notices. */
export function YpFrame({ page, view, action, header, title, sub, savedAt, onSave, saveDisabled, todo, children }: {
  page: YpPage; view: number; action: YpAction | null; header: ReactNode; title: string; sub: string; savedAt?: string; onSave?: () => void; saveDisabled?: boolean;
  /** What this step still needs, shown with the next button at the end of the step (owner request 2026-10-21: no guide text). */
  todo?: { label: string; done: boolean }[]; children?: ReactNode;
}) {
  if (!page.id) return <>{header}<p className="yp-hint" role="status">영상을 여는 중이에요…</p></>;
  if (!page.bundle) return <>{header}{page.error ? <div className="yp-note yp-warn" role="alert"><div>{page.error} <button type="button" className="yp-lnk" onClick={() => void page.reload()}>다시 불러오기</button></div></div>
    : <p className="yp-hint" role="status">영상을 불러오는 중이에요…</p>}</>;
  return <>
    {action ? <YoutubeFlow project={page.bundle.project} view={view} action={action} /> : null}
    {/* The step is the page heading here (시안 stageHead); the menu name stays in the breadcrumb. */}
    <header className="page-header"><div className="page-title-group"><h1 className="page-title" data-ui="page-title">{title}</h1><p>{sub}</p></div>
      {onSave ? <div className="header-actions yp-stool">{savedAt ? <span className="yp-stamp"><i />저장됨 {savedAt}</span> : null}<button type="button" className="yp-btn yp-sm" disabled={saveDisabled} onClick={onSave}>임시 저장</button></div> : null}</header>
    {page.conflict ? <div className="yp-note yp-warn" role="alert"><div>다른 사람이 먼저 고쳤어요. <button type="button" className="yp-lnk" onClick={() => void page.reload()}>새로 불러오기</button> (지금 쓴 내용은 사라져요)</div></div> : null}
    {page.error ? <div className="yp-note yp-warn" role="alert"><div>{page.error}</div></div> : null}
    {children}
    {action ? <StepFooter action={action} todo={todo} /> : null}
  </>;
}

/** The end of every step: what is left (✓ done · ○ to do) and the same one button as the progress line. */
export function StepFooter({ action, todo = [] }: { action: YpAction; todo?: { label: string; done: boolean }[] }) {
  const left = todo.filter(item => !item.done);
  return <div className="yp-foot">
    <div className="yp-foot-left">{action.kind === "status" ? <span>{action.status}</span> : todo.length ? <>
      <span>{left.length ? `남은 것 ${left.length}개` : "다 채웠어요"}</span>
      {todo.map(item => <span key={item.label} className={item.done ? "yp-o" : "yp-x"}>{item.done ? "✓" : "○"} {item.label}</span>)}</> : action.kind === "button" && action.reason ? <span>{action.reason}</span> : null}</div>
    {action.kind === "status" ? (action.secondary ? <button type="button" className="yp-btn" onClick={action.secondary.onClick}>{action.secondary.label}</button> : null)
      : action.kind === "link" ? <Link className="yp-btn yp-pri yp-lg" href={action.href}>{action.label} →</Link>
      : <button type="button" className="yp-btn yp-pri yp-lg" disabled={Boolean(action.reason) || action.busy} onClick={action.onClick}>{action.busy ? "처리 중…" : action.label} →</button>}
  </div>;
}

/** A step not reached yet (시안 lockedPage). */
export function LockedStep({ page, name }: { page: YpPage; name: string }) {
  const project = page.bundle!.project;
  const current = project.yp.stage === "done" ? 0 : YP_STAGE_INDEX[project.yp.stage];
  return <div className="yp-locked"><Info size={18} className="yp-i" aria-hidden="true" /><div><b>{name} 단계는 아직 열리지 않았어요</b><p>지금 단계: {stepName(current, project.yp.topic.type)} <Link className="yp-lnk" href={stepHref(current, project.id)}>지금 단계로 가기 →</Link></p></div></div>;
}
