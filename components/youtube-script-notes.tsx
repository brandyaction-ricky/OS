"use client";
import { useState } from "react";
import { MessageSquare, Sparkles } from "lucide-react";
import { noteSpot, type YpScriptNote } from "@/lib/youtube-process/stages";

const STATE: Record<YpScriptNote["state"], string> = { open: "의견", proposed: "수정안 도착", applied: "반영함", dismissed: "반영 안 함" };
const day = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * 구간 의견 모아 보기 (수정 요청 2026-11-12): every comment on a passage of the 원고 with who wrote it, on which version and where it
 * stands. Several can go to 내 AI at once; an AI 수정안 sits beside the original until the PD applies it or sets it aside.
 */
export function ScriptNotes({ notes, script, editable, busy, inJob, jobOpen, onState, onApply, onAsk, onShow }: {
  notes: YpScriptNote[]; script: string; editable: boolean; busy: boolean;
  /** Notes in the 내 AI job that is still waiting or running. */
  inJob: string[]; jobOpen: boolean;
  onState: (id: string, state: "open" | "dismissed") => void; onApply: (note: YpScriptNote) => void; onAsk: (ids: string[]) => void; onShow: (note: YpScriptNote) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const live = notes.filter(note => note.state === "open" || note.state === "proposed");
  const ended = notes.filter(note => note.state === "applied" || note.state === "dismissed");
  const pickable = live.filter(note => !inJob.includes(note.id) && "at" in noteSpot(script, note)).map(note => note.id);
  const picked = chosen.filter(id => pickable.includes(id));
  const toggle = (id: string) => setChosen(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id].slice(-10));
  const row = (note: YpScriptNote) => {
    const spot = noteSpot(script, note), working = inJob.includes(note.id);
    return <li key={note.id} className={`yp-snote yp-snote-${note.state}`}>
      <div className="yp-snote-h">
        {editable && pickable.includes(note.id) ? <input type="checkbox" checked={picked.includes(note.id)} onChange={() => toggle(note.id)} aria-label="내 AI에게 보낼 의견으로 고르기" /> : null}
        <button type="button" className="yp-snote-q" onClick={() => onShow(note)} title="원고에서 이 구간 보기">“{note.quote.replace(/[*_~`]/g, "").replace(/\s+/g, " ")}”</button>
        <span className={`yp-tag${note.state === "proposed" ? " yp-acc" : ""}`}>{working ? "내 AI가 고치는 중" : STATE[note.state]}</span>
      </div>
      <p className="yp-snote-t">{note.text}</p>
      <p className="yp-hint yp-snote-m">{note.by} · v{note.v || "–"}에서 · {day(note.at)}{note.appliedAt ? ` · ${day(note.appliedAt)} 반영` : ""}</p>
      {"problem" in spot && (note.state === "open" || note.state === "proposed") ? <p className="yp-errline">{spot.problem}. 반영하거나 내 AI에게 보낼 수 없어요. 직접 고치거나 의견을 다시 남겨 주세요.</p> : null}
      {note.proposal && note.state !== "dismissed" ? <div className="yp-snote-p">
        <div className="yp-lbl"><Sparkles size={11} aria-hidden="true" /> 내 AI 수정안 · {note.proposal.by}</div>
        <div className="yp-snote-diff"><div><b>원문</b><p>{note.quote}</p></div><div><b>수정안</b><p>{note.proposal.text}</p></div></div>
        <p className="yp-hint">{note.proposal.why}</p>
      </div> : null}
      {editable ? <div className="yp-row-btns">
        {note.state === "proposed" ? <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy || working || "problem" in spot} onClick={() => onApply(note)}>원고에 반영</button> : null}
        {note.state === "open" || note.state === "proposed" ? <button type="button" className="yp-btn yp-sm" disabled={busy || working} onClick={() => onState(note.id, "dismissed")}>반영 안 함</button> : null}
        {note.state === "dismissed" ? <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => onState(note.id, "open")}>다시 열기</button> : null}
      </div> : null}
    </li>;
  };
  return <section className="yp-card yp-snotes" aria-label="구간 의견">
    <div className="yp-card-h"><MessageSquare size={14} aria-hidden="true" /> 구간 의견 {live.length ? `${live.length}개` : ""}</div>
    <div className="yp-card-b">
      {live.length ? <ul className="yp-snote-list">{live.map(row)}</ul> : <p className="yp-hint">아직 남긴 의견이 없어요. 의견 모드(U)에서 원고의 글을 드래그하면 그 구간에 의견을 남겨요.</p>}
      {editable && live.length ? <div className="yp-row-btns">
        <button type="button" className="yp-btn yp-sm yp-pri" disabled={!picked.length || jobOpen || busy} onClick={() => onAsk(picked)}><Sparkles size={12} aria-hidden="true" /> 고른 의견 {picked.length}개 내 AI에게 수정 요청</button>
        <span className="yp-hint">{jobOpen ? "내 AI가 앞의 요청을 고치는 중이에요." : "수정안이 와도 「원고에 반영」을 누르기 전까지 원고는 그대로예요."}</span>
      </div> : null}
      {ended.length ? <details className="yp-snote-ended"><summary className="yp-hint">끝난 의견 {ended.length}개 (반영함 · 반영 안 함)</summary><ul className="yp-snote-list">{ended.map(row)}</ul></details> : null}
    </div>
  </section>;
}
