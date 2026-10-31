"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import { Clock, Eye, Info, Sparkles } from "lucide-react";
import { myinCleanScript } from "@/lib/myin-script";
import { lengthEstimate, outlineMissing, runtimeError, scriptChars, SPEC_OPTIONS, specOption, type YpOutline } from "@/lib/youtube-process/stages";
import { checkScriptBody } from "@/lib/youtube-script-check";
import { KnowledgeRichEditor } from "./knowledge-rich-editor";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { GateBanner, hhmm, LockedStep, stepAction, Subject, useYpBundle, YpFrame, YpSection } from "./youtube-process-frame";
import { YtCard } from "./youtube-process-media";
import { ScriptReview2 } from "./youtube-process-review2";

const WHY: Record<string, string> = { manual: "", ai: " · 내 AI", make: " · 제작 시작", restore: " · 되돌림" };

/** S4 구성안: 영상 스펙 · 원고 (versions, 예상 길이, 내 AI 원고). No 대표 컨펌; [다음: 제작] moves on (4-5). */
export function YoutubeOutlineScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  const [form, setForm] = useState<YpOutline | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [viewV, setViewV] = useState<number | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [tab, setTab] = useState<"flow" | "refs">("flow");
  const [send, setSend] = useState(false);
  const [moving, setMoving] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const editRev = useRef(0);
  const router = useRouter();
  const saving = useRef(false);
  const timer = useRef<number | null>(null);
  const outline = page.bundle?.stages.outline;
  useEffect(() => { if (outline && !dirty) setForm(outline.data); }, [outline, dirty]);
  const project = page.bundle?.project;
  const editable = Boolean(project && ["outline", "make", "review"].includes(project.yp.stage));
  const reloadAll = useCallback(() => { setDirty(false); setEditorKey(key => key + 1); void page.reload(); }, [page]);
  const job = useStaffJob(page, "script", reloadAll);
  // Logan's test (A-5): once the voice exists, its real length sits next to the estimate.
  const [voiceSec, setVoiceSec] = useState<number | null>(null);
  const projectId = project?.id, token = page.accessToken, demo = page.demo;
  useEffect(() => {
    if (!projectId || demo) return;
    let live = true;
    apiRequest<{ run: { words: { durationSeconds: number } | null } | null }>(`/api/v1/content/youtube-automation/myin?sourceId=${encodeURIComponent(projectId)}`, { token })
      .then(result => { if (live) setVoiceSec(result.run?.words?.durationSeconds ?? null); }, () => undefined);
    return () => { live = false; };
  }, [projectId, token, demo]);

  // The 2.5 s autosave and the blur save can overlap: each save reads the latest version (a stale one was a false "먼저 고쳤어요"),
  // and a save asked for while one is running runs right after it with the newest text.
  const latest = useRef(outline), latestForm = useRef(form), again = useRef(false);
  useEffect(() => { latest.current = outline; }, [outline]);
  useEffect(() => { latestForm.current = form; }, [form]);
  const save = async (patch: Record<string, unknown>, next?: YpOutline) => {
    if (!page.client || !project || !latest.current) return;
    if (saving.current) { again.current = true; return; }
    saving.current = true;
    const rev = editRev.current;
    try {
      const result = await page.client.saveStage(project.id, "outline", latest.current.version, patch);
      latest.current = result.stage;
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, outline: result.stage } } : current);
      setSavedAt(hhmm());
      if (editRev.current === rev) { setDirty(false); if (next) setForm(result.stage.data); }
    } catch (reason) { page.fail(reason); } finally {
      saving.current = false;
      const current = latestForm.current;
      if (again.current) { again.current = false; if (current && editRev.current !== rev) void save({ spec: current.spec, script: current.script }); }
    }
  };
  const saveNow = (extra: Record<string, unknown> = {}) => { if (timer.current) window.clearTimeout(timer.current); if (form) void save({ spec: form.spec, script: form.script, ...extra }, form); };
  const edit = (patch: Partial<YpOutline>) => {
    editRev.current += 1;
    setForm(current => current ? { ...current, ...patch } : current); setDirty(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { const current = latestForm.current; if (current) void save({ spec: current.spec, script: current.script }); }, 2500);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const move = async () => {
    if (!page.client || !project) return;
    setMoving(true);
    try {
      if (dirty && form) await save({ spec: form.spec, script: form.script });
      const next = await page.client.move(project.id, "make", page.bundle!.project.version);
      page.setBundle(current => current ? { ...current, project: next } : current);
      router.push(`/content/make?project=${encodeURIComponent(project.id)}`);
    } catch (reason) { page.fail(reason); } finally { setMoving(false); }
  };

  // 관문 1 on the 원고 as it will be spoken (자동 영상 only); the OS counts it again with the canon (정본 겹침) on 다음: 제작 and on v13 음성.
  const spokenOnly = project?.yp.topic.type === "anim";
  const script = form?.script ?? "", runtime = form?.spec.runtimeMin ?? null;
  const checked = useMemo(() => spokenOnly && scriptChars(script) ? checkScriptBody(myinCleanScript(script).spoken, runtime).issues : [], [spokenOnly, script, runtime]);
  const missing = form ? outlineMissing(form) || (checked.length ? `원고 형식 검사에서 걸린 곳 ${checked.length}건을 고쳐 주세요` : "") : "";
  const action = page.bundle ? stepAction(page, 2, project?.yp.stage === "outline" ? { kind: "button", label: "다음: 제작", reason: missing, busy: moving, onClick: () => void move() } : { kind: "status", status: "구성안 끝남" }) : null;
  const current = form?.versions.at(-1)?.v ?? 0;
  const viewing = viewV && viewV !== current ? form?.versions.find(item => item.v === viewV) ?? null : null;
  const estimate = form ? lengthEstimate(viewing?.md ?? form.script, form.spec.runtimeMin) : null;
  const confirmed = page.bundle?.stages.plan.data.confirmed;
  const plan = page.bundle?.stages.plan.data;
  const anim = project?.yp.topic.type !== "live";
  const aiOpen = job.open || Boolean(job.status?.job && job.status.job.status === "blocked");

  return <YpFrame page={page} view={2} action={action} header={header} title="구성안" sub={project?.yp.stage === "outline" ? "러닝타임을 정하고 원고를 써요." : "제작이 시작된 원고예요. 고치면 버전이 남아요."} savedAt={savedAt}
    todo={form && project?.yp.stage === "outline" ? [{ label: "러닝타임", done: form.spec.runtimeMin !== null && !runtimeError(form.spec.runtimeMin) }, { label: "원고", done: scriptChars(form.script) > 0 }] : undefined}
    onSave={editable ? () => saveNow() : undefined} saveDisabled={!dirty}>
    {page.bundle && form && project ? ["topic", "draft"].includes(project.yp.stage) ? <LockedStep page={page} name="구성안" /> : <>
      {project.yp.stage === "outline" ? <GateBanner page={page} gate="draft" /> : null}
      {project.yp.stage !== "outline" && editable && anim ? <div className="yp-note yp-warn" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div>고치면 영상을 음성부터 다시 만들어야 해요.</div></div> : null}
      <Subject page={page} />
      <div className="yp-wrap2"><div>
        <YpSection n={1} title="영상 스펙" gq={anim ? "최종본 기준" : "촬영 · 최종본 기준"} need className="yp-compact">
          <div className="yp-spec1">
            <span className="yp-sp1"><span className="yp-sp1-l">러닝타임</span><input className="yp-in yp-sel1" inputMode="numeric" maxLength={3} style={{ width: 64 }} aria-label="러닝타임 분" placeholder="1~120" readOnly={!editable}
              value={form.spec.runtimeMin ?? ""} onChange={event => { const value = event.target.value.replace(/\D/g, ""); edit({ spec: { ...form.spec, runtimeMin: value ? Number(value) : null } }); }} /><span>분</span></span>
            {(["res", "fps", "ratio"] as const).map(key => <span key={key} className="yp-sp1"><span className="yp-dot1">·</span><span className="yp-sp1-l">{{ res: "해상도", fps: "프레임", ratio: "비율" }[key]}</span>
              <select className="yp-in yp-sel1" aria-label={key} disabled={!editable} value={specOption(project.yp.topic.type ?? "anim", key, form.spec[key])} onChange={event => edit({ spec: { ...form.spec, [key]: event.target.value } })}>{[...new Set([specOption(project.yp.topic.type ?? "anim", key, form.spec[key]), ...SPEC_OPTIONS[project.yp.topic.type ?? "anim"][key]])].map(option => <option key={option}>{option}</option>)}</select></span>)}
          </div>
          {runtimeError(form.spec.runtimeMin) ? <div className="yp-errline">{runtimeError(form.spec.runtimeMin)}</div> : null}
        </YpSection>
        <YpSection n={2} title="원고" need extra={editable && !viewing ? <button type="button" className="yp-btn yp-sm yp-pri" onClick={() => setSend(true)}><Sparkles size={14} /> {form.ai ? "내 AI로 다시 쓰기" : "내 AI로 원고 쓰기"}</button> : null}>
          <div className="yp-est"><span className="yp-tag yp-acc"><Clock size={12} aria-hidden="true" /> 예상 길이 {estimate?.label}</span><span className="yp-muted" style={{ fontSize: 12 }} title="공백 · 제목 줄 · 사진 · 표를 빼고 분당 350자로 셈">원고 {estimate?.chars.toLocaleString()}자</span>
            {voiceSec ? <span className="yp-tag" title="영상 만드는 컴퓨터가 만든 음성의 실제 길이">실제 음성 {Math.floor(voiceSec / 60)}분 {Math.round(voiceSec % 60)}초</span> : null}
            {estimate?.verdict ? <span className={estimate.verdict.ok ? "yp-ok" : "yp-bad"}>{estimate.verdict.ok ? "✓" : "⚠"} {estimate.verdict.text}</span> : null}</div>
          {aiOpen ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
          {form.versions.length ? <div className="yp-vstrip yp-vrel"><b style={{ fontSize: 12, color: "var(--muted)" }}>버전</b>
            <div className="yp-vrow2">{form.versions.map(version => <span key={version.v} className={`yp-vchip${version.v === current ? " yp-cur" : ""}${viewV === version.v ? " yp-view" : ""}`}>
              <button type="button" className="yp-vo" onClick={() => { setViewV(version.v === current ? null : version.v); setEditorKey(key => key + 1); }}>{version.v === current ? "● " : ""}v{version.v} {new Date(version.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}{WHY[version.why]}{version.v === current ? " 현재" : ""}</button></span>)}</div>
            {editable && !viewing ? <button type="button" className="yp-btn yp-sm" disabled={!form.script.trim()} onClick={() => saveNow({ saveVersion: true })}>버전 남기기</button> : null}</div>
            : editable ? <div className="yp-vstrip"><span className="yp-hint">아직 남긴 버전이 없어요</span><span className="yp-sp" /><button type="button" className="yp-btn yp-sm" disabled={!form.script.trim()} onClick={() => saveNow({ saveVersion: true })}>버전 남기기</button></div> : null}
          {viewing ? <div className="yp-vbanner"><Eye size={14} aria-hidden="true" /> <b>v{viewing.v} 보는 중</b> (보기 전용) · {viewing.by}<span style={{ flex: 1 }} />
            {editable ? <button type="button" className="yp-btn yp-sm" onClick={() => { setViewV(null); setEditorKey(key => key + 1); void save({ restore: viewing.v }, form); }}>이 버전을 최신으로</button> : null}
            <button type="button" className="yp-btn yp-sm yp-pri" onClick={() => { setViewV(null); setEditorKey(key => key + 1); }}>보기 닫기</button></div> : null}
          {form.ai && form.versions.at(-1)?.why === "ai" && !viewing ? <p className="yp-hint" style={{ margin: "0 0 6px" }}><span className="yp-aitag"><Sparkles size={11} aria-hidden="true" /> AI 초안 · {form.ai.by}</span></p> : null}
          <div className="yp-rte yp-tall" onBlur={() => { if (dirty) saveNow(); }}>
            <KnowledgeRichEditor key={`${editorKey}-${viewing?.v ?? "cur"}`} markdown={viewing?.md ?? form.script} accessToken={page.accessToken} disabled={!editable || Boolean(viewing)}
              onChange={markdown => { if (!viewing && markdown !== form.script) edit({ script: markdown }); }} onError={message => page.setError(message)} />
          </div>
          <p className="yp-hint"><Info size={12} aria-hidden="true" /> 마지막 20초는 최종 화면 자리로 비워 둬요.</p>
          {checked.length && editable && !viewing ? <details className="yp-note yp-warn" role="status" style={{ display: "block" }}><summary style={{ cursor: "pointer" }}>원고 형식 검사에서 걸린 곳 {checked.length}건 — 고쳐야 제작·음성으로 넘어가요</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>{checked.map(issue => <li key={issue}>{issue}</li>)}</ul></details> : null}
          {!viewing ? <ScriptReview2 page={page} outline={form} editable={editable} dirty={dirty} /> : null}
          {form.ai ? <details className="yp-card" open={notesOpen} onToggle={event => setNotesOpen((event.target as HTMLDetailsElement).open)} style={{ marginTop: 8 }}>
            <summary style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13 }}>AI 작업 기록 보기</summary>
            {notesOpen ? <div style={{ padding: "0 12px 12px", fontSize: 13 }}>{([["자료", form.ai.materials], ["축", form.ai.axis], ["설계", form.ai.design], ["검토 기록", form.ai.review]] as const).map(([label, value]) =>
              <div key={label}><div className="yp-lbl">{label}</div><pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{value}</pre></div>)}
              {form.ai.suggestions.length ? <><div className="yp-lbl">AI가 남긴 개선 제안</div><ul>{form.ai.suggestions.map(item => <li key={item}>{item}</li>)}</ul></> : null}</div> : null}
          </details> : null}
        </YpSection>
      </div>
      <aside className="yp-rside"><section className="yp-card"><div className="yp-rtabs"><button type="button" className={tab === "flow" ? "yp-on" : ""} onClick={() => setTab("flow")}>영상 흐름</button><button type="button" className={tab === "refs" ? "yp-on" : ""} onClick={() => setTab("refs")}>참고 영상</button></div>
        <div className="yp-card-b">{tab === "flow" ? <>
          <div className="yp-muted" style={{ fontSize: 12, marginBottom: 6 }}>컨펌본 · 제목 A × 썸네일 A</div>
          <YtCard page={page} thumb={confirmed?.A?.thumb} title={confirmed?.A?.title ?? ""} />
          <ul className="yp-fl2" style={{ marginTop: 10 }}><li><b>오프닝</b>{plan?.opening || "—"}</li><li><b>본론</b><div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{plan?.body || "—"}</div></li><li><b>클로징 · 다음 행동</b>{plan?.closing || "—"}</li></ul>
        </> : <ul className="yp-open-list">{[...project.yp.topic.refs, ...(plan?.extraRefs ?? [])].map((ref, index) => <li key={`${ref.url}-${index}`}><a href={ref.url} target="_blank" rel="noreferrer">{ref.title ?? ref.url}</a></li>)}
          {!project.yp.topic.refs.length && !plan?.extraRefs.length ? <li className="yp-pempty">없음</li> : null}</ul>}</div></section></aside></div>
      <SendDialog page={page} task="script" open={send} onClose={() => setSend(false)} job={job} defaults={{ minutes: form.spec.runtimeMin ?? 10 }} />
    </> : null}
  </YpFrame>;
}
