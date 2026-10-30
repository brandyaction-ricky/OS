"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, ChevronRight, Download, Film, FileText, Sparkles, Upload, X } from "lucide-react";
import { editableFields } from "@/lib/youtube-process/confirm";
import { myinCleanScript, myinScriptMarkdown } from "@/lib/myin-script";
import { narrationFromMarkdown } from "@/lib/youtube-narration-document";
import { projectName, topicKeywords, stepHref } from "@/lib/youtube-process/project";
import { finalPair, MAKE_STEPS, SLOTS, thumbsMissing, type YpMake, type YpSlot } from "@/lib/youtube-process/stages";
import { MyinV13Panel } from "./myin-v13-panel";
import { FormulaNote, JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { GateBanner, gateSub, md, stepAction, Subject, useYpBundle, YpFrame, YpSection, LockedStep, type YpPage } from "./youtube-process-frame";
import { ThumbView } from "./youtube-process-media";
import { ShortMake } from "./youtube-process-short";
import { scriptLines } from "@/lib/youtube-process/short-script";

const dayDiff = (date: string) => Math.round((Date.parse(`${date}T00:00:00`) - new Date(new Date().toDateString()).getTime()) / 86_400_000);
const md2 = (date: string) => { const at = new Date(`${date}T00:00:00`); return `${at.getMonth() + 1}/${at.getDate()} (${"일월화수목금토"[at.getDay()]})`; };
function DueChip({ date }: { date: string }) {
  const diff = dayDiff(date);
  return <span className={`yp-dchip${diff < 0 ? " yp-late" : diff <= 1 ? " yp-soon" : ""}`}>{diff < 0 ? `${-diff}일 지남` : diff === 0 ? "오늘" : `${diff}일 남음`}</span>;
}
export const sizeLabel = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)}GB` : `${(bytes / 1e6).toFixed(1)}MB`;

/** S5 제작: 일정 · 진행 상태 · (실사) 작업 자료 · 최종본 (OS 자동 제작 or 파일) · 최종 썸네일, then [다음: 최종 검토] (4-6). */
export function YoutubeMakeScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  const router = useRouter();
  const [due, setDue] = useState("");
  const [why, setWhy] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [finalError, setFinalError] = useState("");   // shown in the upload box: the page-top error was easy to miss below the fold
  const [moving, setMoving] = useState(false);
  const finalInput = useRef<HTMLInputElement>(null);
  const reload = page.reload;
  const onFinal = useCallback(() => void reload(), [reload]);
  // 최종 썸네일 [공식대로 다시 뽑기]: one slot at a time goes to the PD's own AI.
  const redoJob = useStaffJob(page, "retitle", onFinal);
  const [redoAsk, setRedoAsk] = useState<{ slot: YpSlot; reason: string } | null>(null);
  // The slot whose 고치기 · 후보 panel is open under the three cards (a card is too narrow to read candidates in).
  const [fixing, setFixing] = useState<YpSlot | null>(null);
  const bundle = page.bundle;
  const project = bundle?.project;
  const make = bundle?.stages.make;
  const kind = project?.yp.topic.type ?? "anim";
  const anim = kind === "anim";
  const short = kind === "short";
  // 숏폼 (2026-10-28): one made from a confirmed 대본 is made like a longform, by the vertical engine; older ones keep the scene editor.
  const shortScript = bundle?.stages.shortScript.data.confirmed;
  // A 숏폼 goes to the automatic panel only with a confirmed 대본 text; one made in the older scene editor keeps it (2026-10-28 review).
  // An ad is made in the scene editor (owner decision 2026-10-30, 광고 A안): its 광고 브리프 and the 9:16 · 1:1 · 4:5 sizes live there.
  const auto = anim || Boolean(short && shortScript?.text.trim() && project?.yp.topic.purpose !== "ad");

  const save = async (patch: Record<string, unknown>, label: string) => {
    if (!page.client || !project || !make) return false;
    setBusy(label); page.setError("");
    try {
      const result = await page.client.saveStage(project.id, "make", make.version, patch);
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, make: result.stage } } : current);
      return true;
    } catch (reason) { page.fail(reason); return false; } finally { setBusy(""); }
  };
  const uploadFinal = async (file: File) => {
    if (!page.client || !project) return;
    setProgress(0); page.setError(""); setFinalError("");
    try {
      const saved = await page.client.uploadAsset(project.id, "final", file, setProgress);
      if (await save({ addFinal: saved }, "final")) await page.reload();
    } catch (reason) { setFinalError(reason instanceof Error ? reason.message : "최종본을 올리지 못했어요."); page.fail(reason); } finally { setProgress(null); }
  };
  const uploadThumb = async (slot: YpSlot, file: File) => {
    if (!page.client || !project) return;
    setBusy(`thumb-${slot}`);
    try { const saved = await page.client.uploadAsset(project.id, "thumb", file); await save({ thumb: { slot, path: saved.path, name: saved.name } }, `thumb-${slot}`); }
    catch (reason) { page.fail(reason); setBusy(""); }
  };
  const move = async () => {
    if (!page.client || !project) return;
    setMoving(true);
    try { await page.client.move(project.id, "review", project.version); router.push(`/content/final-check?project=${encodeURIComponent(project.id)}&tab=video`); }
    catch (reason) { page.fail(reason); } finally { setMoving(false); }
  };

  const finals = bundle?.finals ?? [];
  const data: YpMake | undefined = make?.data;
  const editable = Boolean(project && (project.yp.stage === "make" || (project.yp.stage === "review" && project.yp.gates.review.state !== "wait")));
  const reviewFields = project ? editableFields(project, "review") : [];
  const canFinal = editable && (project?.yp.stage === "make" || reviewFields === "all" || reviewFields.includes("make.final"));
  const canThumb = editable && (project?.yp.stage === "make" || reviewFields === "all" || reviewFields.includes("make.thumbs"));
  // 일정 is optional (owner decision 2026-10-25): making goes on without a date; the date only feeds 스케줄.
  const reason = !finals.length ? (short ? "최종본을 만들거나 올려 주세요" : "최종본을 올려 주세요") : data && !short ? thumbsMissing(data) : "";
  const action = bundle ? stepAction(page, 3, project?.yp.stage === "make" ? { kind: "button", label: "다음: 최종 검토", reason, busy: moving, onClick: () => void move() } : { kind: "status", status: "제작 끝남" }) : null;
  const confirmed = bundle?.stages.plan.data.confirmed;
  const steps = MAKE_STEPS[kind];
  const statusIndex = data ? Math.max(0, steps.findIndex(([key]) => key === (anim && data.status === "shoot" ? "prep" : data.status))) : 0;
  let n = 0;

  return <YpFrame page={page} view={3} action={action} header={header} title="제작" sub={project?.yp.stage === "review" ? gateSub(project, "review", "최종 검토 중이에요. 새 버전이나 썸네일을 바꿀 때만 여기서 해요.", "제작이 끝났어요.") : short ? auto ? "확정한 대본으로 세로 숏폼을 자동으로 만들어요." : "무엇을 만들지 정하고, 장면마다 이미지를 넣어 영상을 만들어요." : anim ? "원고로 영상을 자동으로 만들어요. 다 되면 최종 썸네일 A · B를 올려요." : "편집이 끝나면 최종본과 최종 썸네일 A · B를 올려요."}
    todo={data && project?.yp.stage === "make" ? short ? [{ label: "최종본", done: finals.length > 0 }] : [{ label: "최종본", done: finals.length > 0 }, { label: "최종 썸네일 A", done: Boolean(data.thumbs.A) }, { label: "최종 썸네일 B", done: Boolean(data.thumbs.B) }] : undefined}>
    {bundle && data && project ? ["topic", "draft", "outline"].includes(project.yp.stage) ? <LockedStep page={page} name="제작" /> : <>
      {project.yp.stage === "review" ? <GateBanner page={page} gate="review" /> : null}
      <Subject page={page} />
      <YpSection n={++n} title="일정" need={data.editDue ? null : false}>
        {!data.editDue || changing ? <div className="yp-duefirst"><div style={{ flexBasis: "100%", fontWeight: 700 }}>{data.editDue ? "편집 완료일 바꾸기" : "편집 완료일을 정하면 스케줄에 보여요"}</div>
          <div><label className="yp-lbl" style={{ marginTop: 0 }}>편집 완료일</label><input className="yp-in" type="date" value={due || data.editDue} onChange={event => setDue(event.target.value)} aria-label="편집 완료일" disabled={!editable} /></div>
          {data.editDue ? <div style={{ flex: 1, minWidth: 200 }}><label className="yp-lbl" style={{ marginTop: 0 }}>바꾸는 이유 (선택)</label><input className="yp-in" value={why} onChange={event => setWhy(event.target.value)} maxLength={200} /></div> : null}
          <button type="button" className="yp-btn yp-pri" disabled={!editable || !(due || data.editDue) || Boolean(busy)} onClick={() => void save({ editDue: due || data.editDue, editDueWhy: why }, "due").then(ok => { if (ok) { setChanging(false); setWhy(""); setDue(""); } })}>정하기</button>
          {changing ? <button type="button" className="yp-btn" onClick={() => setChanging(false)}>취소</button> : null}</div>
          : <><div className="yp-sched2 yp-one"><div className="yp-sdate"><span className="yp-k">편집 완료일</span><div className="yp-v"><span className={`yp-due-big${dayDiff(data.editDue) < 0 ? " yp-late" : ""}`}>{md2(data.editDue)}</span><DueChip date={data.editDue} /></div>
            {editable ? <div><button type="button" className="yp-btn yp-sm" onClick={() => setChanging(true)}><CalendarDays size={14} /> 바꾸기</button></div> : null}</div></div>
            {dayDiff(data.editDue) < 0 && project.yp.stage === "make" ? <div className="yp-note yp-bad" style={{ margin: "10px 0 0" }}><div>편집 완료일이 지났어요. 날짜를 바꾸거나 제작을 마쳐 주세요.</div></div> : null}
            {data.log.length ? <><div className="yp-lbl">바꾼 기록</div><ul className="yp-hist">{data.log.slice(0, 5).map(item => <li key={item.at}><time>{md(item.at)}</time><span>편집 완료 {item.from ? md2(item.from) : "없음"} → {md2(item.to)} · {item.by}{item.why ? ` · ${item.why}` : ""}</span></li>)}</ul></> : null}</>}
      </YpSection>
      {/* The OS-made video moves on by itself; the manual 준비 · 편집 · 완료 buttons are for 실사. */}
      {short && !auto ? <ShortMake page={page} editable={canFinal} n0={n} /> : null}
      {anim || short ? null : <>
      <YpSection n={++n} title="진행 상태">
        <div className="yp-pstat2">{steps.map(([key, label], index) => <span key={key} style={{ display: "contents" }}>
          {index ? <span className="yp-arw" aria-hidden="true"><ChevronRight size={14} /></span> : null}
          <button type="button" className={`yp-ps${index === statusIndex ? " yp-on" : index < statusIndex ? " yp-past" : ""}`} disabled={!editable || !data.editDue || Boolean(busy)} onClick={() => void save({ status: key }, "status")}>
            {index < statusIndex ? "✓ " : ""}{label}<small>{data.statusAt[key] ? md(data.statusAt[key]).split(" ")[0] : ""}</small></button></span>)}</div>
        <p className="yp-hint">최종본과 썸네일 A · B가 있으면 ‘완료’가 돼요.</p>
      </YpSection>
      </>}
      {anim || short ? null : <YpSection n={++n} title="작업 자료"><div className="yp-mats">
        <div className="yp-mat"><FileText size={16} aria-hidden="true" /><div className="yp-grow"><b>원고 (최신)</b><div className="yp-muted" style={{ fontSize: 12 }}>v{bundle.stages.outline.data.versions.at(-1)?.v ?? "—"}{bundle.stages.outline.data.versions.find(item => item.why === "make") ? ` · 제작 시작 원고 v${bundle.stages.outline.data.versions.filter(item => item.why === "make").at(-1)!.v}` : ""}</div></div><Link className="yp-btn yp-sm" href={stepHref(2, project.id)}>열기</Link></div>
        <div className="yp-mat"><FileText size={16} aria-hidden="true" /><div className="yp-grow"><b>컨펌본 (제목 · 썸네일)</b><div className="yp-muted" style={{ fontSize: 12 }}>{SLOTS.filter(slot => confirmed?.[slot]?.title).map(slot => <div key={slot}>{slot}: {confirmed?.[slot]?.title}</div>)}</div></div></div>
      </div></YpSection>}
      {short && !auto ? <details className="yp-more-fields" open={finals.some(final => final.source === "upload")}><summary>직접 편집한 영상이 있으면 올려요 (선택)</summary>
        {progress !== null ? <div className="yp-drop"><Upload size={22} aria-hidden="true" /><b>올리는 중</b><div className="yp-dprog"><i style={{ width: `${progress}%` }} /></div><span style={{ fontSize: 12 }}>{progress}%, 다 올라갈 때까지 화면을 닫지 마세요</span></div>
          : canFinal ? <div className="yp-row-btns"><button type="button" className="yp-btn yp-sm" onClick={() => finalInput.current?.click()}><Upload size={14} /> 파일 올리기</button><span className="yp-muted" style={{ fontSize: 12 }}>올린 파일이 최종 검토 새 버전이 돼요</span></div> : null}
        <input ref={finalInput} type="file" hidden accept="video/mp4,video/quicktime,video/x-m4v,video/webm" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFinal(file); }} />
      </details> : <>
      <YpSection n={++n} title={auto ? "최종본 만들기" : "최종본 올리기"} gq={short ? "확정한 대본으로 자동으로 만들어요" : anim ? "원고로 영상을 자동으로 만들어요" : undefined} need>
        {finals.length ? <ul className="yp-hist" style={{ marginBottom: 10 }}>{[...finals].reverse().map(final => <li key={final.v}><time>v{final.v}{final.v === finals.length ? " 최신" : ""}</time>
          <span>{final.source === "myin" ? "자동 제작" : final.name} · {md(final.at)} · {sizeLabel(final.bytes)}{final.durationSeconds ? ` · ${Math.floor(final.durationSeconds / 60)}분 ${Math.round(final.durationSeconds % 60)}초` : ""}</span></li>)}</ul> : null}
        {auto && page.demo ? <div className="yp-note yp-gray"><div>데모에서는 자동 제작을 하지 않아요.</div></div> : null}
        {auto && !page.demo ? <MyinV13Panel sourceId={project.id} title={projectName(project)} embedded onFinal={onFinal} short={short}
          voiceText={shortScript ? scriptLines(shortScript.text).map(line => line.text).join(" ") : myinCleanScript(myinScriptMarkdown(null, narrationFromMarkdown(bundle.stages.outline.data.script))).spoken.join("\n")}
          finalNote={<p className="yt-note">최종본 v{finals.length || 1} 완성. {short ? "소리를 확인하고 [다음: 최종 검토]를 눌러요." : "소리를 확인하고 최종 썸네일 A · B를 올려요."}</p>} /> : null}
        {progress !== null ? <div className="yp-drop"><Upload size={22} aria-hidden="true" /><b>최종본 v{finals.length + 1} 올리는 중</b><div className="yp-dprog"><i style={{ width: `${progress}%` }} /></div><span style={{ fontSize: 12 }}>{progress}%, 다 올라갈 때까지 화면을 닫지 마세요</span></div>
          : canFinal ? <div className={`yp-drop${finals.length ? " yp-ok" : ""}`} style={auto ? { marginTop: 10 } : undefined}>{finals.length ? <Check size={22} aria-hidden="true" /> : <Film size={22} aria-hidden="true" />}
            <b>{finals.length ? `최종본 v${finals.length} 저장됨` : auto ? "직접 만든 영상이 있으면 올려요" : "영상 파일을 올려 주세요"}</b>
            <span style={{ fontSize: 12 }}>mp4 · mov · m4v · webm</span>
            <div className="yp-row-btns" style={{ justifyContent: "center" }}><button type="button" className="yp-btn" onClick={() => finalInput.current?.click()}>{finals.length ? "새 버전 올리기" : "파일 올리기"}</button></div>
            {finalError ? <p className="yp-unsaved" role="alert" style={{ fontSize: 12, margin: "8px 0 0" }}>{finalError}</p> : null}</div> : null}
        <input ref={finalInput} type="file" hidden accept="video/mp4,video/quicktime,video/x-m4v,video/webm" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFinal(file); }} />
      </YpSection>
      {short ? null : <YpSection n={++n} title="최종 썸네일" gq="A · B 필수, C 선택" need>
        <div className="yp-g3">{SLOTS.map(slot => <FinalThumb key={slot} page={page} slot={slot} make={data} can={canThumb} busy={busy === `thumb-${slot}`} job={redoJob} open={fixing === slot}
          onUpload={file => void uploadThumb(slot, file)} onFix={() => setFixing(slot)} onReset={() => void save({ pair: { slot, title: "", copy: "", reason: "" } }, "pair")} />)}</div>
        {fixing && canThumb ? <PairPanel key={fixing} page={page} slot={fixing} make={data} job={redoJob} saving={busy === "pair"} onClose={() => setFixing(null)}
          onSave={(title, copy, reasonText) => save({ pair: { slot: fixing, title, copy, reason: reasonText } }, "pair").then(ok => { if (ok) setFixing(null); })}
          onRedo={reasonText => setRedoAsk({ slot: fixing, reason: reasonText })} /> : null}
        <p className="yp-hint">jpg · png로 올려요. 마음에 안 들면 [고치기]에서 직접 고치거나 [공식대로 다시 뽑기]로 후보를 받아요. 바꾼 칸은 최종 검토에서 대표가 확인해요.</p>
        <SendDialog page={page} task="retitle" open={Boolean(redoAsk)} onClose={() => setRedoAsk(null)} job={redoJob} extra={redoAsk ?? undefined} queryDefault={topicKeywords(projectName(project))} />
      </YpSection>}</>}
    </> : null}
  </YpFrame>;
}

function FinalThumb({ page, slot, make, can, busy, job, open, onUpload, onFix, onReset }: { page: YpPage; slot: YpSlot; make: YpMake; can: boolean; busy: boolean; job: ReturnType<typeof useStaffJob>;
  open: boolean; onUpload: (file: File) => void; onFix: () => void; onReset: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const plan = page.bundle!.stages.plan.data;
  const confirmed = plan.confirmed?.[slot];
  const pair = finalPair(plan, make, slot);
  if (!confirmed || !pair) return <div className="yp-abc yp-empty"><div className="yp-abc-h"><b>{slot}</b><span className="yp-opt">선택</span></div><div className="yp-th-drop"><span>컨펌본에 없어요</span></div></div>;
  const final = make.thumbs[slot];
  const redo = make.redo?.[slot];
  return <div className={`yp-abc${open ? " yp-on" : ""}`} style={open ? { borderColor: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-soft)" } : undefined}>
    <div className="yp-abc-h"><span className={`yp-ltag${slot === "C" ? " yp-c" : ""}`}>{slot}</span>{slot === "C" ? <span className="yp-opt">선택</span> : <span className="yp-need">필수</span>}
      {pair.changed ? <span className="yp-tag yp-warn">컨펌본과 다름</span> : <span className="yp-tag yp-ok">컨펌본</span>}{final ? <span className="yp-tag yp-acc">최종 이미지 ✓</span> : null}</div>
    <ThumbView page={page} thumb={pair.thumb} path={final?.path} alt={`${slot} 썸네일`} />
    <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.45 }}>{pair.title}</div>
    {pair.changed ? <p className="yp-hint" style={{ margin: 0 }}>컨펌본: {confirmed.title}{confirmed.thumb?.copy && confirmed.thumb.copy !== pair.copy ? ` · 「${confirmed.thumb.copy}」` : ""}{pair.reason ? <><br />바꾼 이유: {pair.reason}</> : null}</p> : null}
    {job.status?.job?.slot === slot ? <JobLine job={job} onRetry={onFix} /> : null}
    {redo && can && !open ? <button type="button" className="yp-btn yp-sm" onClick={onFix}><Sparkles size={14} /> 공식대로 뽑은 후보 {redo.titles.length + redo.copies.length}개 보기</button> : null}
    {can ? <div className="yp-row-btns"><button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "올리는 중…" : final ? "다시 올리기" : "이미지 올리기"}</button>
      {!open ? <button type="button" className="yp-lnk" onClick={onFix}>고치기</button> : null}
      {pair.changed ? <button type="button" className="yp-lnk" disabled={busy} onClick={onReset}>컨펌본으로 되돌리기</button> : null}
      {final ? <a className="yp-ib" aria-label="내려받기" href="#" onClick={async event => { event.preventDefault(); const url = await page.client?.assetUrl(page.bundle!.project.id, final.path); if (url) window.open(url, "_blank", "noopener"); }}><Download size={14} /></a> : null}</div> : null}
    <input ref={input} type="file" hidden accept="image/jpeg,image/png" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }} />
  </div>;
}

/** 고치기 under the cards, full width: the fields, then the AI's title and copy candidates side by side (owner request 2026-10-25: readable). */
function PairPanel({ page, slot, make, job, saving, onClose, onSave, onRedo }: { page: YpPage; slot: YpSlot; make: YpMake; job: ReturnType<typeof useStaffJob>; saving: boolean;
  onClose: () => void; onSave: (title: string, copy: string, reason: string) => void; onRedo: (reason: string) => void }) {
  const pair = finalPair(page.bundle!.stages.plan.data, make, slot)!;
  const redo = make.redo?.[slot];
  const [title, setTitle] = useState(pair.title);
  const [copy, setCopy] = useState(pair.copy);
  const [reason, setReason] = useState(pair.reason);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, []);
  const same = title.trim() === pair.title && copy.trim() === pair.copy;
  const pick = (field: "title" | "copy", text: string, why: string) => { (field === "title" ? setTitle : setCopy)(text); setReason(current => current || why); };
  return <div ref={panel} className="yp-card" style={{ marginTop: 12, padding: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><span className={`yp-ltag${slot === "C" ? " yp-c" : ""}`}>{slot}</span><b style={{ fontSize: 16 }}>{slot} 칸 고치기</b><span style={{ flex: 1 }} />
      <button type="button" className="yp-ib" aria-label="닫기" onClick={onClose}><X size={14} /></button></div>
    <div className="yp-g2">
      <label className="yp-lbl" style={{ margin: 0 }}>제목<input className="yp-in" style={{ fontSize: 15 }} value={title} maxLength={100} onChange={event => setTitle(event.target.value)} aria-label={`${slot} 바꿀 제목`} /></label>
      <label className="yp-lbl" style={{ margin: 0 }}>썸네일 문구 (서브 / 메인)<input className="yp-in" style={{ fontSize: 15 }} value={copy} maxLength={80} onChange={event => setCopy(event.target.value)} aria-label={`${slot} 바꿀 썸네일 문구`} /></label>
    </div>
    <input className="yp-in yp-rev" style={{ marginTop: 8 }} value={reason} maxLength={200} onChange={event => setReason(event.target.value)} placeholder="바꾸는 이유 한 줄 (저장할 때 필수)" aria-label="바꾸는 이유" />
    <div className="yp-row-btns" style={{ marginTop: 8 }}>
      <button type="button" className="yp-btn yp-pri" disabled={saving || same || !title.trim() || !reason.trim()} onClick={() => onSave(title.trim(), copy.trim(), reason.trim())}>{saving ? "저장 중…" : "저장"}</button>
      <button type="button" className="yp-btn" onClick={() => onRedo(reason.trim())}><Sparkles size={14} /> 공식대로 다시 뽑기</button>
      <button type="button" className="yp-btn" onClick={onClose}>닫기</button></div>
    {job.status?.job?.slot === slot ? <div style={{ marginTop: 8 }}><JobLine job={job} onRetry={() => onRedo(reason.trim())} /></div> : null}
    {redo ? <>
      <div className="yp-muted" style={{ fontSize: 13, margin: "16px 0 8px" }}><Sparkles size={13} aria-hidden="true" /> {redo.by}의 Claude가 공식대로 뽑은 후보{redo.market ? ` · 참고 영상: 「${redo.market.query}」 시장 영상 ${redo.market.count}편 (조회수 5만+ · 구독자 대비 조회수 순)` : ""} · 하나씩 눌러 위 칸에 넣어요</div>
      <div className="yp-g2" style={{ gap: 16, alignItems: "start" }}>
        {([["title", "제목", redo.titles], ["copy", "썸네일 문구", redo.copies]] as const).map(([field, name, list]) => <div key={field}>
          <b style={{ fontSize: 15 }}>{name} 후보 {list.length}개</b>
          {field === "title" ? <FormulaNote name="제목 공식" patterns={redo.titlePatterns} fallback={redo.formula} basis={redo.titleBasis} />
            : <><FormulaNote name="메인 카피 공식" patterns={redo.copyPatterns?.main} fallback={redo.copyFormula} basis={redo.copyBasis} />
              <FormulaNote name="서브 카피 공식" patterns={redo.copyPatterns?.sub} /></>}
          <div style={{ display: "grid", gap: 8 }}>{list.map((item, index) => { const value = item.sub ? `${item.sub} / ${item.text}` : item.text; const on = (field === "title" ? title : copy) === value;
            return <button key={index} type="button" className={`yp-way${on ? " yp-rec" : ""}`} style={{ width: "100%" }} aria-pressed={on}
              onClick={() => pick(field, value, `다시 뽑은 ${name} ${index + 1}번 · ${item.hook}`)}>
              {item.sub ? <span style={{ fontSize: 12 }}>{item.sub}</span> : null}
              <b style={{ fontSize: 15, lineHeight: 1.4 }}>{on ? <Check size={14} aria-hidden="true" /> : null} {field === "copy" ? `「${item.text}」` : item.text}</b>
              <span>{item.pattern ? <span className="yp-tag">공식 {item.pattern}</span> : null} <span className="yp-tag">{item.hook}</span> {item.why}</span></button>; })}</div></div>)}
      </div></> : <p className="yp-hint" style={{ marginTop: 12 }}>[공식대로 다시 뽑기]를 누르면 내 AI가 시장 영상에서 제목 공식과 문구 공식을 따로 뽑아 제목 8개 · 문구 8개를 보내요. 이유를 적으면 그 점을 고쳐요.</p>}
  </div>;
}
