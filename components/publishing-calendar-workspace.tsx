"use client";

import { ArrowLeft, ArrowRight, CalendarDays, CircleAlert, Instagram, Send, Youtube } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listRecords, updateRecord } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

function currentMonth() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; }
function shiftMonth(value: string, delta: number) { const [year, month] = value.split("-").map(Number); const date = new Date(year, month - 1 + delta, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function meta(record: OsRecord, key: string) { const value = record.metadata?.[key]; return typeof value === "string" ? value : ""; }
function icon(platform: string) { return platform === "youtube" ? <Youtube size={12} /> : platform === "instagram" ? <Instagram size={12} /> : <Send size={12} />; }

export function PublishingCalendarWorkspace() {
  const { accessToken, demo } = useSession();
  const [month, setMonth] = useState(currentMonth);
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [platform, setPlatform] = useState("all");
  const [error, setError] = useState("");

  const load = useCallback(async () => { if (demo) return; try { const result = await listRecords(accessToken, "content_publish", "limit=200"); setRecords(result.records); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "발행 일정을 불러오지 못했습니다."); } }, [accessToken, demo]);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1);
    const start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
  }, [month]);
  const visible = records.filter((record) => record.starts_at && (platform === "all" || meta(record, "platform") === platform));

  const moveRecord = async (id: string, dateValue: string) => {
    const record = records.find((item) => item.id === id); if (!record) return;
    const current = record.starts_at ? new Date(record.starts_at) : new Date();
    const target = new Date(`${dateValue}T00:00:00`); target.setHours(current.getHours(), current.getMinutes(), 0, 0);
    try { await updateRecord(accessToken, { id: record.id, expectedVersion: record.version, startsAt: target.toISOString(), status: record.status === "draft" ? "scheduled" : record.status }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "발행 일정을 이동하지 못했습니다."); }
  };

  return <><header className="page-header"><div className="page-title-group"><span className="eyebrow">PUBLISHING CALENDAR</span><h1>발행 캘린더</h1><p>플랫폼별 일정을 확인하고 콘텐츠를 날짜 사이로 끌어 이동합니다.</p></div><div className="calendar-platforms"><button className={platform === "all" ? "active" : ""} onClick={() => setPlatform("all")}>전체</button><button className={platform === "youtube" ? "active youtube" : "youtube"} onClick={() => setPlatform("youtube")}><Youtube size={14} /> 유튜브</button><button className={platform === "instagram" ? "active instagram" : "instagram"} onClick={() => setPlatform("instagram")}><Instagram size={14} /> 인스타</button><button className={platform === "threads" ? "active threads" : "threads"} onClick={() => setPlatform("threads")}><Send size={14} /> 스레드</button></div></header>{error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}<div className="period-toolbar panel"><button className="icon-button" onClick={() => setMonth((value) => shiftMonth(value, -1))}><ArrowLeft size={16} /></button><label><CalendarDays size={16} /><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><strong>{month.replace("-", "년 ")}월</strong></label><button className="icon-button" onClick={() => setMonth((value) => shiftMonth(value, 1))}><ArrowRight size={16} /></button><button className="ghost-button" onClick={() => setMonth(currentMonth())}>이번 달</button></div><section className="publishing-calendar panel"><div className="calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-days">{days.map((date) => { const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; const items = visible.filter((record) => record.starts_at?.slice(0, 10) === key); return <div className={date.getMonth() + 1 === Number(month.slice(5)) ? "" : "outside"} key={key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveRecord(event.dataTransfer.getData("text/plain"), key)}><header><span>{date.getDate()}</span><small>{items.length || ""}</small></header>{items.map((record) => <button draggable key={record.id} className={`calendar-content ${meta(record, "platform") || "unknown"}`} onDragStart={(event) => event.dataTransfer.setData("text/plain", record.id)}><span>{icon(meta(record, "platform"))}</span><strong>{record.title}</strong><time>{record.starts_at?.slice(11, 16)}</time></button>)}</div>; })}</div></section></>;
}
