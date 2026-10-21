"use client";
import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, ChevronRight, Download, Film, FileText, Upload } from "lucide-react";
import { editableFields } from "@/lib/youtube-process/confirm";
import { stepHref } from "@/lib/youtube-process/project";
import { MAKE_STEPS, SLOTS, thumbsMissing, type YpMake, type YpSlot } from "@/lib/youtube-process/stages";
import { MyinV13Panel } from "./myin-v13-panel";
import { GateBanner, md, stepAction, Subject, useYpBundle, YpFrame, YpSection, LockedStep, type YpPage } from "./youtube-process-frame";
import { ThumbView } from "./youtube-process-media";

const dayDiff = (date: string) => Math.round((Date.parse(`${date}T00:00:00`) - new Date(new Date().toDateString()).getTime()) / 86_400_000);
const md2 = (date: string) => { const at = new Date(`${date}T00:00:00`); return `${at.getMonth() + 1}/${at.getDate()} (${"일월화수목금토"[at.getDay()]})`; };
function DueChip({ date }: { date: string }) {
  const diff = dayDiff(date);
  return <span className={`yp-dchip${diff < 0 ? " yp-late" : diff <= 1 ? " yp-soon" : ""}`}>{diff < 0 ? `${-diff}일 지남` : diff === 0 ? "오늘" : `${diff}일 남음`}</span>;
}
export const sizeLabel = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)}GB` : `${(bytes / 1e6).toFixed(1)}MB`;

/** S5 제작: 일정 · 진행 상태 · (실사) 작업 자료 · 최종본 (OS 자동 제작 or 파일) · 최종 썸네일, then [다음: 최종 검수] (4-6). */
export function YoutubeMakeScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  const [due, setDue] = useState("");
  const [why, setWhy] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const finalInput = useRef<HTMLInputElement>(null);
  const reload = page.reload;
  const onFinal = useCallback(() => void reload(), [reload]);
  const bundle = page.bundle;
  const project = bundle?.project;
  const make = bundle?.stages.make;
  const kind = project?.yp.topic.type ?? "anim";
  const anim = kind !== "live";

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
    setProgress(0); page.setError("");
    try {
      const saved = await page.client.uploadAsset(project.id, "final", file, setProgress);
      if (await save({ addFinal: saved }, "final")) await page.reload();
    } catch (reason) { page.fail(reason); } finally { setProgress(null); }
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
    try { await page.client.move(project.id, "review", project.version); window.location.assign(`/content/final-check?project=${encodeURIComponent(project.id)}&tab=video`); }
    catch (reason) { page.fail(reason); } finally { setMoving(false); }
  };

  const finals = bundle?.finals ?? [];
  const data: YpMake | undefined = make?.data;
  const editable = Boolean(project && (project.yp.stage === "make" || (project.yp.stage === "review" && project.yp.gates.review.state !== "wait")));
  const reviewFields = project ? editableFields(project, "review") : [];
  const canFinal = editable && (project?.yp.stage === "make" || reviewFields === "all" || reviewFields.includes("make.final"));
  const canThumb = editable && (project?.yp.stage === "make" || reviewFields === "all" || reviewFields.includes("make.thumbs"));
  const reason = !finals.length ? "최종본을 올려주세요" : data ? thumbsMissing(data) : "";
  const action = bundle ? stepAction(page, 3, project?.yp.stage === "make" ? { kind: "button", label: "다음: 최종 검수", reason, busy: moving, onClick: () => void move() } : { kind: "status", status: "제작 끝남" }) : null;
  const confirmed = bundle?.stages.plan.data.confirmed;
  const steps = MAKE_STEPS[kind];
  const statusIndex = data ? Math.max(0, steps.findIndex(([key]) => key === (anim && data.status === "shoot" ? "prep" : data.status))) : 0;
  let n = 0;

  return <YpFrame page={page} view={3} action={action} header={header} title="제작" sub={anim ? "일정을 정하고, OS가 원고로 영상을 만들면 최종 썸네일을 올려요." : "일정을 정하고, 다 만들면 최종본과 최종 썸네일을 올려요."}>
    {bundle && data && project ? ["topic", "draft", "outline"].includes(project.yp.stage) ? <LockedStep page={page} name="제작" /> : <>
      {project.yp.stage === "review" ? <GateBanner page={page} gate="review" /> : null}
      <Subject page={page} />
      <YpSection n={++n} title="일정" need={data.editDue ? null : true}>
        {!data.editDue || changing ? <div className="yp-duefirst"><div style={{ flexBasis: "100%", fontWeight: 700 }}>{data.editDue ? "편집 완료 일정 바꾸기" : "제작을 시작하기 전에 편집 완료 일정을 정해요"}</div>
          <div><label className="yp-lbl" style={{ marginTop: 0 }}>편집 완료 일정</label><input className="yp-in" type="date" value={due || data.editDue} onChange={event => setDue(event.target.value)} aria-label="편집 완료 일정" disabled={!editable} /></div>
          {data.editDue ? <div style={{ flex: 1, minWidth: 200 }}><label className="yp-lbl" style={{ marginTop: 0 }}>바꾸는 이유 (선택)</label><input className="yp-in" value={why} onChange={event => setWhy(event.target.value)} maxLength={200} /></div> : null}
          <button type="button" className="yp-btn yp-pri" disabled={!editable || !(due || data.editDue) || Boolean(busy)} onClick={() => void save({ editDue: due || data.editDue, editDueWhy: why }, "due").then(ok => { if (ok) { setChanging(false); setWhy(""); setDue(""); } })}>정하기</button>
          {changing ? <button type="button" className="yp-btn" onClick={() => setChanging(false)}>취소</button> : null}</div>
          : <><div className="yp-sched2 yp-one"><div className="yp-sdate"><span className="yp-k">편집 완료 일정</span><div className="yp-v"><span className={`yp-due-big${dayDiff(data.editDue) < 0 ? " yp-late" : ""}`}>{md2(data.editDue)}</span><DueChip date={data.editDue} /></div>
            {editable ? <div><button type="button" className="yp-btn yp-sm" onClick={() => setChanging(true)}><CalendarDays size={14} /> 바꾸기</button></div> : null}</div></div>
            {dayDiff(data.editDue) < 0 && project.yp.stage === "make" ? <div className="yp-note yp-bad" style={{ margin: "10px 0 0" }}><div>편집 완료 일정이 지났어요. 날짜를 바꾸거나 제작을 마쳐 주세요.</div></div> : null}
            {data.log.length ? <><div className="yp-lbl">바꾼 기록</div><ul className="yp-hist">{data.log.slice(0, 5).map(item => <li key={item.at}><time>{md(item.at)}</time><span>편집 완료 {item.from ? md2(item.from) : "없음"} → {md2(item.to)} · {item.by}{item.why ? ` · ${item.why}` : ""}</span></li>)}</ul></> : null}</>}
        <p className="yp-hint">업로드 일정(예상)과 기한 알림은 스케줄 화면에서 다음 차례에 들어와요.</p>
      </YpSection>
      <YpSection n={++n} title="진행 상태">
        <div className="yp-pstat2">{steps.map(([key, label], index) => <span key={key} style={{ display: "contents" }}>
          {index ? <span className="yp-arw" aria-hidden="true"><ChevronRight size={14} /></span> : null}
          <button type="button" className={`yp-ps${index === statusIndex ? " yp-on" : index < statusIndex ? " yp-past" : ""}`} disabled={!editable || !data.editDue || Boolean(busy)} onClick={() => void save({ status: key }, "status")}>
            {index < statusIndex ? "✓ " : ""}{label}<small>{data.statusAt[key] ? md(data.statusAt[key]).split(" ")[0] : ""}</small></button></span>)}</div>
        <p className="yp-hint">잘못 눌렀으면 앞 단계를 다시 눌러요. 최종본과 최종 썸네일 A · B가 있으면 자동으로 ‘완료’가 돼요.</p>
      </YpSection>
      {anim ? null : <YpSection n={++n} title="작업 자료"><div className="yp-mats">
        <div className="yp-mat"><FileText size={16} aria-hidden="true" /><div className="yp-grow"><b>원고 (최신)</b><div className="yp-muted" style={{ fontSize: 12 }}>v{bundle.stages.outline.data.versions.at(-1)?.v ?? "—"}{bundle.stages.outline.data.versions.find(item => item.why === "make") ? ` · 제작 시작 원고 v${bundle.stages.outline.data.versions.filter(item => item.why === "make").at(-1)!.v}` : ""}</div></div><Link className="yp-btn yp-sm" href={stepHref(2, project.id)}>열기</Link></div>
        <div className="yp-mat"><FileText size={16} aria-hidden="true" /><div className="yp-grow"><b>컨펌받은 제목 · 썸네일</b><div className="yp-muted" style={{ fontSize: 12 }}>{SLOTS.filter(slot => confirmed?.[slot]?.title).map(slot => <div key={slot}>{slot}: {confirmed?.[slot]?.title}</div>)}</div></div></div>
      </div></YpSection>}
      <YpSection n={++n} title={anim ? "최종본 만들기" : "최종본 올리기"} gq={anim ? "구성안 원고로 OS가 마이인 형식 영상을 만들어요" : undefined} need>
        {finals.length ? <ul className="yp-hist" style={{ marginBottom: 10 }}>{[...finals].reverse().map(final => <li key={final.v}><time>v{final.v}{final.v === finals.length ? " 최신" : ""}</time>
          <span>{final.source === "myin" ? "OS 자동 제작" : final.name} · {md(final.at)} · {sizeLabel(final.bytes)}{final.durationSeconds ? ` · ${Math.floor(final.durationSeconds / 60)}분 ${Math.round(final.durationSeconds % 60)}초` : ""}</span></li>)}</ul> : null}
        {anim && page.demo ? <div className="yp-note yp-gray"><div>데모에서는 OS 자동 제작(음성 → 장면 기획표 → 로건, 유쓰 확인 → 시안 → 완성)을 실행하지 않아요. 실제 화면에서는 여기서 바로 만들어요.</div></div> : null}
        {anim && !page.demo ? <MyinV13Panel sourceId={project.id} embedded onFinal={onFinal}
          finalNote={<p className="yt-note">완성 영상이 최종본 v{finals.length || 1}로 들어갔어요. 이어폰으로 소리를 확인하고 최종 썸네일 A · B를 올린 뒤 위 [다음: 최종 검수]를 눌러요. 자막 파일은 업로드 단계에서 자동으로 쓰여요.</p>} /> : null}
        {progress !== null ? <div className="yp-drop"><Upload size={22} aria-hidden="true" /><b>final_v{finals.length + 1} 올리는 중</b><div className="yp-dprog"><i style={{ width: `${progress}%` }} /></div><span style={{ fontSize: 12 }}>{progress}% · 이 화면을 닫지 마세요</span></div>
          : canFinal ? <div className={`yp-drop${finals.length ? " yp-ok" : ""}`} style={anim ? { marginTop: 10 } : undefined}>{finals.length ? <Check size={22} aria-hidden="true" /> : <Film size={22} aria-hidden="true" />}
            <b>{anim ? "직접 만든 영상으로 바꾸려면 파일을 올려요" : finals.length ? `최종본 v${finals.length}이 OS에 저장됐어요` : "영상 파일을 올려 주세요"}</b>
            <span style={{ fontSize: 12 }}>mp4 · mov · m4v · webm · 저장 · 버전 번호는 자동이에요</span>
            <div className="yp-row-btns" style={{ justifyContent: "center" }}><button type="button" className="yp-btn" onClick={() => finalInput.current?.click()}>{finals.length ? "새 버전 올리기" : "파일 선택"}</button></div></div> : null}
        <input ref={finalInput} type="file" hidden accept="video/mp4,video/quicktime,video/x-m4v,video/webm" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFinal(file); }} />
        <p className="yp-hint">유튜브에는 업로드 단계에서 마지막 최종본 하나만 올라가요.</p>
      </YpSection>
      <YpSection n={++n} title="최종 썸네일" gq="A · B 필수, C 선택" need>
        <div className="yp-g3">{SLOTS.map(slot => <FinalThumb key={slot} page={page} slot={slot} make={data} can={canThumb} busy={busy === `thumb-${slot}`}
          onUpload={file => void uploadThumb(slot, file)} onTitle={(title, reasonText) => void save({ aTitle: title, aReason: reasonText }, "title")} />)}</div>
        <p className="yp-hint">기획안 컨펌본(제목 · 썸네일 A · B · C)이 그대로 이어져요. 썸네일 이미지는 jpg · png 파일로 올려요(유튜브가 받는 형식).</p>
      </YpSection>
    </> : null}
  </YpFrame>;
}

function FinalThumb({ page, slot, make, can, busy, onUpload, onTitle }: { page: YpPage; slot: YpSlot; make: YpMake; can: boolean; busy: boolean; onUpload: (file: File) => void; onTitle: (title: string, reason: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const confirmed = page.bundle!.stages.plan.data.confirmed?.[slot];
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(make.aTitle);
  const [reason, setReason] = useState(make.aReason);
  if (!confirmed) return <div className="yp-abc yp-empty"><div className="yp-abc-h"><b>{slot}</b><span className="yp-opt">선택</span></div><div className="yp-th-drop"><span>기획안 컨펌본에 {slot}가 없어요</span></div></div>;
  const final = make.thumbs[slot];
  const changed = slot === "A" && Boolean(make.aTitle);
  return <div className="yp-abc"><div className="yp-abc-h"><span className={`yp-ltag${slot === "C" ? " yp-c" : ""}`}>{slot}</span>{slot === "C" ? <span className="yp-opt">선택</span> : <span className="yp-need">필수</span>}
    <span className="yp-tag yp-ok">컨펌본</span>{changed ? <span className="yp-tag yp-warn">컨펌본과 다름</span> : null}{final ? <span className="yp-tag yp-acc">최종 이미지 ✓</span> : null}</div>
    <ThumbView page={page} thumb={confirmed.thumb} path={final?.path} alt={`${slot} 썸네일`} />
    <input className="yp-in" value={changed ? make.aTitle : confirmed.title} readOnly aria-label={`${slot} 제목`} />
    {slot === "A" && editing ? <div className="yp-card" style={{ padding: 8 }}>
      <input className="yp-in" value={title} maxLength={100} onChange={event => setTitle(event.target.value)} placeholder="바꿀 제목" aria-label="바꿀 제목" />
      <input className="yp-in yp-rev" style={{ marginTop: 6 }} value={reason} maxLength={200} onChange={event => setReason(event.target.value)} placeholder="바꾼 이유 한 줄 (필수)" aria-label="바꾼 이유" />
      <div className="yp-row-btns" style={{ marginTop: 6 }}><button type="button" className="yp-btn yp-sm yp-pri" disabled={!title.trim() || !reason.trim()} onClick={() => { onTitle(title.trim(), reason.trim()); setEditing(false); }}>저장</button><button type="button" className="yp-btn yp-sm" onClick={() => setEditing(false)}>취소</button></div></div> : null}
    {can ? <div className="yp-row-btns"><button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "올리는 중…" : final ? "다시 올리기" : "최종 이미지 올리기"}</button>
      {slot === "A" && !editing ? <button type="button" className="yp-lnk" onClick={() => changed ? onTitle("", "") : setEditing(true)}>{changed ? "컨펌본으로 되돌리기" : "A 제목 바꿔 보기"}</button> : null}
      {final ? <a className="yp-ib" aria-label="내려받기" href="#" onClick={async event => { event.preventDefault(); const url = await page.client?.assetUrl(page.bundle!.project.id, final.path); if (url) window.open(url, "_blank", "noopener"); }}><Download size={14} /></a> : null}</div> : null}
    <input ref={input} type="file" hidden accept="image/jpeg,image/png" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }} />
  </div>;
}
