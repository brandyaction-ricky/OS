"use client";
import { useEffect, useState } from "react";
import { getDemoKnowledgeEvents } from "@/lib/demo-knowledge-store";
import { apiRequest } from "@/lib/api-client";
import type { DocumentStatus } from "@/lib/types";
import { statusLabel } from "./dashboard";
export function KnowledgeReviewHistory({ id, token, demo, revision }: { id: string; token: string | null; demo: boolean; revision: string }) {
  const [events, setEvents] = useState<Array<{id: string; to_status: DocumentStatus; note: string; created_at: string}>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setEvents([]); setError(""); if (demo) { setEvents(getDemoKnowledgeEvents(id)); return; } if (!token) return;
    let active = true;
    apiRequest<{events: typeof events}>(`/api/v1/documents/${encodeURIComponent(id)}/status`, {token}).then(result => { if (active) setEvents(result.events); }).catch(() => { if (active) setError("검토 이력을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [id, token, demo, revision]);
  return <section className="knowledge-review-history"><h3>최근 검토·상태 이력</h3>{error ? <p role="alert">{error}</p> : events.length ? events.map(event => <div key={event.id}><strong>{statusLabel(event.to_status)}</strong><time>{new Date(event.created_at).toLocaleString("ko-KR")}</time>{event.note ? <p>{event.note}</p> : null}</div>) : <p>{demo ? "데모에서는 상태 이력을 서버에 저장하지 않습니다." : "아직 상태 변경 이력이 없습니다."}</p>}</section>;
}
