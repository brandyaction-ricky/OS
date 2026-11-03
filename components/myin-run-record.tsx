"use client";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { personName } from "@/lib/youtube-process/project";

interface RunRecord {
  startedAt: string; short: boolean; script: { version: number; paragraphs: number }; style?: { name: string; version: number } | null; earlierFinals?: number;
  voice: { model: string; reference: string; onPc: boolean; changed: { at: string; count: number } | null; check: { skipped: boolean; name: string; at: string } | null };
  words: { at: string; durationSeconds: number; words: number; lines: number; kept: boolean | null; voiceKept: boolean | null } | null;
  storyboard: { at: string; model: string; scenes: number; kept: boolean | null; review: { decision: string; name: string; at: string } | null } | null;
  photos: { file: string; from: string; url: string | null; kept: boolean | null }[];
  sound: { at: string; edited: { name: string; at: string } | null } | null;
  prepared: { at: string; sheets: number; sheetsKept: number; changed?: string[] | null } | null;
  clips: { at: string; count: number; kept: number; changed?: string[] | null; review: { name: string; at: string } | null } | null;
  final: { at: string; durationSeconds: number; bytes: number; lufs: number; peak: number; changed?: string[] | null; files: { name: string; kept: boolean }[] } | null;
}
const when = (iso: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const length = (seconds: number) => `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초`;
/** 「파일 있음」 or 「기록만」: a file the record names that storage no longer holds is never offered back. */
const Kept = ({ value }: { value: boolean | null }) => value === null ? null : <span className="status-pill" data-status={value ? "approved" : "review"}>{value ? "파일 있음" : "기록만"}</span>;
/** 재료 고정 (유쓰 요청 3/8 보완): whether a result was made from the materials the video has now; nothing for one made before they were kept. */
const Changed = ({ value }: { value?: string[] | null }) => !value ? null : <span className="status-pill" data-status={value.length ? "review" : "approved"}
  title={value.length ? "다시 만들어야 지금 재료가 들어가요" : undefined}>{value.length ? `바뀐 재료: ${value.join(" · ")}` : "지금 재료와 같아요"}</span>;

/**
 * 만든 재료 · 설정 보기 (유쓰 요청 4/8, 2026-11-02): this video's own production record in one place — the 원고 version, voice, storyboard,
 * photos, sound, previews and finished files it actually used — and whether each file is still kept. Opening it only reads.
 */
export function MyinRunRecord({ runId, token }: { runId: string; token: string | null }) {
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    setError("");
    try { setRecord(await apiRequest<RunRecord>(`/api/v1/content/youtube-automation/myin?record=${runId}`, { token })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "제작 기록을 읽지 못했어요."); }
  };
  return <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) void load(); }}>
    <summary>이 영상 제작 기록 (쓴 재료 · 설정)</summary>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : !record ? <p>불러오는 중…</p> : <dl className="yt-record">
      <dt>시작</dt><dd>{when(record.startedAt)} · {record.short ? "숏폼" : "롱폼"} · 원고 v{record.script.version} · {record.script.paragraphs}문단</dd>
      <dt>채널 모양</dt><dd>{record.style ? `${record.style.name} · v${record.style.version} (이 영상을 시작할 때 고정)` : "고르지 않음 (엔진 기본 모양)"}</dd>
      <dt>목소리</dt><dd>{record.voice.model} · 목소리 {record.voice.reference} · {record.voice.onPc ? "영상 만드는 컴퓨터가 만듦" : "OS 서버가 만듦"}
        {record.voice.changed ? ` · 최종 검토에서 ${record.voice.changed.count}곳 다시 만듦(${when(record.voice.changed.at)})` : ""}
        {record.voice.check ? ` · 음성 ${record.voice.check.skipped ? "확인 건너뜀" : "확인"} ${personName(record.voice.check.name)}` : ""}</dd>
      {record.words ? <><dt>받아쓰기 · 자막</dt><dd>{when(record.words.at)} · {length(record.words.durationSeconds)} · 단어 {record.words.words.toLocaleString("ko-KR")}개 · 자막 {record.words.lines}줄 <Kept value={record.words.kept} />
        {record.words.voiceKept !== null ? <> · 음성 파일 <Kept value={record.words.voiceKept} /></> : null}</dd></> : null}
      {record.storyboard ? <><dt>기획표</dt><dd>{when(record.storyboard.at)} · 직원 AI {record.storyboard.model} · 장면 {record.storyboard.scenes}개 <Kept value={record.storyboard.kept} />
        {record.storyboard.review ? ` · ${record.storyboard.review.decision === "confirmed" ? "확인" : "수정 요청"} ${personName(record.storyboard.review.name)} ${when(record.storyboard.review.at)}` : ""}</dd></> : null}
      {record.photos.length ? <><dt>사진 {record.photos.length}장</dt><dd><ul className="yt-list">{record.photos.map((photo) => <li key={photo.file}>{photo.file} · {photo.from}
        {photo.url ? <> · <a href={photo.url} target="_blank" rel="noreferrer">출처</a></> : null} <Kept value={photo.kept} /></li>)}</ul></dd></> : null}
      {record.sound ? <><dt>사운드</dt><dd>자동 선곡 {when(record.sound.at)}{record.sound.edited ? ` · ${personName(record.sound.edited.name)} 수정 ${when(record.sound.edited.at)}` : ""}</dd></> : null}
      {record.prepared ? <><dt>점검 시트</dt><dd>{when(record.prepared.at)} · {record.prepared.sheets}장 중 {record.prepared.sheetsKept}장 파일 있음 <Changed value={record.prepared.changed} /></dd></> : null}
      {record.clips ? <><dt>미리보기</dt><dd>{when(record.clips.at)} · {record.clips.count}개 중 {record.clips.kept}개 파일 있음{record.clips.review ? ` · 확인 ${personName(record.clips.review.name)} ${when(record.clips.review.at)}` : ""} <Changed value={record.clips.changed} /></dd></> : null}
      {record.final ? <><dt>완성</dt><dd>{when(record.final.at)} · {length(record.final.durationSeconds)} · {(record.final.bytes / 1e6).toFixed(1)}MB · 음량 {record.final.lufs} LUFS · 최대 {record.final.peak} dB <Changed value={record.final.changed} />
        <ul className="yt-list">{record.final.files.map((file) => <li key={file.name}>{file.name} <Kept value={file.kept} /></li>)}</ul>
        {record.earlierFinals ? <small>예전 완성본 {record.earlierFinals}개도 최종 검토의 버전으로 남아 있어요.</small> : null}</dd></> : null}
      <dt>엔진 버전</dt><dd>아직 기록하지 않아요. 영상 만드는 컴퓨터가 버전을 알려 주게 되면 여기에 남아요.</dd>
    </dl>}
    <p className="yt-note">이 영상에 실제로 쓴 것만 보여 줘요. 「기록만」은 파일이 지워져 다시 받을 수 없다는 뜻이에요. 「바뀐 재료」는 그 결과를 만든 뒤 바뀐 재료예요 — 다시 만들어야 들어가요. 열어 보기만 해서는 아무것도 바뀌거나 비용이 들지 않아요.</p>
  </details>;
}
