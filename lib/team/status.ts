export type TeamTaskColumn = "todo" | "active" | "blocked" | "review" | "done";

export function taskColumn(status: string): TeamTaskColumn | null {
  if (["backlog", "planned", "todo"].includes(status)) return "todo";
  if (["active", "doing"].includes(status)) return "active";
  if (status === "blocked") return "blocked";
  if (status === "review") return "review";
  if (status === "done") return "done";
  return null;
}

export function taskStatusForColumn(column: TeamTaskColumn, current: string) {
  if (column === "todo") return taskColumn(current) === "todo" ? current : "planned";
  return column;
}

export function legacyMeetingStatus(meeting: { status: string; metadata?: Record<string, unknown> | null; description?: string | null }, linkedCount: number) {
  if (meeting.status === "active" && linkedCount === 0 && (meeting.metadata?.summary || meeting.metadata?.transcript || meeting.description)) return "review";
  return meeting.status;
}
