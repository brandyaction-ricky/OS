import type { OsRecord } from "../record-types";

export type TeamTaskSource = "meeting" | "telegram" | "planning" | "direct";

export function taskSource(task: Pick<OsRecord, "metadata" | "parent_id">, meetingIds: ReadonlySet<string> = new Set()): TeamTaskSource {
  const source = String(task.metadata?.source ?? "");
  if (source === "meeting" || task.metadata?.meetingId || task.metadata?.meetingItemId || (task.parent_id && meetingIds.has(task.parent_id))) return "meeting";
  if (source.includes("telegram") || task.metadata?.kind === "telegram_answer_feedback") return "telegram";
  if (["planning", "content"].includes(source) || task.metadata?.contentId || task.metadata?.sourceId) return "planning";
  return "direct";
}
