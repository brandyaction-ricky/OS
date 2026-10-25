"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { GATE_NAME } from "@/lib/youtube-process/confirm";
import { projectHref, projectName, stageLabel, YP_FLOW, YP_STAGE_INDEX } from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";
import { errorMessage, youtubeProcessClient, type YpMember, type YpScheduleItem } from "./youtube-process-data";

const WD = "일월화수목금토";
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const md2 = (date: string) => { const at = new Date(`${date}T00:00:00`); return `${at.getMonth() + 1}/${at.getDate()} (${WD[at.getDay()]})`; };
const dayDiff = (date: string) => Math.round((Date.parse(`${date}T00:00:00`) - new Date(new Date().toDateString()).getTime()) / 86_400_000);
type Kind = "up" | "ed" | "cf";
interface Ev { item: YpScheduleItem; kind: Kind; date: string; label: string }

/** S9 스케줄 (4-9): every project's 편집 완료 · 업로드 (예상) · 컨펌 대기 on a week or month calendar; drag a date to move it. */
export function YoutubeScheduleScreen() {
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
  const days = Array.from({ length: mode === "week" ? 7 : 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
  const shown = (items ?? []).filter(item => (pd === "all" || item.project.assigneeId === pd) && (stage === "all" || String(YP_STAGE_INDEX[item.project.yp.stage]) === stage) && item.project.yp.stage !== "done");
  const events: Ev[] = shown.flatMap(item => [
    ...(item.uploadPlan ? [{ item, kind: "up" as const, date: item.uploadPlan, label: "업로드 예상일" }] : []),
    ...(item.editDue && ["topic", "draft", "outline", "make"].includes(item.project.yp.stage) ? [{ item, kind: "ed" as const, date: item.editDue, label: "편집 완료일" }] : []),
    ...(showConfirm && item.waiting?.requestedAt ? [{ item, kind: "cf" as const, date: item.waiting.requestedAt.slice(0, 10), label: `${GATE_NAME[item.waiting.gate]} 대기` }] : []),
  ]);
  const byDay = new Map<string, Ev[]>();
  for (const event of events) byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
  const dupDays = [...byDay.entries()].filter(([, list]) => list.filter(event => event.kind === "up").length >= 2).map(([date]) => date);
  const noUpload = shown.filter(item => !item.uploadPlan && !["upload", "shorts"].includes(item.project.yp.stage));
  const pdName = (id: string | null) => members.find(member => member.id === id)?.name ?? "—";
  const state = (item: YpScheduleItem) => {
    const late = (item.editDue && ["outline", "make"].includes(item.project.yp.stage) && dayDiff(item.editDue) < 0) || (item.uploadPlan && YP_STAGE_INDEX[item.project.yp.stage] < 5 && dayDiff(item.uploadPlan) < 0);
    const tight = !late && YP_STAGE_INDEX[item.project.yp.stage] < 5 && ((item.editDue && dayDiff(item.editDue) <= 2) || (item.uploadPlan && item.editDue && dayDiff(item.uploadPlan) - dayDiff(item.editDue) <= 2));
    return late ? ["yp-bad", "지남"] : tight ? ["yp-warn", "빠듯함"] : ["", "여유"];
  };

  const move = async (item: YpScheduleItem, patch: { editDue?: string; uploadPlan?: string; why?: string }) => {
    if (!client) return false;
    setBusy(true); setError("");
    try { await client.moveDates(item.project.id, item.makeVersion, patch); await load(); return true; }
    catch (reason) { setError(errorMessage(reason)); await load(); return false; } finally { setBusy(false); }
  };
  const open = (item: YpScheduleItem) => { setEditing(item); setForm({ editDue: item.editDue, uploadPlan: item.uploadPlan, why: "" }); dialog.current?.showModal(); };
  const chip = (event: Ev) => {
    const draggable = event.kind !== "cf";
    return <button key={`${event.item.project.id}-${event.kind}`} type="button" className={`yp-ev yp-${event.kind}`} draggable={draggable} title={`${projectName(event.item.project)} · ${event.label}${draggable ? " · 끌어서 날짜 옮기기" : ""}`}
      onDragStart={evt => { evt.dataTransfer.setData("text/plain", JSON.stringify({ id: event.item.project.id, kind: event.kind })); }}
      onClick={() => draggable ? open(event.item) : window.location.assign(projectHref(event.item.project))}>{event.label} · {projectName(event.item.project)}</button>;
  };
  const drop = (date: string, raw: string) => {
    try {
      const { id, kind } = JSON.parse(raw) as { id: string; kind: Kind };
      const item = items?.find(row => row.project.id === id);
      if (item && kind !== "cf") void move(item, kind === "up" ? { uploadPlan: date } : { editDue: date });
    } catch { /* not one of our chips */ }
  };
  const title = mode === "week" ? `${md2(iso(days[0]))} ~ ${md2(iso(days[6]))}` : `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;

  return <>
    {noUpload.length ? <div className="yp-note" role="status"><CalendarDays size={16} className="yp-i" aria-hidden="true" /><div>업로드 예상일이 없는 영상 {noUpload.length}개: <b>{projectName(noUpload[0].project)}</b>{noUpload.length > 1 ? ` 외 ${noUpload.length - 1}개` : ""}
      <button type="button" className="yp-btn yp-sm yp-pri" style={{ marginLeft: 6 }} onClick={() => open(noUpload[0])}>업로드 예상일 정하기</button></div></div> : null}
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <div className="yp-seg2"><button type="button" className={mode === "week" ? "yp-on" : ""} onClick={() => { setMode("week"); setOffset(0); }}>이번 주</button><button type="button" className={mode === "month" ? "yp-on" : ""} onClick={() => { setMode("month"); setOffset(0); }}>이번 달</button></div>
      <button type="button" className="yp-ib" aria-label="이전" onClick={() => setOffset(value => value - 1)}><ChevronLeft size={16} /></button><b style={{ fontSize: 14 }}>{title}</b><button type="button" className="yp-ib" aria-label="다음" onClick={() => setOffset(value => value + 1)}><ChevronRight size={16} /></button>
      <select className="yp-in yp-w-auto" aria-label="담당 PD" value={pd} onChange={event => setPd(event.target.value)}><option value="all">담당 PD 전체</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
      <select className="yp-in yp-w-auto" aria-label="단계" value={stage} onChange={event => setStage(event.target.value)}><option value="all">단계 전체</option>{YP_FLOW.map((step, index) => <option key={step} value={index}>{step}</option>)}</select>
      <label className="yp-cbx"><input type="checkbox" checked={showConfirm} onChange={event => setShowConfirm(event.target.checked)} /> 컨펌 대기</label>
      <span style={{ flex: 1 }} /><div className="yp-legend"><span><i className="yp-sw2 yp-upx" />업로드 예상일</span><span><i className="yp-sw2" style={{ background: "var(--panel-3)" }} />편집 완료일</span><span><i className="yp-sw2" style={{ background: "var(--warning-soft)" }} />컨펌 대기</span></div>
    </div>
    {dupDays.length ? <div className="yp-note yp-warn" role="status"><AlertTriangle size={16} className="yp-i" aria-hidden="true" /><div>같은 날 업로드가 2건 이상이에요: {dupDays.map(md2).join(", ")}</div></div> : null}
    {items === null && !error ? <p className="yp-hint" role="status">불러오는 중이에요…</p> : <>
      <div className="yp-calw"><div className={`yp-cal${mode === "week" ? " yp-wk" : ""}`}>
        {[...WD].map(day => <div key={day} className="yp-dh">{day}</div>)}
        {days.map(date => { const key = iso(date); const list = byDay.get(key) ?? []; const ups = list.filter(event => event.kind === "up").length;
          return <div key={key} className={`yp-dc${mode === "month" && date.getMonth() !== anchor.getMonth() ? " yp-out" : ""}${key === today ? " yp-today" : ""}${ups >= 2 ? " yp-dup" : ""}`}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop(key, event.dataTransfer.getData("text/plain")); }}>
            <span className="yp-dn"><span>{date.getDate()}</span>{ups >= 2 ? <span className="yp-tag yp-warn" style={{ minHeight: 16 }}>⚠ 업로드 {ups}건</span> : null}</span>
            {[...list].sort((a, b) => a.kind === "up" ? -1 : b.kind === "up" ? 1 : 0).map(chip)}</div>; })}
      </div></div>
      <div className="yp-slist">{[...new Set(events.map(event => event.date))].sort().map(date => <div key={date}><div className="yp-sday">{md2(date)}{date === today ? <span className="yp-tag yp-acc">오늘</span> : null}</div>
        {events.filter(event => event.date === date).map(event => <button key={`${event.item.project.id}-${event.kind}`} type="button" className="yp-sit" style={{ width: "100%", textAlign: "left" }} onClick={() => event.kind === "cf" ? window.location.assign(projectHref(event.item.project)) : open(event.item)}>
          <span className={`yp-tag${event.kind === "up" ? " yp-acc" : event.kind === "cf" ? " yp-warn" : ""}`}>{event.label}</span><span style={{ flex: 1, minWidth: 0 }}>{projectName(event.item.project)}</span></button>)}</div>)}
        {!events.length ? <p className="yp-hint">이 기간에 일정이 없어요.</p> : null}</div>
      <h2 style={{ margin: "18px 0 8px", fontSize: 16 }}>현황</h2>
      <div className="yp-scards">{shown.map(item => { const [cls, text] = state(item); return <Link key={item.project.id} className="yp-scard" href={projectHref(item.project)}>
        <b className="yp-sc-t">{projectName(item.project)}</b><span className="yp-sc-p">담당 PD {pdName(item.project.assigneeId)}</span>
        <span className="yp-sc-s"><i className={`yp-sdot ${cls}`} />{stageLabel(item.project)}{text !== "여유" ? <span className={`yp-tag ${cls}`}>{text}</span> : null}</span>
        <span className="yp-muted" style={{ fontSize: 11 }}>{item.editDue ? `편집 완료일 ${md2(item.editDue)}` : "편집 완료일 —"} · {item.uploadPlan ? `업로드 예상일 ${md2(item.uploadPlan)}` : "업로드 예상일 —"}</span></Link>; })}
        {!shown.length ? <p className="yp-hint">진행 중인 영상이 없어요.</p> : null}</div>
    </>}
    <dialog ref={dialog} className="yp-modal" aria-labelledby="yp-dates-title" onClose={() => setEditing(null)}>
      <div className="yp-modal-h"><span id="yp-dates-title">일정 바꾸기 · {editing ? projectName(editing.project) : ""}</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => dialog.current?.close()}><X size={14} /></button></div>
      <div className="yp-modal-b"><div className="yp-g2">
        <label className="yp-lbl" style={{ margin: 0 }}>편집 완료일<input className="yp-in" type="date" value={form.editDue} onChange={event => setForm(value => ({ ...value, editDue: event.target.value }))} /></label>
        <label className="yp-lbl" style={{ margin: 0 }}>업로드 예상일<input className="yp-in" type="date" min={form.editDue || undefined} value={form.uploadPlan} onChange={event => setForm(value => ({ ...value, uploadPlan: event.target.value }))} /></label>
        <label className="yp-lbl" style={{ margin: 0, gridColumn: "1 / -1" }}>바꾸는 이유 (선택)<input className="yp-in" maxLength={200} value={form.why} onChange={event => setForm(value => ({ ...value, why: event.target.value }))} /></label></div>
        {form.editDue && form.uploadPlan && form.uploadPlan < form.editDue ? <div className="yp-errline">업로드 예상일은 편집 완료일보다 앞설 수 없어요.</div> : null}
        {editing?.log.length ? <><div className="yp-lbl">바꾼 기록 <span className="yp-gq">최근 5개</span></div><ul className="yp-hist">{editing.log.map(item => <li key={item.at + item.field}><time>{new Date(item.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</time>
          <span>{item.field === "uploadPlan" ? "업로드 예상일" : "편집 완료일"} {item.from ? md2(item.from) : "없음"} → {item.to ? md2(item.to) : "없음"} · {item.by}{item.why ? ` · ${item.why}` : ""}</span></li>)}</ul></> : null}</div>
      <div className="yp-modal-f"><button type="button" className="yp-btn" onClick={() => dialog.current?.close()}>취소</button>
        <button type="button" className="yp-btn yp-pri" disabled={busy || !editing || Boolean(form.editDue && form.uploadPlan && form.uploadPlan < form.editDue)}
          onClick={() => editing && void move(editing, { editDue: form.editDue, uploadPlan: form.uploadPlan, why: form.why }).then(ok => { if (ok) dialog.current?.close(); })}>저장</button></div>
    </dialog>
  </>;
}
