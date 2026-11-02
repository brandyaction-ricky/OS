"use client";
import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { MAX_REVIEWERS, type YpReviewer } from "@/lib/youtube-process/reviewers";
import type { YpPage } from "./youtube-process-frame";

const day = (value: string) => value ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}까지` : "";

/**
 * 검토할 사람 · 날짜 (유쓰 요청 8/8): who checks which part of the 최종 검토 by when. Only those not finished are reminded; nothing waits on
 * it and the PD still confirms as before.
 */
export function ReviewersBar({ page }: { page: YpPage }) {
  const project = page.bundle?.project;
  const make = page.bundle?.stages.make;
  const me = page.profile?.id ?? "";
  const [rows, setRows] = useState<Omit<YpReviewer, "doneAt">[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (!project || !make) return null;
  const list = make.data.reviewers ?? [];
  const open = ["make", "review"].includes(project.yp.stage);
  const name = (id: string) => page.members.find(member => member.id === id)?.name ?? "알 수 없는 사람";
  const send = async (input: Parameters<NonNullable<YpPage["client"]>["reviewers"]>[2]) => {
    if (!page.client) return;
    setBusy(true); page.setError("");
    try {
      const stage = await page.client.reviewers(project.id, make.version, input);
      page.setBundle(current => current ? { ...current, stages: { ...current.stages, make: stage } } : current);
      setRows(null);
    } catch (reason) { page.fail(reason); } finally { setBusy(false); }
  };
  const mine = list.filter(row => row.id === me);
  return <div className="yp-revw" data-yp-free>
    <b>검토 담당</b>
    {list.length ? list.map(row => <span key={`${row.id}:${row.part}`} className={`yp-revw-p${row.doneAt ? " yp-done" : ""}`}>
      {row.doneAt ? <Check size={12} aria-label="검토 끝" /> : null}{name(row.id)}{row.part ? ` · ${row.part}` : ""}{row.due ? ` · ${day(row.due)}` : ""}</span>)
      : <span className="yp-muted">아직 없어요</span>}
    {open && mine.length ? <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => void send({ action: mine.every(row => row.doneAt) ? "undo" : "done" })}>
      {mine.every(row => row.doneAt) ? "다시 열기" : "내 검토 끝"}</button> : null}
    {open && !rows ? <button type="button" className="yp-lnk" onClick={() => setRows(list.map(({ id, part, due }) => ({ id, part, due })))}>담당 정하기</button> : null}
    {rows ? <div className="yp-revw-ed">
      {rows.map((row, index) => <div key={index} className="yp-revw-row">
        <select className="yp-in" aria-label="검토할 사람" value={row.id} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, id: event.target.value } : item))}>
          <option value="">사람 고르기</option>{page.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
        <input className="yp-in" aria-label="맡은 부분" placeholder="맡은 부분 (자막 · 화면 · 소리)" maxLength={20} value={row.part} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, part: event.target.value } : item))} />
        <input className="yp-in" type="date" aria-label="검토할 날짜" value={row.due} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, due: event.target.value } : item))} />
        <button type="button" className="yp-ib" aria-label="빼기" onClick={() => setRows(rows.filter((_, at) => at !== index))}><X size={14} /></button></div>)}
      <div className="yp-revw-row">
        {rows.length < MAX_REVIEWERS ? <button type="button" className="yp-btn yp-sm" onClick={() => setRows([...rows, { id: "", part: "", due: "" }])}><Plus size={14} /> 사람 추가</button> : null}
        <span className="yp-sp" />
        <button type="button" className="yp-btn yp-sm" onClick={() => setRows(null)}>취소</button>
        <button type="button" className="yp-btn yp-pri yp-sm" disabled={busy || rows.some(row => !row.id)} onClick={() => void send({ action: "set", reviewers: rows })}>저장</button></div>
      <p className="yp-hint">정한 날부터 검토를 끝내지 않은 사람에게만 하루 한 번 알려요. 날짜가 지나도 저절로 컨펌되지 않아요.</p>
    </div> : null}
  </div>;
}
