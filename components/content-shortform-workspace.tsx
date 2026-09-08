"use client";

import {
  Check,
  CircleAlert,
  Download,
  Film,
  Link2,
  Pencil,
  Play,
  Plus,
  Save,
  Scissors,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { archiveRecord, createContentMediaUpload, createRecord, generateContent, getContentMediaUrl, listRecords, updateRecord, uploadContentMedia } from "@/lib/api-client";
import { parseTimedTranscript } from "@/lib/content-input";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

type ShortsTab = "editor" | "clips";

interface ShortsStyle {
  titleText: string;
  subtitleText: string;
  channelName: string;
  font: string;
  titleSize: number;
  subtitleSize: number;
  titleColor: string;
  subtitleColor: string;
  backgroundColor: string;
  position: "top" | "center" | "bottom";
  reframe: "pad" | "top" | "crop";
  captions: boolean;
  tighten: boolean;
}

const DEFAULT_STYLE: ShortsStyle = {
  titleText: "영상의 핵심을 한 문장으로",
  subtitleText: "시청자가 멈춰 볼 이유를 적어주세요",
  channelName: "브랜디액션",
  font: "Pretendard",
  titleSize: 34,
  subtitleSize: 18,
  titleColor: "#ffffff",
  subtitleColor: "#d9dce3",
  backgroundColor: "#11151b",
  position: "top",
  reframe: "pad",
  captions: true,
  tighten: false,
};

function meta<T>(record: OsRecord | null | undefined, key: string, fallback: T): T {
  const found = record?.metadata?.[key];
  return found == null ? fallback : found as T;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function videoMime(file: File) {
  if (["video/mp4", "video/quicktime", "video/x-m4v", "video/webm", "video/x-matroska"].includes(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return ({ mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", mkv: "video/x-matroska" } as Record<string, string>)[extension || ""] || "";
}

export function ContentShortformWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [sources, setSources] = useState<OsRecord[]>([]);
  const [clips, setClips] = useState<OsRecord[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [tab, setTab] = useState<ShortsTab>("editor");
  const [style, setStyle] = useState<ShortsStyle>(DEFAULT_STYLE);
  const [count, setCount] = useState(5);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState("");
  const [sourceUrlDraft, setSourceUrlDraft] = useState("");
  const [transcript, setTranscript] = useState("");
  const [savedMediaUrl, setSavedMediaUrl] = useState("");
  const previewRef = useRef<HTMLVideoElement>(null);
  const [editRange, setEditRange] = useState({ start: 0, end: 30 });
  const [editClip, setEditClip] = useState<OsRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [sourceResult, clipResult] = await Promise.all([
        listRecords(accessToken, "content_topic", "limit=200"),
        listRecords(accessToken, "content_short", "limit=200"),
      ]);
      const usable = sourceResult.records.filter((record) => !["channel", "outlier"].includes(meta<string>(record, "studioKind", "")));
      setSources(usable); setClips(clipResult.records);
      setSourceId((current) => current || new URLSearchParams(window.location.search).get("sourceId") || usable[0]?.id || "");

    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "숏폼 작업을 불러오지 못했습니다.");
    }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;
  const visible = clips.filter((clip) => clip.parent_id === sourceId);
  const selected = visible.filter((clip) => meta(clip, "selected", true));
  const finished = visible.filter((clip) => meta<string>(clip, "renderState", "") === "completed" && meta(clip, "previewUrl", ""));
  const timedCueCount = parseTimedTranscript(transcript).length;

  useEffect(() => {
    const saved = meta<Partial<ShortsStyle>>(selectedSource, "shortsStyle", {});
    setStyle({ ...DEFAULT_STYLE, ...saved });
    setSourceUrlDraft(selectedSource?.source_url ?? "");
    setTranscript(meta(selectedSource, "transcriptSrt", ""));
    setLocalFile(null);
    setLocalUrl("");
  }, [selectedSource]);

  useEffect(() => {
    let active = true; setSavedMediaUrl("");
    const path = meta<string>(selectedSource, "contentMediaPath", "");
    if (path) getContentMediaUrl(accessToken, path).then((result) => { if (active) setSavedMediaUrl(result.url); }).catch(() => { if (active) setError("저장 원본을 불러오지 못했습니다. 보관 만료 여부를 확인해 주세요."); });
    return () => { active = false; };
  }, [accessToken, selectedSource]);
  useEffect(() => { if (editClip) setEditRange({ start: Number(meta(editClip, "start", 0)), end: Number(meta(editClip, "end", 30)) }); }, [editClip]);
  const previewUrl = localUrl || savedMediaUrl || (/^https?:\/\/[^\s]+\.(mp4|webm|mov)(\?.*)?$/i.test(sourceUrlDraft) ? sourceUrlDraft : "");
  const importCaptions = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) return setError("자막 파일은 2MB 이하로 선택해 주세요.");
    const text = await file.text();
    if (!parseTimedTranscript(text).length) return setError("유효한 시간 정보가 있는 SRT/VTT 파일을 선택해 주세요.");
    setTranscript(text); setError("");
  };

  const chooseFile = (file?: File) => {
    if (localUrl) URL.revokeObjectURL(localUrl);
    if (!file) { setLocalFile(null); setLocalUrl(""); return; }
    setLocalFile(file);
    setLocalUrl(URL.createObjectURL(file));
  };

  const saveTemplate = async () => {
    if (!selectedSource) return;
    setBusy(true); setError("");
    try {
      let mediaPath = meta<string>(selectedSource, "contentMediaPath", "");
      let retentionUntil = meta<string>(selectedSource, "contentMediaRetentionUntil", "");
      if (localFile) {
        const mimeType = videoMime(localFile);
        if (!mimeType) throw new Error("MP4·MOV·M4V·WebM·MKV 영상만 원본으로 저장할 수 있습니다.");
        const signed = await createContentMediaUpload(accessToken, { sourceId: selectedSource.id, fileName: localFile.name, fileSize: localFile.size, mimeType });
        await uploadContentMedia(signed.path, signed.token, localFile);
        mediaPath = signed.path;
        retentionUntil = new Date(Date.now() + signed.retentionHours * 3_600_000).toISOString();
      }
      await updateRecord(accessToken, {
        id: selectedSource.id,
        expectedVersion: selectedSource.version,
        sourceUrl: sourceUrlDraft.trim() || null,
        metadata: { ...selectedSource.metadata, shortsStyle: style, transcriptSrt: transcript, contentMediaPath: mediaPath, contentMediaName: localFile?.name || meta(selectedSource, "contentMediaName", ""), contentMediaSize: localFile?.size || meta(selectedSource, "contentMediaSize", 0), contentMediaRetentionUntil: retentionUntil, styleUpdatedAt: new Date().toISOString() },
      });
      setLocalFile(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "숏폼 템플릿을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const openManualClip = () => {
    if (!selectedSource) return;
    setError("");
    setTab("clips");
    setEditClip({ ...selectedSource, id: "", version: 0, record_type: "content_short", parent_id: sourceId, title: `${selectedSource.title} 수동 클립`, description: "", metadata: { proposalOnly: true, selected: true, start: 0, end: 30, renderState: "not_started", ...style } });
  };

  const propose = async () => {
    if (!sourceId || !selectedSource) return;
    if (!timedCueCount) {
      openManualClip();
      return;
    }
    if (transcript !== meta(selectedSource, "transcriptSrt", "")) return setError("변경한 자막을 원본·스타일 저장으로 먼저 저장해 주세요.");
    setBusy(true); setError("");
    try {
      const response = await generateContent(accessToken, { action: "shorts_proposal", sourceId, count });
      if (response.queued) setError("Claude 연결 대기 작업으로 저장했습니다.");
      else setTab("clips");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "쇼츠 구간을 제안하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const toggle = async (clip: OsRecord) => {
    setBusy(true); setError("");
    try {
      await updateRecord(accessToken, { id: clip.id, expectedVersion: clip.version, metadata: { ...clip.metadata, selected: !meta(clip, "selected", true) } });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "클립 채택 상태를 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const saveClip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editClip) return;
    const form = new FormData(event.currentTarget);
    const start = Number(form.get("start"));
    const end = Number(form.get("end"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return setError("클립 종료 시각은 시작 시각보다 뒤여야 합니다.");
    setBusy(true); setError("");
    try {
      const changes = { title: String(form.get("title") ?? "").trim(), description: String(form.get("hook") ?? "").trim(), metadata: { ...editClip.metadata, start, end, editNote: String(form.get("note") ?? "").trim(), renderState: "not_started", previewUrl: null } };
      if (editClip.id) await updateRecord(accessToken, { id: editClip.id, expectedVersion: editClip.version, status: "review", stage: "구간제안", ...changes });
      else await createRecord(accessToken, { recordType: "content_short", status: "review", priority: "normal", stage: "구간제안", team: profile?.team || "콘텐츠", parentId: sourceId, sourceUrl: selectedSource?.source_url, tags: ["쇼츠", "수동구간"], ...changes });
      setEditClip(null); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "클립 구간을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const addManualClip = () => {
    openManualClip();
  };

  const requestRender = async () => {
    if (!selectedSource || !selected.length) return;
    const mediaPath = meta<string>(selectedSource, "contentMediaPath", "");
    if (!selectedSource.source_url && !mediaPath) return setError("원본 파일을 저장하거나 워커용 원본 URL을 입력해 주세요.");
    if (localFile) return setError("새로 선택한 원본 파일을 먼저 템플릿과 함께 저장해 주세요.");
    setBusy(true); setError("");
    try {
      for (const clip of selected) {
        await updateRecord(accessToken, { id: clip.id, expectedVersion: clip.version, status: "blocked", stage: "렌더 서버 연결 대기", progress: 25, metadata: { ...clip.metadata, ...style, renderState: "worker_not_connected", sourceUrl: selectedSource.source_url, contentMediaPath: mediaPath } });
      }
      await createRecord(accessToken, {
        recordType: "ai_job",
        title: `[숏폼 제작] ${selectedSource.title}`,
        description: `선택한 ${selected.length}개 구간의 제작 요청입니다. 렌더 서버 연결이 필요하며 아직 영상은 생성되지 않았습니다.`,
        status: "blocked",
        priority: "high",
        team: profile?.team || "콘텐츠",
        parentId: selectedSource.id,
        sourceUrl: selectedSource.source_url,
        tags: ["숏폼", "렌더", "승인완료"],
        metadata: { reason: "worker_not_connected", contentAction: "shorts_render", sourceId: selectedSource.id, clipIds: selected.map((clip) => clip.id), style, sourceUrl: selectedSource.source_url, contentMediaPath: mediaPath, deleteOriginalAfter: meta(selectedSource, "contentMediaRetentionUntil", "") },
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "숏폼 제작 작업을 등록하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const closeClipEditor = () => { if (!busy) setEditClip(null); };

  const removeClip = async (clip: OsRecord) => {
    if (!window.confirm(`“${clip.title}” 클립을 휴지통으로 이동할까요?`)) return;
    try { await archiveRecord(accessToken, clip.id); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "클립을 삭제하지 못했습니다."); }
  };

  const previewPosition = style.position === "top" ? "flex-start" : style.position === "bottom" ? "flex-end" : "center";

  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">숏폼 제작실</span><h1>숏폼 편집</h1><p>원본과 화면 스타일을 정하고 구간만 먼저 제안한 뒤, 사람이 채택한 클립만 제작 워커로 넘깁니다.</p></div><div className="header-actions"><select aria-label="기준 콘텐츠 선택" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">기준 콘텐츠 선택</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select>{timedCueCount ? <input className="clip-count-input" type="number" min="1" max="12" aria-label="제안할 클립 수" value={count} onChange={(event) => setCount(Number(event.target.value))} /> : null}<button className="primary-button" disabled={!sourceId || busy} onClick={propose}><Scissors size={15} /> {timedCueCount ? "구간 제안" : "수동 편집"}</button></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <nav className="studio-tabs content-radar-tabs" aria-label="숏폼 작업 단계"><button className={tab === "editor" ? "active" : ""} onClick={() => setTab("editor")}><strong>스타일·원본</strong><small>화면 템플릿</small></button><button className={tab === "clips" ? "active" : ""} onClick={() => setTab("clips")}><strong>클립</strong><small>구간·제작 관리</small></button></nav>

    {tab === "editor" ? <section className="shorts-editor-layout">
      <article className="panel shorts-preview-panel"><div className="panel-header"><div><h2>세로 영상 미리보기</h2><p>원본 재생과 스타일 배치를 확인합니다. 최종 렌더 결과는 별도로 확인하세요.</p></div><span className="status-pill status-ready">1080 × 1920</span></div><div className="shorts-device" style={{ backgroundColor: style.backgroundColor }}>
        {previewUrl ? <video src={previewUrl} muted controls /> : <div className="shorts-placeholder"><Film size={42} /><span>원본 영상을 선택하면 미리보기가 표시됩니다.</span></div>}
        <div className="shorts-overlay" style={{ justifyContent: previewPosition, fontFamily: style.font }}><div><strong style={{ color: style.titleColor, fontSize: `${Math.max(16, style.titleSize * .62)}px` }}>{style.titleText}</strong><span style={{ color: style.subtitleColor, fontSize: `${Math.max(10, style.subtitleSize * .62)}px` }}>{style.subtitleText}</span></div><small>{style.channelName}</small></div>
      </div></article>
      <aside className="panel shorts-style-panel"><div className="panel-header"><div><h2>스타일 템플릿</h2><p>콘텐츠별로 저장되며 모든 채택 클립에 적용됩니다.</p></div><button className="primary-button" disabled={!selectedSource || busy} onClick={saveTemplate}><Save size={14} /> {busy ? "원본 저장 중…" : "원본·스타일 저장"}</button></div><div className="shorts-source-block"><label className="file-drop"><Upload size={18} /><span><strong>{localFile?.name || meta(selectedSource, "contentMediaName", "원본 영상 선택")}</strong><small>{meta(selectedSource, "contentMediaPath", "") ? "비공개 원본 저장됨 · 업로드 후 24시간 보관" : "선택 즉시 미리보기 · 저장 시 비공개 업로드"}</small></span><input type="file" accept="video/mp4,video/quicktime,video/x-m4v,video/webm,video/x-matroska,.mkv" onChange={(event) => chooseFile(event.target.files?.[0])} /></label><label><span><Link2 size={13} /> 외부 원본 URL (선택)</span><input type="url" value={sourceUrlDraft} onChange={(event) => setSourceUrlDraft(event.target.value)} placeholder="https://… 워커가 읽을 수 있는 경로" /></label></div>{sourceUrlDraft && !previewUrl ? <p className="inline-alert warning" role="status">URL만 저장된 상태입니다. YouTube 페이지는 영상 파일이 아니어서 직접 재생·자동 전사할 수 없습니다. 원본 파일을 업로드하고 SRT/VTT 자막을 추가하거나 수동 구간으로 편집해 주세요.</p> : null}<section className="shorts-transcript"><div className="shorts-transcript-head"><span><strong>시간 자막 (SRT·VTT)</strong><small>선택 사항</small></span><div>{transcript ? <button type="button" className="ghost-button" onClick={() => { setTranscript(""); setError(""); }}>자막 비우기</button> : null}<label className="secondary-button caption-file-button"><Upload size={13} /> 파일 선택<input className="sr-only" type="file" accept=".srt,.vtt,text/vtt" onChange={(event) => { void importCaptions(event.target.files?.[0]); event.target.value = ""; }} /></label></div></div><textarea rows={6} aria-label="시간 자막 원문" value={transcript} onChange={(event) => { setTranscript(event.target.value); setError(""); }} placeholder={"00:00:00,000 --> 00:00:04,000\n자막 내용"} /><small>{timedCueCount ? `유효한 자막 ${timedCueCount}개 · 저장 후 자동 구간 제안에 사용합니다.` : "자막이 없으면 시작·종료 시간을 직접 정하는 수동 편집으로 진행합니다."}</small></section><div className="shorts-style-form"><label><span>메인 제목</span><input value={style.titleText} onChange={(event) => setStyle((current) => ({ ...current, titleText: event.target.value }))} /></label><label><span>보조 문구</span><input value={style.subtitleText} onChange={(event) => setStyle((current) => ({ ...current, subtitleText: event.target.value }))} /></label><div className="form-grid"><label><span>채널명</span><input value={style.channelName} onChange={(event) => setStyle((current) => ({ ...current, channelName: event.target.value }))} /></label><label><span>글꼴</span><select value={style.font} onChange={(event) => setStyle((current) => ({ ...current, font: event.target.value }))}><option>Pretendard</option><option>Noto Sans KR</option><option>system-ui</option></select></label></div><div className="form-grid"><label><span>제목 크기 {style.titleSize}</span><input type="range" min="22" max="58" value={style.titleSize} onChange={(event) => setStyle((current) => ({ ...current, titleSize: Number(event.target.value) }))} /></label><label><span>보조 크기 {style.subtitleSize}</span><input type="range" min="12" max="32" value={style.subtitleSize} onChange={(event) => setStyle((current) => ({ ...current, subtitleSize: Number(event.target.value) }))} /></label></div><div className="shorts-color-row"><label><span>제목</span><input type="color" value={style.titleColor} onChange={(event) => setStyle((current) => ({ ...current, titleColor: event.target.value }))} /></label><label><span>보조</span><input type="color" value={style.subtitleColor} onChange={(event) => setStyle((current) => ({ ...current, subtitleColor: event.target.value }))} /></label><label><span>배경</span><input type="color" value={style.backgroundColor} onChange={(event) => setStyle((current) => ({ ...current, backgroundColor: event.target.value }))} /></label></div><div className="form-grid"><label><span>문구 위치</span><select value={style.position} onChange={(event) => setStyle((current) => ({ ...current, position: event.target.value as ShortsStyle["position"] }))}><option value="top">상단</option><option value="center">중앙</option><option value="bottom">하단</option></select></label><label><span>세로 화면</span><select value={style.reframe} onChange={(event) => setStyle((current) => ({ ...current, reframe: event.target.value as ShortsStyle["reframe"] }))}><option value="pad">전체 보존 · 흐린 배경</option><option value="top">상단 확대 · 아래 여백</option><option value="crop">중앙 크롭 · 예외</option></select></label></div><div className="shorts-checks"><label><input type="checkbox" checked={style.captions} onChange={(event) => setStyle((current) => ({ ...current, captions: event.target.checked }))} /> 자동 자막</label><label><input type="checkbox" checked={style.tighten} onChange={(event) => setStyle((current) => ({ ...current, tighten: event.target.checked }))} /> 무음 줄이기</label></div></div></aside>
    </section> : null}

    {tab === "clips" ? <>
      <section className="panel clips-toolbar"><div><span><strong>{visible.length}</strong> 전체 클립</span><span><strong>{selected.length}</strong> 채택</span><span><strong>{finished.length}</strong> 제작 완료</span></div><div><button className="secondary-button" disabled={!sourceId || busy} onClick={addManualClip}><Plus size={14} /> 수동 구간</button><button className="primary-button" disabled={!selected.length || busy} onClick={requestRender}><Play size={14} /> 채택 {selected.length}개 제작 요청</button></div></section>
      <section className="clip-production-grid">{visible.map((clip, index) => {
        const start = Number(meta(clip, "start", 0)); const end = Number(meta(clip, "end", 0)); const picked = meta(clip, "selected", true); const preview = meta(clip, "previewUrl", "");
        return <article className={`panel clip-production-card ${picked ? "selected" : ""}`} key={clip.id}><div className="vertical-clip-preview" style={{ backgroundColor: style.backgroundColor }}>{preview ? <video src={preview} muted controls /> : <><Film size={34} /><span>CLIP {String(index + 1).padStart(2, "0")}</span></>}</div><div><header><button className={picked ? "clip-picked" : ""} onClick={() => toggle(clip)}>{picked ? <Check size={13} /> : <Plus size={13} />} {picked ? "채택" : "채택하기"}</button><span className={`status-pill status-${clip.status}`}>{clip.stage || clip.status}</span></header><h3>{clip.title}</h3><p>{clip.description}</p><div className="clip-time"><span>{formatTime(start)}</span><i /><span>{formatTime(end)}</span><em>{Math.max(0, Math.round(end - start))}초</em></div><footer><button className="ghost-button" onClick={() => setEditClip(clip)}><Pencil size={13} /> 구간·문구 수정</button>{preview ? <a className="ghost-button" href={preview} download><Download size={13} /> 다운로드</a> : <button className="ghost-button" disabled><Download size={13} /> 제작 후 다운로드</button>}<button className="ghost-button danger" onClick={() => removeClip(clip)}><Trash2 size={13} /> 삭제</button></footer></div></article>;
      })}{!visible.length ? <div className="panel compact-empty clip-empty"><Scissors size={28} /><strong>제안된 클립이 없습니다.</strong><span>구간 제안을 실행하거나 수동 구간을 추가하세요.</span></div> : null}</section>
    </> : null}

    {editClip ? <div className="drawer-backdrop" onMouseDown={() => !busy && closeClipEditor()}><form className="record-drawer" onSubmit={saveClip} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">클립 편집</span><h2>{editClip.id ? "구간·문구 수정" : "수동 구간 추가"}</h2></div><button type="button" className="icon-button" onClick={closeClipEditor}><X size={18} /></button></div>{previewUrl ? <video className="clip-trim-preview" ref={previewRef} src={previewUrl} controls onTimeUpdate={() => { const video = previewRef.current; if (video && video.currentTime >= editRange.end) video.pause(); }} /> : null}<button type="button" className="secondary-button" disabled={!previewUrl} onClick={() => { const video = previewRef.current; if (video) { video.currentTime = editRange.start; void video.play(); } }}>선택 구간 재생</button><label><span>클립 제목</span><input name="title" required defaultValue={editClip.title} /></label><label><span>첫 문장·훅</span><textarea name="hook" rows={4} defaultValue={editClip.description} /></label><div className="form-grid"><label><span>시작 초</span><input type="number" min="0" step="0.1" name="start" required value={editRange.start} onChange={(event) => setEditRange((current) => ({ ...current, start: Number(event.target.value) }))} /></label><label><span>종료 초</span><input type="number" min="0.1" step="0.1" name="end" required value={editRange.end} onChange={(event) => setEditRange((current) => ({ ...current, end: Number(event.target.value) }))} /></label></div><label><span>편집 메모</span><textarea name="note" rows={4} defaultValue={meta(editClip, "editNote", "")} placeholder="점프 컷, 자막 문구, B-roll 지시" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={closeClipEditor}>취소</button><button className="primary-button" disabled={busy}><Save size={14} /> 수정 저장</button></div></form></div> : null}
  </>;
}
