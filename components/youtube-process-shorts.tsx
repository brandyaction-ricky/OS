"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Download, Film, Plus, Sparkles, Trash2 } from "lucide-react";
import { apiRequest, archiveRecord, createRecord, listRecords, updateRecord } from "@/lib/api-client";
import { parseTimedTranscript } from "@/lib/content-input";
import type { OsRecord } from "@/lib/record-types";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import type { YpRenderView } from "./youtube-process-data";
import { LockedStep, stepAction, Subject, useYpBundle, YpFrame, YpSection } from "./youtube-process-frame";
import { RenderTag } from "./youtube-process-short";

const fmt = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const num = (record: OsRecord, key: string) => Number(record.metadata?.[key] ?? 0);

/** S8 쇼츠 (owner request 2026-10-21: the earlier 숏폼 편집 in this flow): the uploaded final, its subtitles, and the clips to cut. */
export function YoutubeShortsScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  const [clips, setClips] = useState<OsRecord[]>([]);
  const [src, setSrc] = useState<string | null>(null);
  const [srt, setSrt] = useState("");
  const [range, setRange] = useState<{ start: number; end: number; title: string }>({ start: 0, end: 30, title: "" });
  const [time, setTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const [send, setSend] = useState(false);
  const [moving, setMoving] = useState(false);
  const [renders, setRenders] = useState<Record<string, YpRenderView>>({});
  const [making, setMaking] = useState("");
  const [watch, setWatch] = useState<{ clipId: string; url: string } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const project = page.bundle?.project;
  const finals = useMemo(() => page.bundle?.finals ?? [], [page.bundle?.finals]);
  const last = finals.at(-1) ?? null;
  const cues = useMemo(() => parseTimedTranscript(srt), [srt]);

  const loadClips = useCallback(async () => {
    if (!project || page.demo || !page.accessToken) return;
    try { setClips((await listRecords(page.accessToken, "content_short", `parentId=${project.id}&limit=200`)).records.filter(row => !row.archived_at).sort((a, b) => num(a, "start") - num(b, "start"))); }
    catch (reason) { page.fail(reason); }
  }, [project, page]);
  useEffect(() => { void loadClips(); }, [loadClips]);
  // Each adopted clip can become a vertical short on the render PC (Codex's shortform render, PR #205): 720×1280 with the subtitles.
  const client = page.client, projectId = project?.id;
  const loadRenders = useCallback(async () => {
    if (!client || !projectId || page.demo) return;
    try { setRenders(await client.clipRenders(projectId)); } catch { /* the list still works without it */ }
  }, [client, projectId, page.demo]);
  useEffect(() => { void loadRenders(); }, [loadRenders]);
  const anyWorking = Object.values(renders).some(render => ["backlog", "in_progress"].includes(render.status));
  useEffect(() => {
    if (!anyWorking) return;
    const timer = window.setInterval(() => void loadRenders(), 15_000);
    return () => window.clearInterval(timer);
  }, [anyWorking, loadRenders]);
  const makeVertical = async (clip: OsRecord) => {
    if (!client || !projectId) return;
    setMaking(clip.id);
    try { await client.renderClip(projectId, clip.id); await loadRenders(); } catch (reason) { page.fail(reason); } finally { setMaking(""); }
  };
  const open = async (clipId: string, renderId: string, download = false) => {
    if (!client || !projectId) return;
    try { const url = await client.shortVideoUrl(projectId, renderId, download); if (download) window.location.assign(url); else setWatch({ clipId, url }); }
    catch (reason) { page.fail(reason); }
  };
  const job = useStaffJob(page, "shorts", loadClips);
  useEffect(() => {
    let active = true;
    if (!page.client || !project || !last) return;
    page.client.finalUrl(project.id, last).then(url => { if (active) setSrc(url); }, () => undefined);
    const srtUrl = last.runId && page.accessToken
      ? apiRequest<{ srt: string | null }>(`/api/v1/content/youtube-automation/myin?outputs=${last.runId}`, { token: page.accessToken }).then(result => result.srt)
      : page.bundle?.stages.upload.data.srt ? page.client.assetUrl(project.id, page.bundle.stages.upload.data.srt.path) : Promise.resolve(null);
    srtUrl.then(url => url ? fetch(url).then(response => response.text()) : "").then(text => { if (active) setSrt(text); }, () => undefined);
    return () => { active = false; };
  }, [page.client, page.accessToken, page.bundle?.stages.upload.data.srt, project, last]);

  const add = async () => {
    if (!project || !page.accessToken || range.end <= range.start) return;
    setBusy(true);
    try {
      await createRecord(page.accessToken, { recordType: "content_short", title: range.title.trim() || `쇼츠 ${fmt(range.start)}`, description: "", status: "planned", priority: "normal", parentId: project.id,
        metadata: { projectId: project.id, start: Math.round(range.start * 10) / 10, end: Math.round(range.end * 10) / 10, selected: true, renderState: "not_started" } });
      setRange(value => ({ ...value, title: "" })); await loadClips();
    } catch (reason) { page.fail(reason); } finally { setBusy(false); }
  };
  const toggle = async (clip: OsRecord) => {
    if (!page.accessToken) return;
    try { await updateRecord(page.accessToken, { id: clip.id, expectedVersion: clip.version, metadata: { ...clip.metadata, selected: clip.metadata?.selected === false } }); await loadClips(); }
    catch (reason) { page.fail(reason); }
  };
  const remove = async (clip: OsRecord) => {
    if (!page.accessToken) return;
    try { await archiveRecord(page.accessToken, clip.id); await loadClips(); } catch (reason) { page.fail(reason); }
  };
  const exportList = () => {
    const rows = clips.filter(clip => clip.metadata?.selected !== false);
    const csv = ["시작,끝,길이(초),제목,첫 문장", ...rows.map(clip => [fmt(num(clip, "start")), fmt(num(clip, "end")), Math.round(num(clip, "end") - num(clip, "start")), `"${clip.title.replace(/"/g, '""')}"`, `"${String(clip.metadata?.hook ?? clip.description ?? "").replace(/"/g, '""')}"`].join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv" })); link.download = "shorts.csv"; link.click();
  };
  const finish = async () => {
    if (!page.client || !project) return;
    setMoving(true);
    try { const next = await page.client.move(project.id, "done", project.version); page.setBundle(current => current ? { ...current, project: next } : current); }
    catch (reason) { page.fail(reason); } finally { setMoving(false); }
  };

  const reached = project && ["upload", "shorts", "done"].includes(project.yp.stage);
  const uploaded = page.bundle?.stages.upload.data.run?.status === "done";
  const action = page.bundle ? stepAction(page, 6, project?.yp.stage === "done" ? { kind: "status", status: "끝난 프로젝트" }
    : { kind: "button", label: "여기서 끝내기", reason: uploaded ? "" : "유튜브 업로드가 끝나면 마칠 수 있어요", busy: moving, onClick: () => void finish() }) : null;
  const adopted = clips.filter(clip => clip.metadata?.selected !== false);

  return <YpFrame page={page} view={6} action={action} header={header} title="쇼츠" sub="올린 롱폼에서 쇼츠로 자를 구간을 골라요. 내 AI가 자막을 읽고 구간을 제안해요.">
    {page.bundle && project ? !reached ? <LockedStep page={page} name="쇼츠" /> : <>
      <Subject page={page} />
      {page.demo ? <div className="yp-note yp-gray"><div>데모에서는 쇼츠 구간을 저장하지 않아요.</div></div> : null}
      <div className="yp-wrap2"><div>
        <YpSection n={1} title="원본 영상" gq={last ? `최종본 v${last.v} · ${last.source === "myin" ? "OS 자동 제작" : last.name}` : "최종본이 없어요"}>
          <div className="yp-player">{src ? <video ref={video} src={src} controls preload="metadata" style={{ width: "100%", display: "block", aspectRatio: "16/9", background: "var(--media-bg)" }} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} />
            : <div className="yp-frame"><div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--media-muted)" }}>{last ? "영상을 불러오는 중이에요…" : "아직 최종본이 없어요"}</div></div>}</div>
          <div className="yp-savebar" style={{ marginTop: 8 }}>
            <button type="button" className="yp-btn yp-sm" onClick={() => setRange(value => ({ ...value, start: time, end: Math.max(value.end, time + 15) }))}>지금 {fmt(time)}을 시작으로</button>
            <button type="button" className="yp-btn yp-sm" onClick={() => setRange(value => ({ ...value, end: Math.max(time, value.start + 1) }))}>지금 {fmt(time)}을 끝으로</button>
            <input className="yp-in" style={{ flex: 1, minWidth: 160 }} placeholder="쇼츠 제목 (선택)" value={range.title} maxLength={80} onChange={event => setRange(value => ({ ...value, title: event.target.value }))} aria-label="쇼츠 제목" />
            <span className="yp-tag">{fmt(range.start)} ~ {fmt(range.end)} · {Math.round(range.end - range.start)}초</span>
            <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy || page.demo || range.end <= range.start} onClick={() => void add()}><Plus size={14} /> 구간 추가</button></div>
          {range.end - range.start > 60 ? <div className="yp-errline">쇼츠는 60초 안쪽이 좋아요.</div> : null}
        </YpSection>
        <YpSection n={2} title="쇼츠 구간" gq={`${adopted.length}개 채택 · 시간 순서`} extra={<>
          <button type="button" className="yp-btn yp-sm yp-pri" disabled={page.demo || job.open || !srt} onClick={() => setSend(true)}><Sparkles size={14} /> 내 AI로 구간 제안</button>
          <button type="button" className="yp-btn yp-sm" disabled={!adopted.length} onClick={exportList}><Download size={14} /> 편집용 목록</button></>}>
          {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
          {!srt ? <p className="yp-hint">자막(SRT)이 있어야 내 AI가 구간을 제안해요. OS가 만든 영상은 자막이 자동으로 있고, 직접 올린 영상은 업로드 단계에서 SRT를 올려요.</p> : null}
          {clips.length ? <ul className="yp-hist">{clips.map(clip => <li key={clip.id} style={{ alignItems: "center" }}>
            <time><button type="button" className="yp-lnk yp-tlink" onClick={() => { if (video.current) { video.current.currentTime = num(clip, "start"); void video.current.play(); } }}>▷ {fmt(num(clip, "start"))}</button></time>
            <span style={{ flex: 1, minWidth: 0 }}><b>{clip.title}</b> <span className="yp-muted">~{fmt(num(clip, "end"))} · {Math.round(num(clip, "end") - num(clip, "start"))}초</span>
              {clip.metadata?.hook ? <><br /><span className="yp-muted" style={{ fontSize: 12 }}>첫 문장: {String(clip.metadata.hook)}</span></> : null}
              {clip.metadata?.generatedBy === "staff_ai" ? <span className="yp-aitag" style={{ marginLeft: 6 }}><Sparkles size={10} aria-hidden="true" /> AI 제안</span> : null}</span>
            {clip.metadata?.selected !== false ? <ClipRender render={renders[clip.id]} busy={making === clip.id} demo={page.demo} onMake={() => void makeVertical(clip)}
              onWatch={renderId => void open(clip.id, renderId)} onDownload={renderId => void open(clip.id, renderId, true)} /> : null}
            <button type="button" className={`yp-btn yp-sm${clip.metadata?.selected !== false ? " yp-pri" : ""}`} onClick={() => void toggle(clip)}>{clip.metadata?.selected !== false ? <><Check size={14} /> 채택</> : "채택하기"}</button>
            <button type="button" className="yp-ib" aria-label="빼기" onClick={() => void remove(clip)}><Trash2 size={14} /></button></li>)}</ul>
            : <p className="yp-pempty">아직 구간이 없어요. 영상을 보며 시작 · 끝을 정하거나 내 AI에 제안을 맡겨요.</p>}
          {watch ? <div className="yp-short-out" style={{ marginTop: 10 }}><video className="yp-vid9" src={watch.url} controls autoPlay preload="metadata" /><button type="button" className="yp-btn yp-sm" onClick={() => setWatch(null)}>닫기</button></div> : null}
          <p className="yp-hint">채택한 구간은 [세로 영상 만들기]를 누르면 렌더 PC가 자막을 넣은 720 × 1280 쇼츠로 만들어요. 편집자에게 맡길 때는 [편집용 목록]을 내려받아요.</p>
        </YpSection>
      </div>
      <aside className="yp-rside"><section className="yp-card"><div className="yp-card-h">자막 <span className="yp-gq">누르면 그 시각으로 가요</span></div><div className="yp-card-b" style={{ maxHeight: 560, overflow: "auto" }}>
        {cues.length ? cues.map(cue => <button key={`${cue.start}-${cue.text}`} type="button" className="yp-sit" style={{ width: "100%", textAlign: "left", marginBottom: 4 }}
          onClick={() => { if (video.current) video.current.currentTime = cue.start; setTime(cue.start); }}><span className="yp-tag">{fmt(cue.start)}</span><span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{cue.text}</span></button>)
          : <p className="yp-hint">{last ? "자막을 불러오는 중이거나 자막이 없어요." : "최종본이 없어요."}</p>}
      </div></section></aside></div>
      <SendDialog page={page} task="shorts" open={send} onClose={() => setSend(false)} job={job} />
    </> : null}
  </YpFrame>;
}

/** One clip's vertical short: make it, watch it while it is made, then 보기 · 내려받기 (or the reason it stopped). */
function ClipRender({ render, busy, demo, onMake, onWatch, onDownload }: { render?: YpRenderView; busy: boolean; demo: boolean; onMake: () => void; onWatch: (id: string) => void; onDownload: (id: string) => void }) {
  if (render && ["backlog", "in_progress"].includes(render.status)) return <RenderTag render={render} />;
  if (render?.status === "done") return <span className="yp-row-btns"><button type="button" className="yp-btn yp-sm" onClick={() => onWatch(render.id)}><Film size={14} /> 세로 영상 보기</button>
    <button type="button" className="yp-ib" aria-label="세로 영상 내려받기" onClick={() => onDownload(render.id)}><Download size={14} /></button></span>;
  return <span className="yp-row-btns">{render ? <RenderTag render={render} /> : null}
    <button type="button" className="yp-btn yp-sm" disabled={busy || demo} title={demo ? "데모에서는 만들지 않아요" : undefined} onClick={onMake}><Film size={14} /> {busy ? "보내는 중…" : render ? "다시 만들기" : "세로 영상 만들기"}</button></span>;
}
