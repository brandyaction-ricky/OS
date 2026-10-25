"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Download, ExternalLink, Film, PenLine, Plus, Sparkles, Trash2, Youtube } from "lucide-react";
import { apiRequest, archiveRecord, createRecord, listRecords, updateRecord, uploadYoutubeFile } from "@/lib/api-client";
import type { ChannelConnection } from "@/lib/channel-types";
import { parseTimedTranscript } from "@/lib/content-input";
import type { OsRecord } from "@/lib/record-types";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import type { YpRenderView } from "./youtube-process-data";
import { clipConfirmed, clipParts, clipScriptProblems, clipSeconds, formatParts, parseParts } from "@/lib/youtube-process/short";
import { GateBanner, gateAction, LockedStep, ReplyForm, stepAction, Subject, useGate, useYpBundle, YpFrame, YpSection } from "./youtube-process-frame";
import { RenderTag } from "./youtube-process-short";
import { YoutubeColumnPanel } from "./youtube-process-column";

const fmt = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const num = (record: OsRecord, key: string) => Number(record.metadata?.[key] ?? 0);

/** S8 쇼츠 (owner request 2026-10-21: the earlier 숏폼 편집 in this flow): the uploaded final, its subtitles, and the clips to cut. */
export function YoutubeShortsScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  // 쇼츠 · 칼럼 (2026-10-25): the same last step holds the SEO 칼럼 written from the same 원고.
  const [tab, setTab] = useState<"shorts" | "column">(useSearchParams().get("tab") === "column" ? "column" : "shorts");
  const pick = (next: "shorts" | "column") => {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "column") params.set("tab", "column"); else params.delete("tab");
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  };
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
  // A finished clip goes up as a YouTube Short (2026-10-25): title and description from the clip, on the first connected channel.
  // 쇼츠 대본 (2026-10-25): title · first 3 seconds · the longform parts in play order · description, confirmed by the 대표 (쇼츠 컨펌).
  const [text, setText] = useState<{ id: string; title: string; hook: string; parts: string; desc: string } | null>(null);
  const [channelOwner, setChannelOwner] = useState("");
  const [sending, setSending] = useState<{ id: string; step: string } | null>(null);
  useEffect(() => {
    if (page.demo || !page.accessToken) return;
    apiRequest<{ connections: ChannelConnection[] }>("/api/v1/channels", { token: page.accessToken })
      .then(result => setChannelOwner(result.connections.find(row => row.platform === "youtube" && row.status === "connected")?.ownerId ?? ""), () => undefined);
  }, [page.demo, page.accessToken]);
  const saveText = async () => {
    const clip = clips.find(row => row.id === text?.id);
    if (!clip || !text || !page.accessToken) return;
    const parts = parseParts(text.parts);
    if (!parts) { page.setError("구간은 05:30-05:36, 02:10-02:50처럼 시작-끝을 쉼표로 나눠 써 주세요."); return; }
    try {
      await updateRecord(page.accessToken, { id: clip.id, expectedVersion: clip.version, title: text.title.trim() || clip.title,
        metadata: { ...clip.metadata, hook: text.hook.trim(), desc: text.desc, segments: parts, start: parts[0].start, end: parts[0].end } });
      setText(null); await loadClips();
    } catch (reason) { page.fail(reason); }
  };
  const publish = async (clip: OsRecord, renderId: string) => {
    if (!client || !projectId || !page.accessToken) return;
    const owner = channelOwner ? { connectionOwnerId: channelOwner } : {};
    const send = (body: Record<string, unknown>) => apiRequest<{ uploadUrl?: string }>(`/api/v1/content/youtube/projects/${projectId}/upload`, { token: page.accessToken, method: "POST", body: JSON.stringify({ ...body, clipId: clip.id, ...owner }) });
    setSending({ id: clip.id, step: "영상을 준비하는 중" }); page.setError("");
    try {
      const response = await fetch(await client.shortVideoUrl(projectId, renderId));
      if (!response.ok) throw new Error("세로 영상을 불러오지 못했어요.");
      const file = new File([await response.blob()], "short.mp4", { type: "video/mp4" });
      const session = await send({ action: "clip-session", fileName: file.name, fileSize: file.size, mimeType: file.type });
      const video = await uploadYoutubeFile(session.uploadUrl!, file, percent => setSending({ id: clip.id, step: `유튜브로 보내는 중 ${percent}%` }));
      setSending({ id: clip.id, step: "결과를 기록하는 중" });
      await send({ action: "clip-complete", videoId: video.id });
      await loadClips();
    } catch (reason) { page.fail(reason); } finally { setSending(null); }
  };
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
    const csv = ["구간,길이(초),제목,첫 문장", ...rows.map(clip => [`"${formatParts(clipParts(clip.metadata))}"`, Math.round(clipSeconds(clipParts(clip.metadata))), `"${clip.title.replace(/"/g, '""')}"`, `"${String(clip.metadata?.hook ?? clip.description ?? "").replace(/"/g, '""')}"`].join(","))].join("\n");
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
  const adopted = clips.filter(clip => clip.metadata?.selected !== false);
  // 쇼츠 컨펌: picked scripts not yet confirmed (or changed since) go to the 대표 before anything is made; while it waits nothing changes.
  const control = useGate(page, "shorts");
  const shortsGate = project?.yp.gates.shorts;
  const waiting = shortsGate?.state === "wait";
  const confirmedOf = (clip: OsRecord) => clipConfirmed(project?.yp.shortsConfirmed, shortsGate?.state === "ok", clip);
  const needConfirm = adopted.some(clip => !confirmedOf(clip));
  const unfinished = adopted.find(clip => clipScriptProblems(clip).length);
  const shortsMissing = !adopted.length ? "쇼츠로 만들 대본을 채택해 주세요" : unfinished ? `대본을 채워 주세요 — ${unfinished.title || "제목 없음"}: ${clipScriptProblems(unfinished).join(", ")}` : "";
  const action = !page.bundle ? null : project?.yp.stage === "done" ? stepAction(page, 6, { kind: "status", status: "끝난 프로젝트" })
    : waiting || needConfirm ? gateAction(page, "shorts", 6, control, shortsMissing)
    : stepAction(page, 6, { kind: "button", label: "여기서 끝내기", reason: uploaded ? "" : "유튜브 업로드가 끝나면 마칠 수 있어요", busy: moving, onClick: () => void finish() });

  return <YpFrame page={page} view={6} action={action} header={header} title="쇼츠 · 칼럼" sub={tab === "column" ? "구성안 원고로 검색용 SEO 칼럼을 만들어요. 내 AI가 쓰고, 이미지를 넣어 내보내요." : "내 AI가 쇼츠 대본을 쓰고, 고른 대본은 대표 쇼츠 컨펌을 받은 뒤 세로 영상으로 만들어 올려요."}>
    {page.bundle && project ? !reached ? <LockedStep page={page} name="쇼츠 · 칼럼" /> : <>
      <Subject page={page} />
      <div className="yp-ftabs yp-two" role="tablist" aria-label="쇼츠 · 칼럼" style={{ padding: "0 0 10px" }}>
        <button type="button" role="tab" aria-selected={tab === "shorts"} className={tab === "shorts" ? "yp-on" : ""} onClick={() => pick("shorts")}>쇼츠 대본 <b>{adopted.length}</b></button>
        <button type="button" role="tab" aria-selected={tab === "column"} className={tab === "column" ? "yp-on" : ""} onClick={() => pick("column")}>SEO 칼럼{page.bundle.stages.column.data.items.length ? <b>{page.bundle.stages.column.data.items.length}</b> : null}</button>
      </div>
      {tab === "column" ? <YoutubeColumnPanel page={page} /> : <>
      {page.demo ? <div className="yp-note yp-gray"><div>데모에서는 쇼츠 구간을 저장하지 않아요.</div></div> : null}
      {shortsGate && shortsGate.state !== "none" ? <GateBanner page={page} gate="shorts" okExtra={needConfirm && !waiting ? <> · 컨펌 뒤 새로 고르거나 바뀐 대본이 있어요. 다시 컨펌을 요청해요.</> : null} /> : null}
      <ReplyForm control={control} />
      <div className="yp-wrap2"><div>
        <YpSection n={1} title="원본 영상" gq={last ? `최종본 v${last.v} · ${last.source === "myin" ? "OS 자동 제작" : last.name}` : "최종본이 없어요"}>
          <div className="yp-player">{src ? <video ref={video} src={src} controls preload="metadata" style={{ width: "100%", display: "block", aspectRatio: "16/9", background: "var(--media-bg)" }} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} />
            : <div className="yp-frame"><div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--media-muted)" }}>{last ? "영상을 불러오는 중이에요…" : "아직 최종본이 없어요"}</div></div>}</div>
          <div className="yp-savebar" style={{ marginTop: 8 }}>
            <button type="button" className="yp-btn yp-sm" onClick={() => setRange(value => ({ ...value, start: time, end: Math.max(value.end, time + 15) }))}>지금 {fmt(time)}을 시작으로</button>
            <button type="button" className="yp-btn yp-sm" onClick={() => setRange(value => ({ ...value, end: Math.max(time, value.start + 1) }))}>지금 {fmt(time)}을 끝으로</button>
            <input className="yp-in" style={{ flex: 1, minWidth: 160 }} placeholder="쇼츠 제목 (선택)" value={range.title} maxLength={80} onChange={event => setRange(value => ({ ...value, title: event.target.value }))} aria-label="쇼츠 제목" />
            <span className="yp-tag">{fmt(range.start)} ~ {fmt(range.end)} · {Math.round(range.end - range.start)}초</span>
            <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy || page.demo || waiting || range.end <= range.start} onClick={() => void add()}><Plus size={14} /> 구간 추가</button></div>
          {range.end - range.start > 60 ? <div className="yp-errline">쇼츠는 60초 안쪽이 좋아요.</div> : null}
        </YpSection>
        <YpSection n={2} title="쇼츠 대본" gq={`${adopted.length}편 채택 · 컨펌 OK ${adopted.filter(confirmedOf).length}편`} extra={<>
          <button type="button" className="yp-btn yp-sm yp-pri" disabled={page.demo || job.open || !srt} onClick={() => setSend(true)}><Sparkles size={14} /> 내 AI로 대본 쓰기</button>
          <button type="button" className="yp-btn yp-sm" disabled={!adopted.length} onClick={exportList}><Download size={14} /> 편집용 목록</button></>}>
          {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
          {!srt ? <p className="yp-hint">자막(SRT)이 있어야 내 AI가 구간을 제안해요. OS가 만든 영상은 자막이 자동으로 있고, 직접 올린 영상은 업로드 단계에서 SRT를 올려요.</p> : null}
          {clips.length ? <ul className="yp-hist">{clips.map(clip => <li key={clip.id} style={{ alignItems: "center", flexWrap: "wrap" }}>
            <time><button type="button" className="yp-lnk yp-tlink" onClick={() => { if (video.current) { video.current.currentTime = clipParts(clip.metadata)[0].start; void video.current.play(); } }}>▷ {fmt(clipParts(clip.metadata)[0].start)}</button></time>
            {/* The title keeps a readable width; the buttons wrap under it on a narrow screen. */}
            <span style={{ flex: "1 1 220px", minWidth: 0 }}><b>{clip.title}</b> <span className="yp-muted">{formatParts(clipParts(clip.metadata))} · {Math.round(clipSeconds(clipParts(clip.metadata)))}초</span>
              {clip.metadata?.kind ? <span className="yp-tag" style={{ marginLeft: 6 }}>{String(clip.metadata.kind)}</span> : null}
              {clip.metadata?.selected !== false ? confirmedOf(clip) ? <span className="yp-tag yp-ok" style={{ marginLeft: 6 }}>컨펌 OK</span>
                : project?.yp.shortsConfirmed?.clips[clip.id] ? <span className="yp-tag yp-warn" style={{ marginLeft: 6 }}>컨펌 뒤 바뀜</span> : <span className="yp-tag" style={{ marginLeft: 6 }}>컨펌 전</span> : null}
              {clip.metadata?.hook ? <><br /><span className="yp-muted" style={{ fontSize: 12 }}>첫 3초: {String(clip.metadata.hook)}</span></> : null}
              {clip.metadata?.generatedBy === "staff_ai" ? <span className="yp-aitag" style={{ marginLeft: 6 }}><Sparkles size={10} aria-hidden="true" /> AI 제안</span> : null}
              {clip.metadata?.desc ? <><br /><span className="yp-muted" style={{ fontSize: 12, whiteSpace: "pre-line" }}>설명: {String(clip.metadata.desc)}</span></> : null}</span>
            {clip.metadata?.selected !== false ? <ClipRender render={renders[clip.id]} busy={making === clip.id} demo={page.demo} confirmed={confirmedOf(clip)} onMake={() => void makeVertical(clip)}
              onWatch={renderId => void open(clip.id, renderId)} onDownload={renderId => void open(clip.id, renderId, true)} /> : null}
            {clip.metadata?.selected !== false ? <ClipPublish clip={clip} render={renders[clip.id]} longformUp={uploaded} confirmed={confirmedOf(clip)} sending={sending?.id === clip.id ? sending.step : sending ? "다른 쇼츠를 올리는 중" : ""}
              demo={page.demo} onPublish={renderId => void publish(clip, renderId)} /> : null}
            <button type="button" className="yp-btn yp-sm" disabled={waiting} title={waiting ? "쇼츠 컨펌을 기다리는 동안은 고칠 수 없어요" : undefined}
              onClick={() => setText({ id: clip.id, title: clip.title, hook: String(clip.metadata?.hook ?? ""), parts: formatParts(clipParts(clip.metadata)), desc: String(clip.metadata?.desc ?? "") })}><PenLine size={14} /> 대본 고치기</button>
            {text?.id === clip.id ? <div style={{ flex: "1 1 100%", display: "grid", gap: 6, marginTop: 6 }}>
              <label className="yp-lbl" style={{ margin: 0 }}>제목 <span className="yp-gq">썸네일 한 줄 카피 · 유튜브 쇼츠 제목</span><input className="yp-in" value={text.title} maxLength={100} aria-label="쇼츠 제목" onChange={event => setText({ ...text, title: event.target.value })} /></label>
              <label className="yp-lbl" style={{ margin: 0 }}>첫 3초 <span className="yp-gq">첫 구간에서 들리는 첫 문장</span><input className="yp-in" value={text.hook} maxLength={200} aria-label="첫 3초" onChange={event => setText({ ...text, hook: event.target.value })} /></label>
              <label className="yp-lbl" style={{ margin: 0 }}>구간 <span className="yp-gq">재생 순서대로 4개까지, 합계 60초 이내 · 예) 05:30-05:36, 02:10-02:50</span><input className="yp-in" value={text.parts} aria-label="구간" onChange={event => setText({ ...text, parts: event.target.value })} /></label>
              <textarea className="yp-in" rows={4} value={text.desc} maxLength={1000} aria-label="쇼츠 설명" placeholder={"이 구간이 답하는 질문 · 핵심 한두 줄\n#해시태그 3~5개 (전체 영상 링크는 OS가 붙여요)"} onChange={event => setText({ ...text, desc: event.target.value })} />
              <div className="yp-savebar"><span className="yp-sp" /><button type="button" className="yp-btn yp-sm" onClick={() => setText(null)}>취소</button><button type="button" className="yp-btn yp-sm yp-pri" onClick={() => void saveText()}>저장</button></div>
            </div> : null}
            <button type="button" className={`yp-btn yp-sm${clip.metadata?.selected !== false ? " yp-pri" : ""}`} disabled={waiting} onClick={() => void toggle(clip)}>{clip.metadata?.selected !== false ? <><Check size={14} /> 채택</> : "채택하기"}</button>
            <button type="button" className="yp-ib" aria-label="빼기" disabled={waiting} onClick={() => void remove(clip)}><Trash2 size={14} /></button></li>)}</ul>
            : <p className="yp-pempty">아직 구간이 없어요. 영상을 보며 시작 · 끝을 정하거나 내 AI에 제안을 맡겨요.</p>}
          {watch ? <div className="yp-short-out" style={{ marginTop: 10 }}><video className="yp-vid9" src={watch.url} controls autoPlay preload="metadata" /><button type="button" className="yp-btn yp-sm" onClick={() => setWatch(null)}>닫기</button></div> : null}
          <p className="yp-hint">대본을 채택하고 [쇼츠 컨펌 요청]을 누르면 대표 메뉴 › 컨펌으로 가요. OK가 난 대본은 [세로 영상 만들기]로 렌더 PC가 구간을 이어 붙인 720 × 1280 쇼츠를 만들고, [유튜브에 올리기]로 올려요(업로드 단계의 공개 범위, 설명 끝에 전체 영상 링크). OK 뒤에 대본을 고치면 다시 컨펌을 받아요. 편집자에게 맡길 때는 [편집용 목록]을 내려받아요.</p>
        </YpSection>
      </div>
      <aside className="yp-rside"><section className="yp-card"><div className="yp-card-h">자막 <span className="yp-gq">누르면 그 시각으로 가요</span></div><div className="yp-card-b" style={{ maxHeight: 560, overflow: "auto" }}>
        {cues.length ? cues.map(cue => <button key={`${cue.start}-${cue.text}`} type="button" className="yp-sit" style={{ width: "100%", textAlign: "left", marginBottom: 4 }}
          onClick={() => { if (video.current) video.current.currentTime = cue.start; setTime(cue.start); }}><span className="yp-tag">{fmt(cue.start)}</span><span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{cue.text}</span></button>)
          : <p className="yp-hint">{last ? "자막을 불러오는 중이거나 자막이 없어요." : "최종본이 없어요."}</p>}
      </div></section></aside></div>
      <SendDialog page={page} task="shorts" open={send} onClose={() => setSend(false)} job={job} />
      </>}
    </> : null}
  </YpFrame>;
}

/** After the vertical video: [유튜브에 올리기] once the longform is up and the script is confirmed (or the Short's link once it is up). */
function ClipPublish({ clip, render, longformUp, confirmed, sending, demo, onPublish }: { clip: OsRecord; render?: YpRenderView; longformUp: boolean; confirmed: boolean; sending: string; demo: boolean; onPublish: (renderId: string) => void }) {
  const youtube = clip.metadata?.youtube as { videoUrl?: string } | undefined;
  if (youtube?.videoUrl) return <a className="yp-btn yp-sm" href={youtube.videoUrl} target="_blank" rel="noreferrer"><Youtube size={14} /> 올린 쇼츠 <ExternalLink size={12} /></a>;
  if (render?.status !== "done") return null;
  const missing = !confirmed ? "쇼츠 컨펌 OK 뒤에 올려요" : !clip.metadata?.desc ? "설명을 채워 주세요" : !longformUp ? "롱폼을 먼저 유튜브에 올려요" : demo ? "데모에서는 올리지 않아요" : "";
  return <span className="yp-row-btns">
    <button type="button" className="yp-btn yp-sm" disabled={Boolean(missing || sending)} title={missing || undefined} onClick={() => onPublish(render.id)}><Youtube size={14} /> {sending || "유튜브에 올리기"}</button>
  </span>;
}

/** One clip's vertical short: make it, watch it while it is made, then 보기 · 내려받기 (or the reason it stopped). */
function ClipRender({ render, busy, demo, confirmed, onMake, onWatch, onDownload }: { render?: YpRenderView; busy: boolean; demo: boolean; confirmed: boolean; onMake: () => void; onWatch: (id: string) => void; onDownload: (id: string) => void }) {
  if (render && ["backlog", "in_progress"].includes(render.status)) return <RenderTag render={render} />;
  if (render?.status === "done") return <span className="yp-row-btns"><button type="button" className="yp-btn yp-sm" onClick={() => onWatch(render.id)}><Film size={14} /> 세로 영상 보기</button>
    <button type="button" className="yp-ib" aria-label="세로 영상 내려받기" onClick={() => onDownload(render.id)}><Download size={14} /></button></span>;
  return <span className="yp-row-btns">{render ? <RenderTag render={render} /> : null}
    <button type="button" className="yp-btn yp-sm" disabled={busy || demo || !confirmed} title={demo ? "데모에서는 만들지 않아요" : !confirmed ? "쇼츠 컨펌 OK 뒤에 만들어요" : undefined} onClick={onMake}><Film size={14} /> {busy ? "보내는 중…" : render ? "다시 만들기" : "세로 영상 만들기"}</button></span>;
}
