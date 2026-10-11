import type { Meeting } from "../knowledge/model";
import type { OsRecord } from "../record-types";

export interface TeamDecision {
  id: string;
  text: string;
  status: "effective" | "pending" | "superseded" | "cancelled";
  brand: string;
  meetingId: string | null;
  meetingTitle: string;
  decidedBy: string | null;
  decidedAt: string | null;
  version: number | null;
  replacedBy: string | null;
  record: OsRecord | null;
}

export function teamDecisions(records: OsRecord[], meetings: Meeting[]): TeamDecision[] {
  const byId = new Map(meetings.map(meeting => [meeting.id, meeting]));
  const confirmedItems = new Set(records.map(record => String(record.metadata.meetingItemId ?? "")).filter(Boolean));
  const actual = records.flatMap(record => {
    if (!["decided", "confirmed", "superseded", "cancelled", "open", "review"].includes(record.status)) return [];
    const meetingId = record.parent_id ?? (typeof record.metadata.meetingId === "string" ? record.metadata.meetingId : null);
    return [{
      id: record.id, text: record.title,
      status: record.status === "superseded" ? "superseded" as const : record.status === "cancelled" ? "cancelled" as const : ["open", "review"].includes(record.status) ? "pending" as const : "effective" as const,
      brand: record.brand || byId.get(meetingId ?? "")?.brand || "", meetingId, meetingTitle: byId.get(meetingId ?? "")?.title ?? "기록 없음",
      decidedBy: String(record.metadata.confirmedBy ?? record.metadata.decidedBy ?? record.created_by),
      decidedAt: String(record.metadata.confirmedAt ?? record.metadata.decidedAt ?? record.created_at),
      version: record.version, replacedBy: typeof record.metadata.replacedBy === "string" ? record.metadata.replacedBy : null, record,
    }];
  });
  const candidates = meetings.flatMap(meeting => meeting.status === "review" ? meeting.metadata.items.flatMap(item => item.kind === "decision" && item.state !== "discarded" && !confirmedItems.has(item.id) ? [{ id: item.id, text: item.text, status: "pending" as const, brand: meeting.brand ?? "", meetingId: meeting.id, meetingTitle: meeting.title, decidedBy: null, decidedAt: meeting.starts_at, version: null, replacedBy: null, record: null }] : []) : []);
  return [...actual, ...candidates].sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
}
