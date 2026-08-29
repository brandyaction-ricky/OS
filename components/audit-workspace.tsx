"use client";

import { Activity, CircleAlert, Clock3, FileClock } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "./session-provider";

interface AuditEvent { id: number; record_id: string; actor_id: string | null; event_type: string; from_status: string | null; to_status: string | null; changed_fields: string[]; created_at: string; os_records: { title: string; record_type: string } | null; }
export function AuditWorkspace() {
  const { accessToken, demo } = useSession(); const [events,setEvents]=useState<AuditEvent[]>([]); const [error,setError]=useState("");
  useEffect(()=>{ if(demo)return; fetch("/api/v1/audit",{headers:{authorization:`Bearer ${accessToken}`}}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body?.error?.message);return body;}).then(body=>setEvents(body.events)).catch(reason=>setError(reason.message)); },[accessToken,demo]);
  return <><header className="page-header"><div className="page-title-group"><span className="eyebrow">AUDIT TRAIL</span><h1>감사 로그</h1><p>운영 기록의 생성·수정·보관 이력을 되돌릴 수 있는 근거로 남깁니다.</p></div></header>{error?<div className="inline-alert danger"><CircleAlert size={16}/>{error}</div>:null}<section className="panel audit-panel"><div className="panel-header"><div><h2>최근 변경</h2><p>최신 100건 · 읽기 전용</p></div><span className="count-badge">{events.length}</span></div>{events.length?<div className="audit-list">{events.map(event=><div key={event.id}><span className="audit-icon">{event.event_type==="created"?<Activity size={15}/>:<FileClock size={15}/>}</span><span><strong>{event.os_records?.title ?? "운영 기록"}</strong><small>{event.event_type} · {event.changed_fields.join(", ") || "전체"}{event.from_status!==event.to_status?` · ${event.from_status??"-"} → ${event.to_status??"-"}`:""}</small></span><time><Clock3 size={12}/>{new Intl.DateTimeFormat("ko-KR",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(event.created_at))}</time></div>)}</div>:<div className="empty-state"><div><FileClock/><h3>아직 변경 이력이 없습니다.</h3><p>운영 기록을 만들거나 수정하면 자동으로 쌓입니다.</p></div></div>}</section></>;
}
