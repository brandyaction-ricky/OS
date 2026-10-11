"use client";

import { useState } from "react";
import type { Meeting } from "@/lib/knowledge/model";
import type { OsRecord } from "@/lib/record-types";
import { teamCommand } from "@/lib/team/client";
import { legacyMeetingPairs, wordSimilarity } from "@/lib/team/duplicates";

export function LegacyMerge({ meetings, records, token, onChanged }: { meetings: Meeting[]; records: OsRecord[]; token: string; onChanged: () => Promise<void> }) {
  const pairs = legacyMeetingPairs(meetings);
  const [selected, setSelected] = useState<number | null>(null), [keeper, setKeeper] = useState(""), [mergeIds, setMergeIds] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!pairs.length) return null;
  const pair = selected === null ? null : pairs[selected];
  const keep = pair?.first.id === keeper ? pair.first : pair?.second;
  const other = pair?.first.id === keeper ? pair.second : pair?.first;
  const tasks = (id: string) => records.filter(record => record.record_type === "task" && (record.parent_id === id || record.metadata.meetingId === id));
  const overlapping = keep && other ? tasks(other.id).filter(task => tasks(keep.id).some(existing => wordSimilarity(existing.title, task.title) >= 0.6)) : [];
  async function merge() {
    if (!keep || !other) return;
    setBusy(true); setError("");
    try {
      await teamCommand(token, { action: "meeting.merge_legacy", keeperId: keep.id, otherId: other.id, keeperVersion: keep.version, otherVersion: other.version, mergeTaskIds: mergeIds });
      setSelected(null); setKeeper(""); setMergeIds([]); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "병합하지 못했습니다."); } finally { setBusy(false); }
  }
  return <><div className="tm-callout" data-tone="warn"><div className="tm-callout-body"><strong>중복 가능 회의 {pairs.length}쌍</strong><small>사람이 두 기록을 비교하고 남길 기록을 선택합니다.</small></div><div className="tm-callout-actions"><button className="secondary-button compact" type="button" onClick={() => { setSelected(0); setKeeper(pairs[0].first.id); }}>비교 후 병합</button></div></div>{pair ? <div className="modal-backdrop"><section className="form-modal" role="dialog" aria-modal="true" aria-label="이전 회의 비교 후 병합"><div className="drawer-head"><h2>이전 회의 비교</h2><button className="secondary-button compact" onClick={() => setSelected(null)}>닫기</button></div><div className="tm-modal-body"><label>비교할 쌍<select value={selected ?? 0} onChange={event => { const index = Number(event.target.value); setSelected(index); setKeeper(pairs[index].first.id); setMergeIds([]); }}>{pairs.map((item,index) => <option value={index} key={`${item.first.id}:${item.second.id}`}>{item.first.title} / {item.second.title}</option>)}</select></label><div className="tm-compare">{[pair.first,pair.second].map(meeting => <button className="tm-choice" aria-pressed={keeper === meeting.id} type="button" key={meeting.id} onClick={() => { setKeeper(meeting.id); setMergeIds([]); }}><span><strong>{meeting.title}</strong><small>{meeting.starts_at ? new Date(meeting.starts_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "일정 미정"}</small><small>참석자 {meeting.attendees.length}명 · 원문 {meeting.description ? "있음" : "없음"} · 연결 업무 {tasks(meeting.id).length}건</small></span></button>)}</div><p>남길 기록을 선택하세요. 다른 기록의 연결된 결정·업무가 이쪽으로 옮겨지고, 다른 기록은 보관됩니다.</p>{overlapping.length ? <fieldset><legend>제목이 같은 업무</legend>{overlapping.map(task => <label key={task.id}><input type="checkbox" checked={mergeIds.includes(task.id)} onChange={event => setMergeIds(current => event.target.checked ? [...current, task.id] : current.filter(id => id !== task.id))} />{task.title} · 체크하면 중복 업무를 보관</label>)}</fieldset> : null}{error ? <p className="tm-danger-text" role="alert">{error}</p> : null}<button className="primary-button compact" disabled={busy || overlapping.some(task => !mergeIds.includes(task.id))} onClick={() => void merge()}>{busy ? "병합 중…" : "선택한 기록으로 병합"}</button></div></section></div> : null}</>;
}
