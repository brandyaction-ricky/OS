"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Download, MessageSquare, Pause, Pencil, Play, ThumbsUp, Trash2, Upload } from "lucide-react";
import { stepHref } from "@/lib/youtube-process/project";
import { finalPair, SLOTS, type YpSlot } from "@/lib/youtube-process/stages";
import { GateBanner, gateAction, gateSub, LockedStep, ReplyForm, Subject, useGate, useYpBundle, YpFrame } from "./youtube-process-frame";
import type { YpFeedbackView } from "./youtube-process-data";
import { useSession } from "./session-provider";
import { ApiRequestError } from "@/lib/api-client";
import { feedbackClosed, type FeedbackAction } from "@/lib/youtube-process/feedback";
import { YtCard } from "./youtube-process-media";

const fmt = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const KINDS = ["제목", "썸네일 문구", "이미지 연출", "기타"];
const closed = feedbackClosed;
const label = (item: YpFeedbackView) => item.target !== "video" ? `🖼 ${item.target}` : item.range ? `▷ ${fmt(item.range[0])}~${fmt(item.range[1])}` : `▷ ${fmt(item.t ?? 0)}`;

/** S6 최종 검토: the latest final with time-coded feedback, the thumbnails, and the 최종 검토 컨펌 (4-7). */
export function YoutubeFinalCheckScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  const control = useGate(page, "review");
  const [items, setItems] = useState<YpFeedbackView[]>([]);
  const [view, setView] = useState<"video" | "thumb">("video");
  const [size, setSize] = useState<"s" | "l">("s");
  const [hidePanel, setHidePanel] = useState(false);
  const [verSel, setVerSel] = useState<number | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [thumbTarget, setThumbTarget] = useState<YpSlot>("A");
  const [kind, setKind] = useState("");
  const [sug, setSug] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [rate, setRate] = useState(1);   // 재생 속도 (2026-10-28 직원 요청: 검토 시간을 줄이게 1 · 1.5 · 2배)
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const project = page.bundle?.project;
  const finals = useMemo(() => page.bundle?.finals ?? [], [page.bundle?.finals]);
  const latest = finals.at(-1)?.v ?? 0;
  const ver = verSel ?? latest;
  const final = finals.find(item => item.v === ver) ?? null;

  // Keyed on the client and the video id only: `page` is a new object every render, so depending on it refetched and re-rendered forever.
  const { client, fail } = page, projectId = project?.id;
  const loadFeedback = useCallback(async () => {
    if (!client || !projectId) return;
    try { setItems(await client.feedback(projectId)); } catch (reason) { fail(reason); }
  }, [client, fail, projectId]);
  useEffect(() => { void loadFeedback(); }, [loadFeedback]);
  // Someone else's ✓ 반영 or reply shows up without reopening the page: on return to the tab and every 30 s while it is visible.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadFeedback(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [loadFeedback]);
  // A new signed address restarts the download (and the playing spot), so it is asked for only when the shown final changes.
  const finalKey = final ? `${final.v}:${final.at}` : "";
  const shownFinal = useRef(final);
  shownFinal.current = final;
  useEffect(() => {
    let active = true;
    const current = shownFinal.current;
    if (!client || !projectId || !current) { setSrc(null); return; }
    client.finalUrl(projectId, current).then(url => { if (active) setSrc(url); }, () => { if (active) setSrc(null); });
    return () => { active = false; };
  }, [client, projectId, finalKey]);

  const old = view === "video" && ver !== latest;
  // Open long-form items from earlier versions follow the latest one ('vN에서 넘어옴', 3차).
  const shown = items.filter(item => view === "video" ? item.target === "video" && (item.ver === ver || (ver === latest && item.ver < latest && !closed(item))) : item.target !== "video");
  const openItems = shown.filter(item => !closed(item));
  const doneItems = shown.filter(closed);
  const openCount = (target: "video" | "thumb") => items.filter(item => (target === "video" ? item.target === "video" : item.target !== "video") && !closed(item) && !item.reaction).length;

  const seek = (seconds: number) => { if (video.current) { video.current.currentTime = seconds; setTime(seconds); } };
  const toggle = () => { const el = video.current; if (!el) return; if (el.paused) { void el.play(); setRange(null); } else el.pause(); };
  const at = (clientX: number) => { const rect = bar.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (duration || 0); };
  const add = async (reaction = false) => {
    if (!page.client || !project || (!reaction && !text.trim())) return;
    setBusy(true); page.setError("");
    try {
      const item = await page.client.addFeedback(project.id, view === "video"
        ? { target: "video", ver, t: range ? null : Math.round(time * 10) / 10, range: range ? [Math.round(range[0]), Math.round(range[1])] : null, text: text.trim(), reaction }
        : { target: thumbTarget, ver: 1, text: text.trim(), kind, sug: sug.trim(), reaction });
      setItems(list => [...list, item]); setText(""); setSug(""); setRange(null);
    } catch (reason) { page.fail(reason); } finally { setBusy(false); }
  };
  /** Resolves to an error message (shown under that item, the draft kept) or "" when saved. A 409 reloads the list. */
  const act = async (item: YpFeedbackView, action: FeedbackAction, value = "", replyId?: string): Promise<string> => {
    if (!page.client || !project) return "화면을 다시 불러와 주세요.";
    try { const next = await page.client.actFeedback(project.id, item.id, item.version, action, value, replyId); setItems(list => list.map(row => row.id === next.id ? next : row)); return ""; }
    catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 409) { void loadFeedback(); return `${reason.message} 최신 내용으로 다시 불러왔어요. 한 번 더 눌러 주세요.`; }
      return reason instanceof Error ? reason.message : "저장하지 못했어요. 다시 눌러 주세요.";
    }
  };
  const exportList = () => {
    const rows = items.filter(item => item.target === "video" && item.ver === ver && !item.reaction).sort((a, b) => (a.t ?? a.range?.[0] ?? 0) - (b.t ?? b.range?.[0] ?? 0));
    const csv = ["시간,내용,누가,상태", ...rows.map(item => [label(item).replace("▷ ", ""), `"${item.text.replace(/"/g, '""')}"`, item.who, item.status === "done" ? "반영" : item.status === "declined" ? "반영 안 함" : "남음"].join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv" })); link.download = `feedback_v${ver}.csv`; link.click();
  };

  const unresolved = openCount("video") + openCount("thumb");
  const action = page.bundle ? gateAction(page, "review", 4, control, finals.length ? "" : project?.yp.topic.type === "short" ? "최종본을 만들거나 올려 주세요" : "최종본을 올려 주세요") : null;
  const stamp = view === "video" ? (range ? `▷ ${fmt(range[0])}~${fmt(range[1])}` : `▷ ${fmt(time)}`) : `🖼 ${thumbTarget}`;
  const confirmed = page.bundle?.stages.plan.data.confirmed;
  const plan = { confirmed };
  const make = page.bundle?.stages.make.data;
  // A 숏폼 is a vertical video with no YouTube thumbnails.
  const short = project?.yp.topic.type === "short";

  return <YpFrame page={page} view={4} action={action} header={header} title="최종 검토" sub={gateSub(project, "review", "끝까지 보고, 고칠 곳은 그 시간에 남겨요.", short ? "최종 검토가 끝났어요. 내보내기로 넘어가요." : "최종 검토가 끝났어요. 업로드로 넘어가요.")}
    todo={project?.yp.stage === "review" && project.yp.gates.review.state !== "wait" ? [{ label: "최종본", done: finals.length > 0 }, ...(unresolved ? [{ label: `남은 피드백 ${unresolved}개 (그래도 요청 가능)`, done: false }] : [])] : undefined}>
    {page.bundle && project && make ? ["topic", "draft", "outline", "make"].includes(project.yp.stage) ? <LockedStep page={page} name="최종 검토" /> : <>
      <GateBanner page={page} gate="review" okExtra={project.yp.stage === "upload" ? <> · <Link className="yp-lnk" href={stepHref(5, project.id)}>{short ? "내보내기로" : "업로드로"} →</Link></> : null} />
      <ReplyForm control={control} />
      <Subject page={page} />
      <div className="yp-rvbar"><span style={{ flex: 1 }} />
        <button type="button" className="yp-btn yp-sm yp-pc-only" onClick={() => setHidePanel(value => !value)}>{hidePanel ? "피드백 보이기" : "피드백 숨기기"}</button>
        <div className="yp-seg2 yp-sm yp-pc-only" role="group" aria-label="플레이어 크기"><button type="button" className={size === "s" ? "yp-on" : ""} onClick={() => setSize("s")}>작게</button><button type="button" className={size === "l" ? "yp-on" : ""} onClick={() => setSize("l")}>크게</button></div></div>
      <div className={`yp-rv yp-sz-${size}${hidePanel ? " yp-nop" : ""}`}><div>
        <div className="yp-player">
          {short ? null : <div className="yp-vtabs"><button type="button" className={view === "video" ? "yp-on" : ""} onClick={() => setView("video")}>영상</button><button type="button" className={view === "thumb" ? "yp-on" : ""} onClick={() => setView("thumb")}>썸네일</button></div>}
          {view === "video" ? <>
            <div className={`yp-frame${short ? " yp-vert" : ""}`} onClick={toggle} role="button" tabIndex={0} aria-label={playing ? "멈추고 쓰기" : "재생"} onKeyDown={event => { if (event.key === " " || event.key.toLowerCase() === "f") { event.preventDefault(); toggle(); } }}>
              {src ? <video ref={video} src={src} preload="metadata" style={{ width: "100%", height: "100%", display: "block" }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onLoadedMetadata={event => { setDuration(event.currentTarget.duration); event.currentTarget.playbackRate = rate; }} />
                : <div className="yp-muted" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--media-muted)" }}>{final ? "영상을 불러오는 중이에요…" : "아직 최종본이 없어요"}</div>}
              <span className={`yp-badge${playing ? "" : " yp-pz"}`}>{playing ? "재생 중" : `멈춤 · ${fmt(time)}`}{old ? ` · v${ver} 이전 버전` : ""}</span>
            </div>
            <div className="yp-ctrl"><button type="button" className="yp-cb" aria-label={playing ? "멈춤" : "재생"} onClick={toggle}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
              <div className="yp-pb" ref={bar} role="slider" aria-label="재생 위치" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} tabIndex={0}
                onMouseDown={event => { drag.current = at(event.clientX); }}
                onMouseUp={event => { if (drag.current === null || !duration) return; const end = at(event.clientX); const start = drag.current; drag.current = null;
                  if (Math.abs(end - start) > duration / 100) { video.current?.pause(); setRange([Math.min(start, end), Math.max(start, end)]); seek(Math.min(start, end)); } else { setRange(null); seek(end); } }}>
                <span className="yp-track" /><span className="yp-fill" style={{ width: `${duration ? time / duration * 100 : 0}%` }} />
                {duration ? items.filter(item => item.target === "video" && item.ver === ver && !closed(item) && !item.reaction).map(item => item.range
                  ? <span key={item.id} className="yp-rg" style={{ left: `${item.range[0] / duration * 100}%`, width: `${(item.range[1] - item.range[0]) / duration * 100}%` }} />
                  : <span key={item.id} className="yp-mk" style={{ left: `${(item.t ?? 0) / duration * 100}%` }} />) : null}
                {range && duration ? <span className="yp-rg yp-sel" style={{ left: `${range[0] / duration * 100}%`, width: `${(range[1] - range[0]) / duration * 100}%` }} /> : null}
                <span className="yp-knob" style={{ left: `${duration ? time / duration * 100 : 0}%` }} /></div>
              <span className="yp-tm">{fmt(time)} / {fmt(duration)}</span></div>
            <div className="yp-ctrl2"><label className="yp-vsel">버전 <select value={ver} onChange={event => { setVerSel(Number(event.target.value)); setRange(null); setTime(0); }} aria-label="영상 버전">
              {[...finals].reverse().map(item => <option key={item.v} value={item.v}>v{item.v}{item.v === latest ? " (최신)" : ""} · {item.source === "myin" || item.source === "short" ? "자동 제작" : item.name}</option>)}</select></label>
              <label className="yp-vsel">속도 <select value={rate} onChange={event => { const value = Number(event.target.value); setRate(value); if (video.current) video.current.playbackRate = value; }} aria-label="재생 속도">
                {[1, 1.5, 2].map(value => <option key={value} value={value}>{value}배</option>)}</select></label>
              <span style={{ flex: 1 }} />
              {project.yp.stage === "review" ? <Link className="yp-cb" href={`/content/make?project=${encodeURIComponent(project.id)}`}><Upload size={14} /> 제작에서 새 버전 올리기</Link> : null}
              <button type="button" className="yp-cb" onClick={exportList}><Download size={14} /> 편집용 목록 내려받기</button></div>
          </> : <div className="yp-tview2" style={{ padding: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            {SLOTS.filter(slot => confirmed?.[slot]).map(slot => <button key={slot} type="button" className={`yp-abc${thumbTarget === slot ? " yp-on" : ""}`} style={{ textAlign: "left" }} onClick={() => setThumbTarget(slot)}>
              <div className="yp-abc-h"><span className={`yp-ltag${slot === "C" ? " yp-c" : ""}`}>{slot}</span>{finalPair(plan, make, slot)?.changed ? <span className="yp-tag yp-warn">컨펌본과 다름</span> : null}</div>
              <YtCard page={page} thumb={finalPair(plan, make, slot)?.thumb} path={make.thumbs[slot]?.path} title={finalPair(plan, make, slot)?.title ?? ""} /></button>)}</div>}
        </div>
        <p className="yp-hint">{view === "video" ? "영상을 누르면 멈추고 그 시간에 써요. 재생 바를 끌면 구간을 골라요." : "썸네일을 누르면 그 썸네일에 피드백을 남겨요."}</p>
      </div>
      <aside className="yp-fbp"><div className="yp-fbp-h"><b>남은 피드백 {openCount("video") + openCount("thumb")}</b><span className="yp-muted" style={{ fontSize: 12 }}>{view === "video" ? `v${ver} · 러닝타임 순서` : "A → B → C"}</span></div>
        {short ? null : <div className="yp-ftabs yp-two"><button type="button" className={view === "video" ? "yp-on" : ""} onClick={() => setView("video")}>영상 <b>{openCount("video")}</b></button><button type="button" className={view === "thumb" ? "yp-on" : ""} onClick={() => setView("thumb")}>썸네일 <b>{openCount("thumb")}</b></button></div>}
        <div className="yp-fbl">{openItems.length ? openItems.map(item => <FeedbackItem key={item.id} item={item} open={open === item.id} latest={latest} onOpen={() => setOpen(open === item.id ? null : item.id)}
            onSeek={() => { if (item.target === "video") { setView("video"); seek(item.t ?? item.range?.[0] ?? 0); } else setThumbTarget(item.target as YpSlot); }} onAct={(action, value, replyId) => act(item, action, value, replyId)} />)
          : <p className="yp-muted" style={{ padding: 8 }}>남은 피드백이 없어요</p>}
          {doneItems.length ? <><button type="button" className="yp-solvedbar" onClick={() => setShowDone(value => !value)}>반영됨 {doneItems.length}개 {showDone ? "▾" : "▸"}</button>
            {showDone ? doneItems.map(item => <FeedbackItem key={item.id} item={item} open={open === item.id} latest={latest} onOpen={() => setOpen(open === item.id ? null : item.id)} onSeek={() => seek(item.t ?? 0)} onAct={(action, value, replyId) => act(item, action, value, replyId)} />) : null}</> : null}</div>
        {old ? <div className="yp-comp"><p className="yp-muted" style={{ margin: 0, fontSize: 13 }}>이전 버전은 보기만 해요. 피드백은 최신 버전에 남겨요. <button type="button" className="yp-lnk" onClick={() => setVerSel(null)}>최신 v{latest} 보기</button></p></div>
          : project.yp.stage === "review" || project.yp.stage === "upload" ? <div className="yp-comp">
            <div className="yp-comp-h">{view === "video" && playing ? <span className="yp-muted">재생 중. 영상을 누르면 멈추고 시간이 붙어요</span> : <>지금 쓰기 <span className="yp-at">{stamp}</span></>}<span style={{ flex: 1 }} />
              {view === "thumb" ? <div className="yp-kseg" role="group" aria-label="어느 썸네일">{SLOTS.filter(slot => confirmed?.[slot]).map(slot => <button key={slot} type="button" className={thumbTarget === slot ? "yp-on" : ""} onClick={() => setThumbTarget(slot)}>{slot}</button>)}</div> : null}</div>
            {view === "thumb" ? <><div className="yp-chips" style={{ marginBottom: 6 }}>{KINDS.map(item => <button key={item} type="button" className={`yp-chip${kind === item ? " yp-on" : ""}`} onClick={() => setKind(kind === item ? "" : item)}>{item}</button>)}<span className="yp-muted" style={{ fontSize: 12, alignSelf: "center" }}>안 골라도 돼요</span></div>
              {kind === "제목" || kind === "썸네일 문구" ? <input className="yp-in" style={{ marginBottom: 6 }} value={sug} onChange={event => setSug(event.target.value)} placeholder={kind === "제목" ? "바꿀 제목을 직접 써요" : "바꿀 큰 글자를 직접 써요"} aria-label="직접 제안" /> : null}</> : null}
            <textarea className="yp-in" value={text} onChange={event => setText(event.target.value)} placeholder="빈칸에 그냥 쓰면 돼요" aria-label="피드백" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void add(); }} />
            <div className="yp-comp-f"><button type="button" className="yp-btn yp-sm" title="좋아요만 남기기" aria-label="좋아요" disabled={busy} onClick={() => void add(true)}><ThumbsUp size={14} /></button><span className="yp-sp" />
              <span className="yp-muted" style={{ fontSize: 12 }}>Ctrl+Enter</span><button type="button" className="yp-btn yp-pri" disabled={busy || !text.trim()} onClick={() => void add()}>남기기</button></div>
          </div> : null}
      </aside></div>
    </> : null}
  </YpFrame>;
}

function FeedbackItem({ item, open, latest, onOpen, onSeek, onAct }: { item: YpFeedbackView; open: boolean; latest: number; onOpen: () => void; onSeek: () => void;
  onAct: (action: FeedbackAction, value?: string, replyId?: string) => Promise<string> }) {
  const { profile } = useSession();
  const me = profile?.id ?? "";
  // One draft per item and per open box; it stays until the save succeeds (개발 요청 8cb3c12e R02).
  const [mode, setMode] = useState<null | { kind: "reply" | "decline" | "edit" | "reply_edit"; replyId?: string }>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const done = closed(item);
  const mine = item.whoId === me;
  const run = async (action: FeedbackAction, value = "", replyId?: string) => {
    setSaving(true); setError("");
    const message = await onAct(action, value, replyId);
    setSaving(false);
    if (message) { setError(message); return false; }
    return true;
  };
  const submit = async () => {
    if (!mode || !draft.trim()) return;
    if (await run(mode.kind, draft.trim(), mode.replyId)) { setMode(null); setDraft(""); }
  };
  const begin = (kind: "reply" | "decline" | "edit" | "reply_edit", text = "", replyId?: string) => { setMode({ kind, replyId }); setDraft(text); setError(""); };
  const when = (at?: string) => at ? new Date(at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return <div className={`yp-fi${done ? " yp-done" : ""}${open ? " yp-open" : ""}`}>
    <div className="yp-f1">{item.reaction ? <span className="yp-tag">👍</span> : <input type="checkbox" checked={item.status === "done"} disabled={item.status === "declined" || item.deleted} title="반영" aria-label="반영" onChange={event => void run(event.target.checked ? "resolve" : "reopen")} />}
      <button type="button" className="yp-lnk yp-tlink" onClick={onSeek}>{label(item)}</button><span className={`yp-tx${item.deleted ? " yp-muted" : ""}`} onClick={onOpen}>{item.deleted ? "삭제된 댓글입니다" : item.text || (item.reaction ? "좋아요" : "")}</span><span className="yp-who">{item.who}</span>
      {item.status === "declined" ? <span className="yp-tag">반영 안 함</span> : item.status === "done" ? <span className={`yp-tag${item.confirmedBy ? " yp-ok" : ""}`}>{item.confirmedBy ? "확인 완료" : "반영됨"}</span> : item.target === "video" && item.ver < latest && !done ? <span className="yp-tag yp-warn">v{item.ver}에서</span> : null}
      {item.replies.length ? <span className="yp-muted" style={{ fontSize: 12 }}>답글 {item.replies.filter(row => !row.deleted).length}</span> : null}
      <button type="button" className="yp-ib" style={{ width: 24, height: 24 }} aria-label="펼치기" onClick={onOpen}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></div>
    {open ? <div className="yp-more2"><div className="yp-muted" style={{ fontSize: 12 }}>{new Date(item.at).toLocaleString("ko-KR")}{item.editedAt ? " · 고침" : ""}{item.kind ? ` · ${item.kind}` : ""}{item.target === "video" && item.ver < latest ? ` · v${item.ver}에서 넘어옴` : ""}{item.declinedWhy ? ` · 반영 안 함: ${item.declinedWhy}` : ""}</div>
      {item.status === "done" ? <p className="yp-fi-sug" role="status">반영됨{item.doneBy ? ` · ${item.doneBy}` : ""}{item.doneAt ? ` · ${when(item.doneAt)}` : ""}{item.fixedIn ? ` · v${item.fixedIn}` : ""}
        {item.confirmedBy ? <> · <b>요청자 확인 완료</b> ({item.confirmedBy} · {when(item.confirmedAt)})</> : " · 요청자 확인 전"}
        {(mine || profile?.role === "admin") && !item.deleted ? <> {item.confirmedBy
          ? <button type="button" className="yp-lnk" disabled={saving} onClick={() => void run("unconfirm")}>확인 되돌리기</button>
          : <button type="button" className="yp-btn yp-sm yp-pri" disabled={saving} onClick={() => void run("confirm")}>반영 확인</button>}</> : null}</p> : null}
      {item.sug && !item.deleted ? <p className="yp-fi-sug">바꿀 {item.kind === "제목" ? "제목" : "글자"}: <b>{item.sug}</b></p> : null}
      {item.replies.map(row => <div key={row.id} className="yp-rep"><b>{row.by}</b> {row.deleted ? <span className="yp-muted">삭제된 댓글입니다</span> : <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{row.text}</span>}
        <span className="yp-muted" style={{ fontSize: 11 }}> · {when(row.at)}{row.editedAt ? " · 고침" : ""}</span>
        {row.byId === me && !row.deleted ? <> <button type="button" className="yp-lnk" onClick={() => begin("reply_edit", row.text, row.id)}>수정</button> <button type="button" className="yp-lnk" disabled={saving} onClick={() => { if (window.confirm("이 답글을 지울까요?")) void run("reply_delete", "", row.id); }}>삭제</button></> : null}</div>)}
      {mode ? <div className="yp-repin"><textarea className="yp-in" rows={2} value={draft} onChange={event => setDraft(event.target.value)} autoFocus
          onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(); }}
          placeholder={mode.kind === "decline" ? "반영하지 않는 이유 (필수)" : mode.kind === "reply" ? "답글" : "고칠 내용"} aria-label={mode.kind === "decline" ? "반영 안 함 이유" : mode.kind === "reply" ? "답글" : "고칠 내용"} />
        <button type="button" className="yp-btn yp-sm yp-pri" disabled={saving || !draft.trim()} onClick={() => void submit()}>{saving ? "저장 중…" : mode.kind === "edit" || mode.kind === "reply_edit" ? "고치기" : "남기기"}</button>
        <button type="button" className="yp-btn yp-sm" disabled={saving} onClick={() => { setMode(null); setError(""); }}>취소</button></div> : null}
      {error ? <p className="yp-errline" role="alert">{error}</p> : null}
      {!item.reaction && !mode ? <div className="yp-fi-a">
        <button type="button" className="yp-btn yp-sm" onClick={() => begin("reply")}><MessageSquare size={14} /> 답글</button>
        {!done ? <button type="button" className="yp-btn yp-sm" onClick={() => begin("decline")}>반영 안 함</button> : null}
        {mine && !item.deleted ? <><button type="button" className="yp-btn yp-sm" onClick={() => begin("edit", item.text)}><Pencil size={14} /> 수정</button>
          <button type="button" className="yp-btn yp-sm" disabled={saving} onClick={() => { if (window.confirm("이 피드백을 지울까요? 달린 답글은 남아요.")) void run("delete"); }}><Trash2 size={14} /> 삭제</button></> : null}
      </div> : null}
    </div> : null}
  </div>;
}

