"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type { MyinSoundItem, MyinSoundPlan } from "@/lib/myin-storyboard";
import "./myin-sound-editor.css";

interface SoundState { plan: MyinSoundPlan; catalog: MyinSoundItem[]; scenes: { scene: number; type: string; at: string }[] }

const byScene = <T extends { scene: number }>(items: T[]) => [...items].sort((a, b) => a.scene - b.scene);
const changes = (a: MyinSoundPlan, b: MyinSoundPlan) => (["music", "amb", "sfx"] as const)
  .reduce((n, part) => n + Math.max(a[part].length, b[part].length) - a[part].filter((x, i) => JSON.stringify(x) === JSON.stringify(b[part][i])).length, 0);

/**
 * ④ 자료 준비 › 사운드 (2026-10-27 대표): the music, ambience and effect lines Logan's music match wrote at ③, changed here before the full
 * video. A song plays from its scene to the next song; an effect plays when its line is heard. Saving checks the keys and lines on the server.
 */
export function MyinSoundEditor({ runId, token, editable, onSaved }: { runId: string; token: string | null; editable: boolean; onSaved: () => Promise<void> }) {
  const [state, setState] = useState<SoundState | null>(null);
  const [plan, setPlan] = useState<MyinSoundPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ musicScene: 1, musicKey: "", ambScene: 1, ambKey: "", sfxScene: 1, sfxCue: "", sfxKey: "" });
  const load = useCallback(async () => {
    try {
      const next = await apiRequest<SoundState>(`/api/v1/content/youtube-automation/myin?sound=${runId}`, { token });
      setState(next); setPlan(next.plan);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "사운드를 불러오지 못했습니다."); }
  }, [runId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!state || !plan) return <p className="yt-note" role="status">{error || "사운드를 불러오는 중…"}</p>;

  const of = (kind: MyinSoundItem["kind"]) => state.catalog.filter((item) => item.kind === kind);
  const options = (kind: MyinSoundItem["kind"], current?: string) => {
    const list = of(kind);
    return <>{current && !list.some((item) => item.key === current) ? <option value={current}>{current} (예전 큐 시트)</option> : null}
      {list.map((item) => <option key={item.key} value={item.key}>{item.title}{item.note ? ` · ${item.note}` : ""}</option>)}</>;
  };
  const sceneCell = (scene: number) => <span className="yt-sound-scene"><b>{scene}번 장면</b><small>“{state.scenes[scene - 1]?.at ?? ""}”</small></span>;
  const sceneOptions = state.scenes.map((sc) => <option key={sc.scene} value={sc.scene}>{sc.scene}번 · “{sc.at.slice(0, 16)}”</option>);
  const pending = changes(plan, state.plan);
  const set = (next: Partial<MyinSoundPlan>) => setPlan({ ...plan, ...next });
  const off = !editable || busy;
  const save = async () => {
    setBusy(true); setError("");
    try {
      await apiRequest(`/api/v1/content/youtube-automation/myin`, { method: "PATCH", token, body: JSON.stringify({ action: "sound", runId, plan }) });
      await load(); await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "사운드를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const remove = (label: string, onClick: () => void) =>
    <button type="button" className="yt-sound-remove" aria-label={label} title={label} disabled={off} onClick={onClick}><Trash2 size={15} /></button>;

  return <section className="yt-sound" aria-label="사운드 편집">
    <div className="yt-sound-head">
      <div><h3>사운드</h3><p>곡은 그 장면부터 다음 곡이 나올 때까지 깔리고, 효과음은 적은 말이 들리는 순간에 납니다.</p></div>
      <span className={`yt-sound-state${pending ? " changed" : ""}`}>{pending ? `저장 안 한 변경 ${pending}곳` : "저장됨"}</span>
    </div>

    <div className="yt-sound-sec">
      <div className="yt-sound-sec-head"><strong>음악</strong><span className="yt-sound-count">{plan.music.length}구간</span><small>시작은 곡의 몇 초부터 틀지 (비우면 곡 기본)</small></div>
      {plan.music.length ? plan.music.map((m, i) => <div className="yt-sound-row" key={`m${m.scene}`}>
        {sceneCell(m.scene)}
        <select aria-label={`${m.scene}번 장면부터 깔 곡`} disabled={off} value={m.key} onChange={(event) => set({ music: plan.music.map((x, j) => j === i ? { ...x, key: event.target.value } : x) })}>{options("music", m.key)}</select>
        <label className="yt-sound-sec-time"><input aria-label={`${m.scene}번 장면 곡 시작(초)`} type="number" min={0} step={0.5} disabled={off} value={m.start ?? ""} placeholder="기본"
          onChange={(event) => set({ music: plan.music.map((x, j) => j === i ? { ...x, start: event.target.value === "" ? undefined : Number(event.target.value) } : x) })} />초</label>
        {remove(`${m.scene}번 장면 곡 빼기`, () => set({ music: plan.music.filter((_, j) => j !== i) }))}
      </div>) : <p className="yt-sound-empty">아직 곡이 없어요. 아래에서 곡을 시작할 장면을 골라 더해요.</p>}
      {editable ? <div className="yt-sound-row add">
        <select aria-label="곡을 새로 시작할 장면" disabled={off} value={add.musicScene} onChange={(event) => setAdd({ ...add, musicScene: Number(event.target.value) })}>{sceneOptions}</select>
        <select aria-label="새로 깔 곡" disabled={off} value={add.musicKey} onChange={(event) => setAdd({ ...add, musicKey: event.target.value })}><option value="">곡 고르기</option>{options("music")}</select>
        <button type="button" className="secondary-button" disabled={off || !add.musicKey || plan.music.some((m) => m.scene === add.musicScene)}
          onClick={() => set({ music: byScene([...plan.music, { scene: add.musicScene, key: add.musicKey }]) })}><Plus size={14} /> 구간 더하기</button>
      </div> : null}
    </div>

    <div className="yt-sound-sec">
      <div className="yt-sound-sec-head"><strong>앰비언스</strong><span className="yt-sound-count">{plan.amb.length}곳</span><small>그 장소에 실제로 있는 장면에만 · 길이는 초</small></div>
      {plan.amb.length ? plan.amb.map((a, i) => <div className="yt-sound-row" key={`a${a.scene}`}>
        {sceneCell(a.scene)}
        <select aria-label={`${a.scene}번 장면 앰비언스`} disabled={off} value={a.key} onChange={(event) => set({ amb: plan.amb.map((x, j) => j === i ? { ...x, key: event.target.value } : x) })}>{options("amb", a.key)}</select>
        <label className="yt-sound-sec-time"><input aria-label={`${a.scene}번 장면 앰비언스 길이(초)`} type="number" min={1} step={0.5} disabled={off} value={a.dur ?? ""} placeholder="장면 동안"
          onChange={(event) => set({ amb: plan.amb.map((x, j) => j === i ? { ...x, dur: event.target.value === "" ? undefined : Number(event.target.value) } : x) })} />초</label>
        {remove(`${a.scene}번 장면 앰비언스 빼기`, () => set({ amb: plan.amb.filter((_, j) => j !== i) }))}
      </div>) : <p className="yt-sound-empty">앰비언스가 없어요.</p>}
      {editable ? <div className="yt-sound-row add">
        <select aria-label="앰비언스를 깔 장면" disabled={off} value={add.ambScene} onChange={(event) => setAdd({ ...add, ambScene: Number(event.target.value) })}>{sceneOptions}</select>
        <select aria-label="새 앰비언스 장소" disabled={off} value={add.ambKey} onChange={(event) => setAdd({ ...add, ambKey: event.target.value })}><option value="">장소 고르기</option>{options("amb")}</select>
        <button type="button" className="secondary-button" disabled={off || !add.ambKey || plan.amb.some((a) => a.scene === add.ambScene)}
          onClick={() => set({ amb: byScene([...plan.amb, { scene: add.ambScene, key: add.ambKey }]) })}><Plus size={14} /> 앰비언스 더하기</button>
      </div> : null}
    </div>

    <div className="yt-sound-sec">
      <div className="yt-sound-sec-head"><strong>효과음</strong><span className="yt-sound-count">{plan.sfx.length}개</span><small>그 장면에서 들리는 말을 받아쓰기 철자 그대로</small></div>
      {plan.sfx.length ? plan.sfx.map((fx, i) => <div className="yt-sound-row sfx" key={`s${i}`}>
        {sceneCell(fx.scene)}
        <span className="yt-sound-cue">“{fx.cue}” 들릴 때</span>
        <select aria-label={`효과음 ${i + 1} 소리`} disabled={off} value={fx.key} onChange={(event) => set({ sfx: plan.sfx.map((x, j) => j === i ? { ...x, key: event.target.value } : x) })}>{options("sfx", fx.key)}</select>
        {remove(`효과음 ${i + 1} 빼기`, () => set({ sfx: plan.sfx.filter((_, j) => j !== i) }))}
      </div>) : <p className="yt-sound-empty">직접 넣은 효과음이 없어요. 도식 · 글자가 나올 때의 기본 소리는 자동으로 납니다.</p>}
      {editable ? <div className="yt-sound-row add sfx">
        <select aria-label="효과음을 넣을 장면" disabled={off} value={add.sfxScene} onChange={(event) => setAdd({ ...add, sfxScene: Number(event.target.value) })}>{sceneOptions}</select>
        <input aria-label="효과음이 날 말" disabled={off} value={add.sfxCue} placeholder="예) 도장을 쾅" onChange={(event) => setAdd({ ...add, sfxCue: event.target.value })} />
        <select aria-label="새 효과음 소리" disabled={off} value={add.sfxKey} onChange={(event) => setAdd({ ...add, sfxKey: event.target.value })}><option value="">소리 고르기</option>{options("sfx")}</select>
        <button type="button" className="secondary-button" disabled={off || !add.sfxKey || !add.sfxCue.trim()}
          onClick={() => { set({ sfx: byScene([...plan.sfx, { scene: add.sfxScene, cue: add.sfxCue.trim(), key: add.sfxKey }]) }); setAdd({ ...add, sfxCue: "" }); }}><Plus size={14} /> 효과음 더하기</button>
      </div> : null}
    </div>

    {!state.catalog.length ? <p className="yt-note">렌더 PC가 사운드 목록을 아직 보내지 않았어요. 지금 적힌 소리만 쓸 수 있어요.</p> : null}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    {editable ? <div className="yt-sound-bar">
      <small>{pending ? "저장해야 전체 영상에 들어가요." : "바꾸면 여기서 저장해요."}</small>
      {pending ? <button type="button" className="ghost-button" disabled={busy} onClick={() => { setPlan(state.plan); setError(""); }}>되돌리기</button> : null}
      <button type="button" className="primary-button" disabled={busy || !pending} onClick={() => void save()}>{busy ? "저장 중…" : "사운드 저장"}</button>
    </div> : null}
  </section>;
}
