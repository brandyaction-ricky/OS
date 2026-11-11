"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pin, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { SLOTS, type YpSlot, type YpThumbPick } from "@/lib/youtube-process/stages";
import { ThumbFrame } from "@/lib/youtube-process/thumb-frame";
import { THUMB_STYLES, thumbLayout, type ThumbCopy, type ThumbSubject, type ThumbTool } from "@/lib/youtube-process/thumb-style";
import type { useYpBundle } from "./youtube-process-frame";

// 롱폼 애니메이션 썸네일 고르기 (요청 2026-11-09): a YouTube home feed with the PD's candidate among the market videos the AI read.
// Picture ‹ › and copy ‹ › turn apart; 고정 keeps the copy while the pictures turn. 고르기 makes the PNG with the same frame.
type Candidate = { id: string; n: number; at: string; by: string; path: string; url: string | null; scene: string; why: string; refs: string[]; copies: ThumbCopy[]; tool: ThumbTool; subject?: ThumbSubject };
type Feed = { id: string; title: string; channel: string; views: number; thumbnail: string };
type View = { style: string | null; feed: Feed[]; candidates: Candidate[] };
export type ThumbPicked = { path: string; name: string; copy: ThumbCopy; pick: YpThumbPick };

const views = (n: number) => n >= 10_000 ? `조회수 ${Math.round(n / 1000) / 10}만회` : `조회수 ${n.toLocaleString("ko-KR")}회`;

/** The 1280×720 frame shrunk to its box, so the screen shows exactly what the PNG will be. */
export function Scaled({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => { if (stage.current) stage.current.style.transform = `scale(${entry.contentRect.width / 1280})`; });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={box} className="yp-tp-frame"><div ref={stage} className="yp-tp-stage">{children}</div></div>;
}

export function ThumbPicker({ page, title, planCopies, picked, can, busyJob, onPick, onMake }: {
  page: ReturnType<typeof useYpBundle>; title: string; planCopies: ThumbCopy[];
  /** What each slot holds now (candidate ids), to mark them on the feed. */
  picked: Partial<Record<YpSlot, string>>;
  can: boolean; busyJob: boolean;
  onPick: (slot: YpSlot, value: ThumbPicked) => Promise<void> | void;
  /** 기획안 only: [썸네일 후보 만들기] with the tool and how many. 제작 shows no generation. */
  onMake?: (tool: ThumbTool, count: number) => void;
}) {
  const projectId = page.bundle?.project.id;
  const [data, setData] = useState<View | null>(null);
  const urls = useRef(new Map<string, string>());
  const [img, setImg] = useState(0);
  const [cpy, setCpy] = useState(0);
  const [pinned, setPinned] = useState<ThumbCopy | null>(null);
  const [mode, setMode] = useState<"feed" | "large" | "phone" | "archive">("feed");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [tool, setTool] = useState<ThumbTool>(() => { try { return localStorage.getItem("yp-thumb-tool") === "chatgpt" ? "chatgpt" : "flow"; } catch { return "flow"; } });
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState<YpSlot | "">("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!projectId || !page.accessToken || page.demo) return;
    try {
      const next = await apiRequest<View>(`/api/v1/content/youtube/projects/${projectId}/thumbs`, { token: page.accessToken });
      // A picture keeps its first link (an hour): a new one each poll would download it again (egress).
      for (const c of next.candidates) { if (c.url && !urls.current.has(c.path)) urls.current.set(c.path, c.url); c.url = urls.current.get(c.path) ?? c.url; }
      setData(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "후보를 읽지 못했어요."); }
  }, [projectId, page.accessToken, page.demo]);
  // Again when the job ends, so the last pictures handed in show.
  useEffect(() => { void load(); }, [load, busyJob]);
  useEffect(() => {
    if (!busyJob) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [busyJob, load]);
  const style = data?.style ? THUMB_STYLES[data.style] : null;
  const list = useMemo(() => data?.candidates ?? [], [data]);
  const current = list[Math.min(img, Math.max(0, list.length - 1))];
  // 기획안 문구가 1번: the PD's own copies first, then this picture's three.
  const copies = useMemo(() => {
    const seen = new Set<string>(), out: ThumbCopy[] = [];
    for (const copy of [...planCopies, ...(current?.copies ?? [])]) if (copy.text.trim() && !seen.has(copy.text)) { seen.add(copy.text); out.push(copy); }
    return out;
  }, [planCopies, current]);
  const copy = pinned ?? copies[Math.min(cpy, Math.max(0, copies.length - 1))] ?? { text: title };
  const turnImage = (step: number) => { if (!list.length) return; setImg((img + step + list.length) % list.length); if (!pinned) setCpy(0); };
  const turnCopy = (step: number) => { if (!copies.length || pinned) return; setCpy((cpy + step + copies.length) % copies.length); };
  const checks = style ? thumbLayout(copy, style).checks : [];
  const pick = async (slot: YpSlot) => {
    if (!current || !projectId || !page.accessToken) return;
    setBusy(slot); setError("");
    try {
      const made = await apiRequest<{ path: string; name: string }>(`/api/v1/content/youtube/projects/${projectId}/thumbs`, { method: "POST", token: page.accessToken,
        body: JSON.stringify({ candidate: current.id, copy: { text: copy.text, accent: copy.accent ?? "" }, kind: onMake ? "plan_thumb" : "thumb" }) });
      await onPick(slot, { ...made, copy, pick: { candidate: current.id, ...(copy.accent ? { accent: copy.accent } : {}) } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "고르지 못했어요."); } finally { setBusy(""); }
  };
  if (!style) return null;
  const ours = <div className={`yp-tp-card yp-tp-ours${mode === "phone" ? " yp-tp-phone" : ""}`}>
    {current?.url ? <Scaled><ThumbFrame style={style} image={current.url} copy={copy} subject={current.subject} /></Scaled> : <div className="yp-tp-frame yp-tp-empty">{list.length ? "그림을 불러오는 중…" : "아직 후보가 없어요"}</div>}
    <div className="yp-tp-meta"><b>{title || "제목 A"}</b><span>우리 채널 · 후보 {current ? `${current.n}번` : "-"}</span></div>
  </div>;
  const feed = data?.feed ?? [];
  return <div className="yp-tp">
    {onMake && can ? <div className="yp-tp-make">
      <label>그림 도구<select className="yp-in yp-sel1" value={tool} onChange={event => { const next = event.target.value as ThumbTool; setTool(next); try { localStorage.setItem("yp-thumb-tool", next); } catch { /* per-viewer default only */ } }}>
        <option value="flow">Flow</option><option value="chatgpt">ChatGPT</option></select></label>
      <label>몇 개<input className="yp-in" type="number" min={1} max={12} value={count} onChange={event => setCount(Math.min(12, Math.max(1, Number(event.target.value) || 1)))} /></label>
      <button type="button" className="yp-btn yp-pri yp-sm" disabled={busyJob} onClick={() => onMake(tool, count)}><Sparkles size={14} /> {list.length ? "후보 더 만들기" : "썸네일 후보 만들기"}</button>
      <span className="yp-muted">{busyJob ? "내 AI가 만드는 대로 하나씩 들어와요." : `후보 ${list.length}개`}</span>
    </div> : null}
    {list.length ? <>
      <div className="yp-tp-bar">
        <span className="yp-tp-turn">그림<button type="button" className="yp-ib" aria-label="이전 그림" onClick={() => turnImage(-1)}><ChevronLeft size={16} /></button>{img + 1}/{list.length}<button type="button" className="yp-ib" aria-label="다음 그림" onClick={() => turnImage(1)}><ChevronRight size={16} /></button></span>
        <span className="yp-tp-turn">문구<button type="button" className="yp-ib" aria-label="이전 문구" disabled={Boolean(pinned)} onClick={() => turnCopy(-1)}><ChevronLeft size={16} /></button>{pinned ? "고정" : `${Math.min(cpy, copies.length - 1) + 1}/${copies.length}`}<button type="button" className="yp-ib" aria-label="다음 문구" disabled={Boolean(pinned)} onClick={() => turnCopy(1)}><ChevronRight size={16} /></button></span>
        <button type="button" className={`yp-btn yp-sm${pinned ? " yp-on" : ""}`} aria-pressed={Boolean(pinned)} onClick={() => setPinned(pinned ? null : copy)}><Pin size={13} /> 문구 고정</button>
        <span className="yp-sp" />
        <div className="yp-seg2 yp-sm" role="group" aria-label="보기">{([["feed", "피드"], ["large", "크게"], ["phone", "휴대폰"], ["archive", "보관함"]] as const).map(([key, label]) => <button key={key} type="button" className={mode === key ? "yp-on" : ""} onClick={() => setMode(key)}>{label}</button>)}</div>
      </div>
      {mode === "archive" ? <Archive list={list} picked={picked} only={onlyPicked} onOnly={setOnlyPicked} onOpen={index => { setImg(index); if (!pinned) setCpy(0); setMode("feed"); }} />
        : mode === "feed" ? <div className="yp-tp-feed">
        {feed[0] ? <FeedCard item={feed[0]} /> : null}{ours}{feed.slice(1, 5).map(item => <FeedCard key={item.id} item={item} />)}
      </div> : <div className={mode === "phone" ? "yp-tp-phonewrap" : "yp-tp-large"}>{ours}</div>}
      <div className="yp-tp-copy">「{copy.text.replace(/\n/g, " / ")}」{copy.accent ? <span className="yp-muted"> · 파랑 「{copy.accent}」</span> : null}
        {checks.map(check => <span key={check.id} className={`yp-tag ${check.ok ? "yp-good" : "yp-bad"}`}>{check.text}</span>)}</div>
      {can ? <div className="yp-tp-pick"><span>이 조합을</span>{SLOTS.map(slot => <button key={slot} type="button" className={`yp-btn yp-sm${picked[slot] === current?.id ? " yp-on" : ""}`} disabled={Boolean(busy) || !current || checks.some(c => !c.ok)} onClick={() => void pick(slot)}>{busy === slot ? "만드는 중…" : `${slot}에 넣기`}</button>)}</div> : null}
      {current ? <div className="yp-tp-why"><b>장면</b> {current.scene}{current.why ? <><br /><b>왜 눌릴지</b> {current.why}</> : null}
        {current.refs.length ? <div className="yp-tp-refs"><b>근거 레퍼런스</b>{current.refs.map(ref => { const item = feed.find(row => row.id === ref); return item
          // eslint-disable-next-line @next/next/no-img-element -- YouTube's own thumbnail address
          ? <a key={ref} href={`https://www.youtube.com/watch?v=${ref}`} target="_blank" rel="noreferrer" title={item.title}><img src={item.thumbnail} alt={item.title} /></a>
          : <a key={ref} href={`https://www.youtube.com/watch?v=${ref}`} target="_blank" rel="noreferrer">{ref}</a>; })}</div> : null}</div> : null}
    </> : <p className="yp-pempty">{onMake ? "아직 후보가 없어요. [썸네일 후보 만들기]를 누르면 내 AI가 그림을 만들어 하나씩 올려요." : "기획안에서 만든 후보가 없어요."}</p>}
    {error ? <p className="yp-err" role="alert">{error}</p> : null}
  </div>;
}

/** 보관함: every picture made for this video, newest first, with the tool, who and when; 고른 것만 keeps the ones in A · B · C. */
function Archive({ list, picked, only, onOnly, onOpen }: { list: Candidate[]; picked: Partial<Record<YpSlot, string>>; only: boolean; onOnly: (on: boolean) => void; onOpen: (index: number) => void }) {
  const slotOf = (id: string) => SLOTS.filter(slot => picked[slot] === id).join(" · ");
  const rows = list.map((c, index) => ({ c, index })).filter(({ c }) => !only || slotOf(c.id)).reverse();
  return <div className="yp-tp-archive">
    <label className="yp-tp-only"><input type="checkbox" checked={only} onChange={event => onOnly(event.target.checked)} /> 고른 것만</label>
    {rows.length ? <div className="yp-tp-feed">{rows.map(({ c, index }) => <button key={c.id} type="button" className="yp-tp-card yp-tp-arc" onClick={() => onOpen(index)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link from private storage */}
      <div className="yp-tp-frame">{c.url ? <img src={c.url} alt={`후보 ${c.n}`} /> : null}</div>
      <div className="yp-tp-meta"><b>{c.n}번{slotOf(c.id) ? ` · ${slotOf(c.id)}에 고름` : ""}</b><span>{c.tool === "flow" ? "Flow" : "ChatGPT"} · {c.by} · {c.at.slice(5, 16).replace("T", " ")}</span><span>{c.scene}</span></div>
    </button>)}</div> : <p className="yp-pempty">{only ? "아직 고른 후보가 없어요." : "아직 후보가 없어요."}</p>}
  </div>;
}

function FeedCard({ item }: { item: Feed }) {
  return <a className="yp-tp-card" href={`https://www.youtube.com/watch?v=${item.id}`} target="_blank" rel="noreferrer">
    {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's own thumbnail address */}
    <div className="yp-tp-frame"><img src={item.thumbnail} alt="" /></div>
    <div className="yp-tp-meta"><b>{item.title}</b><span>{item.channel} · {views(item.views)}</span></div>
  </a>;
}
