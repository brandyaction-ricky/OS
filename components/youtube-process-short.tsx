"use client";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Download, ExternalLink, ImagePlus, Plus, Sparkles, X, Youtube } from "lucide-react";
import { apiRequest, uploadYoutubeFile } from "@/lib/api-client";
import type { ChannelConnection } from "@/lib/channel-types";
import { appealText, shortMissing, type YpShortBrief, type YpShortScene } from "@/lib/youtube-process/short";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { CostTag, useCostConfirm, voiceEstimate } from "./youtube-process-cost";
import type { YpBundle, YpClient, YpFinalView, YpRenderView, YpShortPatch, YpShortView } from "./youtube-process-data";
import { GateBanner, LockedStep, stepAction, Subject, YpFrame, YpSection, type YpPage } from "./youtube-process-frame";

// 유튜브 공정 v1 숏폼 (owner decision 2026-10-21) on Codex's shortform render (PR #205): scenes with one image each become a
// 720×1280 MP4 on the render PC; longform clips become vertical shorts with their subtitles.
const REASON: Record<string, string> = {
  SHORTFORM_VOICE_TOO_LONG: "내레이션이 장면보다 길어요. 내레이션을 줄이거나 장면을 늘려 주세요.",
  SHORTFORM_CAPTION_TOO_LONG: "한 장면 자막이 너무 길어요. 네 줄 안으로 줄여 주세요.",
  SHORTFORM_INPUT_CHANGED: "만드는 사이 내용이 바뀌었어요. 다시 만들어 주세요.",
  SHORTFORM_FILES_UNAVAILABLE: "이미지나 원본 파일을 열지 못했어요. 이미지를 다시 올리고 만들어 주세요.",
  SHORTFORM_DOWNLOAD_FAILED: "이미지나 원본 파일을 받지 못했어요. 다시 만들어 주세요.",
  SHORTFORM_RANGE_INVALID: "구간이 영상 길이를 넘어요. 구간을 다시 골라 주세요.",
  SHORTFORM_RUNTIME_MISSING: "영상 만드는 컴퓨터가 준비되지 않았어요. 관리자에게 알려 주세요.",
};
const working = (render: YpRenderView | null | undefined) => Boolean(render && ["backlog", "in_progress"].includes(render.status));
/** Feed-ad sizes made beside the 9:16 one (owner requests 2026-10-25): the view field, the button words, the player shape. */
const AD_SIZES = [
  { aspect: "1:1", key: "square", label: "정사각형 1:1", again: "정사각형", cls: "yp-vid1" },
  { aspect: "4:5", key: "portrait", label: "4:5 세로", again: "4:5", cls: "yp-vid45" },
] as const;
/** The latest 9:16 final (Shorts · Reels, the YouTube upload) and the latest of each feed-ad size, which sit beside it. */
export const latestFinals = (finals: YpFinalView[]) => {
  const last = (aspect?: "1:1" | "4:5") => finals.filter(final => final.aspect === aspect).at(-1) ?? null;
  return { vertical: last(), square: last("1:1"), portrait: last("4:5") };
};
/** One line for a render: waiting · making · done · stopped with its reason. */
export function RenderTag({ render }: { render: YpRenderView | null | undefined }) {
  if (!render) return null;
  if (render.status === "done") return <span className="yp-tag yp-ok">완성 · {render.duration}초</span>;
  if (render.status === "in_progress") return <span className="yp-tag yp-warn">만드는 중 (1~3분)</span>;
  if (render.status === "backlog") return <span className="yp-tag yp-acc">차례를 기다려요</span>;
  return <span className="yp-tag yp-bad" title={render.error ?? ""}>{REASON[render.error ?? ""] ?? "만들다 멈췄어요. 다시 만들어 보고, 또 멈추면 관리자에게 알려 주세요."}</span>;
}

/** The latest MP4 with its download (숏폼 제작 · 내보내기). */
export function ShortVideo({ page, final }: { page: YpPage; final: YpFinalView | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const client = page.client, id = page.bundle?.project.id;
  useEffect(() => {
    let active = true;
    if (!client || !id || !final) { setSrc(null); return; }
    client.finalUrl(id, final).then(url => { if (active) setSrc(url); }, () => undefined);
    return () => { active = false; };
  }, [client, id, final]);
  if (!final) return null;
  const download = async () => {
    if (!client || !id) return;
    try { const url = final.source === "short" && final.runId ? await client.shortVideoUrl(id, final.runId, true) : src; if (url) window.location.assign(url); }
    catch (reason) { page.fail(reason); }
  };
  const size = AD_SIZES.find(item => item.aspect === final.aspect), cls = size?.cls ?? "yp-vid9";
  return <div className="yp-short-out">
    {src ? <video className={cls} src={src} controls preload="metadata" /> : <div className={cls} />}
    <div className="yp-row-btns"><span className="yp-muted" style={{ fontSize: 12 }}>v{final.v} · {size ? `${size.label} · ` : ""}{final.source === "short" ? "자동 제작" : final.name}{final.durationSeconds ? ` · ${final.durationSeconds}초` : ""}</span>
      <button type="button" className="yp-btn yp-sm" onClick={() => void download()}><Download size={14} /> MP4 내려받기</button></div>
  </div>;
}

const blank = (seconds: number): YpShortScene => ({ seconds, text: "", voice: "", note: "", asset: "" });
const move = <T,>(list: T[], from: number, to: number) => { const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

/** 제작 of a 숏폼: 무엇을 만들까요 → 장면 (내 AI or 직접, one image each) → MP4 (render PC). Numbered after the sections before it. */
export function ShortMake({ page, editable, n0 }: { page: YpPage; editable: boolean; n0: number }) {
  const project = page.bundle!.project;
  const client = page.client, id = project.id, fail = page.fail, reloadBundle = page.reload;
  const [view, setView] = useState<YpShortView | null>(null);
  const [brief, setBrief] = useState<YpShortBrief | null>(null);
  const [scenes, setScenes] = useState<YpShortScene[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  // Narration is company money (Fish): asked once per narration text in a popup with the estimate (owner request 2026-10-25).
  const cost = useCostConfirm(), voicePaid = useRef("");
  const [send, setSend] = useState(false);
  const editRev = useRef(0);
  const saving = useRef(false);
  const apply = useCallback((next: YpShortView) => { setView(next); setBrief(next.brief); setScenes(next.scenes); setDirty(false); }, []);
  const load = useCallback(async () => { if (!client) return; try { apply(await client.short(id)); } catch (reason) { fail(reason); } }, [client, id, apply, fail]);
  useEffect(() => { void load(); }, [load]);
  const job = useStaffJob(page, "short", load);
  const render = view?.render;
  // Every size's render is watched, so a square or 4:5 ad also shows its progress without a page refresh.
  const statuses = [view?.render, view?.square, view?.portrait].map(item => item?.status ?? "").join();
  useEffect(() => {
    if (!client || !/backlog|in_progress/.test(statuses)) return;
    const timer = window.setInterval(() => void client.short(id).then(next => {
      if ([next.render, next.square, next.portrait].map(item => item?.status ?? "").join() === statuses) return;
      setView(current => current ? { ...current, render: next.render, square: next.square, portrait: next.portrait } : next);
      void reloadBundle();
    }, () => undefined), 15_000);
    return () => window.clearInterval(timer);
  }, [client, id, statuses, reloadBundle]);

  const save = async (patch?: YpShortPatch) => {
    if (!client || !view || !brief || saving.current) return null;
    saving.current = true;
    const rev = editRev.current;
    try {
      const next = await client.saveShort(id, view.version, patch ?? { brief, scenes });
      setView(next);
      if (editRev.current === rev) { setBrief(next.brief); setScenes(next.scenes); setDirty(false); }
      return next;
    } catch (reason) { fail(reason); return null; } finally { saving.current = false; }
  };
  if (!view || !brief) return <p className="yp-hint" role="status">숏폼을 불러오는 중이에요…</p>;
  const editBrief = (patch: Partial<YpShortBrief>, now = false) => {
    editRev.current += 1; const next = { ...brief, ...patch }; setBrief(next); setDirty(true);
    if (now) void save({ brief: next, scenes });
  };
  const editScenes = (next: YpShortScene[], now = false) => {
    editRev.current += 1; setScenes(next); setDirty(true);
    if (now) void save({ brief, scenes: next });
  };
  const upload = async (index: number, file: File) => {
    if (!client) return;
    setBusy(`img-${index}`);
    try {
      const image = await client.shortImage(id, file);
      setView(current => current ? { ...current, images: { ...current.images, [image.assetId]: { name: file.name, url: image.url } } } : current);
      editScenes(scenes.map((scene, at) => at === index ? { ...scene, assetId: image.assetId } : scene), true);
    } catch (reason) { fail(reason); } finally { setBusy(""); }
  };
  const make = async (aspect: "9:16" | "1:1" | "4:5" = "9:16") => {
    if (!client) return;
    const voiceText = scenes.map(scene => scene.voice.trim()).join("\n").trim();
    if (voiceText && voicePaid.current !== voiceText) {
      const estimate = voiceEstimate(voiceText);
      if (!await cost.confirm({ what: "내레이션 음성 (Fish)", amount: `약 ${estimate.krw.toLocaleString("ko-KR")}원`,
        detail: `${estimate.chars.toLocaleString("ko-KR")}자 · 이미 만든 문장은 다시 들지 않아요`, ok: "확인하고 만들기" })) return;
      voicePaid.current = voiceText;
    }
    setBusy(aspect);
    try {
      const saved = dirty ? await save() : view;
      if (!saved) return;
      await client.renderShort(id, saved.version, Boolean(voiceText), aspect);
      await load();
    } catch (reason) { fail(reason); } finally { setBusy(""); }
  };

  const ad = brief.purpose === "ad";
  const missing = shortMissing(brief, scenes);
  const hasVoice = scenes.some(scene => scene.voice.trim());
  const before = scenes.slice(0, -1).reduce((total, scene) => total + scene.seconds, 0);
  const finals = page.bundle?.finals ?? [];
  const made = latestFinals(finals);
  const field = (key: "product" | "audience" | "goal" | "landingUrl" | "evidence", label: string, placeholder: string, need: boolean, rows = 0) => <label className="yp-lbl" style={rows ? { gridColumn: "1 / -1" } : undefined}>
    {label} {need ? <span className="yp-need">필수</span> : <span className="yp-opt">선택</span>}
    {rows ? <textarea className="yp-in" rows={rows} value={brief[key]} readOnly={!editable} placeholder={placeholder} onChange={event => editBrief({ [key]: event.target.value })} />
      : <input className="yp-in" value={brief[key]} readOnly={!editable} placeholder={placeholder} onChange={event => editBrief({ [key]: event.target.value })} />}</label>;
  const pageFields = <>{field("landingUrl", "연결할 페이지", "https://", ad)}{field("evidence", "실제 근거와 출처", "상품 정보 · 사용을 허락받은 후기 · 실제 화면과 그 출처", ad, 3)}</>;

  return <div onBlur={() => { if (dirty) void save(); }}>
    <YpSection n={n0 + 1} title="무엇을 만들까요" gq="용도 · 길이 · 보는 사람 · 할 행동" need>
      <div className="yp-row-btns" style={{ flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div className="yp-seg2" role="group" aria-label="용도">{([["organic", "일반 콘텐츠"], ["ad", "광고"]] as const).map(([key, label]) =>
          <button key={key} type="button" className={brief.purpose === key ? "yp-on" : ""} disabled={!editable} onClick={() => editBrief({ purpose: key }, true)}>{label}</button>)}</div>
        <div className="yp-seg2" role="group" aria-label="길이">{([15, 30, 60] as const).map(seconds =>
          <button key={seconds} type="button" className={brief.duration === seconds ? "yp-on" : ""} disabled={!editable} onClick={() => editBrief({ duration: seconds }, true)}>{seconds}초</button>)}</div></div>
      <div className="yp-g2">
        {field("product", ad ? "광고할 상품 · 서비스" : "다룰 내용", ad ? "예) 강점 진단 결과지" : "예) 저녁마다 지치는 이유 한 가지", ad)}
        {field("audience", "누구에게", "예) 퇴근 후에도 할 일이 머리에 남는 30대 직장인", true)}
        {field("goal", "보고 나서 할 행동", "예) 프로필 링크에서 진단 받기", true, 1)}
        {ad ? pageFields : null}
      </div>
      {ad ? null : <details className="yp-more-fields" open={Boolean(brief.landingUrl || brief.evidence)}><summary>연결 페이지 · 근거 더 쓰기 (선택)</summary><div className="yp-g2">{pageFields}</div></details>}
      {ad ? <div className="yp-field"><div className="yp-fld-h"><b>구매 이유</b> <span className="yp-need">필수</span><span className="yp-gq">하나만 써요</span></div>
        {view.appeals.length ? <div className="yp-ways">{view.appeals.map(appeal => { const text = appealText(appeal);
          return <button key={appeal.title} type="button" className={`yp-way${brief.appeal === text ? " yp-rec" : ""}`} disabled={!editable} onClick={() => editBrief({ appeal: text }, true)}>
            <b>{appeal.title}</b><span>{appeal.reason}</span><span>{appeal.basis === "evidence" ? "입력한 근거 있음" : "검증할 가설"} · {appeal.evidence || "추가 확인 필요"}</span></button>; })}</div> : null}
        <textarea className="yp-in" rows={2} aria-label="구매 이유" value={brief.appeal} readOnly={!editable} placeholder="예) 30분 만에 내 강점을 정리해 주는 결과지" onChange={event => editBrief({ appeal: event.target.value })} /></div> : null}
    </YpSection>

    <YpSection n={n0 + 2} title="장면" gq={`${brief.duration}초 · 장면마다 이미지 한 장`} need>
      {editable && project.yp.gates.review.state !== "wait" ? (job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} />
        : !scenes.length ? <div className="yp-ways">
          <button type="button" className="yp-way yp-rec" onClick={() => setSend(true)}><b><Sparkles size={14} aria-hidden="true" /> 내 AI에게 맡기기</b><span>{ad ? "구매 이유 후보와 " : ""}장면 · 자막 · 내레이션 · 필요한 이미지를 채워 줘요 (10분쯤)</span></button>
          <button type="button" className="yp-way" onClick={() => editScenes([blank(Math.round(brief.duration / 3)), blank(Math.round(brief.duration / 3)), blank(0)], true)}><b>직접 쓰기</b><span>장면 세 개로 시작해요</span></button></div>
        : <div className="yp-row-btns" style={{ marginBottom: 10 }}><button type="button" className="yp-btn yp-sm" onClick={() => setSend(true)}><Sparkles size={14} /> {view.ai ? "내 AI로 다시 쓰기" : "내 AI에게 맡기기"}</button>
          {view.ai ? <span className="yp-aitag"><Sparkles size={11} aria-hidden="true" /> AI 초안 · {view.ai.by}</span> : null}</div>) : null}
      {view.aiScenes && editable ? <div className="yp-note yp-purple" role="status"><Sparkles size={16} className="yp-i" aria-hidden="true" /><div><b>AI 장면이 왔어요.</b> 이미 쓴 장면이 있어 바로 넣지 않았어요.
        <button type="button" className="yp-lnk" onClick={() => void save({ useAiScenes: true })}>이 초안으로 바꾸기</button>
        <details><summary>초안 보기</summary><ol style={{ fontSize: 13 }}>{view.aiScenes.map((scene, index) => <li key={index}>{scene.seconds}초 · {scene.text}{scene.voice ? ` — “${scene.voice}”` : ""}</li>)}</ol></details></div></div> : null}
      {scenes.map((scene, index) => <SceneRow key={index} index={index} scene={scene} last={index === scenes.length - 1} remain={Math.max(0, brief.duration - before)} count={scenes.length}
        image={scene.assetId ? view.images[scene.assetId] : undefined} editable={editable} busy={busy === `img-${index}`}
        onChange={patch => editScenes(scenes.map((row, at) => at === index ? { ...row, ...patch } : row))} onUpload={file => void upload(index, file)}
        onMove={to => editScenes(move(scenes, index, to), true)} onRemove={() => editScenes(scenes.filter((_, at) => at !== index), true)} />)}
      {editable && scenes.length && scenes.length < 20 ? <button type="button" className="yp-btn yp-sm" onClick={() => editScenes([...scenes, blank(0)], true)}><Plus size={14} /> 장면 추가</button> : null}
      <p className="yp-hint">직접 만들었거나 허락받은 이미지만 올려요.</p>
    </YpSection>

    <YpSection n={n0 + 3} title="영상 만들기" gq={ad ? "세로 9:16 (광고는 1:1 · 4:5도)" : "세로 9:16"} need>
      {missing.length && editable ? <ul className="yp-hist" style={{ marginBottom: 8 }}>{missing.map(item => <li key={item}><span>○ {item}</span></li>)}</ul> : null}
      <div className="yp-row-btns" style={{ flexWrap: "wrap", marginBottom: 10 }}>
        {editable ? <button type="button" className="yp-btn yp-pri" disabled={missing.length > 0 || busy === "9:16" || working(render) || page.demo}
          onClick={() => void make()}>{busy === "9:16" ? "처리 중…" : render?.status === "done" ? "고친 내용으로 다시 만들기" : ad ? "세로 9:16 만들기" : "영상 만들기"}</button> : null}
        <RenderTag render={render} />
        {ad ? AD_SIZES.map(size => <Fragment key={size.aspect}>
          {editable ? <button type="button" className="yp-btn" disabled={missing.length > 0 || busy === size.aspect || working(view[size.key]) || page.demo}
            onClick={() => void make(size.aspect)}>{busy === size.aspect ? "처리 중…" : view[size.key]?.status === "done" ? `${size.again} 다시 만들기` : `${size.label} 만들기`}</button> : null}
          <RenderTag render={view[size.key]} /></Fragment>) : null}
        {hasVoice && editable ? <CostTag cost="company" /> : null}
        {page.demo ? <span className="yp-muted" style={{ fontSize: 12 }}>데모에서는 영상을 만들지 않아요.</span> : null}</div>
      <div className="yp-row-btns" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <ShortVideo page={page} final={made.vertical} />
        {ad ? <><ShortVideo page={page} final={made.square} /><ShortVideo page={page} final={made.portrait} /></> : null}</div>
      {ad ? <p className="yp-hint">세로는 쇼츠 · 릴스용, 1:1 · 4:5는 피드 광고용이에요.</p> : null}
    </YpSection>
    <SendDialog page={page} task="short" open={send} onClose={() => setSend(false)} job={job} />
    {cost.element}
  </div>;
}

function SceneRow({ index, scene, last, remain, count, image, editable, busy, onChange, onUpload, onMove, onRemove }: {
  index: number; scene: YpShortScene; last: boolean; remain: number; count: number; image?: { name: string; url: string }; editable: boolean; busy: boolean;
  onChange: (patch: Partial<YpShortScene>) => void; onUpload: (file: File) => void; onMove: (to: number) => void; onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="yp-scn">
    <button type="button" className="yp-scn-img" disabled={!editable || busy} onClick={() => input.current?.click()} aria-label={`장면 ${index + 1} 이미지 ${image ? "바꾸기" : "올리기"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from private storage */}
      {image ? <img src={image.url} alt={image.name} /> : <><ImagePlus size={18} aria-hidden="true" /><span>{busy ? "올리는 중…" : "이미지 올리기"}</span></>}</button>
    <div className="yp-scn-f">
      <div className="yp-scn-h"><span className="yp-n">{index + 1}</span>
        {last ? <span className="yp-tag">나머지 {Math.round(remain * 10) / 10}초</span>
          : <label className="yp-scn-sec"><input className="yp-in" type="number" min={1} max={60} step={0.5} value={scene.seconds} readOnly={!editable} aria-label={`장면 ${index + 1} 길이(초)`}
            onChange={event => onChange({ seconds: Math.max(0, Number(event.target.value) || 0) })} />초</label>}
        {scene.asset ? <span className="yp-gq">필요한 이미지: {scene.asset}</span> : null}<span className="yp-sp" />
        {editable ? <span className="yp-row-btns"><button type="button" className="yp-ib yp-xs" aria-label="위로" disabled={!index} onClick={() => onMove(index - 1)}><ArrowUp size={12} /></button>
          <button type="button" className="yp-ib yp-xs" aria-label="아래로" disabled={last} onClick={() => onMove(index + 1)}><ArrowDown size={12} /></button>
          {count > 1 ? <button type="button" className="yp-ib yp-xs" aria-label="장면 빼기" onClick={onRemove}><X size={12} /></button> : null}</span> : null}</div>
      <textarea className="yp-in" rows={2} aria-label={`장면 ${index + 1} 자막`} value={scene.text} readOnly={!editable} maxLength={240} placeholder="화면 자막 (네 줄 안)" onChange={event => onChange({ text: event.target.value })} />
      <input className="yp-in" aria-label={`장면 ${index + 1} 내레이션`} value={scene.voice} readOnly={!editable} maxLength={1800} placeholder="내레이션 (선택 · 1초에 6자 안팎)" onChange={event => onChange({ voice: event.target.value })} />
    </div>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }} />
  </div>;
}

/** 내보내기 of a 숏폼 (in place of the YouTube upload): the approved MP4 to download, what goes with it, then 끝내기. */
export function ShortExportScreen({ header, page }: { header: ReactNode; page: YpPage }) {
  const [moving, setMoving] = useState(false);
  const [view, setView] = useState<YpShortView | null>(null);
  const project = page.bundle?.project;
  const client = page.client, id = project?.id;
  useEffect(() => { if (client && id) client.short(id).then(setView, () => undefined); }, [client, id]);
  const { vertical: last, square, portrait } = latestFinals(page.bundle?.finals ?? []);
  const finish = async () => {
    if (!page.client || !project) return;
    setMoving(true);
    try { const next = await page.client.move(project.id, "done", project.version); page.setBundle(current => current ? { ...current, project: next } : current); }
    catch (reason) { page.fail(reason); } finally { setMoving(false); }
  };
  const action = page.bundle ? stepAction(page, 5, project?.yp.stage === "done" ? { kind: "status", status: "끝난 영상" }
    : { kind: "button", label: "다 올렸으면 끝내기", reason: last ? "" : "최종본이 없어요", busy: moving, onClick: () => void finish() }) : null;
  return <YpFrame page={page} view={5} action={action} header={header} title="내보내기" sub="유튜브 쇼츠는 여기서 바로 올리고, 릴스 · 광고는 MP4를 내려받아 올려요. 다 올렸으면 끝내요.">
    {page.bundle && project ? !["upload", "done"].includes(project.yp.stage) ? <LockedStep page={page} name="내보내기" /> : <>
      <GateBanner page={page} gate="review" />
      <Subject page={page} />
      <YpSection n={1} title="최종본" gq={square || portrait ? "대표 OK가 난 마지막 버전 · 세로와 피드 광고용" : "대표 OK가 난 마지막 버전"}>
        <div className="yp-row-btns" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <ShortVideo page={page} final={last} />
          <ShortVideo page={page} final={square} />
          <ShortVideo page={page} final={portrait} /></div>
        {square || portrait ? <p className="yp-hint">정사각형 · 4:5는 피드 광고용이에요. 내려받아 광고 관리자에 올려요.</p> : null}
      </YpSection>
      <ShortYoutube page={page} last={last} />
      {view ? <YpSection n={3} title="광고 · 릴스로 올릴 때 같이 쓸 것">
        <dl className="yp-kv">
          <dt>용도</dt><dd>{view.brief.purpose === "ad" ? "광고" : "일반 콘텐츠"} · {view.brief.duration}초</dd>
          <dt>할 행동</dt><dd>{view.brief.goal || "—"}</dd>
          <dt>연결 페이지</dt><dd>{view.brief.landingUrl ? <a className="yp-lnk" href={view.brief.landingUrl} target="_blank" rel="noreferrer">{view.brief.landingUrl}</a> : "—"}</dd>
          {view.brief.purpose === "ad" ? <><dt>구매 이유</dt><dd style={{ whiteSpace: "pre-wrap" }}>{view.brief.appeal || "—"}</dd></> : null}
        </dl>
        <p className="yp-hint">광고 문구와 연결 페이지의 약속이 맞는지 올리기 전에 한 번 더 봐요.</p>
      </YpSection> : null}
    </> : null}
  </YpFrame>;
}

/** 내보내기 › 유튜브 쇼츠 (owner request 2026-10-25): my AI writes the title and description, the PD edits them, and the MP4 goes up as a Short. */
function ShortYoutube({ page, last }: { page: YpPage; last: YpFinalView | null }) {
  const project = page.bundle!.project;
  const upload = page.bundle!.stages.upload;
  const run = upload.data.run;
  const [form, setForm] = useState({ title: upload.data.title ?? "", desc: upload.data.desc, privacy: upload.data.privacy });
  const [dirty, setDirty] = useState(false);
  const [send, setSend] = useState(false);
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [owner, setOwner] = useState("");
  const [step, setStep] = useState("");
  const job = useStaffJob(page, "short-copy", () => void page.reload());
  useEffect(() => { if (!dirty) setForm({ title: upload.data.title ?? "", desc: upload.data.desc, privacy: upload.data.privacy }); }, [upload.data, dirty]);
  useEffect(() => {
    if (page.demo || !page.accessToken) return;
    apiRequest<{ connections: ChannelConnection[] }>("/api/v1/channels", { token: page.accessToken })
      .then(result => { const rows = result.connections.filter(row => row.platform === "youtube" && row.status === "connected"); setChannels(rows); setOwner(current => current || rows[0]?.ownerId || ""); }, () => setChannels([]));
  }, [page.demo, page.accessToken]);
  const save = async (patch: Record<string, unknown> = form) => {
    if (!page.client) return false;
    try {
      const result = await page.client.saveStage(project.id, "upload", upload.version, patch);
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, upload: result.stage } } : current);
      setDirty(false); return true;
    } catch (reason) { page.fail(reason); return false; }
  };
  const edit = (patch: Partial<typeof form>) => { setForm(current => ({ ...current, ...patch })); setDirty(true); };
  const go = async () => {
    if (!page.client || !last) return;
    page.setError("");
    try {
      if (dirty && !(await save())) return;
      setStep("영상을 준비하는 중");
      const url = await page.client.finalUrl(project.id, last);
      const response = url ? await fetch(url) : null;
      if (!response?.ok) throw new Error("저장된 최종본을 불러오지 못했어요.");
      const file = new File([await response.blob()], "short.mp4", { type: "video/mp4" });
      const session = await page.client.uploadSession(project.id, { fileName: file.name, fileSize: file.size, mimeType: file.type, ...(owner ? { connectionOwnerId: owner } : {}) });
      const video = await uploadYoutubeFile(session.uploadUrl, file, percent => setStep(`유튜브로 보내는 중 ${percent}%`));
      setStep("결과를 기록하는 중");
      await page.client.uploadComplete(project.id, { videoId: video.id, ...(owner ? { connectionOwnerId: owner } : {}) });
      await page.reload();
    } catch (reason) { page.fail(reason); } finally { setStep(""); }
  };
  const draft = upload.data.descBy;
  const draftWaiting = Boolean(draft && (form.desc !== draft.draft || (draft.title && form.title !== draft.title)));
  const missing = !last ? "최종본이 없어요" : !form.title.trim() ? "제목을 써 주세요" : !form.desc.trim() ? "설명을 써 주세요" : page.demo ? "데모에서는 올리지 않아요" : !channels.length ? "유튜브 채널을 연결해 주세요" : "";
  return <YpSection n={2} title="유튜브에 올리기" gq={run?.status === "done" ? "올렸어요" : "제목 · 설명을 다듬고 올려요"} extra={run?.status === "done" ? null
    : <button type="button" className="yp-btn yp-sm yp-pri" disabled={page.demo || job.open} onClick={() => setSend(true)}><Sparkles size={14} /> 내 AI로 제목 · 설명 쓰기</button>}>
    {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
    {run?.status === "done" ? <div className="yp-note yp-ok" role="status"><Youtube size={16} className="yp-i" aria-hidden="true" /><div><b>유튜브에 올렸어요</b> · {form.title}
      {run.videoUrl ? <> · <a className="yp-lnk" href={run.videoUrl} target="_blank" rel="noreferrer">유튜브에서 보기 <ExternalLink size={12} /></a></> : null}</div></div> : <>
      {draftWaiting && draft ? <div className="yp-note"><div>AI 초안이 왔어요. 쓴 내용은 그대로 뒀어요.
        <button type="button" className="yp-lnk" onClick={() => edit({ desc: draft.draft, ...(draft.title ? { title: draft.title } : {}) })}>이 초안으로 바꾸기</button></div></div> : null}
      <label className="yp-lbl" style={{ display: "block" }}>제목 <span className="yp-gq">쇼츠 제목 · 100자 이내</span>
        <input className="yp-in" value={form.title} maxLength={100} onChange={event => edit({ title: event.target.value })} onBlur={() => { if (dirty) void save(); }} /></label>
      <label className="yp-lbl" style={{ display: "block" }}>설명 <span className="yp-gq">마지막 줄 #해시태그는 태그로도 들어가요</span>
        <textarea className="yp-in" rows={5} value={form.desc} maxLength={5000} onChange={event => edit({ desc: event.target.value })} onBlur={() => { if (dirty) void save(); }} /></label>
      <div className="yp-savebar">
        <label className="yp-lbl" style={{ margin: 0 }}>공개 범위 <select className="yp-in" value={form.privacy} onChange={event => { const privacy = event.target.value as typeof form.privacy; edit({ privacy }); void save({ ...form, privacy }); }}>
          <option value="private">비공개</option><option value="unlisted">일부 공개</option></select></label>
        {channels.length > 1 ? <select className="yp-in" value={owner} onChange={event => setOwner(event.target.value)} aria-label="유튜브 채널">{channels.map(row => <option key={row.ownerId} value={row.ownerId}>{row.accountName}</option>)}</select>
          : channels[0] ? <span className="yp-muted">채널: {channels[0].accountName}</span> : null}
        <span className="yp-sp" />
        {missing ? <span className="yp-hint">{missing}</span> : null}
        <button type="button" className="yp-btn yp-pri" disabled={Boolean(missing) || Boolean(step)} onClick={() => void go()}><Youtube size={14} /> {step || "유튜브에 올리기"}</button><CostTag cost="youtube" />
      </div>
      <p className="yp-hint">공개는 올린 뒤 스튜디오에서 해요.</p>
    </>}
    <SendDialog page={page} task="short-copy" open={send} onClose={() => setSend(false)} job={job} />
  </YpSection>;
}

/** What the 대표 decides on for a 숏폼's 최종 검수: the vertical MP4, what it was made for, and the open feedback. */
export function ShortConfirmDetail({ client, bundle, open }: { client: YpClient; bundle: YpBundle; open: number | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [view, setView] = useState<YpShortView | null>(null);
  const { vertical: final, square, portrait } = latestFinals(bundle.finals);
  const ads = [square && `정사각형 v${square.v}`, portrait && `4:5 v${portrait.v}`].filter(Boolean).join(" · ");
  const id = bundle.project.id;
  useEffect(() => {
    let active = true;
    if (final) client.finalUrl(id, final).then(url => { if (active) setSrc(url); }, () => undefined);
    client.short(id).then(next => { if (active) setView(next); }, () => undefined);
    return () => { active = false; };
  }, [client, id, final]);
  return <div className="yp-g2" style={{ marginBottom: 12, alignItems: "start" }}>
    {src ? <video className="yp-vid9" src={src} controls preload="metadata" /> : <div className="yp-vid9" />}
    <dl className="yp-kv" style={{ gridTemplateColumns: "96px minmax(0,1fr)" }}>
      <dt>최종본</dt><dd>{final ? `v${final.v} · ${final.source === "short" ? "자동 제작" : final.name}${final.durationSeconds ? ` · ${final.durationSeconds}초` : ""}` : "—"}{ads ? ` · 함께 만든 것: ${ads}` : ""}</dd>
      <dt>용도</dt><dd>{view ? `${view.brief.purpose === "ad" ? "광고" : "일반 콘텐츠"} · ${view.brief.duration}초` : "—"}</dd>
      <dt>할 행동</dt><dd>{view?.brief.goal || "—"}</dd>
      <dt>연결 페이지</dt><dd>{view?.brief.landingUrl || "—"}</dd>
      {view?.brief.purpose === "ad" ? <><dt>구매 이유</dt><dd style={{ whiteSpace: "pre-wrap" }}>{view.brief.appeal || "—"}</dd><dt>근거</dt><dd style={{ whiteSpace: "pre-wrap" }}>{view.brief.evidence || "—"}</dd></> : null}
      <dt>남은 피드백</dt><dd>{open === null ? "—" : `${open}개`}</dd>
    </dl>
  </div>;
}
