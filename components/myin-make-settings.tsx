"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { LocalRenderStatus } from "@/lib/myin-local";
import { CostTag } from "./cost-notice";
import { DraftPlacePicker, type DraftPlace } from "./myin-local-render";
import { EarlierStylePick } from "./myin-run-record";
import { ago, sinceIso, type StaffJobStatus } from "./youtube-production-steps";

// 제작 설정 (직원 요청 2026-11-05): 채널 모양, 기획표를 쓰는 AI, 만드는 곳, GPT 화면 검사를 영상을 시작할 때 한 번 정한다. 단계 사이에는
// 다시 묻지 않고, 바꾸면 그다음 단계부터 따른다. 새 영상은 이 브라우저에서 지난번에 고른 값으로 시작한다.
export interface MakeSettings { place: DraftPlace; screenCheck: boolean }
export interface RunSettings extends MakeSettings { name: string }
const KEY = "myin-make-settings";
export function lastSettings(): MakeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MakeSettings> | null;
    return { place: saved?.place === "local" ? "local" : "pc", screenCheck: saved?.screenCheck !== false };
  } catch { return { place: "pc", screenCheck: true }; }
}
export function rememberSettings(settings: MakeSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private window: next video starts from the defaults */ }
}

/** Where the next steps are made, as the screen says it: a staff computer only for a longform whose voice was left for staff Macs. */
export function placeName(settings: RunSettings | null | undefined, run: { localReady: boolean; layout?: string | null } | null) {
  if (settings?.place !== "local" || run?.layout) return "영상 만드는 컴퓨터";
  return run && !run.localReady ? "영상 만드는 컴퓨터 (이 영상은 내 컴퓨터용 음성이 없어요)" : `${settings.name}님 컴퓨터`;
}

type Style = { id: string; name: string; version: number };
export function MyinMakeSettings({ sourceId, token, short, run, fresh, editing, onEditing, styles, styleId, onStyle, value, onChange, localPc, onLocalConnected, onSaved }: {
  sourceId: string; token: string | null; short: boolean;
  run: { id: string; localReady: boolean; layout?: string | null; settings?: RunSettings | null; style?: { name: string; version: number } | null } | null;
  /** No video yet (or a changed script): the card is the first thing to fill in and the start button takes it. */ fresh: boolean;
  editing: boolean; onEditing: (open: boolean) => void;
  styles: Style[]; styleId: string; onStyle: (id: string) => void;
  value: MakeSettings; onChange: (value: MakeSettings) => void;
  localPc: LocalRenderStatus | null; onLocalConnected: () => void; onSaved: () => void;
}) {
  const [myAi, setMyAi] = useState<StaffJobStatus["myAi"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = fresh || editing;
  useEffect(() => {
    if (!token || !open) return;
    apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${sourceId}&task=storyboard`, { token })
      .then((status) => setMyAi(status.myAi), () => setMyAi(null));
  }, [token, sourceId, open]);
  const save = async () => {
    if (!run) return;
    setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/content/youtube-automation/myin", { method: "PATCH", token, body: JSON.stringify({ action: "settings", runId: run.id, ...value }) });
      rememberSettings(value); onEditing(false); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "제작 설정을 저장하지 못했어요."); }
    finally { setBusy(false); }
  };
  const seen = sinceIso(myAi?.lastUsedAt ?? null);
  const current = run?.settings;
  return <section className="yt-note" id="myin-settings" aria-label="제작 설정">
    <div className="yt-run-head"><strong>제작 설정</strong>
      {!open && run ? <button type="button" className="secondary-button compact" onClick={() => onEditing(true)}>바꾸기</button> : null}</div>
    {!open && run ? <small>{run.style ? `채널 모양 ${run.style.name} · v${run.style.version} · ` : ""}만드는 곳 {placeName(current, run)} · GPT 화면 검사 {(current?.screenCheck ?? true) ? "켬" : "끔"}
      {current ? "" : " · 이 영상은 제작 설정 전에 시작해서 기본값을 따라요"}</small> : null}
    {open ? <>
      <small>한 번 정하면 단계마다 다시 묻지 않아요. 바꾸면 그다음 단계부터 따라요.</small>
      {fresh && styles.length ? <div className="yt-actions"><label className="yt-style-pick">채널 모양<select value={styleId} onChange={(event) => onStyle(event.target.value)}>
        <option value="">기본 (고르지 않음)</option>{styles.map((style) => <option key={style.id} value={style.id}>{style.name} · v{style.version}</option>)}</select></label>
        <EarlierStylePick sourceId={sourceId} token={token} styles={styles} onPick={onStyle} /></div>
        : run?.style ? <small>채널 모양 {run.style.name} · v{run.style.version} · 음성을 시작할 때 영상에 고정돼요</small> : null}
      <small>기획표를 쓰는 AI · 내 AI · {!myAi ? "확인하는 중" : !myAi.keys ? "아직 연결하지 않았어요(2단계에서 연결 방법을 보여 줘요)" : seen === null ? "연결됨 · 아직 OS를 확인한 적 없음" : `연결됨 · ${ago(seen)} 전에 마지막으로 확인`}</small>
      {short ? <small>만드는 곳 · 영상 만드는 컴퓨터 (숏폼은 세로 엔진이 있는 컴퓨터에서만 만들어요)</small>
        : <DraftPlacePicker label="만드는 곳 (미리보기 · 자료 준비 · 전체 영상)" value={value.place} onChange={(place) => onChange({ ...value, place })} status={localPc} ready token={token} onConnected={onLocalConnected} />}
      <label className="yt-check"><input type="checkbox" checked={value.screenCheck} onChange={(event) => onChange({ ...value, screenCheck: event.target.checked })} />
        점검 시트가 나오면 GPT가 바로 화면을 검사해요 <CostTag kind="paid" /> <small>급하면 끄고 바로 편집으로 넘어가요. 빈 화면 · 그리기 오류 검사는 언제나 해요(무료).</small></label>
      <small>사람이 확인하는 단계 · 기획표 확인 · 미리보기 확인</small>
      {!fresh && run ? <div className="yt-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? "저장 중…" : "저장"}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => onEditing(false)}>닫기</button></div> : null}
      {error ? <p className="inline-alert" role="alert">{error}</p> : null}
    </> : null}
  </section>;
}

/** The one line a step keeps in place of its own picker: where the next step is made, and a way back to the card. */
export function SettingsLine({ text, onChange }: { text: string; onChange: () => void }) {
  return <div className="yt-actions"><small>{text}</small>
    <button type="button" className="secondary-button compact" onClick={onChange}>바꾸기</button></div>;
}
