"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Sparkles, X } from "lucide-react";
import { editableFields } from "@/lib/youtube-process/confirm";
import { parseYoutubeRef, projectName, sameRef } from "@/lib/youtube-process/project";
import { draftMissing, PLAN_FIELD_KEY, slotOf, thumbFilled, type YpPlan, type YpThumb } from "@/lib/youtube-process/stages";
import { GateBanner, gateAction, gateSub, hhmm, LockedStep, ReplyForm, Subject, useGate, useLeaveGuard, useYpBundle, YpFrame, YpSection } from "./youtube-process-frame";
import type { YpProject } from "@/lib/youtube-process/project";
import { ThumbView } from "./youtube-process-media";
import { JobLine, PatternsBox, SendDialog, useStaffJob } from "./youtube-process-ai";
import { ShortScriptScreen } from "./youtube-process-short-script";
import { CardMakeScreen } from "./youtube-process-card";

const id = () => crypto.randomUUID().slice(0, 12);
const SlotTag = ({ index }: { index: number }) => {
  const slot = slotOf(index);
  return slot === "예비" ? <span className="yp-tag" title="예비 후보 — 컨펌 · 검토 · 업로드 테스트에 안 들어가요">예비</span>
    : <span className={`yp-ltag${slot === "C" ? " yp-c" : ""}`} title={slot === "C" ? "C안 · 선택" : `${slot}안 · 필수`}>{slot}</span>;
};
const move = <T,>(list: T[], from: number, to: number) => { const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

/** S3 기획안: 제목 후보 · 썸네일 후보 · 영상 흐름 · 전달 사항, then the 기획안 컨펌 (4-4). */
export function YoutubeDraftScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  const [form, setForm] = useState<YpPlan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [size, setSize] = useState<"s" | "l">("s");
  const [refUrl, setRefUrl] = useState("");
  const [uploading, setUploading] = useState("");
  const editRev = useRef(0);
  // Saves go out one after another, each on the version the last one returned (로건 피드백 A-2), and a 컨펌 waits for them (로건 QA 10/30).
  const queue = useRef<Promise<YpProject | null>>(Promise.resolve(null));
  const timer = useRef<number | null>(null);
  const savedVersion = useRef({ project: "", version: 0 });
  const [send, setSend] = useState(false);
  const plan = page.bundle?.stages.plan;
  useEffect(() => { if (plan && !dirty) setForm(plan.data); }, [plan, dirty]);
  const reload = page.reload;
  const onJobDone = useCallback(() => { setDirty(false); void reload(); }, [reload]);
  const job = useStaffJob(page, "plan", onJobDone);

  const project = page.bundle?.project;
  const fields = project ? editableFields(project, "draft") : [];
  const can = (key: keyof typeof PLAN_FIELD_KEY) => Boolean(project && project.yp.stage === "draft" && (fields === "all" || fields.includes(PLAN_FIELD_KEY[key])));
  const rev = (key: string) => project?.yp.gates.draft.state === "changes" && (project.yp.gates.draft.fields ?? []).includes(key);

  const save = (next: YpPlan | null = form): Promise<YpProject | null> => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    // The text this save carries is the text typed up to now: only then may its answer refill the form.
    const rev0 = editRev.current;
    const run = queue.current.then(async () => {
      if (!page.client || !project || !plan || !next) return null;
      const patch = Object.fromEntries((Object.keys(PLAN_FIELD_KEY) as (keyof typeof PLAN_FIELD_KEY)[]).filter(key => can(key)).map(key => [key, next[key]]));
      try {
        const result = await page.client.saveStage(project.id, "plan", savedVersion.current.project === project.id ? Math.max(plan.version, savedVersion.current.version) : plan.version, patch);
        savedVersion.current = { project: project.id, version: result.stage.version };
        page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, plan: result.stage } } : current);
        setSavedAt(hhmm());
        if (editRev.current === rev0) setDirty(false);
        return result.project;
      } catch (reason) { page.fail(reason); return null; }
    });
    queue.current = run;
    return run;
  };
  // Typing saves itself after a short pause, not only when the cursor leaves the box (로건 QA 10/30: a reload lost the 클로징).
  const edit = (patch: Partial<YpPlan>, now = false) => {
    editRev.current += 1;
    const next = { ...form!, ...patch };
    setForm(next); setDirty(true); page.setError("");
    if (now) { void save(next); return; }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(next), 1500);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useLeaveGuard(dirty);
  const control = useGate(page, "draft", async () => {
    if (dirty && project?.yp.stage === "draft") return save();
    const last = await queue.current;
    return last && project && last.version > project.version ? last : project ?? null;
  });
  const upload = async (index: number, file: File) => {
    if (!page.client || !project || !form) return;
    setUploading(form.thumbs[index].id);
    try {
      const saved = await page.client.uploadAsset(project.id, "plan_thumb", file);
      edit({ thumbs: form.thumbs.map((thumb, at) => at === index ? { ...thumb, mode: "img", path: saved.path } : thumb) }, true);
    } catch (reason) { page.fail(reason); } finally { setUploading(""); }
  };

  // A 숏폼's 기획안 place is its 대본 (숏폼 대본 정본, 2026-10-28).
  if (project?.yp.topic.type === "short") return <ShortScriptScreen page={page} header={header} />;
  // A 카드뉴스's 기획안 place is 카드 만들기 (설계서 2026-10-30).
  if (project?.yp.topic.type === "card") return <CardMakeScreen page={page} header={header} />;
  const missing = form ? draftMissing(form) : "";
  const action = page.bundle ? gateAction(page, "draft", 1, control, missing) : null;
  return <YpFrame page={page} view={1} action={action} header={header} title="기획안" sub={gateSub(project, "draft", "제목 A · B와 썸네일 A · B, 영상 흐름을 채우고 컨펌해요.", "기획안 컨펌이 끝났어요. 구성안으로 넘어가요.")} savedAt={savedAt}
    todo={form && project?.yp.stage === "draft" ? [{ label: "제목 A", done: Boolean(form.titles[0]?.text.trim()) }, { label: "제목 B", done: Boolean(form.titles[1]?.text.trim()) }, { label: "썸네일 A", done: thumbFilled(form.thumbs[0]) }, { label: "썸네일 B", done: thumbFilled(form.thumbs[1]) }, { label: "오프닝", done: Boolean(form.opening.trim()) }, { label: "본론", done: Boolean(form.body.trim()) }, { label: "클로징", done: Boolean(form.closing.trim()) }] : undefined}
    onSave={project?.yp.stage === "draft" ? () => void save() : undefined} saveDisabled={!dirty}>
    {page.bundle && form && project ? project.yp.stage === "topic" ? <LockedStep page={page} name="기획안" /> : <div onBlur={() => { if (dirty) void save(); }}>
      <GateBanner page={page} gate="draft" />
      <ReplyForm control={control} />
      <Subject page={page} />
      {project.yp.stage === "draft" && project.yp.gates.draft.state !== "wait" ? (job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} />
        // The boxes are open from the start with one button above them: the two big choice cards shrank into this button on 「직접 쓰기」
        // and pulled the page up ~50 px, so text meant for 제목 A landed in B (로건 QA 10/30).
        : <div className="yp-row-btns" style={{ marginBottom: 10 }}><button type="button" className="yp-btn yp-sm" onClick={() => setSend(true)}><Sparkles size={14} /> {form.ai ? "내 AI로 다시 쓰기" : "내 AI로 초안 채우기"}</button>
          {form.ai ? <span className="yp-aitag"><Sparkles size={11} aria-hidden="true" /> AI 초안 · {form.ai.by}</span> : null}</div>) : null}
      {form.aiDraft && project.yp.stage === "draft" ? <div className="yp-note yp-purple" role="status"><Sparkles size={16} className="yp-i" aria-hidden="true" /><div><b>AI 기획안이 왔어요.</b> 이미 쓴 내용이 있어 바로 넣지 않았어요.
        <button type="button" className="yp-lnk" disabled={!can("titles")} onClick={() => { const draft = form.aiDraft!; editRev.current += 1; const next = { ...form, ...draft, aiDraft: undefined }; setForm(next); setDirty(true);
          if (page.client && project && plan) void page.client.saveStage(project.id, "plan", plan.version, { ...draft, aiDraft: null }).then(result => { page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, plan: result.stage } } : current); setDirty(false); }, page.fail); }}>이 초안으로 바꾸기</button>
        <details><summary>초안 보기</summary><div style={{ fontSize: 13 }}><b>제목</b><ol>{form.aiDraft.titles.map(title => <li key={title.id}>{title.text}</li>)}</ol>
          <b>썸네일</b><ol>{form.aiDraft.thumbs.map(thumb => <li key={thumb.id}>{thumb.copy} — {thumb.screen}</li>)}</ol>
          <b>오프닝</b><p>{form.aiDraft.opening}</p><b>본론</b><p style={{ whiteSpace: "pre-wrap" }}>{form.aiDraft.body}</p><b>클로징</b><p>{form.aiDraft.closing}</p></div></details></div></div> : null}
      <div className="yp-wrap2"><div>
        <YpSection n={1} title="제목 · 썸네일" gq="어떻게 클릭하게 만드나요?" need rev={rev("draft.tt")}>
          {form.ai?.patterns ? <details className="yp-card" style={{ padding: "8px 12px", marginBottom: 10 }}><summary style={{ cursor: "pointer", fontSize: 13 }}><Sparkles size={12} aria-hidden="true" /> AI가 뽑은 제목 · 썸네일 공식 보기 (시장 참고 영상에서 반복된 말)</summary>
            <div style={{ marginTop: 6 }}><PatternsBox patterns={form.ai.patterns} /></div></details> : null}
          <div className="yp-field"><div className="yp-fld-h"><b>제목 후보</b></div>
            {form.titles.map((title, index) => <div key={title.id} className={`yp-tr3${index < 3 ? " yp-on" : ""}`}>
              {can("titles") ? <span className="yp-row-btns">
                <button type="button" className="yp-ib yp-xs" aria-label="위로" disabled={!index} onClick={() => edit({ titles: move(form.titles, index, index - 1) }, true)}><ArrowUp size={12} /></button>
                <button type="button" className="yp-ib yp-xs" aria-label="아래로" disabled={index === form.titles.length - 1} onClick={() => edit({ titles: move(form.titles, index, index + 1) }, true)}><ArrowDown size={12} /></button></span> : null}
              <SlotTag index={index} />
              <input className="yp-in" aria-label={`제목 ${slotOf(index)}`} value={title.text} readOnly={!can("titles")} placeholder={index < 2 ? `${slotOf(index)}안 · 필수` : index === 2 ? "C안 · 선택" : "예비 후보"}
                onChange={event => edit({ titles: form.titles.map(row => row.id === title.id ? { ...row, text: event.target.value } : row) })} />
              {can("titles") && form.titles.length > 1 ? <button type="button" className="yp-ib" aria-label="후보 빼기" onClick={() => edit({ titles: form.titles.filter(row => row.id !== title.id) }, true)}><X size={14} /></button> : null}
            </div>)}
            {can("titles") ? <button type="button" className="yp-btn yp-sm" onClick={() => edit({ titles: [...form.titles, { id: id(), text: "" }] })}><Plus size={14} /> 제목 후보 추가</button> : null}
            </div>
          <div className="yp-field"><div className="yp-fld-h"><b>썸네일 후보</b><span className="yp-gq">이미지 또는 글로</span><span className="yp-sp" />
            <div className="yp-seg2 yp-sm" role="group" aria-label="후보 크기"><button type="button" className={size === "s" ? "yp-on" : ""} onClick={() => setSize("s")}>작게</button><button type="button" className={size === "l" ? "yp-on" : ""} onClick={() => setSize("l")}>크게</button></div></div>
            <div className={`yp-thg2 yp-sz-${size}`} style={size === "l" ? { gridTemplateColumns: "repeat(2,minmax(0,1fr))" } : undefined}>
              {form.thumbs.map((thumb, index) => <ThumbCard key={thumb.id} page={page} thumb={thumb} index={index} can={can("thumbs")} busy={uploading === thumb.id}
                onChange={next => edit({ thumbs: form.thumbs.map(row => row.id === thumb.id ? next : row) })}
                onMode={mode => edit({ thumbs: form.thumbs.map(row => row.id === thumb.id ? { ...row, mode } : row) }, true)}
                onMove={to => edit({ thumbs: move(form.thumbs, index, to) }, true)} last={index === form.thumbs.length - 1}
                onRemove={form.thumbs.length > 1 ? () => edit({ thumbs: form.thumbs.filter(row => row.id !== thumb.id) }, true) : undefined}
                onUpload={file => void upload(index, file)} />)}
              {can("thumbs") ? <button type="button" className="yp-th-add" onClick={() => edit({ thumbs: [...form.thumbs, { id: id(), mode: "text" }] })}><Plus size={16} /> 후보 추가</button> : null}
            </div>
            </div>
        </YpSection>
        <YpSection n={2} title="영상 흐름 (뼈대)" gq="어떤 순서로 보여 주나요?" need>
          <div className={`yp-field${rev("draft.opening") ? " yp-rev" : ""}`}><div className="yp-fld-h"><b>오프닝 (첫 30초)</b><span className="yp-gq">처음 30초에 뭘 보여 주나요?</span>{rev("draft.opening") ? <span className="yp-revtag">대표가 짚은 칸</span> : null}</div>
            <textarea className="yp-in" rows={3} aria-label="오프닝" value={form.opening} readOnly={!can("opening")} placeholder="예) 회의에서 내 의견이 무시당했을 때, 그릇 큰 사람은 이렇게 반응한다" onChange={event => edit({ opening: event.target.value })} />
            <p className="yp-hint">제목 · 썸네일에서 한 약속을 바로 보여 줄 장면</p></div>
          <div className={`yp-field${rev("draft.body") ? " yp-rev" : ""}`}><div className="yp-fld-h"><b>본론</b><span className="yp-gq">본론은 어떻게 이어지나요?</span>{rev("draft.body") ? <span className="yp-revtag">대표가 짚은 칸</span> : null}</div>
            <textarea className="yp-in" rows={6} aria-label="본론" value={form.body} readOnly={!can("body")} placeholder={"예) 소제목 – 보여 줄 장면\n1. 남 탓을 하지 않는다 – 같은 실수, 두 사람 반응 비교\n2. 끝까지 듣는다 – 말 끊는 사람 vs 듣는 사람\n3. …"} onChange={event => edit({ body: event.target.value })} /></div>
          <div className={`yp-field${rev("draft.closing") ? " yp-rev" : ""}`}><div className="yp-fld-h"><b>클로징 · 다음 행동</b><span className="yp-gq">끝나고 어디로 보내나요?</span>{rev("draft.closing") ? <span className="yp-revtag">대표가 짚은 칸</span> : null}</div>
            <textarea className="yp-in" rows={3} aria-label="클로징 · 다음 행동" value={form.closing} readOnly={!can("closing")} placeholder="예) 그릇은 습관이라는 말로 마무리하고, 진단으로 보내요" onChange={event => edit({ closing: event.target.value })} /></div>
        </YpSection>
        <details className="yp-more-fields" open={Boolean(form.note) || rev("draft.note")}><summary>전달 사항 더 쓰기 (선택)</summary>
          <textarea className="yp-in" rows={2} aria-label="전달 사항" value={form.note} readOnly={!can("note")} placeholder="예) 지난주 댓글에 비슷한 질문이 많았어요. 참고 영상 1번은 제목 구조만 참고했어요" onChange={event => edit({ note: event.target.value })} />
        </details>
      </div>
      <aside className="yp-rside"><section className="yp-card"><div className="yp-card-h">참고 영상 <span className="yp-opt">선택</span></div><div className="yp-card-b">
        <ul className="yp-open-list">{[...project.yp.topic.refs.map(ref => ({ ref, own: false })), ...form.extraRefs.map(ref => ({ ref, own: true }))].map(({ ref, own }, index) => <li key={`${ref.url}-${index}`}>
          <a href={ref.url} target="_blank" rel="noreferrer">{ref.title ?? ref.url}</a><span className="yp-sp" />
          {own && can("extraRefs") ? <button type="button" className="yp-ib" aria-label="빼기" onClick={() => edit({ extraRefs: form.extraRefs.filter(row => row.url !== ref.url) }, true)}><X size={14} /></button> : null}</li>)}</ul>
        {!project.yp.topic.refs.length && !form.extraRefs.length ? <p className="yp-pempty">아직 없어요</p> : null}
        {can("extraRefs") ? <form className="yp-savebar" onSubmit={event => { event.preventDefault(); const ref = parseYoutubeRef(refUrl); if (!ref) { page.setError("유튜브 영상 주소를 붙여 넣어 주세요."); return; }
          if ([...project.yp.topic.refs, ...form.extraRefs].some(row => sameRef(row, ref))) { page.setError("이미 있는 참고 영상이에요."); return; }
          setRefUrl(""); edit({ extraRefs: [...form.extraRefs, ref] }, true); }}>
          <input className="yp-in" placeholder="유튜브 영상 주소" aria-label="참고 영상 주소" value={refUrl} onChange={event => setRefUrl(event.target.value)} /><button type="submit" className="yp-btn">추가</button></form> : null}
      </div></section></aside></div>
      <SendDialog page={page} task="plan" open={send} onClose={() => setSend(false)} job={job} queryDefault={project ? projectName(project) : undefined} />
    </div> : null}
  </YpFrame>;
}

/** One 썸네일 후보 card: 이미지 (upload) or 글 설명 (화면 + 큰 글자), with its A · B · C letter (시안 thCard). */
function ThumbCard({ page, thumb, index, can, busy, last, onChange, onMode, onMove, onRemove, onUpload }: {
  page: ReturnType<typeof useYpBundle>; thumb: YpThumb; index: number; can: boolean; busy: boolean; last: boolean;
  onChange: (thumb: YpThumb) => void; onMode: (mode: YpThumb["mode"]) => void; onMove: (to: number) => void; onRemove?: () => void; onUpload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className={`yp-thc${index < 3 ? " yp-on" : ""}`}>
    <div className="yp-thc-h"><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><SlotTag index={index} /><span className="yp-muted" style={{ fontSize: 12 }}>후보 {index + 1}</span></span>
      {can ? <span className="yp-row-btns"><button type="button" className="yp-ib yp-xs" aria-label="앞으로" disabled={!index} onClick={() => onMove(index - 1)}><ArrowUp size={12} /></button>
        <button type="button" className="yp-ib yp-xs" aria-label="뒤로" disabled={last} onClick={() => onMove(index + 1)}><ArrowDown size={12} /></button>
        {onRemove ? <button type="button" className="yp-ib yp-xs" aria-label="후보 빼기" onClick={onRemove}><X size={12} /></button> : null}</span> : null}</div>
    {can ? <div className="yp-seg2 yp-sm"><button type="button" className={thumb.mode === "img" ? "yp-on" : ""} onClick={() => onMode("img")}>이미지</button><button type="button" className={thumb.mode === "text" ? "yp-on" : ""} onClick={() => onMode("text")}>글 설명</button></div> : null}
    {thumb.mode === "img" ? thumb.path ? <ThumbView page={page} thumb={thumb} alt={`썸네일 후보 ${index + 1}`} />
      : <div className="yp-th-drop"><ImagePlus size={18} aria-hidden="true" /><span>png · jpg · gif · webp · 10MB</span>{can ? <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "올리는 중…" : "이미지 올리기"}</button> : null}</div>
      : <>
        <ThumbView page={page} thumb={thumb} alt={`썸네일 후보 ${index + 1}`} />
        <label className="yp-lbl yp-tl2" style={{ margin: 0 }}>화면</label>
        <textarea className="yp-in yp-sm2" rows={2} aria-label="화면 설명" value={thumb.screen ?? ""} readOnly={!can} placeholder="어떤 장면인가요?" onChange={event => onChange({ ...thumb, screen: event.target.value })} />
        <label className="yp-lbl yp-tl2" style={{ margin: 0 }}>큰 글자</label>
        <input className="yp-in yp-sm2" aria-label="큰 글자" value={thumb.copy ?? ""} readOnly={!can} placeholder="예) 쓸 곳이 없었어요" onChange={event => onChange({ ...thumb, copy: event.target.value })} />
      </>}
    {thumb.mode === "img" && thumb.path && can ? <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "올리는 중…" : "다른 이미지 올리기"}</button> : null}
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }} />
  </div>;
}
