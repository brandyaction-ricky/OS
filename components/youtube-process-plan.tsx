"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Info, X } from "lucide-react";
import {
  emptyGates, parseYoutubeRef, projectHref, projectName, sameRef, recentProjects, similarProjects, stageLabel, stepHref, stepName, topicEditable, topicFieldEditable, topicLines, topicMissing,
  YP_FLOW, YP_KIND_LABEL, YP_KIND_SHORT, YP_STAGE_INDEX, type YpKind, type YpProject, type YpRef,
} from "@/lib/youtube-process/project";
import { apiRequest } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { errorMessage, isConflict, youtubeProcessClient, type YpMember, type YpTopicInput } from "./youtube-process-data";
import { YoutubeFlow, type YpAction } from "./youtube-process-flow";
import { GateNotes, ReopenButton, StepFooter, useLeaveGuard } from "./youtube-process-frame";
import { ConfirmActions } from "./youtube-process-confirm";
import { useYoutubeCanConfirm } from "./use-youtube-confirm";
import { canReopen, editedSinceDecision, GATE_FIELDS, gateName } from "@/lib/youtube-process/confirm";
import { YoutubeDraftScreen } from "./youtube-process-draft";
import { YoutubeOutlineScreen } from "./youtube-process-outline";
import { ShortTopicResearch } from "./youtube-process-short-script";

const LAST_KEY = "brandy-yp-last-project";
const VIEWS = ["topic", "draft", "outline"] as const;
type Form = { title: string; kind: YpKind | null; target: string; note: string; refs: YpRef[]; purpose: "ad" | null; assigneeId: string | null };
const formOf = (project: YpProject): Form => ({ title: project.title, kind: project.yp.topic.type, target: project.yp.topic.target, note: project.yp.topic.note, refs: project.yp.topic.refs,
  purpose: project.yp.topic.purpose ?? null, assigneeId: project.assigneeId });
const hhmm = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const md = (iso?: string) => { if (!iso) return ""; const date = new Date(iso); return `${date.getMonth() + 1}/${date.getDate()} ${hhmm(date)}`; };
const daysSince = (iso?: string) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0;

function Field({ n, title, question, need, rev, children }: { n: number; title: string; question?: string; need: boolean; rev?: boolean; children: ReactNode }) {
  return <section className="yp-fsec">
    <div className="yp-fsec-h"><span className="yp-n">{n}</span><b>{title}</b><span className={need ? "yp-need" : "yp-opt"}>{need ? "필수" : "선택"}</span>{question ? <span className="yp-gq">{question}</span> : null}{rev ? <span className="yp-revtag">대표가 짚은 칸</span> : null}</div>
    <div className="yp-fsec-b">{children}</div>
  </section>;
}

/** 기획 (S2 주제 · S3 기획안 · S4 구성안): ?view= picks the screen. */
export function YoutubePlanScreen({ header }: { header: ReactNode }) {
  const view = useSearchParams().get("view");
  if (view === "draft") return <YoutubeDraftScreen header={header} />;
  if (view === "outline") return <YoutubeOutlineScreen header={header} />;
  return <YoutubeTopicScreen header={header} />;
}

/** S2 주제. */
function YoutubeTopicScreen({ header }: { header: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const projectParam = params.get("project");
  const { accessToken, demo, profile } = useSession();
  const canConfirm = useYoutubeCanConfirm(true, accessToken, demo, profile?.role === "admin");
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const [project, setProjectState] = useState<YpProject | null>(null);
  // The newest project the server returned: saves start from it, and an older answer arriving late (a 숏폼 참고 영상 · 공식 save that
  // touched the project, a blur save finishing after 주제 확정) never sets the screen back (2026-10-28 review).
  const latest = useRef<YpProject | null>(null);
  const setProject = useCallback((next: YpProject) => {
    if (latest.current?.id === next.id && next.version < latest.current.version) return;
    latest.current = next; setProjectState(next);
  }, []);
  const [projects, setProjects] = useState<YpProject[]>([]);
  const [members, setMembers] = useState<YpMember[]>([]);
  const [form, setForm] = useState<Form>({ title: "", kind: null, target: "", note: "", refs: [], purpose: null, assigneeId: null });
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  // 로건 피드백 10/26-1: a failed save left the old 「저장됨」 stamp, so it read as saved.
  const [unsaved, setUnsaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [created, setCreated] = useState<YpProject[]>([]);
  const [refUrl, setRefUrl] = useState("");
  const [refError, setRefError] = useState("");
  const [loading, setLoading] = useState(projectParam !== "new");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  // 숏폼 (owner direction 2026-10-28): the topic is fixed after the references and their formulas — 주제 확정 waits for both.
  const [research, setResearch] = useState({ refs: false, formula: "" });
  const saving = useRef<Promise<YpProject | null> | null>(null);
  const savingKey = useRef("");
  // The project on screen, so the URL change after a first save does not reload it over newer typing.
  const loadedId = useRef<string | null>(null);
  // Bumped on every edit; a save clears 'unsaved' only if nothing changed while it ran. savedRev is the edit the last good save carried.
  const editRev = useRef(0);
  const savedRev = useRef(0);
  const timer = useRef<number | null>(null);

  // A plan screen opened without a project goes to the last one opened, or to the project list (4-0).
  useEffect(() => {
    if (projectParam) return;
    let last = "";
    try { last = localStorage.getItem(LAST_KEY) ?? ""; } catch { /* the list is the fallback */ }
    router.replace(last ? stepHref(0, last) : "/content/projects");
  }, [projectParam, router]);

  const load = useCallback(async (force = false) => {
    if (!client || !projectParam) return;
    setError(""); setConflict(false);
    const [list, people] = await Promise.all([client.list(), client.members().catch(() => [] as YpMember[])]);
    setProjects(list); setMembers(people);
    if (projectParam === "new") {
      // 주제 찾기 › [이 영상으로 새 프로젝트] opens here with the found video as the first reference.
      const found = parseYoutubeRef(params.get("ref") ?? "");
      const ref = found ? { ...found, title: params.get("refTitle")?.slice(0, 200) || undefined } : null;
      // 틈새 › [기획으로 넘기기] also hands over its name as the 주제 and the title formula as the first 전달 사항.
      setLoading(false); setForm(current => ({ ...current, title: current.title || params.get("title")?.slice(0, 120) || "", note: current.note || params.get("note")?.slice(0, 2000) || "", assigneeId: current.assigneeId ?? profile?.id ?? null, refs: ref && !current.refs.some(row => row.url === ref.url) ? [ref, ...current.refs] : current.refs })); return;
    }
    if (!force && loadedId.current === projectParam) return;
    const found = await client.get(projectParam);
    loadedId.current = found.id;
    setProject(found); setForm(formOf(found)); setDirty(false); setLoading(false); savedRev.current = editRev.current;
    try { localStorage.setItem(LAST_KEY, found.id); } catch { /* convenience only */ }
  }, [client, projectParam, profile?.id, params, setProject]);
  useEffect(() => { load().catch(reason => { setError(errorMessage(reason)); setLoading(false); }); }, [load]);

  const editable = project ? topicEditable(project) : projectParam === "new";
  useLeaveGuard(dirty && editable);
  const viewParam = params.get("view");
  const current = project ? (project.yp.stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[project.yp.stage]) : 0;
  const view = Math.max(0, VIEWS.indexOf((viewParam ?? "topic") as typeof VIEWS[number]));

  // Typing saves itself after a short pause (로건 QA 10/30: the 저장 time stopped at 11:09 while the 정밀 타겟 kept changing). A new
  // video is made by the first save, so it still waits for the cursor to leave the box.
  const edit = (patch: Partial<Form>) => {
    editRev.current += 1; const next = { ...form, ...patch };
    setForm(next); setDirty(true); setError("");
    if (timer.current) window.clearTimeout(timer.current);
    if (project) timer.current = window.setTimeout(() => void save(next), 1500);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const save = useCallback(async (next: Form = form): Promise<YpProject | null> => {
    if (!client) return null;
    const input: YpTopicInput = { title: next.title, kind: next.kind, target: next.target, note: next.note, refs: next.refs, purpose: next.kind === "short" ? next.purpose : null, assigneeId: next.assigneeId };
    const key = JSON.stringify(input);
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    // One save at a time: a click during a save of the same content uses its result; newer content (a second reference added
    // meanwhile) waits and saves on top of it with its version — it used to go out with the old one and read as an error (로건 피드백 A-2).
    let base = latest.current?.id === project?.id ? latest.current : project;
    while (saving.current) {
      if (savingKey.current === key) return saving.current;
      base = (await saving.current) ?? base;
    }
    const rev = editRev.current;
    const run = (async () => {
      try {
        const saved = base ? await client.update(base.id, base.version, topicEditable(base) ? input : { assigneeId: next.assigneeId }) : await client.create(input);
        setProject(saved); setSavedAt(hhmm(new Date())); setUnsaved(false); savedRev.current = Math.max(savedRev.current, rev);
        if (editRev.current === rev) setDirty(false);
        if (!base) {
          loadedId.current = saved.id;
          try { localStorage.setItem(LAST_KEY, saved.id); } catch { /* convenience only */ }
          router.replace(stepHref(0, saved.id));
        }
        return saved;
      } catch (reason) {
        setUnsaved(true);
        if (isConflict(reason)) setConflict(true); else setError(errorMessage(reason));
        return null;
      } finally { saving.current = null; }
    })();
    saving.current = run; savingKey.current = key;
    return run;
  }, [client, form, project, router, setProject]);

  const saveIfDirty = () => { if (dirty && editable) void save(); };
  const open = (key: "title" | "kind" | "target" | "refs" | "note" | "purpose") => project ? topicFieldEditable(project, key) : projectParam === "new";
  const editAndSave = (patch: Partial<Form>) => { editRev.current += 1; const next = { ...form, ...patch }; setForm(next); setDirty(true); void save(next); };

  async function gate(action: "confirm" | "request" | "cancel", reply?: string) {
    if (!client) return;
    setBusy(true); setError(""); setCreated([]);
    try {
      // A save still running may carry older text than the screen (로건 QA 10/30: 「정밀 타겟을 써 주세요」 with the box filled):
      // wait for it, then save whatever was typed after it, and only then confirm.
      const running = saving.current ? await saving.current : null;
      const base = !project || editRev.current !== savedRev.current ? await save() : running ?? (latest.current?.id === project.id ? latest.current : project);
      if (!base) return;
      // S11-5: after 수정 요청, re-requesting without changing anything needs a one-line reason.
      if (action === "request" && !reply && base.yp.gates.topic.state === "changes" && !editedSinceDecision(base, "topic")) { setReplyOpen(true); return; }
      const result = await client.topicGate(base.id, action, base.version, reply);
      setReplyOpen(false); setReplyText("");
      setProject(result.project); setForm(formOf(result.project)); setDirty(false); setCreated(result.created);
      if (result.created.length) setProjects(list => [...result.created, ...list]);
      // 로건 QA 10/30: a 컨펌 now opens the next step (the note about extra videos made from more lines keeps the PD here).
      else if (action === "confirm" && result.project.yp.stage !== base.yp.stage) router.push(projectHref(result.project));
    } catch (reason) {
      if (isConflict(reason)) setConflict(true); else setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  if (!projectParam) return <>{header}<p className="yp-hint" role="status">영상을 여는 중이에요…</p></>;
  const shell = project ?? { id: "new", version: 0, title: form.title, assigneeId: form.assigneeId, ownerId: "", updatedAt: "", yp: { v: 1 as const, stage: "topic" as const, topic: { type: form.kind, target: form.target, note: form.note, refs: form.refs }, gates: emptyGates(), contentUpdatedAt: "" } };
  const topicGate = shell.yp.gates.topic;
  const rev = (field: string) => topicGate.state === "changes" && (topicGate.fields ?? []).includes(field);
  const lines = topicLines(form.title);
  const short = form.kind === "short";
  const confirmLabel = gateName("topic", form.kind);
  const action: YpAction = view !== current && current < YP_FLOW.length
    ? { kind: "link", label: `이어서 하기 · ${stepName(current, shell.yp.topic.type)}`, href: stepHref(current, shell.id) }
    : { kind: "button", label: `${confirmLabel}하고 다음으로${lines.length > 1 ? ` (${lines.length}개)` : ""}`, busy, onClick: () => void gate("confirm"),
      reason: topicMissing(form.title, { type: form.kind, target: form.target }) || (!short ? "" : !research.refs ? "참고 영상을 찾아 주세요" : !research.formula ? "공식을 고르고 주제를 정해 주세요" : "") };
  const others = projects.filter(row => row.id !== shell.id);
  const similar = editable ? similarProjects(form.title, others, shell.id) : [];

  return <>
    {loading ? null : <YoutubeFlow project={shell} view={view} action={action} />}
    <header className="page-header"><div className="page-title-group"><h1 className="page-title" data-ui="page-title">주제</h1>
      <p>{topicGate.state === "wait" ? "대표 컨펌 요청이 남아 있어요. 이제 PD가 직접 컨펌하면 다음으로 넘어가요." : topicGate.state === "changes" ? "대표 수정 요청을 반영하고 컨펌해요. 모든 칸을 고칠 수 있어요." : topicGate.state === "ok" ? `${confirmLabel}이 끝났어요. ${shell.yp.topic.type === "short" ? "대본으로" : "기획안으로"} 넘어가요.` : short ? "키워드나 링크로 참고 영상을 찾고, 공식을 뽑아 주제를 확정해요." : "주제 · 유형 · 정밀 타겟 세 칸을 채우고 컨펌해요."}</p></div>
      <div className="header-actions yp-stool">{unsaved ? <span className="yp-stamp yp-unsaved" role="alert">저장 안 됨 · 위 안내를 봐 주세요</span> : savedAt ? <span className="yp-stamp"><i />저장됨 {savedAt}</span> : null}{editable ? <button type="button" className="yp-btn yp-sm" disabled={!dirty} onClick={() => void save()}>임시 저장</button> : null}</div></header>
    {loading ? <p className="yp-hint" role="status">영상을 불러오는 중이에요…</p> : <>
      {conflict ? <div className="yp-note yp-warn" role="alert"><div>다른 사람이 먼저 고쳤어요. <button type="button" className="yp-lnk" onClick={() => void load(true)}>새로 불러오기</button> (지금 쓴 내용은 사라져요)</div></div> : null}
      {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
      {created.length ? <div className="yp-note" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div>영상 {created.length}개를 더 만들어 함께 컨펌했어요: {created.map((row, index) => <span key={row.id}>{index ? ", " : ""}<Link href={stepHref(0, row.id)}>{projectName(row)}</Link></span>)}</div></div> : null}
      {view === 0 ? <div onBlur={saveIfDirty}>
        {topicGate.state === "wait" ? <div className="yp-cwait" role="status"><div className="yp-cwait-h"><b>주제 컨펌 대기</b><span className="yp-hint">{md(topicGate.requestedAt)} 요청{daysSince(topicGate.requestedAt) ? ` · ${daysSince(topicGate.requestedAt)}일째` : ""}</span></div>
          {(topicGate as { pdReply?: string }).pdReply ? <p className="yp-reply-note"><b>PD 답글</b> · 고친 칸 없이 다시 요청: “{(topicGate as { pdReply?: string }).pdReply}”</p> : null}
          {canConfirm && client && project ? <ConfirmActions project={project} gate="topic" client={client} onDone={next => { setProject(next); setForm(formOf(next)); }} />
            : <p className="yp-hint">아래 [{confirmLabel}하고 다음으로]를 누르면 PD 컨펌으로 넘어가요.</p>}</div> : null}
        {topicGate.state === "changes" ? <div className="yp-note yp-warn" role="status"><div><b>대표 수정 요청</b> · {md(topicGate.decidedAt)} — “{topicGate.memo}”<br />{topicGate.fields?.length ? `특히 볼 칸: ${topicGate.fields.map(field => GATE_FIELDS.topic[field] ?? field).join(", ")} · ` : ""}모든 칸을 고칠 수 있어요</div></div> : null}
        {topicGate.state === "hold" ? <div className="yp-note yp-warn" role="status"><div><b>대표 보류</b> · {md(topicGate.decidedAt)} — 사유: {topicGate.reason}. 손본 뒤 컨펌할 수 있어요.</div></div> : null}
        {project && client && canReopen(project, "topic") ? <div className="yp-note yp-ok" role="status"><div><b>{confirmLabel} OK · PD 컨펌</b> <ReopenButton project={project} gate="topic" client={client}
          onDone={next => { setProject(next); setForm(formOf(next)); }} onError={reason => isConflict(reason) ? setConflict(true) : setError(errorMessage(reason))} /></div></div> : null}
        {project ? <GateNotes project={project} gate="topic" /> : null}
        {replyOpen ? <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); if (replyText.trim()) void gate("request", replyText.trim()); }}>
          <label>고친 칸 없이 다시 요청하는 이유 (대표에게 보여요)<input className="yp-in" id="yp-topic-reply" maxLength={200} value={replyText} onChange={event => setReplyText(event.target.value)} /></label>
          <div><button type="submit" className="yp-btn yp-pri" disabled={busy || !replyText.trim()}>이유와 함께 다시 요청</button> <button type="button" className="yp-btn" onClick={() => setReplyOpen(false)}>취소</button></div>
        </form> : null}
        <div className="yp-savebar">
          <label>담당 PD <select className="yp-pdsel" id="yp-topic-pd" value={form.assigneeId ?? ""} onChange={event => editAndSave({ assigneeId: event.target.value || null })}>
            <option value="">정하지 않음</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        </div>
        <Field n={1} title="주제" question={short ? "처음엔 키워드나 초안이면 돼요" : "어떤 영상을 만들까요?"} need rev={rev("topic.title")}>
          <div className="yp-max720">
            <textarea className="yp-in" id="yp-topic-title" rows={2} aria-label="주제" placeholder={short ? "예) 만나고 싶은데 쉬고도 싶을 때" : "예) 하루 일이 두 개뿐인데 저녁마다 지치는 이유"} readOnly={!open("title")} value={form.title} onChange={event => edit({ title: event.target.value })} />
            {similar.length ? <div className="yp-note yp-warn"><div>비슷한 주제가 이미 있어요: {similar.map((row, index) => <span key={row.id}>{index ? ", " : ""}<Link href={stepHref(0, row.id)}><b>{projectName(row)}</b></Link> ({stageLabel(row)})</span>)}</div></div> : null}
            {lines.length > 1 && editable ? <div className="yp-note"><Info size={16} className="yp-i" aria-hidden="true" /><div>{lines.length}줄이라 영상 {lines.length}개로 나눠 요청해요.</div></div> : null}
          </div>
        </Field>
        <Field n={2} title="유형" need rev={rev("topic.type")}>
          <div className="yp-radio-c" role="radiogroup" aria-label="유형">
            {(["live", "anim", "short"] as const).map(kind => <label key={kind} className={`yp-rc${form.kind === kind ? " yp-on" : ""}`}>
              <input type="radio" name="yp-topic-kind" value={kind} checked={form.kind === kind} disabled={!open("kind")} onChange={() => editAndSave({ kind })} />
              <span><b>{YP_KIND_LABEL[kind]}</b><small>{kind === "live" ? "촬영 · 편집" : kind === "anim" ? "작화 · 이미지 만들기 · 편집" : "15 ~ 60초 세로 영상"}</small></span>
            </label>)}
          </div>
          {/* A 숏폼 is made for the feed (쇼츠 · 릴스) or as a Meta ad: its 참고 자료 and its script differ (주제 찾기, 2026-10-28). */}
          {short ? <div className="yp-chips" role="radiogroup" aria-label="숏폼 쓰임" style={{ marginTop: 10 }}>
            {([[null, "숏폼 · 릴스", "쇼츠 · 릴스 · 틱톡에 올려요"], ["ad", "광고", "메타 광고로 돌려요"]] as const).map(([purpose, name, hint]) =>
              <button key={name} type="button" role="radio" aria-checked={form.purpose === purpose} className={`yp-chip${form.purpose === purpose ? " yp-on" : ""}`} disabled={!open("purpose")}
                onClick={() => editAndSave({ purpose })}><b>{name}</b> <span className="yp-muted">{hint}</span></button>)}
          </div> : null}
        </Field>
        <Field n={3} title="정밀 타겟" question="어떤 질문을 품은 사람이 볼까요?" need rev={rev("topic.target")}>
          <div className="yp-max720"><input className="yp-in" id="yp-topic-target" aria-label="정밀 타겟" placeholder="예) 내가 뭘 원하는지 모르겠다는 말을 자주 하는 사람" readOnly={!open("target")} value={form.target} onChange={event => edit({ target: event.target.value })} />
            {/* Owner decision 2026-10-26 (기획_절차): a situation-led target pulls the whole script into that situation's scenes. */}
            <p className="yp-hint">처한 상황(이직·퇴사)보다 그 질문을 품은 사람으로 적어요. 주제 자체가 퇴사 같은 상황이면 상황으로 적어도 돼요.</p></div>
        </Field>
        {short ? project ? <ShortTopicResearch project={project} onProject={setProject} onPick={title => editAndSave({ title })} onState={setResearch} />
          : <p className="yp-hint">주제를 쓰면 참고 영상을 찾을 수 있어요.</p> : null}
        {/* 참고 영상 · 전달 사항 are optional: folded until someone wants them (or they already hold something). 숏폼 finds its 참고 영상 above. */}
        <details className="yp-more-fields" open={Boolean((!short && form.refs.length) || form.note || rev("topic.refs") || rev("topic.note"))}><summary>{short ? "전달 사항 더 쓰기 (선택)" : "참고 영상 · 전달 사항 더 쓰기 (선택)"}</summary>
        {short ? null : <Field n={4} title="참고 영상" question="유튜브 링크" need={false} rev={rev("topic.refs")}>
          <div className="yp-max720">
            {form.refs.length ? <ul className="yp-open-list">{form.refs.map((ref, index) => <li key={`${ref.url}-${index}`}>
              <a href={ref.url} target="_blank" rel="noreferrer">{ref.title ?? ref.url}</a><span className="yp-sp" />
              {open("refs") ? <>
                <button type="button" className="yp-ib" aria-label="위로" disabled={!index} onClick={() => { const refs = [...form.refs]; [refs[index - 1], refs[index]] = [refs[index], refs[index - 1]]; editAndSave({ refs }); }}><ArrowUp size={14} /></button>
                <button type="button" className="yp-ib" aria-label="아래로" disabled={index === form.refs.length - 1} onClick={() => { const refs = [...form.refs]; [refs[index + 1], refs[index]] = [refs[index], refs[index + 1]]; editAndSave({ refs }); }}><ArrowDown size={14} /></button>
                <button type="button" className="yp-ib" aria-label="빼기" onClick={() => editAndSave({ refs: form.refs.filter((_, at) => at !== index) })}><X size={14} /></button>
              </> : null}
            </li>)}</ul> : !editable ? <span className="yp-hint">없음</span> : null}
            {open("refs") ? <form className="yp-savebar" onSubmit={async event => {
              event.preventDefault();
              const ref = parseYoutubeRef(refUrl);
              if (!ref) { setRefError("유튜브 영상 주소를 붙여 넣어 주세요. (youtube.com/watch · youtu.be · shorts)"); return; }
              if (form.refs.some(row => sameRef(row, ref))) { setRefError("이미 있어요."); return; }
              setRefError(""); setRefUrl("");
              // 로건 피드백 10/26-3: a pasted address gets its title · channel like a 주제 찾기 reference (1 unit of YouTube quota).
              const title = demo || !accessToken ? undefined : await apiRequest<{ title: string }>(`/api/v1/content/youtube/discover?video=${ref.videoId}`, { token: accessToken })
                .then(info => info.title, () => undefined);
              editAndSave({ refs: [...form.refs, title ? { ...ref, title } : ref] });
            }}>
              <input className="yp-in" id="yp-topic-ref" placeholder="유튜브 영상 주소 붙여 넣기" aria-label="참고 영상 주소" value={refUrl} onChange={event => setRefUrl(event.target.value)} />
              <button type="submit" className="yp-btn">추가</button>
            </form> : null}
            {refError ? <div className="yp-errline" role="alert">{refError}</div> : null}
          </div>
        </Field>}
        <Field n={short ? 6 : 5} title="전달 사항" question="더 설명할 게 있으면 써 주세요" need={false} rev={rev("topic.note")}>
          <textarea className="yp-in yp-max720" id="yp-topic-note" rows={2} aria-label="전달 사항" readOnly={!open("note")} value={form.note} onChange={event => edit({ note: event.target.value })} />
        </Field>
        </details>
        <StepFooter action={action} todo={editable ? [{ label: "주제", done: Boolean(lines.length) }, { label: "유형", done: Boolean(form.kind) }, { label: "정밀 타겟", done: Boolean(form.target.trim()) },
          ...(short ? [{ label: "참고 영상", done: research.refs }, { label: "공식", done: Boolean(research.formula) }] : [])] : undefined} />
        <div className="yp-lists" style={{ marginTop: 16 }}><section className="yp-card"><div className="yp-card-h">우리가 했던 주제</div>
          <div>{recentProjects(others, 5).map(row => <Link key={row.id} className="yp-lrow" href={stepHref(0, row.id)}><div className="yp-lt"><b>{projectName(row)}</b><div className="yp-lm"><span>{row.yp.topic.type ? YP_KIND_SHORT[row.yp.topic.type] : "유형 없음"}</span><span>{stageLabel(row)}</span><span>{md(row.yp.contentUpdatedAt).split(" ")[0]}</span></div></div></Link>)}
            {others.length ? null : <p className="yp-pempty">아직 다른 영상이 없어요</p>}</div>
          <div className="yp-lfoot"><span>주제가 겹치는지 확인해요</span><Link className="yp-lnk" href="/content/projects">더 보기 →</Link></div>
        </section></div>
      </div> : null}
    </>}
  </>;
}
