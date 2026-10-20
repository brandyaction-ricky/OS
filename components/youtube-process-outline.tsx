"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Clock, Eye, Info, Sparkles } from "lucide-react";
import { lengthEstimate, outlineMissing, runtimeError, SPEC_OPTIONS, type YpOutline } from "@/lib/youtube-process/stages";
import { KnowledgeRichEditor } from "./knowledge-rich-editor";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { GateBanner, hhmm, LockedStep, stepAction, Subject, useYpBundle, YpFrame, YpSection } from "./youtube-process-frame";
import { YtCard } from "./youtube-process-media";

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
  const saving = useRef(false);
  const timer = useRef<number | null>(null);
  const outline = page.bundle?.stages.outline;
  useEffect(() => { if (outline && !dirty) setForm(outline.data); }, [outline, dirty]);
  const project = page.bundle?.project;
  const editable = Boolean(project && ["outline", "make", "review"].includes(project.yp.stage));
  const reloadAll = useCallback(() => { setDirty(false); setEditorKey(key => key + 1); void page.reload(); }, [page]);
  const job = useStaffJob(page, "script", reloadAll);

  const save = async (patch: Record<string, unknown>, next?: YpOutline) => {
    if (!page.client || !project || !outline || saving.current) return;
    saving.current = true;
    const rev = editRev.current;
    try {
      const result = await page.client.saveStage(project.id, "outline", outline.version, patch);
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, outline: result.stage } } : current);
      setSavedAt(hhmm());
      if (editRev.current === rev) { setDirty(false); if (next) setForm(result.stage.data); }
    } catch (reason) { page.fail(reason); } finally { saving.current = false; }
  };
  const saveNow = (extra: Record<string, unknown> = {}) => { if (timer.current) window.clearTimeout(timer.current); if (form) void save({ spec: form.spec, script: form.script, ...extra }, form); };
  const edit = (patch: Partial<YpOutline>) => {
    editRev.current += 1;
    setForm(current => current ? { ...current, ...patch } : current); setDirty(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setForm(current => { if (current) void save({ spec: current.spec, script: current.script }); return current; }), 2500);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const move = async () => {
    if (!page.client || !project) return;
    setMoving(true);
    try {
      if (dirty && form) await save({ spec: form.spec, script: form.script });
      const next = await page.client.move(project.id, "make", page.bundle!.project.version);
      page.setBundle(current => current ? { ...current, project: next } : current);
      window.location.assign(`/content/make?project=${encodeURIComponent(project.id)}`);
    } catch (reason) { page.fail(reason); } finally { setMoving(false); }
  };

  const missing = form ? outlineMissing(form) : "";
  const action = page.bundle ? stepAction(page, 2, project?.yp.stage === "outline" ? { kind: "button", label: "다음: 제작", reason: missing, busy: moving, onClick: () => void move() } : { kind: "status", status: "구성안 끝남" }) : null;
  const current = form?.versions.at(-1)?.v ?? 0;
  const viewing = viewV && viewV !== current ? form?.versions.find(item => item.v === viewV) ?? null : null;
  const estimate = form ? lengthEstimate(viewing?.md ?? form.script, form.spec.runtimeMin) : null;
  const confirmed = page.bundle?.stages.plan.data.confirmed;
  const plan = page.bundle?.stages.plan.data;
  const anim = project?.yp.topic.type !== "live";
  const aiOpen = job.open || Boolean(job.status?.job && job.status.job.status === "blocked");

  return <YpFrame page={page} view={2} action={action} header={header} title="구성안" sub={`${anim ? "" : "촬영 전에 "}스펙과 원고를 정해요. 대표 컨펌은 없어요.`} savedAt={savedAt}
    onSave={editable ? () => saveNow() : undefined} saveDisabled={!dirty}>
    {page.bundle && form && project ? ["topic", "draft"].includes(project.yp.stage) ? <LockedStep page={page} name="구성안" /> : <>
      {project.yp.stage === "outline" ? <><GateBanner page={page} gate="draft" />
        <div className="yp-note yp-gray" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div>구성안은 대표 컨펌 없이 바로 제작으로 넘어가요. 러닝타임과 원고만 채우면 돼요.</div></div></> : null}
      {project.yp.stage !== "outline" && editable ? <div className="yp-note yp-warn" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div>제작이 시작된 원고예요. 고치면 버전이 남고, OS가 만드는 영상은 음성부터 다시 만들어야 해요.</div></div> : null}
      <Subject page={page} />
      <div className="yp-wrap2"><div>
        <YpSection n={1} title={anim ? "완성본 스펙" : "영상 스펙"} gq={anim ? "완성 영상 기준" : "촬영 · 완성본 기준"} need className="yp-compact">
          <div className="yp-spec1">
            <span className="yp-sp1"><span className="yp-sp1-l">러닝타임</span><input className="yp-in yp-sel1" inputMode="numeric" maxLength={3} style={{ width: 64 }} aria-label="러닝타임 분" placeholder="1~120" readOnly={!editable}
              value={form.spec.runtimeMin ?? ""} onChange={event => { const value = event.target.value.replace(/\D/g, ""); edit({ spec: { ...form.spec, runtimeMin: value ? Number(value) : null } }); }} /><span>분</span></span>
            {(["res", "fps", "ratio"] as const).map(key => <span key={key} className="yp-sp1"><span className="yp-dot1">·</span><span className="yp-sp1-l">{{ res: "해상도", fps: "프레임", ratio: "비율" }[key]}</span>
              <select className="yp-in yp-sel1" aria-label={key} disabled={!editable} value={form.spec[key]} onChange={event => edit({ spec: { ...form.spec, [key]: event.target.value } })}>{[...new Set([form.spec[key], ...SPEC_OPTIONS[key]])].map(option => <option key={option}>{option}</option>)}</select></span>)}
          </div>
          {runtimeError(form.spec.runtimeMin) ? <div className="yp-errline">{runtimeError(form.spec.runtimeMin)}</div> : null}
          <p className="yp-hint" style={{ marginTop: 6 }}>{anim ? "완성본 크기만 정해요." : "촬영과 완성본에 같이 써요."} 유형별 기본값이 골라져 있어요.</p>
        </YpSection>
        <YpSection n={2} title="원고" need extra={editable && !viewing ? <button type="button" className="yp-btn yp-sm yp-pri" onClick={() => setSend(true)}><Sparkles size={14} /> {form.ai ? "내 AI로 다시 쓰기" : "내 AI로 원고 쓰기"}</button> : null}>
          <div className="yp-est"><span className="yp-tag yp-acc"><Clock size={12} aria-hidden="true" /> 예상 길이 {estimate?.label}</span><span className="yp-muted" style={{ fontSize: 12 }}>원고 {estimate?.chars.toLocaleString()}자 (공백 · 제목 줄 · 사진 · 표 빼고) ÷ 분당 350자</span>
            {estimate?.verdict ? <span className={estimate.verdict.ok ? "yp-ok" : "yp-bad"}>{estimate.verdict.ok ? "✓" : "⚠"} {estimate.verdict.text}</span> : null}</div>
          {aiOpen ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
          {form.versions.length ? <div className="yp-vstrip yp-vrel"><b style={{ fontSize: 12, color: "var(--muted)" }}>버전</b>
            <div className="yp-vrow2">{form.versions.map(version => <span key={version.v} className={`yp-vchip${version.v === current ? " yp-cur" : ""}${viewV === version.v ? " yp-view" : ""}`}>
              <button type="button" className="yp-vo" onClick={() => { setViewV(version.v === current ? null : version.v); setEditorKey(key => key + 1); }}>{version.v === current ? "● " : ""}v{version.v} {new Date(version.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}{WHY[version.why]}{version.v === current ? " 현재" : ""}</button></span>)}</div>
            {editable && !viewing ? <button type="button" className="yp-btn yp-sm" disabled={!form.script.trim()} onClick={() => saveNow({ saveVersion: true })}>새 버전으로 저장</button> : null}</div>
            : editable ? <div className="yp-vstrip"><span className="yp-hint">아직 저장한 버전이 없어요</span><span className="yp-sp" /><button type="button" className="yp-btn yp-sm" disabled={!form.script.trim()} onClick={() => saveNow({ saveVersion: true })}>새 버전으로 저장</button></div> : null}
          {viewing ? <div className="yp-vbanner"><Eye size={14} aria-hidden="true" /> <b>v{viewing.v} 보는 중</b> (보기 전용) · {viewing.by}<span style={{ flex: 1 }} />
            {editable ? <button type="button" className="yp-btn yp-sm" onClick={() => { setViewV(null); setEditorKey(key => key + 1); void save({ restore: viewing.v }, form); }}>이 버전으로 되돌리기</button> : null}
            <button type="button" className="yp-btn yp-sm yp-pri" onClick={() => { setViewV(null); setEditorKey(key => key + 1); }}>최신으로 돌아가기</button></div> : null}
          {form.ai && form.versions.at(-1)?.why === "ai" && !viewing ? <p className="yp-hint" style={{ margin: "0 0 6px" }}><span className="yp-aitag"><Sparkles size={11} aria-hidden="true" /> AI 초안 · {form.ai.by}의 Claude</span> 사람은 다듬기만 해요.</p> : null}
          <div className="yp-rte yp-tall" onBlur={() => { if (dirty) saveNow(); }}>
            <KnowledgeRichEditor key={`${editorKey}-${viewing?.v ?? "cur"}`} markdown={viewing?.md ?? form.script} accessToken={page.accessToken} disabled={!editable || Boolean(viewing)}
              onChange={markdown => { if (!viewing && markdown !== form.script) edit({ script: markdown }); }} onError={message => page.setError(message)} />
          </div>
          <p className="yp-hint"><Info size={12} aria-hidden="true" /> 클로징: 마지막 20초는 최종 화면 자리예요. 편집 때 비워 두세요.</p>
          {form.ai ? <details className="yp-card" open={notesOpen} onToggle={event => setNotesOpen((event.target as HTMLDetailsElement).open)} style={{ marginTop: 8 }}>
            <summary style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13 }}>내 AI가 남긴 작업 기록 · 자료 · 축 · 설계 · 검수 ({form.ai.model}{form.ai.canonBundle ? ` · 정본 ${form.ai.canonBundle}` : ""})</summary>
            {notesOpen ? <div style={{ padding: "0 12px 12px", fontSize: 13 }}>{([["자료", form.ai.materials], ["축", form.ai.axis], ["설계", form.ai.design], ["검수 기록", form.ai.review]] as const).map(([label, value]) =>
              <div key={label}><div className="yp-lbl">{label}</div><pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{value}</pre></div>)}
              {form.ai.suggestions.length ? <><div className="yp-lbl">정본 개선 제안</div><ul>{form.ai.suggestions.map(item => <li key={item}>{item}</li>)}</ul></> : null}</div> : null}
          </details> : null}
        </YpSection>
        {anim ? <p className="yp-hint">애니메이션 구성안은 영상 스펙 · 원고만 써요. 제작 단계에서 OS가 이 원고로 영상을 만들어요.</p>
          : <p className="yp-hint">큐시트 · 촬영 준비 · PDF 뽑기는 다음 개발 차례에 들어와요.</p>}
      </div>
      <aside className="yp-rside"><section className="yp-card"><div className="yp-rtabs"><button type="button" className={tab === "flow" ? "yp-on" : ""} onClick={() => setTab("flow")}>영상 흐름</button><button type="button" className={tab === "refs" ? "yp-on" : ""} onClick={() => setTab("refs")}>레퍼런스</button></div>
        <div className="yp-card-b">{tab === "flow" ? <>
          <div className="yp-muted" style={{ fontSize: 12, marginBottom: 6 }}>기획안 컨펌본 · 제목 A × 썸네일 A</div>
          <YtCard page={page} thumb={confirmed?.A?.thumb} title={confirmed?.A?.title ?? ""} />
          <ul className="yp-fl2" style={{ marginTop: 10 }}><li><b>오프닝</b>{plan?.opening || "—"}</li><li><b>본론</b><div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{plan?.body || "—"}</div></li><li><b>클로징 · 다음 행동</b>{plan?.closing || "—"}</li></ul>
        </> : <ul className="yp-open-list">{[...project.yp.topic.refs, ...(plan?.extraRefs ?? [])].map((ref, index) => <li key={`${ref.url}-${index}`}><a href={ref.url} target="_blank" rel="noreferrer">{ref.title ?? ref.url}</a></li>)}
          {!project.yp.topic.refs.length && !plan?.extraRefs.length ? <li className="yp-pempty">없음</li> : null}</ul>}</div></section></aside></div>
      <SendDialog page={page} task="script" open={send} onClose={() => setSend(false)} job={job} defaults={{ minutes: form.spec.runtimeMin ?? 10 }} />
    </> : null}
  </YpFrame>;
}
