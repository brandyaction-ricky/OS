"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { VoiceDictionary, VoiceReading, VoiceTest } from "@/lib/youtube-process/voice-dictionary";
import { useSession } from "./session-provider";

type Edit = Record<string, unknown> & { op: string };
const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

/**
 * 음성 사전 (로건 OS 요청 2026-10-30, phase ④): the 읽기 사전 and the 끊김 시험 문제 the render PC reads at every voice job. Lines it added
 * itself say 「자동 수집 · 확인 필요」 until someone marks them right, changes or removes them.
 */
export function YoutubeVoiceDictionaryScreen() {
  const { accessToken, demo } = useSession();
  const [data, setData] = useState<{ dictionary: VoiceDictionary; version: number } | null>(null);
  const [tab, setTab] = useState<"readings" | "tests">("readings");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState(""), [bind, setBind] = useState(""), [was, setWas] = useState(""), [testId, setTestId] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (demo) { setData({ dictionary: { readings: [], tests: [] }, version: 0 }); return; }
    try { setData(await apiRequest("/api/v1/content/youtube/voice-dictionary", { token: accessToken })); } catch (reason) { setError(reason instanceof Error ? reason.message : "음성 사전을 열지 못했어요."); }
  }, [accessToken, demo]);
  useEffect(() => { void load(); }, [load]);
  const send = async (edit: Edit) => {
    if (!data) return false;
    setBusy(true); setError("");
    try { setData(await apiRequest("/api/v1/content/youtube/voice-dictionary", { method: "PATCH", token: accessToken, body: JSON.stringify({ ...edit, expectedVersion: data.version }) })); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); return false; }
    finally { setBusy(false); }
  };
  const saveReading = async () => { if (await send({ op: "reading", from, to, ...(editing ? { was: editing } : {}) })) { setFrom(""); setTo(""); setEditing(null); } };
  const saveTest = async () => {
    const places = bind.split(/[,\s]+/).map(item => item.trim()).filter(Boolean);
    if (await send({ op: "test", text, bind: places, was, ...(testId ? { id: testId } : {}) })) { setText(""); setBind(""); setWas(""); setTestId(null); }
  };
  if (!data) return error ? <p className="yp-errline" role="alert">{error}</p> : <p className="yp-hint" role="status">불러오는 중이에요…</p>;
  const { readings, tests } = data.dictionary;
  const autoTag = (row: VoiceReading | VoiceTest) => row.auto ? <span className="yp-tag yp-warn">자동 수집 · 확인 필요</span> : null;
  return <>
    <div className="yp-seg2" role="tablist" aria-label="사전" style={{ marginBottom: 12 }}>
      <button type="button" role="tab" aria-selected={tab === "readings"} className={tab === "readings" ? "yp-on" : ""} onClick={() => setTab("readings")}>읽기 사전 {readings.length}</button>
      <button type="button" role="tab" aria-selected={tab === "tests"} className={tab === "tests" ? "yp-on" : ""} onClick={() => setTab("tests")}>끊김 시험 문제 {tests.length}</button>
    </div>
    {error ? <p className="yp-errline" role="alert">{error}</p> : null}
    {tab === "readings" ? <section className="yp-card"><div className="yp-card-b" style={{ display: "grid", gap: 10 }}>
      <p className="yp-hint" style={{ margin: 0 }}>음성을 만들 때만 바꿔 읽어요. 원고 · 자막은 그대로예요.</p>
      <form style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onSubmit={event => { event.preventDefault(); void saveReading(); }}>
        <input className="yp-in" style={{ flex: "1 1 140px" }} value={from} maxLength={60} placeholder="원래 말 (예: ChatGPT)" aria-label="원래 말" onChange={event => setFrom(event.target.value)} />
        <input className="yp-in" style={{ flex: "1 1 140px" }} value={to} maxLength={120} placeholder="읽는 소리 (예: 챗지피티)" aria-label="읽는 소리" onChange={event => setTo(event.target.value)} />
        <button type="submit" className="yp-btn yp-sm yp-pri" disabled={busy || !from.trim() || !to.trim()}>{editing ? "고치기" : "추가"}</button>
        {editing ? <button type="button" className="yp-btn yp-sm" onClick={() => { setEditing(null); setFrom(""); setTo(""); }}>취소</button> : null}
      </form>
      {readings.length ? <ul className="yp-hist">{readings.map(row => <li key={row.from} style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 240px", minWidth: 0 }}><b>{row.from}</b> → {row.to}<br /><small className="yp-muted">{row.source} · {row.by} · {when(row.at)}</small></span>
        {autoTag(row)}
        {row.auto ? <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => void send({ op: "confirm", kind: "reading", key: row.from })}>맞음</button> : null}
        <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => { setEditing(row.from); setFrom(row.from); setTo(row.to); }}>고치기</button>
        <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => { if (window.confirm(`「${row.from}」을 읽기 사전에서 지울까요?`)) void send({ op: "reading_delete", from: row.from }); }}>지우기</button></li>)}</ul>
        : <p className="yp-pempty">아직 없어요. 다음 음성을 만들 때 영상 만드는 컴퓨터의 사전이 들어와요.</p>}
    </div></section>
    : <section className="yp-card"><div className="yp-card-b" style={{ display: "grid", gap: 10 }}>
      <p className="yp-hint" style={{ margin: 0 }}>음성 만드는 방식을 바꿀 때마다 이 문장들을 모두 다시 만들어 통과해야 반영해요.</p>
      <form style={{ display: "grid", gap: 6 }} onSubmit={event => { event.preventDefault(); void saveTest(); }}>
        <input className="yp-in" value={text} maxLength={400} placeholder="문장 (예: 대신 듣고 보면서 알 수 있어요.)" aria-label="문장" onChange={event => setText(event.target.value)} />
        <input className="yp-in" value={bind} placeholder="붙여 읽을 자리 (예: 듣고|보면서 보면서|알)" aria-label="붙여 읽을 자리" onChange={event => setBind(event.target.value)} />
        <input className="yp-in" value={was} maxLength={400} placeholder="원래 들린 모양 (선택 · 예: 대신 듣고. 보면서.)" aria-label="원래 들린 모양" onChange={event => setWas(event.target.value)} />
        <div className="yp-row-btns"><button type="submit" className="yp-btn yp-sm yp-pri" disabled={busy || !text.trim() || !bind.trim()}>{testId ? "고치기" : "추가"}</button>
          {testId ? <button type="button" className="yp-btn yp-sm" onClick={() => { setTestId(null); setText(""); setBind(""); setWas(""); }}>취소</button> : null}</div>
      </form>
      {tests.length ? <ul className="yp-hist">{tests.map(row => <li key={row.id} style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 300px", minWidth: 0 }}>{row.text}<br /><small className="yp-muted">붙여 읽기 {row.bind.join(" · ")}{row.was ? ` · 들린 모양 「${row.was}」` : ""} · {row.from}</small></span>
        {autoTag(row)}
        {row.auto ? <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => void send({ op: "confirm", kind: "test", key: row.id })}>맞음</button> : null}
        <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => { setTestId(row.id); setText(row.text); setBind(row.bind.join(" ")); setWas(row.was); }}>고치기</button>
        <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => { if (window.confirm("이 시험 문제를 지울까요?")) void send({ op: "test_delete", id: row.id }); }}>지우기</button></li>)}</ul>
        : <p className="yp-pempty">아직 없어요. 다음 음성을 만들 때 영상 만드는 컴퓨터의 시험 문제가 들어와요.</p>}
    </div></section>}
  </>;
}
