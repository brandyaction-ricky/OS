"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Info, X } from "lucide-react";
import {
  parseYoutubeRef, projectName, recentProjects, similarProjects, stageLabel, stepHref, topicEditable, topicFieldEditable, topicLines, topicMissing,
  YP_FLOW, YP_KIND_LABEL, YP_KIND_SHORT, YP_STAGE_INDEX, type YpKind, type YpProject, type YpRef,
} from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";
import { errorMessage, isConflict, youtubeProcessClient, type YpMember, type YpTopicInput } from "./youtube-process-data";
import { YoutubeFlow, type YpAction } from "./youtube-process-flow";
import { ConfirmActions } from "./youtube-process-confirm";
import { useYoutubeCanConfirm } from "./use-youtube-confirm";
import { editedSinceDecision, GATE_FIELDS } from "@/lib/youtube-process/confirm";

const LAST_KEY = "brandy-yp-last-project";
const VIEWS = ["topic", "draft", "outline"] as const;
type Form = { title: string; kind: YpKind | null; target: string; note: string; refs: YpRef[]; assigneeId: string | null };
const formOf = (project: YpProject): Form => ({ title: project.title, kind: project.yp.topic.type, target: project.yp.topic.target, note: project.yp.topic.note, refs: project.yp.topic.refs, assigneeId: project.assigneeId });
const hhmm = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const md = (iso?: string) => { if (!iso) return ""; const date = new Date(iso); return `${date.getMonth() + 1}/${date.getDate()} ${hhmm(date)}`; };
const daysSince = (iso?: string) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0;

function Field({ n, title, question, need, rev, children }: { n: number; title: string; question?: string; need: boolean; rev?: boolean; children: ReactNode }) {
  return <section className="yp-fsec">
    <div className="yp-fsec-h"><span className="yp-n">{n}</span><b>{title}</b><span className={need ? "yp-need" : "yp-opt"}>{need ? "필수" : "선택"}</span>{question ? <span className="yp-gq">{question}</span> : null}{rev ? <span className="yp-revtag">고칠 칸</span> : null}</div>
    <div className="yp-fsec-b">{children}</div>
  </section>;
}

/** 기획 (S2 주제 · S3 기획안 · S4 구성안). T3 fills 주제; 기획안 and 구성안 follow in T5 and T6. */
export function YoutubePlanScreen({ header }: { header: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const projectParam = params.get("project");
  const { accessToken, demo, profile } = useSession();
  const canConfirm = useYoutubeCanConfirm(true, accessToken, demo, profile?.role === "admin");
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const [project, setProject] = useState<YpProject | null>(null);
  const [projects, setProjects] = useState<YpProject[]>([]);
  const [members, setMembers] = useState<YpMember[]>([]);
  const [form, setForm] = useState<Form>({ title: "", kind: null, target: "", note: "", refs: [], assigneeId: null });
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [created, setCreated] = useState<YpProject[]>([]);
  const [refUrl, setRefUrl] = useState("");
  const [refError, setRefError] = useState("");
  const [loading, setLoading] = useState(projectParam !== "new");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const saving = useRef<Promise<YpProject | null> | null>(null);
  // The project on screen, so the URL change after a first save does not reload it over newer typing.
  const loadedId = useRef<string | null>(null);
  // Bumped on every edit; a save clears 'unsaved' only if nothing changed while it ran.
  const editRev = useRef(0);

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
    if (projectParam === "new") { setLoading(false); setForm(current => ({ ...current, assigneeId: current.assigneeId ?? profile?.id ?? null })); return; }
    if (!force && loadedId.current === projectParam) return;
    const found = await client.get(projectParam);
    loadedId.current = found.id;
    setProject(found); setForm(formOf(found)); setDirty(false); setLoading(false);
    try { localStorage.setItem(LAST_KEY, found.id); } catch { /* convenience only */ }
  }, [client, projectParam, profile?.id]);
  useEffect(() => { load().catch(reason => { setError(errorMessage(reason)); setLoading(false); }); }, [load]);

  const editable = project ? topicEditable(project) : projectParam === "new";
  const viewParam = params.get("view");
  const current = project ? (project.yp.stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[project.yp.stage]) : 0;
  const view = Math.max(0, VIEWS.indexOf((viewParam ?? "topic") as typeof VIEWS[number]));

  const edit = (patch: Partial<Form>) => { editRev.current += 1; setForm(value => ({ ...value, ...patch })); setDirty(true); setError(""); };

  const save = useCallback(async (next: Form = form): Promise<YpProject | null> => {
    if (!client) return null;
    // One save at a time: a click during a blur save waits for it and uses its result (and version).
    if (saving.current) return saving.current;
    const rev = editRev.current;
    const input: YpTopicInput = { title: next.title, kind: next.kind, target: next.target, note: next.note, refs: next.refs, assigneeId: next.assigneeId };
    const run = (async () => {
      try {
        const saved = project ? await client.update(project.id, project.version, project && topicEditable(project) ? input : { assigneeId: next.assigneeId }) : await client.create(input);
        setProject(saved); setSavedAt(hhmm(new Date()));
        if (editRev.current === rev) setDirty(false);
        if (!project) {
          loadedId.current = saved.id;
          try { localStorage.setItem(LAST_KEY, saved.id); } catch { /* convenience only */ }
          router.replace(stepHref(0, saved.id));
        }
        return saved;
      } catch (reason) {
        if (isConflict(reason)) setConflict(true); else setError(errorMessage(reason));
        return null;
      } finally { saving.current = null; }
    })();
    saving.current = run;
    return run;
  }, [client, form, project, router]);

  const saveIfDirty = () => { if (dirty && editable) void save(); };
  const open = (key: "title" | "kind" | "target" | "refs" | "note") => project ? topicFieldEditable(project, key) : projectParam === "new";
  const editAndSave = (patch: Partial<Form>) => { editRev.current += 1; const next = { ...form, ...patch }; setForm(next); setDirty(true); void save(next); };

  async function gate(action: "request" | "cancel", reply?: string) {
    if (!client) return;
    setBusy(true); setError(""); setCreated([]);
    try {
      const base = saving.current ? await saving.current : dirty || !project ? await save() : project;
      if (!base) return;
      // S11-5: after 수정 요청, re-requesting without changing anything needs a one-line reason.
      if (action === "request" && !reply && base.yp.gates.topic.state === "changes" && !editedSinceDecision(base, "topic")) { setReplyOpen(true); return; }
      const result = await client.topicGate(base.id, action, base.version, reply);
      setReplyOpen(false); setReplyText("");
      setProject(result.project); setForm(formOf(result.project)); setDirty(false); setCreated(result.created);
      if (result.created.length) setProjects(list => [...result.created, ...list]);
    } catch (reason) {
      if (isConflict(reason)) setConflict(true); else setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  if (!projectParam) return <>{header}<p className="yp-hint" role="status">프로젝트를 여는 중이에요…</p></>;
  const shell = project ?? { id: "new", version: 0, title: form.title, assigneeId: form.assigneeId, ownerId: "", updatedAt: "", yp: { v: 1 as const, stage: "topic" as const, topic: { type: form.kind, target: form.target, note: form.note, refs: form.refs }, gates: { topic: { state: "none" as const, round: 0 }, draft: { state: "none" as const, round: 0 }, review: { state: "none" as const, round: 0 } }, contentUpdatedAt: "" } };
  const topicGate = shell.yp.gates.topic;
  const rev = (field: string) => topicGate.state === "changes" && (topicGate.fields ?? []).includes(field);
  const lines = topicLines(form.title);
  const action: YpAction = view !== current && current < YP_FLOW.length
    ? { kind: "link", label: `지금 단계로: ${YP_FLOW[current]}`, href: stepHref(current, shell.id) }
    : topicGate.state === "wait"
      ? { kind: "status", status: `대표 컨펌 대기 · ${daysSince(topicGate.requestedAt)}일`, secondary: { label: "요청 취소", onClick: () => void gate("cancel") } }
      : { kind: "button", label: `${["changes", "hold"].includes(topicGate.state) ? "주제 컨펌 다시 요청" : "주제 컨펌 요청"}${lines.length > 1 ? ` (${lines.length}개)` : ""}`, reason: topicMissing(form.title, { type: form.kind, target: form.target }), busy, onClick: () => void gate("request") };
  const others = projects.filter(row => row.id !== shell.id);
  const similar = editable ? similarProjects(form.title, others, shell.id) : [];

  return <>
    {loading ? null : <YoutubeFlow project={shell} view={view} action={action} />}
    {header}
    {loading ? <p className="yp-hint" role="status">프로젝트를 불러오는 중이에요…</p> : <>
      {conflict ? <div className="yp-note yp-warn" role="alert"><div>다른 사람이 먼저 고쳤어요. <button type="button" className="yp-lnk" onClick={() => void load(true)}>새로 불러오기</button> (지금 쓴 내용은 사라져요)</div></div> : null}
      {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
      {created.length ? <div className="yp-note" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div>줄마다 프로젝트를 나눠 {created.length}개를 더 만들고, 각각 대표 컨펌을 요청했어요: {created.map((row, index) => <span key={row.id}>{index ? ", " : ""}<Link href={stepHref(0, row.id)}>{projectName(row)}</Link></span>)}</div></div> : null}
      {view === 0 ? <div onBlur={saveIfDirty}>
        <div className="yp-shead"><div><h2>주제</h2><p className="yp-sub">어떤 영상을 만들지 정해요. 대표는 이 내용을 보고 할지 말지만 정해요.</p></div>
          <div className="yp-stool">{savedAt ? <span className="yp-stamp"><i />저장됨 {savedAt}</span> : null}<button type="button" className="yp-btn yp-sm" disabled={!editable || !dirty} onClick={() => void save()}>임시 저장</button></div></div>
        {topicGate.state === "wait" ? <div className="yp-cwait" role="status"><div className="yp-cwait-h"><b>주제 컨펌 · 대표 대기</b><span className="yp-hint">{md(topicGate.requestedAt)} 올라감 · 대기 {daysSince(topicGate.requestedAt)}일 · 6시간마다 다시 알림 (22~08시 제외)</span></div>
          {(topicGate as { pdReply?: string }).pdReply ? <p className="yp-reply-note"><b>PD 답글</b> · 고친 칸 없이 다시 요청: “{(topicGate as { pdReply?: string }).pdReply}”</p> : null}
          {canConfirm && client && project ? <ConfirmActions project={project} gate="topic" client={client} onDone={next => { setProject(next); setForm(formOf(next)); }} />
            : <p className="yp-hint">기다리는 동안 이 단계는 고칠 수 없어요. 고치려면 위 [요청 취소]를 누르세요. 대표가 OK하면 기획안 단계가 열려요.</p>}</div> : null}
        {topicGate.state === "changes" ? <div className="yp-note yp-warn" role="status"><div><b>대표 수정 요청</b> · {md(topicGate.decidedAt)} — “{topicGate.memo}”<br />고칠 칸: {(topicGate.fields ?? []).map(field => GATE_FIELDS.topic[field] ?? field).join(", ")}. 고친 뒤 위 [주제 컨펌 다시 요청]을 누르세요.</div></div> : null}
        {topicGate.state === "hold" ? <div className="yp-note yp-warn" role="status"><div><b>대표 보류</b> · {md(topicGate.decidedAt)} — 사유: {topicGate.reason}. 손본 뒤 다시 요청할 수 있어요.</div></div> : null}
        {replyOpen ? <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); if (replyText.trim()) void gate("request", replyText.trim()); }}>
          <label>고친 칸이 없어요. 다시 요청하는 이유를 한 줄 써 주세요 (대표 화면에 ‘PD 답글’로 보여요)<input className="yp-in" id="yp-topic-reply" maxLength={200} value={replyText} onChange={event => setReplyText(event.target.value)} /></label>
          <div><button type="submit" className="yp-btn yp-pri" disabled={busy || !replyText.trim()}>이유와 함께 다시 요청</button> <button type="button" className="yp-btn" onClick={() => setReplyOpen(false)}>취소</button></div>
        </form> : null}
        {!editable && topicGate.state === "ok" ? <div className="yp-note" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div>주제는 대표 컨펌을 받아 확정됐어요.</div></div> : null}
        <div className="yp-savebar">
          <label>담당 PD <select className="yp-pdsel" id="yp-topic-pd" value={form.assigneeId ?? ""} onChange={event => editAndSave({ assigneeId: event.target.value || null })}>
            <option value="">정하지 않음</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <span className="yp-hint">OS 구성원 목록 · 안 고르면 주제를 넣은 사람</span>
          <span>프로젝트 이름: <b>{lines[0] ?? <span className="yp-hint">주제를 쓰면 자동으로 채워져요</span>}</b></span>
        </div>
        <Field n={1} title="주제" question="어떤 영상을 만들까요?" need rev={rev("topic.title")}>
          <div className="yp-max720">
            <textarea className="yp-in" id="yp-topic-title" rows={2} aria-label="주제" placeholder="예) 하루 일이 두 개뿐인데 저녁마다 지치는 이유" readOnly={!open("title")} value={form.title} onChange={event => edit({ title: event.target.value })} />
            <p className="yp-hint">한 줄로 써요. 여러 줄로 쓰면 줄마다 프로젝트가 만들어져요.</p>
            {similar.length ? <div className="yp-note yp-warn"><div>비슷한 주제가 이미 있어요: {similar.map((row, index) => <span key={row.id}>{index ? ", " : ""}<Link href={stepHref(0, row.id)}><b>{projectName(row)}</b></Link> ({stageLabel(row)})</span>)}</div></div> : null}
            {lines.length > 1 && editable ? <div className="yp-note"><Info size={16} className="yp-i" aria-hidden="true" /><div>{lines.length}줄이에요 → 컨펌을 요청하면 프로젝트 {lines.length}개가 만들어져요. 유형 · 정밀 타겟 · 레퍼런스 · 담당 PD는 같은 값으로 들어가요.</div></div> : null}
          </div>
        </Field>
        <Field n={2} title="유형" question="기본값이 없어요. 꼭 골라주세요." need rev={rev("topic.type")}>
          <div className="yp-radio-c" role="radiogroup" aria-label="유형">
            {(["live", "anim"] as const).map(kind => <label key={kind} className={`yp-rc${form.kind === kind ? " yp-on" : ""}`}>
              <input type="radio" name="yp-topic-kind" value={kind} checked={form.kind === kind} disabled={!open("kind")} onChange={() => editAndSave({ kind })} />
              <span><b>{YP_KIND_LABEL[kind]}</b><small>{kind === "live" ? "촬영 · 편집" : "작화 · 생성 · 편집"}</small></span>
            </label>)}
          </div>
        </Field>
        <Field n={3} title="정밀 타겟" question="누가, 언제, 무엇이 막혀서 볼까요?" need rev={rev("topic.target")}>
          <div className="yp-max720"><input className="yp-in" id="yp-topic-target" aria-label="정밀 타겟" placeholder="예) 퇴근 후 2시간 안에서 무엇부터 할지 막힌 30대 직장인" readOnly={!open("target")} value={form.target} onChange={event => edit({ target: event.target.value })} /></div>
        </Field>
        <Field n={4} title="레퍼런스" question="유튜브 링크 · 개수 제한 없음" need={false} rev={rev("topic.refs")}>
          <div className="yp-max720">
            {form.refs.length ? <ul className="yp-open-list">{form.refs.map((ref, index) => <li key={`${ref.url}-${index}`}>
              <a href={ref.url} target="_blank" rel="noreferrer">{ref.title ?? ref.url}</a><span className="yp-sp" />
              {open("refs") ? <>
                <button type="button" className="yp-ib" aria-label="위로" disabled={!index} onClick={() => { const refs = [...form.refs]; [refs[index - 1], refs[index]] = [refs[index], refs[index - 1]]; editAndSave({ refs }); }}><ArrowUp size={14} /></button>
                <button type="button" className="yp-ib" aria-label="아래로" disabled={index === form.refs.length - 1} onClick={() => { const refs = [...form.refs]; [refs[index + 1], refs[index]] = [refs[index], refs[index + 1]]; editAndSave({ refs }); }}><ArrowDown size={14} /></button>
                <button type="button" className="yp-ib" aria-label="빼기" onClick={() => editAndSave({ refs: form.refs.filter((_, at) => at !== index) })}><X size={14} /></button>
              </> : null}
            </li>)}</ul> : !editable ? <span className="yp-hint">없음</span> : null}
            {open("refs") ? <form className="yp-savebar" onSubmit={event => {
              event.preventDefault();
              const ref = parseYoutubeRef(refUrl);
              if (!ref) { setRefError("유튜브 영상 주소를 붙여 넣어 주세요. (youtube.com/watch · youtu.be · shorts)"); return; }
              setRefError(""); setRefUrl(""); editAndSave({ refs: [...form.refs, ref] });
            }}>
              <input className="yp-in" id="yp-topic-ref" placeholder="유튜브 영상 주소 붙여넣기" aria-label="레퍼런스 주소" value={refUrl} onChange={event => setRefUrl(event.target.value)} />
              <button type="submit" className="yp-btn">추가</button>
            </form> : null}
            {refError ? <div className="yp-errline" role="alert">{refError}</div> : null}
          </div>
        </Field>
        <Field n={5} title="전달 사항" question="추가로 설명이 필요한 부분이 있으면 적어주세요" need={false} rev={rev("topic.note")}>
          <textarea className="yp-in yp-max720" id="yp-topic-note" rows={2} aria-label="전달 사항" readOnly={!open("note")} value={form.note} onChange={event => edit({ note: event.target.value })} />
        </Field>
        <div className="yp-lists"><section className="yp-card"><div className="yp-card-h">우리가 했던 주제</div>
          <div>{recentProjects(others, 5).map(row => <Link key={row.id} className="yp-lrow" href={stepHref(0, row.id)}><div className="yp-lt"><b>{projectName(row)}</b><div className="yp-lm"><span>{row.yp.topic.type ? YP_KIND_SHORT[row.yp.topic.type] : "유형 없음"}</span><span>{stageLabel(row)}</span><span>{md(row.yp.contentUpdatedAt).split(" ")[0]}</span></div></div></Link>)}
            {others.length ? null : <p className="yp-pempty">아직 다른 프로젝트가 없어요</p>}</div>
          <div className="yp-lfoot"><span>주제가 겹치는지 확인해요</span><Link className="yp-lnk" href="/content/projects">더 보기 →</Link></div>
        </section></div>
      </div> : <div className="yp-note" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div><b>{YP_FLOW[view]} 화면은 만드는 중이에요.</b> 다음 개발 단계({view === 1 ? "T5" : "T6"})에서 {view === 1 ? "제목 A · B · C, 썸네일 시안, 영상 흐름" : "영상 스펙 · 원고 · 버전 · 큐시트"}이 들어와요.</div></div>}
    </>}
  </>;
}
