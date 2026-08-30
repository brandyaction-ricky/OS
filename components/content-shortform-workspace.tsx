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
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { createContentMediaUpload, createRecord, generateContent, listRecords, updateRecord, uploadContentMedia } from "@/lib/api-client";
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
  accentColor: string;
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
  accentColor: "#ff6b4a",
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
      setSourceId((current) => current || usable[0]?.id || "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "숏폼 작업을 불러오지 못했습니다.");
    }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;
  const visible = clips.filter((clip) => clip.parent_id === sourceId);
  const selected = visible.filter((clip) => meta(clip, "selected", true));
  const finished = visible.filter((clip) => ["ready", "published"].includes(clip.status));

  useEffect(() => {
    const saved = meta<Partial<ShortsStyle>>(selectedSource, "shortsStyle", {});
    setStyle({ ...DEFAULT_STYLE, ...saved });
    setSourceUrlDraft(selectedSource?.source_url ?? "");
    setLocalFile(null);
    setLocalUrl("");
  }, [selectedSource]);

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
        metadata: { ...selectedSource.metadata, shortsStyle: style, contentMediaPath: mediaPath, contentMediaName: localFile?.name || meta(selectedSource, "contentMediaName", ""), contentMediaSize: localFile?.size || meta(selectedSource, "contentMediaSize", 0), contentMediaRetentionUntil: retentionUntil, styleUpdatedAt: new Date().toISOString() },
      });
      setLocalFile(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "숏폼 템플릿을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const propose = async () => {
    if (!sourceId) return;
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
    if (end <= start) return setError("클립 종료 시각은 시작 시각보다 뒤여야 합니다.");
    setBusy(true); setError("");
    try {
      await updateRecord(accessToken, {
        id: editClip.id,
        expectedVersion: editClip.version,
        title: String(form.get("title") ?? "").trim(),
        description: String(form.get("hook") ?? "").trim(),
        metadata: { ...editClip.metadata, start, end, editNote: String(form.get("note") ?? "").trim() },
      });
      setEditClip(null); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "클립 구간을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const addManualClip = async () => {
    if (!selectedSource) return;
    setBusy(true); setError("");
    try {
      const { record } = await createRecord(accessToken, {
        recordType: "content_short",
        title: `${selectedSource.title} 수동 클립`,
        description: "수동으로 추가한 구간",
        status: "review",
        priority: "normal",
        stage: "구간제안",
        team: profile?.team || "콘텐츠",
        parentId: selectedSource.id,
        sourceUrl: selectedSource.source_url,
        tags: ["쇼츠", "수동구간"],
        metadata: { proposalOnly: true, selected: true, start: 0, end: 30, renderState: "not_started", ...style },
      });
      setEditClip(record); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "수동 구간을 추가하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const requestRender = async () => {
    if (!selectedSource || !selected.length) return;
    const mediaPath = meta<string>(selectedSource, "contentMediaPath", "");
    if (!selectedSource.source_url && !mediaPath) return setError("원본 파일을 저장하거나 워커용 원본 URL을 입력해 주세요.");
    if (localFile) return setError("새로 선택한 원본 파일을 먼저 템플릿과 함께 저장해 주세요.");
    setBusy(true); setError("");
    try {
      for (const clip of selected) {
        await updateRecord(accessToken, { id: clip.id, expectedVersion: clip.version, status: "ready", stage: "제작대기", progress: 45, metadata: { ...clip.metadata, ...style, renderState: "queued", sourceUrl: selectedSource.source_url, contentMediaPath: mediaPath } });
      }
      await createRecord(accessToken, {
        recordType: "ai_job",
        title: `[숏폼 제작] ${selectedSource.title}`,
        description: `승인한 ${selected.length}개 구간을 영상 워커에서 제작합니다. 원본은 서버 저장 경로 또는 외부 원본 URL로 전달됩니다.`,
        status: "backlog",
        priority: "high",
        team: profile?.team || "콘텐츠",
        parentId: selectedSource.id,
        sourceUrl: selectedSource.source_url,
        tags: ["숏폼", "렌더", "승인완료"],
        metadata: { contentAction: "shorts_render", sourceId: selectedSource.id, clipIds: selected.map((clip) => clip.id), style, sourceUrl: selectedSource.source_url, contentMediaPath: mediaPath, deleteOriginalAfter: meta(selectedSource, "contentMediaRetentionUntil", "") },
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "숏폼 제작 작업을 등록하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const previewPosition = style.position === "top" ? "flex-start" : style.position === "bottom" ? "flex-end" : "center";

  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">숏폼 제작실</span><h1>숏폼 편집</h1><p>원본과 화면 스타일을 정하고 구간만 먼저 제안한 뒤, 사람이 채택한 클립만 제작 워커로 넘깁니다.</p></div><div className="header-actions"><select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">기준 콘텐츠 선택</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select><input className="clip-count-input" type="number" min="1" max="12" aria-label="제안할 클립 수" value={count} onChange={(event) => setCount(Number(event.target.value))} /><button className="primary-button" disabled={!sourceId || busy} onClick={propose}><Scissors size={15} /> 구간 제안</button></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <nav className="studio-tabs content-radar-tabs" aria-label="숏폼 작업 단계"><button className={tab === "editor" ? "active" : ""} onClick={() => setTab("editor")}><strong>스타일·원본</strong><small>화면 템플릿</small></button><button className={tab === "clips" ? "active" : ""} onClick={() => setTab("clips")}><strong>클립</strong><small>구간·제작 관리</small></button></nav>

    {tab === "editor" ? <section className="shorts-editor-layout">
      <article className="panel shorts-preview-panel"><div className="panel-header"><div><h2>세로 영상 미리보기</h2><p>9:16 출력 화면 · 원본 파일은 이 브라우저 안에서만 미리봅니다.</p></div><span className="status-pill status-ready">1080 × 1920</span></div><div className="shorts-device" style={{ backgroundColor: style.backgroundColor }}>
        {localUrl ? <video src={localUrl} muted controls /> : <div className="shorts-placeholder"><Film size={42} /><span>원본 영상을 선택하면 미리보기가 표시됩니다.</span></div>}
        <div className="shorts-overlay" style={{ justifyContent: previewPosition, fontFamily: style.font }}><div><i style={{ backgroundColor: style.accentColor }} /><strong style={{ color: style.titleColor, fontSize: `${Math.max(16, style.titleSize * .62)}px` }}>{style.titleText}</strong><span style={{ color: style.subtitleColor, fontSize: `${Math.max(10, style.subtitleSize * .62)}px` }}>{style.subtitleText}</span></div><small>{style.channelName}</small></div>
      </div></article>
      <aside className="panel shorts-style-panel"><div className="panel-header"><div><h2>스타일 템플릿</h2><p>콘텐츠별로 저장되며 모든 채택 클립에 적용됩니다.</p></div><button className="primary-button" disabled={!selectedSource || busy} onClick={saveTemplate}><Save size={14} /> {busy ? "원본 저장 중…" : "원본·스타일 저장"}</button></div><div className="shorts-source-block"><label className="file-drop"><Upload size={18} /><span><strong>{localFile?.name || meta(selectedSource, "contentMediaName", "원본 영상 선택")}</strong><small>{meta(selectedSource, "contentMediaPath", "") ? "비공개 원본 저장됨 · 제작 후 24시간 보관" : "선택 즉시 미리보기 · 저장 시 비공개 업로드"}</small></span><input type="file" accept="video/mp4,video/quicktime,video/x-m4v,video/webm,video/x-matroska,.mkv" onChange={(event) => chooseFile(event.target.files?.[0])} /></label><label><span><Link2 size={13} /> 외부 원본 URL (선택)</span><input type="url" value={sourceUrlDraft} onChange={(event) => setSourceUrlDraft(event.target.value)} placeholder="https://… 워커가 읽을 수 있는 경로" /></label></div><div className="shorts-style-form"><label><span>메인 제목</span><input value={style.titleText} onChange={(event) => setStyle((current) => ({ ...current, titleText: event.target.value }))} /></label><label><span>보조 문구</span><input value={style.subtitleText} onChange={(event) => setStyle((current) => ({ ...current, subtitleText: event.target.value }))} /></label><div className="form-grid"><label><span>채널명</span><input value={style.channelName} onChange={(event) => setStyle((current) => ({ ...current, channelName: event.target.value }))} /></label><label><span>글꼴</span><select value={style.font} onChange={(event) => setStyle((current) => ({ ...current, font: event.target.value }))}><option>Pretendard</option><option>Noto Sans KR</option><option>system-ui</option></select></label></div><div className="form-grid"><label><span>제목 크기 {style.titleSize}</span><input type="range" min="22" max="58" value={style.titleSize} onChange={(event) => setStyle((current) => ({ ...current, titleSize: Number(event.target.value) }))} /></label><label><span>보조 크기 {style.subtitleSize}</span><input type="range" min="12" max="32" value={style.subtitleSize} onChange={(event) => setStyle((current) => ({ ...current, subtitleSize: Number(event.target.value) }))} /></label></div><div className="shorts-color-row"><label><span>제목</span><input type="color" value={style.titleColor} onChange={(event) => setStyle((current) => ({ ...current, titleColor: event.target.value }))} /></label><label><span>보조</span><input type="color" value={style.subtitleColor} onChange={(event) => setStyle((current) => ({ ...current, subtitleColor: event.target.value }))} /></label><label><span>강조</span><input type="color" value={style.accentColor} onChange={(event) => setStyle((current) => ({ ...current, accentColor: event.target.value }))} /></label><label><span>배경</span><input type="color" value={style.backgroundColor} onChange={(event) => setStyle((current) => ({ ...current, backgroundColor: event.target.value }))} /></label></div><div className="form-grid"><label><span>문구 위치</span><select value={style.position} onChange={(event) => setStyle((current) => ({ ...current, position: event.target.value as ShortsStyle["position"] }))}><option value="top">상단</option><option value="center">중앙</option><option value="bottom">하단</option></select></label><label><span>세로 화면</span><select value={style.reframe} onChange={(event) => setStyle((current) => ({ ...current, reframe: event.target.value as ShortsStyle["reframe"] }))}><option value="pad">전체 보존 · 흐린 배경</option><option value="top">상단 확대 · 아래 여백</option><option value="crop">중앙 크롭 · 예외</option></select></label></div><div className="shorts-checks"><label><input type="checkbox" checked={style.captions} onChange={(event) => setStyle((current) => ({ ...current, captions: event.target.checked }))} /> 자동 자막</label><label><input type="checkbox" checked={style.tighten} onChange={(event) => setStyle((current) => ({ ...current, tighten: event.target.checked }))} /> 무음 줄이기</label></div></div></aside>
    </section> : null}

    {tab === "clips" ? <>
      <section className="panel clips-toolbar"><div><span><strong>{visible.length}</strong> 전체 클립</span><span><strong>{selected.length}</strong> 채택</span><span><strong>{finished.length}</strong> 제작 대기·완료</span></div><div><button className="secondary-button" disabled={!sourceId || busy} onClick={addManualClip}><Plus size={14} /> 수동 구간</button><button className="primary-button" disabled={!selected.length || busy} onClick={requestRender}><Play size={14} /> 채택 {selected.length}개 제작 요청</button></div></section>
      <section className="clip-production-grid">{visible.map((clip, index) => {
        const start = Number(meta(clip, "start", 0)); const end = Number(meta(clip, "end", 0)); const picked = meta(clip, "selected", true); const preview = meta(clip, "previewUrl", "");
        return <article className={`panel clip-production-card ${picked ? "selected" : ""}`} key={clip.id}><div className="vertical-clip-preview" style={{ backgroundColor: style.backgroundColor }}>{preview ? <video src={preview} muted /> : <><Film size={34} /><span>CLIP {String(index + 1).padStart(2, "0")}</span></>}<button aria-label="미리보기"><Play size={16} /></button></div><div><header><button className={picked ? "clip-picked" : ""} onClick={() => toggle(clip)}>{picked ? <Check size={13} /> : <Plus size={13} />} {picked ? "채택" : "채택하기"}</button><span className={`status-pill status-${clip.status}`}>{clip.stage || clip.status}</span></header><h3>{clip.title}</h3><p>{clip.description}</p><div className="clip-time"><span>{formatTime(start)}</span><i /><span>{formatTime(end)}</span><em>{Math.max(0, Math.round(end - start))}초</em></div><footer><button className="ghost-button" onClick={() => setEditClip(clip)}><Pencil size={13} /> 구간·문구 수정</button>{preview ? <a className="ghost-button" href={preview} download><Download size={13} /> 다운로드</a> : <button className="ghost-button" disabled><Download size={13} /> 제작 후 다운로드</button>}</footer></div></article>;
      })}{!visible.length ? <div className="panel compact-empty clip-empty"><Scissors size={28} /><strong>제안된 클립이 없습니다.</strong><span>구간 제안을 실행하거나 수동 구간을 추가하세요.</span></div> : null}</section>
    </> : null}

    {editClip ? <div className="drawer-backdrop" onMouseDown={() => !busy && setEditClip(null)}><form className="record-drawer" onSubmit={saveClip} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">클립 편집</span><h2>구간·문구 수정</h2></div><button type="button" className="icon-button" onClick={() => setEditClip(null)}><X size={18} /></button></div><label><span>클립 제목</span><input name="title" required defaultValue={editClip.title} /></label><label><span>첫 문장·훅</span><textarea name="hook" rows={4} defaultValue={editClip.description} /></label><div className="form-grid"><label><span>시작 초</span><input type="number" min="0" step="0.1" name="start" defaultValue={Number(meta(editClip, "start", 0))} /></label><label><span>종료 초</span><input type="number" min="0.1" step="0.1" name="end" defaultValue={Number(meta(editClip, "end", 30))} /></label></div><label><span>편집 메모</span><textarea name="note" rows={4} defaultValue={meta(editClip, "editNote", "")} placeholder="점프 컷, 강조 자막, B-roll 지시" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setEditClip(null)}>취소</button><button className="primary-button" disabled={busy}><Save size={14} /> 수정 저장</button></div></form></div> : null}
  </>;
}
