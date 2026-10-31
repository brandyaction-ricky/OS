"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, GripVertical, X } from "lucide-react";
import { gateName } from "@/lib/youtube-process/confirm";
import { personName, projectHref, projectName, stageLabel, YP_FLOW, YP_STAGE_INDEX } from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";
import { errorMessage, youtubeProcessClient, type YpMember, type YpScheduleItem } from "./youtube-process-data";

const WD = "일월화수목금토";
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const md2 = (date: string) => { const at = new Date(`${date}T00:00:00`); return `${at.getMonth() + 1}/${at.getDate()} (${WD[at.getDay()]})`; };
const dayDiff = (date: string) => Math.round((Date.parse(`${date}T00:00:00`) - new Date(new Date().toDateString()).getTime()) / 86_400_000);
type Kind = "up" | "ed" | "cf" | "pub";
interface Ev { item: YpScheduleItem; kind: Kind; date: string; label: string }

/** S9 스케줄 (4-9): every project's 편집 완료 · 업로드 (예상) · 컨펌 대기 on a week or month calendar; drag a date to move it. */
export function YoutubeScheduleScreen({ header }: { header: ReactNode }) {
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const [items, setItems] = useState<YpScheduleItem[] | null>(null);
  const [members, setMembers] = useState<YpMember[]>([]);
  const [mode, setMode] = useState<"week" | "month">("month");
  const [offset, setOffset] = useState(0);
  const [pd, setPd] = useState("all");
  const [stage, setStage] = useState("all");
  const [showConfirm, setShowConfirm] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<YpScheduleItem | null>(null);
  const [form, setForm] = useState({ editDue: "", uploadPlan: "", why: "" });
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [dragOver, setDragOver] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    if (!client) return;
    try { const [list, people] = await Promise.all([client.schedule(), client.members().catch(() => [] as YpMember[])]); setItems(list); setMembers(people); setError(""); }
    catch (reason) { setError(errorMessage(reason)); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const today = iso(new Date());
  const anchor = new Date(); anchor.setHours(0, 0, 0, 0);
  if (mode === "week") anchor.setDate(anchor.getDate() + offset * 7); else anchor.setMonth(anchor.getMonth() + offset, 1);
  const start = new Date(anchor);
  if (mode === "week") start.setDate(anchor.getDate() - anchor.getDay()); else start.setDate(1 - new Date(anchor.getFullYear(), anchor.getMonth(), 1).getDay());
  const monthCells = Math.ceil((new Date(anchor.getFullYear(), anchor.getMonth(), 1).getDay() + new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()) / 7) * 7;
  const days = Array.from({ length: mode === "week" ? 7 : monthCells }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
  const shown = (items ?? []).filter(item => (pd === "all" || item.project.assigneeId === pd) && (stage === "all" || String(YP_STAGE_INDEX[item.project.yp.stage]) === stage) && item.project.yp.stage !== "done");
  const events: Ev[] = shown.flatMap(item => [
    ...(item.uploadPlan ? [{ item, kind: "up" as const, date: item.uploadPlan, label: "업로드 예상일" }] : []),
    // 공개 예약 (로건 요청 10/30): set on 업로드 › 5. 공개 범위, not moved here.
    ...(item.publishAt ? [{ item, kind: "pub" as const, date: iso(new Date(item.publishAt)), label: `공개 예약 ${new Date(item.publishAt).toTimeString().slice(0, 5)}` }] : []),
    ...(item.editDue && ["topic", "draft", "outline", "make"].includes(item.project.yp.stage) ? [{ item, kind: "ed" as const, date: item.editDue, label: "편집 완료일" }] : []),
    ...(showConfirm && item.waiting?.requestedAt ? [{ item, kind: "cf" as const, date: item.waiting.requestedAt.slice(0, 10), label: `${gateName(item.waiting.gate, item.project.yp.topic.type)} 대기` }] : []),
  ]);
  const byDay = new Map<string, Ev[]>();
  for (const event of events) byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
  const dupDays = [...byDay.entries()].filter(([, list]) => list.filter(event => event.kind === "up").length >= 2).map(([date]) => date);
  const noUpload = shown.filter(item => !item.uploadPlan && !["upload", "shorts"].includes(item.project.yp.stage));
  const picked = noUpload.find(item => item.project.id === selected);
  const periodEvents = events.filter(event => event.date >= iso(days[0]) && event.date <= iso(days[days.length - 1]));
  const pdName = (id: string | null) => members.find(member => member.id === id)?.name ?? "—";
  const state = (item: YpScheduleItem) => {
    const late = (item.editDue && ["outline", "make"].includes(item.project.yp.stage) && dayDiff(item.editDue) < 0) || (item.uploadPlan && YP_STAGE_INDEX[item.project.yp.stage] < 5 && dayDiff(item.uploadPlan) < 0);
    const tight = !late && YP_STAGE_INDEX[item.project.yp.stage] < 5 && ((item.editDue && dayDiff(item.editDue) <= 2) || (item.uploadPlan && item.editDue && dayDiff(item.uploadPlan) - dayDiff(item.editDue) <= 2));
    return late ? ["yp-bad", "지남"] : tight ? ["yp-warn", "빠듯함"] : ["", "여유"];
  };

  const move = async (item: YpScheduleItem, patch: { editDue?: string; uploadPlan?: string; why?: string }) => {
    if (!client || busy) return false;
    setBusy(true); setError("");
    try { await client.moveDates(item.project.id, item.makeVersion, patch); await load(); return true; }
    catch (reason) { await load(); setError(errorMessage(reason)); return false; } finally { setBusy(false); }
  };
  const open = (item: YpScheduleItem) => { setSelected(""); setEditing(item); setForm({ editDue: item.editDue, uploadPlan: item.uploadPlan, why: "" }); dialog.current?.showModal(); };
  const chip = (event: Ev) => {
    const draggable = event.kind === "up" || event.kind === "ed";
    return <button key={`${event.item.project.id}-${event.kind}`} type="button" className={`yp-ev yp-${event.kind === "pub" ? "up" : event.kind}`} draggable={draggable && !busy} disabled={busy} aria-label={`${projectName(event.item.project)} · ${event.label}`} title={`${projectName(event.item.project)} · ${event.label}${draggable ? " · 끌어서 날짜 옮기기" : ""}`}
      onDragStart={evt => { evt.dataTransfer.setData("text/plain", JSON.stringify({ id: event.item.project.id, kind: event.kind })); }}
      onClick={() => draggable ? open(event.item) : window.location.assign(projectHref(event.item.project))}>{projectName(event.item.project)}</button>;
  };
  const drop = (date: string, raw: string) => {
    try {
      const { id, kind } = JSON.parse(raw) as { id: string; kind: Kind };
      const item = shown.find(row => row.project.id === id);
      if (item && (kind === "up" || kind === "ed")) void move(item, kind === "up" ? { uploadPlan: date } : { editDue: date }).then(ok => { if (ok) setSelected(""); });
    } catch { /* not one of our chips */ }
  };
  const title = mode === "week" ? `${md2(iso(days[0]))} ~ ${md2(iso(days[6]))}` : `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
  const place = (date: string) => { if (picked) void move(picked, { uploadPlan: date }).then(ok => { if (ok) setSelected(""); }); };

  return <div className="yp-schedule">
    <div className="yp-schedule-head">{header}<div className="yp-seg2" role="group" aria-label="달력 보기">
      <button type="button" aria-pressed={mode === "week"} className={mode === "week" ? "yp-on" : ""} onClick={() => { setMode("week"); setOffset(0); }}>주</button>
      <button type="button" aria-pressed={mode === "month"} className={mode === "month" ? "yp-on" : ""} onClick={() => { setMode("month"); setOffset(0); }}>월</button></div></div>
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
    <div className="yp-schedule-toolbar">
      <div className="yp-schedule-nav"><button type="button" className="yp-btn yp-sm" aria-label="이전 기간" onClick={() => setOffset(value => value - 1)}><ChevronLeft size={16} /></button><b aria-live="polite">{title}</b><button type="button" className="yp-btn yp-sm" aria-label="다음 기간" onClick={() => setOffset(value => value + 1)}><ChevronRight size={16} /></button>
        <button type="button" className="yp-btn yp-sm" onClick={() => setOffset(0)}>오늘</button></div>
      <select className="yp-in yp-w-auto" aria-label="담당 PD" value={pd} onChange={event => setPd(event.target.value)}><option value="all">담당 PD 전체</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
      <select className="yp-in yp-w-auto" aria-label="단계" value={stage} onChange={event => setStage(event.target.value)}><option value="all">단계 전체</option>{YP_FLOW.map((step, index) => <option key={step} value={index}>{step}</option>)}</select>
      <div className="yp-legend"><span><i className="yp-sw2 yp-up" />업로드 예정</span><span><i className="yp-sw2 yp-ed" />편집 완료</span><button type="button" className="yp-schedule-confirm" aria-pressed={showConfirm} title={showConfirm ? "컨펌 대기 숨기기" : "컨펌 대기 보기"} onClick={() => setShowConfirm(value => !value)}><i className="yp-sw2 yp-cf" />컨펌 대기</button></div>
    </div>
    {dupDays.length ? <div className="yp-note yp-warn" role="status"><AlertTriangle size={16} className="yp-i" aria-hidden="true" /><div>같은 날 업로드가 2건 이상이에요: {dupDays.map(md2).join(", ")}</div></div> : null}
    {items === null && !error ? <p className="yp-hint" role="status">불러오는 중이에요…</p> : <>
      <div className="yp-schedule-grid">
      <aside className="yp-undated" aria-label="날짜 없는 콘텐츠"><h2>날짜 없음 <span className="yp-tag yp-warn">{noUpload.length}</span></h2>
        <div className="yp-undated-list">{noUpload.map(item => <button key={item.project.id} type="button" className={`yp-undated-item${picked?.project.id === item.project.id ? " yp-on" : ""}`} disabled={busy} draggable={!busy} aria-pressed={picked?.project.id === item.project.id} aria-label={`${projectName(item.project)} 업로드 날짜 선택`} title={projectName(item.project)}
          onDragStart={event => event.dataTransfer.setData("text/plain", JSON.stringify({ id: item.project.id, kind: "up" }))} onClick={() => setSelected(value => value === item.project.id ? "" : item.project.id)}><GripVertical size={14} aria-hidden="true" /><span>{projectName(item.project)}</span></button>)}</div>
        {!noUpload.length && <p className="yp-hint">날짜 없는 콘텐츠가 없어요.</p>}
        <p className="yp-hint" role="status">{picked ? `「${projectName(picked.project)}」 업로드 날짜를 선택해 주세요.` : "끌어서 날짜에 놓기 · 키보드: 항목 선택 후 날짜 선택"}</p>
        {picked && <button type="button" className="yp-btn yp-sm" onClick={() => open(picked)}><CalendarDays size={14} aria-hidden="true" />날짜 직접 입력</button>}
      </aside>
      <div className="yp-schedule-calendar">
      <div className="yp-calw"><div className={`yp-cal${mode === "week" ? " yp-wk" : ""}`} aria-label={title}>
        {[...WD].map(day => <div key={day} className="yp-dh">{day}</div>)}
        {days.map(date => { const key = iso(date); const list = byDay.get(key) ?? []; const ups = list.filter(event => event.kind === "up").length;
          return <div key={key} data-date={key} className={`yp-dc${mode === "month" && date.getMonth() !== anchor.getMonth() ? " yp-out" : ""}${key === today ? " yp-today" : ""}${ups >= 2 ? " yp-dup" : ""}${dragOver === key ? " yp-over" : ""}${picked ? " yp-pickable" : ""}`}
            onClick={event => { if (event.target === event.currentTarget) place(key); }} onDragOver={event => { event.preventDefault(); if (!busy) setDragOver(key); }} onDragLeave={() => setDragOver("")} onDrop={event => { event.preventDefault(); setDragOver(""); if (!busy) drop(key, event.dataTransfer.getData("text/plain")); }}>
            <button className="yp-dn" type="button" aria-label={`${key} 업로드 날짜로 선택`} disabled={!picked || busy} onClick={() => place(key)}><span>{date.getDate()}</span>{key === today ? <small>오늘</small> : null}</button>
            {ups >= 2 ? <span className="yp-tag yp-warn">업로드 {ups}건</span> : null}
            {[...list].sort((a, b) => a.kind === "up" ? -1 : b.kind === "up" ? 1 : 0).map(chip)}</div>; })}
      </div></div>
      <div className="yp-slist">{picked && <button type="button" className="yp-btn yp-pri" onClick={() => open(picked)}>선택한 콘텐츠 날짜 지정</button>}{[...new Set(periodEvents.map(event => event.date))].sort().map(date => <div key={date}><div className="yp-sday">{md2(date)}{date === today ? <span className="yp-tag yp-acc">오늘</span> : null}</div>
        {periodEvents.filter(event => event.date === date).map(event => <button key={`${event.item.project.id}-${event.kind}`} type="button" className="yp-sit" style={{ width: "100%", textAlign: "left" }} onClick={() => event.kind === "cf" || event.kind === "pub" ? window.location.assign(projectHref(event.item.project)) : open(event.item)}>
          <span className={`yp-tag${event.kind === "up" || event.kind === "pub" ? " yp-acc" : event.kind === "cf" ? " yp-warn" : ""}`}>{event.label}</span><span style={{ flex: 1, minWidth: 0 }}>{projectName(event.item.project)}</span></button>)}</div>)}
        {!periodEvents.length ? <p className="yp-hint">이 기간에 일정이 없어요.</p> : null}</div>
      </div></div>
      <details className="yp-schedule-status"><summary>전체 진행 현황 {shown.length}개</summary>
      <div className="yp-scards">{shown.map(item => { const [cls, text] = state(item); return <Link key={item.project.id} className="yp-scard" href={projectHref(item.project)}>
        <b className="yp-sc-t">{projectName(item.project)}</b><span className="yp-sc-p">담당 PD {pdName(item.project.assigneeId)}</span>
        <span className="yp-sc-s"><i className={`yp-sdot ${cls}`} />{stageLabel(item.project)}{text !== "여유" ? <span className={`yp-tag ${cls}`}>{text}</span> : null}</span>
        <span className="yp-muted" style={{ fontSize: 12 }}>{item.editDue ? `편집 완료일 ${md2(item.editDue)}` : "편집 완료일 —"} · {item.uploadPlan ? `업로드 예상일 ${md2(item.uploadPlan)}` : "업로드 예상일 —"}</span></Link>; })}
        {!shown.length ? <p className="yp-hint">진행 중인 영상이 없어요.</p> : null}</div></details>
    </>}
    <dialog ref={dialog} className="yp-modal" aria-labelledby="yp-dates-title" onClose={() => setEditing(null)}>
      <div className="yp-modal-h"><span id="yp-dates-title">일정 바꾸기 · {editing ? projectName(editing.project) : ""}</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => dialog.current?.close()}><X size={14} /></button></div>
      <div className="yp-modal-b"><div className="yp-g2">
        <label className="yp-lbl" style={{ margin: 0 }}>편집 완료일<input className="yp-in" type="date" value={form.editDue} onChange={event => setForm(value => ({ ...value, editDue: event.target.value }))} /></label>
        <label className="yp-lbl" style={{ margin: 0 }}>업로드 예상일<input className="yp-in" type="date" min={form.editDue || undefined} value={form.uploadPlan} onChange={event => setForm(value => ({ ...value, uploadPlan: event.target.value }))} /></label>
        <label className="yp-lbl" style={{ margin: 0, gridColumn: "1 / -1" }}>바꾸는 이유 (선택)<input className="yp-in" maxLength={200} value={form.why} onChange={event => setForm(value => ({ ...value, why: event.target.value }))} /></label></div>
        {form.editDue && form.uploadPlan && form.uploadPlan < form.editDue ? <div className="yp-errline">업로드 예상일은 편집 완료일보다 앞설 수 없어요.</div> : null}
        {editing?.log.length ? <><div className="yp-lbl">바꾼 기록 <span className="yp-gq">최근 5개</span></div><ul className="yp-hist">{editing.log.map(item => <li key={item.at + item.field}><time>{new Date(item.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</time>
          <span>{item.field === "uploadPlan" ? "업로드 예상일" : "편집 완료일"} {item.from ? md2(item.from) : "없음"} → {item.to ? md2(item.to) : "없음"} · {personName(item.by)}{item.why ? ` · ${item.why}` : ""}</span></li>)}</ul></> : null}</div>
      <div className="yp-modal-f"><button type="button" className="yp-btn" onClick={() => dialog.current?.close()}>취소</button>
        <button type="button" className="yp-btn yp-pri" disabled={busy || !editing || Boolean(form.editDue && form.uploadPlan && form.uploadPlan < form.editDue)}
          onClick={() => editing && void move(editing, { editDue: form.editDue, uploadPlan: form.uploadPlan, why: form.why }).then(ok => { if (ok) dialog.current?.close(); })}>저장</button></div>
    </dialog>
  </div>;
}
