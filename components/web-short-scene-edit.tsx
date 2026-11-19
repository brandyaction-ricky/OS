"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Slot = { path: string; label: string; max: number; value: string };
type Scene = { n: number; type: string; name: string; at: string; photo: string | null; slots: Slot[] };
type State = { open: boolean; storyboardAt: string; scenes: Scene[] };
const API = "/api/v1/content/youtube-automation/myin";
const letters = (text: string) => text.replace(/\s/g, "").length;

/**
 * 장면 글자 고치기 (대표 2026-11-19 「자동 흐름에서도 장면을 직접 고칠 수 있게」): a 웹 숏폼's scenes with their text slots (목록 항목 ·
 * 비교 칸 · 인물 카드 · 행동 카드 …), edited in place with the letter limits shown; saving draws the changed scenes into the 점검 시트
 * again. Photos are changed in 「우리 이미지 올리기」 beside it; the kind of scene and when things appear stay with [수정 요청].
 */
export function WebShortSceneEdit({ runId, token, storyboardAt, onSaved, onScene }: { runId: string; token: string | null; storyboardAt: string; onSaved: () => void;
  onScene?: (scene: number) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({});
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<{ n: number; text: string } | null>(null);
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    let live = true;
    apiRequest<State>(`${API}?webscenes=${runId}`, { token }).then((next) => { if (live) { setState(next); setEdits({}); } })
      .catch((reason) => { if (live) setError({ n: 0, text: reason instanceof Error ? reason.message : "장면을 열지 못했어요." }); });
    return () => { live = false; };
  }, [runId, token, storyboardAt]);

  if (!state?.scenes.length) return error ? <p className="yt-note yt-warn">{error.text}</p> : null;
  const save = async (scene: Scene) => {
    const texts = edits[scene.n] ?? {};
    setBusy(scene.n); setError(null);
    try {
      await apiRequest(API, { method: "PATCH", token, body: JSON.stringify({ action: "web_scene_edit", runId, n: scene.n, texts, storyboardAt: state.storyboardAt }) });
      setSaved(scene.n); onSaved();
    } catch (reason) { setError({ n: scene.n, text: reason instanceof Error ? reason.message : "저장하지 못했어요." }); }
    finally { setBusy(0); }
  };
  return <details className="yt-details">
    <summary>장면 글자 고치기 · {state.scenes.length}장면</summary>
    <p className="yt-note">{state.open ? "목록 항목 · 비교 칸 · 카드 문구를 여기서 바로 고쳐요. 저장하면 그 장면만 점검 시트에 다시 그려요. 사진은 아래 「우리 이미지 올리기」에서 바꾸고, 장면 종류나 나오는 때를 바꾸려면 의견을 남기고 [수정 요청]을 눌러요."
      : "기획표를 확인하는 동안이나 미리보기를 확인할 때 고칠 수 있어요."}</p>
    {state.scenes.map((scene) => {
      const mine = edits[scene.n] ?? {};
      const changed = Object.entries(mine).some(([path, value]) => value !== scene.slots.find((s) => s.path === path)?.value);
      const over = scene.slots.some((slot) => letters(mine[slot.path] ?? slot.value) > slot.max);
      return <div key={scene.n} className="yt-run yt-wse-scene">
        <div className="yt-run-head"><strong>{scene.n} · {scene.name}</strong>
          <span className="yp-muted"> 「{scene.at}」{scene.photo ? ` · 사진 ${scene.photo}` : ""}</span>
          {onScene ? <button type="button" className="secondary-button yt-wse-gap" onClick={() => onScene(scene.n)}>시트에서 보기</button> : null}</div>
        {scene.slots.length ? scene.slots.map((slot) => {
          const value = mine[slot.path] ?? slot.value, n = letters(value);
          return <label key={slot.path} className="yt-wse-field">{slot.label}
            <span className={`yt-wse-count ${n > slot.max ? "yt-warn" : "yp-muted"}`}>{n}/{slot.max}자</span>
            <input className="yp-in" value={value} maxLength={80} disabled={!state.open || busy === scene.n}
              onChange={(event) => setEdits((all) => ({ ...all, [scene.n]: { ...all[scene.n], [slot.path]: event.target.value } }))} /></label>;
        }) : <p className="yp-muted yt-wse-empty">글자 칸이 없는 사진 장면이에요.</p>}
        {scene.slots.length && state.open ? <div className="yt-wse-act">
          <button type="button" className="primary-button" disabled={!changed || over || busy === scene.n} onClick={() => void save(scene)}>{busy === scene.n ? "저장 중…" : "이 장면 저장"}</button>
          {saved === scene.n && !changed ? <span className="yp-muted yt-wse-gap">저장했어요 · 점검 시트를 다시 그려요</span> : null}
          {over ? <span className="yt-warn yt-wse-gap">글자 수를 줄여 주세요</span> : null}</div> : null}
        {error?.n === scene.n ? <p className="yt-note yt-warn">{error.text}</p> : null}
      </div>;
    })}
  </details>;
}
