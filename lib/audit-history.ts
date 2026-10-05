export interface AuditHistoryEvent {
  id: string;
  subject_id: string;
  subject_type: string;
  actor_id: string | null;
  actor_type: "user" | "agent";
  event_type: string;
  created_at: string;
}

export interface AuditHistoryGroup<T extends AuditHistoryEvent> {
  key: string;
  events: T[];
  newest: string;
  oldest: string;
}

const GROUP_GAP_MS = 30 * 60 * 1000;

// Consecutive edits by the same actor on the same object form one expandable
// row. A status change, creation or archive is a separate decision and stays
// visible on its own.
export function groupAuditHistory<T extends AuditHistoryEvent>(events: T[]): AuditHistoryGroup<T>[] {
  const groups: AuditHistoryGroup<T>[] = [];
  for (const event of events) {
    const previous = groups.at(-1);
    const head = previous?.events[0];
    const tail = previous?.events.at(-1);
    const gap = tail ? Date.parse(tail.created_at) - Date.parse(event.created_at) : Infinity;
    if (head && tail && event.event_type === "updated" && tail.event_type === "updated"
      && event.actor_type === head.actor_type && event.actor_id === head.actor_id
      && event.subject_type === head.subject_type && event.subject_id === head.subject_id
      && Number.isFinite(gap) && gap >= 0 && gap <= GROUP_GAP_MS) {
      previous.events.push(event);
      previous.oldest = event.created_at;
    } else {
      groups.push({ key: event.id, events: [event], newest: event.created_at, oldest: event.created_at });
    }
  }
  return groups;
}
