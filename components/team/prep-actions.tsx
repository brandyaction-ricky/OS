"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { prepareMeeting } from "@/lib/api-client";
import type { Meeting } from "@/lib/knowledge/model";
import { TEAM_BUSINESSES, teamBusiness } from "@/lib/team/business";
import { teamCommand } from "@/lib/team/client";

type Brief = Awaited<ReturnType<typeof prepareMeeting>>;
const todayInKst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function needsAttention(task: { status?: unknown; due_date?: unknown }) { return task.status === "blocked" || typeof task.due_date === "string" && task.due_date < todayInKst(); }

export function TeamPrepView({ meetings, token, onChanged }: { meetings: Meeting[]; token: string; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [business, setBusiness] = useState<(typeof TEAM_BUSINESSES)[number]["key"]>("myin"), [brief, setBrief] = useState<Brief | null>(null), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const brand = TEAM_BUSINESSES.find(item => item.key === business)!.brand;
  useEffect(() => { let cancelled = false; setBrief(null); setError(""); void prepareMeeting(token, brand).then(result => { if (!cancelled) { setBrief(result); setSelected([...result.pending.map((_, index) => `p${index}`), ...result.todos.flatMap((task, index) => needsAttention(task) ? [`t${index}`] : [])]); } }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "회의 준비 자료를 불러오지 못했습니다."); }); return () => { cancelled = true; }; }, [token, brand]);
  const upcoming = meetings.filter(meeting => !meeting.legacy && meeting.status === "planned" && teamBusiness(meeting.brand ?? "")?.key === business).sort((a,b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""))[0];
  const agenda = useMemo(() => [
    ...(brief?.pending ?? []).flatMap((text,index) => selected.includes(`p${index}`) ? [`- 확인할 안건: ${text}`] : []),
    ...(brief?.todos ?? []).flatMap((task,index) => selected.includes(`t${index}`) && needsAttention(task) ? [`- 후속 업무: ${task.title}`] : []),
    ...(business !== "company" ? brief?.kpis ?? [] : []).map(kpi => `- KPI: ${kpi.title} · ${kpi.signal}`),
  ].join("\n"), [brief, selected, business]);
  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  async function start() {
    setBusy(true); setError("");
    try {
      let id: string | undefined = upcoming?.id;
      let version: number | undefined = upcoming?.version;
      if (!id) {
        const previous = meetings.find(meeting => meeting.id === brief?.latestMeeting?.id && meeting.status === "done" && !meeting.legacy);
        const created = await teamCommand(token, { action: "meeting.create", title: `${TEAM_BUSINESSES.find(item => item.key === business)!.label} 회의`, brand, previousMeetingId: previous?.id });
        id = created.id; version = created.version;
      }
      if (!id || !version) throw new Error("회의 기록을 만들지 못했습니다.");
      const saved = await teamCommand(token, { action: "meeting.save", id, expectedVersion: version, agenda });
      await teamCommand(token, { action: "meeting.start", id, expectedVersion: saved.version ?? version + 1 });
      await onChanged(); router.push(`/organization/meetings?meeting=${encodeURIComponent(id)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "회의를 시작하지 못했습니다."); } finally { setBusy(false); }
  }
  return <><div className="tm-toolbar">{TEAM_BUSINESSES.map(item => <button type="button" className="tm-chip" aria-pressed={business === item.key} onClick={() => setBusiness(item.key)} key={item.key}>{item.label}</button>)}</div>{error ? <div className="tm-callout" data-tone="danger" role="alert">{error}</div> : null}<div className="tm-callout" data-tone="info">{brief?.latestMeeting ? `${brief.latestMeeting.date?.slice(0, 10) ?? "이전"} 회의 이후` : "이전 회의가 없습니다."}{brief?.unreviewed?.length ? ` · 검수할 회의 ${brief.unreviewed.length}건` : ""}</div><div className="tm-detail-grid"><div className="tm-stack"><section className="panel tm-prep-section"><div className="card-head"><strong className="card-title">다음 회의</strong></div><div className="tm-prep-row">{upcoming ? <Link href={`/organization/meetings?meeting=${encodeURIComponent(upcoming.id)}`}>{upcoming.title}</Link> : "예정된 회의가 없습니다."}</div></section><section className="panel tm-prep-section"><div className="card-head"><strong className="card-title">확인할 결정·미결 안건</strong></div>{brief?.pending.length ? brief.pending.map((text,index) => <label className="tm-prep-row" key={`p${index}`}><input type="checkbox" checked={selected.includes(`p${index}`)} onChange={() => toggle(`p${index}`)} />{text}</label>) : <div className="empty-state">미결 안건이 없습니다.</div>}</section><section className="panel tm-prep-section"><div className="card-head"><strong className="card-title">막힘·기한 지남</strong></div>{brief?.todos.some(needsAttention) ? brief.todos.map((task,index) => needsAttention(task) ? <label className="tm-prep-row" key={task.id}><input type="checkbox" checked={selected.includes(`t${index}`)} onChange={() => toggle(`t${index}`)} /><span className="tm-grow">{task.title}</span><span className="tm-muted">{task.status === "blocked" ? "막힘" : task.due_date ?? "기한 없음"}</span></label> : null) : <div className="empty-state">막히거나 기한이 지난 업무가 없습니다.</div>}</section><section className="panel tm-prep-section"><div className="card-head"><strong className="card-title">진행 중</strong></div>{brief?.todos.some(task => !needsAttention(task)) ? brief.todos.filter(task => !needsAttention(task)).map(task => <div className="tm-prep-row" key={task.id}><span className="tm-grow">{task.title}</span><span className="tm-muted">{task.due_date ?? "기한 없음"}</span></div>) : <div className="empty-state">진행 중인 업무가 없습니다.</div>}</section><section className="panel tm-prep-section"><div className="card-head"><strong className="card-title">이전 회의 이후 완료</strong></div>{brief?.completed?.length ? brief.completed.map(task => <div className="tm-prep-row" key={task.id}>{task.title}</div>) : <div className="empty-state">최근 완료된 업무가 없습니다.</div>}</section>{business !== "company" ? <section className="panel tm-prep-section"><div className="card-head"><strong className="card-title">KPI</strong></div>{brief?.kpis.length ? brief.kpis.map(kpi => <div className="tm-prep-row" key={kpi.id}>{kpi.title} · {kpi.signal}</div>) : <div className="empty-state">입력된 KPI가 없습니다.</div>}</section> : null}</div><aside className="panel tm-side"><div className="tm-side-section"><h3>안건 미리보기</h3><p className="body-text" style={{ whiteSpace: "pre-wrap" }}>{agenda || "안건을 선택해 주세요."}</p></div><div className="tm-side-section"><button className="primary-button compact tm-wide-button" disabled={busy || !brief} onClick={() => void start()}>{busy ? "처리 중…" : "이 안건으로 회의 시작"}</button></div></aside></div></>;
}
