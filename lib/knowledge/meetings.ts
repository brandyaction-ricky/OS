import type { KnowledgeActor } from "./access.ts";
import type { Meeting, MeetingItem } from "./model.ts";

type RecordRow = { id: string; title: string; description?: string | null; status: string; version: number; owner_id: string; created_by: string; created_at?: string; updated_at: string; starts_at?: string | null; parent_id?: string | null; metadata?: Record<string, unknown> | null };
const text = (value: unknown) => typeof value === "string" ? value : "";

/** Read-only compatibility projection. Never infer access from old free-text participant names. */
export function projectMeetings(rows: RecordRow[], decisions: RecordRow[], attendance: Array<{meeting_id:string;user_id:string}>, actor: KnowledgeActor): Meeting[] {
  if (actor.active === false || actor.type !== "user") return [];
  const attendanceByMeeting = new Map<string,string[]>(), decisionsByMeeting = new Map<string,RecordRow[]>();
  for (const attendee of attendance) attendanceByMeeting.set(attendee.meeting_id,[...(attendanceByMeeting.get(attendee.meeting_id) ?? []),attendee.user_id]);
  for (const decision of decisions) {
    if (decision.status !== "decided") continue;
    for (const meetingId of new Set([decision.parent_id,text(decision.metadata?.meetingId)].filter(Boolean) as string[]))
      decisionsByMeeting.set(meetingId,[...(decisionsByMeeting.get(meetingId) ?? []),decision]);
  }
  return rows.flatMap(row => {
    if (!["planned", "active", "review", "done"].includes(row.status)) return [];
    const metadata = row.metadata ?? {}, legacy = metadata.workspace !== "knowledge";
    const attendees = [...(attendanceByMeeting.get(row.id) ?? [])];
    // Historical records have no attendance relation; ownership is the only reliable identity.
    if (legacy && metadata.visibility == null && !attendees.length) attendees.push(row.owner_id, row.created_by);
    const visible = attendees.includes(actor.ownerId) || (actor.memberKind === "staff" && (metadata.visibility === "team" || (legacy && metadata.visibility == null)));
    if (!visible) return [];
    if (!legacy) return [{...row, description:row.description ?? "", starts_at:row.starts_at ?? null, attendees:[...new Set(attendees)], metadata} as Meeting];
    const items: MeetingItem[] = (decisionsByMeeting.get(row.id) ?? []).map(d => ({
      id:d.id, kind:"decision", text:d.title, state:"accepted", source:"manual", addedBy:d.created_by,
      legacyConfirmed:true, confirmedBy:text(d.metadata?.decidedBy) || d.created_by,
      confirmedAt:text(d.metadata?.decidedAt) || d.created_at, reviewMissing:!d.metadata?.decidedBy || !d.metadata?.decidedAt,
    }));
    return [{...row, legacy:true, description:text(metadata.transcript) || row.description || "", starts_at:row.starts_at ?? null, status:row.status as Meeting["status"], attendees:[...new Set(attendees)],
      metadata:{workspace:"knowledge",visibility:metadata.visibility === "attendees" ? "attendees" : "team",agenda:row.description ?? "",summary:text(metadata.summary),items},
    }];
  });
}

export function meetingDecisions(meetings: Meeting[]) {
  return meetings.slice().sort((a,b)=>(b.starts_at ?? b.updated_at).localeCompare(a.starts_at ?? a.updated_at)).flatMap(meeting => {
    const decisions = meeting.metadata.items.filter(item => item.kind === "decision" && item.state !== "discarded" && !(item.source === "ai" && item.state !== "accepted"));
    const corrections: MeetingItem[] = (meeting.metadata.corrections ?? []).map((c,index) => ({id:`correction-${index}`,kind:"decision",text:c.text,state:"accepted",source:"manual",addedBy:c.by,confirmedBy:c.by,confirmedAt:c.at,correctionReason:c.reason}));
    return [...decisions,...corrections].map(item => ({meeting,item,confirmed:Boolean(item.legacyConfirmed || (meeting.status === "done" && item.state === "accepted"))}));
  });
}

// Approved product policy. Enabling a storage lifecycle job is a separate release gate.
export const MEETING_RETENTION = Object.freeze({audioDays:30,transcriptDays:365,evidence:"decision-excerpts",automaticDeletionEnabled:false});
