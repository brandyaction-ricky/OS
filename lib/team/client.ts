import { apiRequest, listRecords } from "../api-client";
import type { Meeting } from "../knowledge/model";
import type { OsRecord, RecordType } from "../record-types";

export async function teamCommand(token: string, input: Record<string, unknown>) {
  return apiRequest<{ id: string; version?: number }>("/api/v1/team/command", { method: "POST", token, body: JSON.stringify(input) });
}

export async function listTeamRange(token: string, type: RecordType, from: string, to: string) {
  const rows: OsRecord[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await listRecords(token, type, new URLSearchParams({ from, to, limit: "200", offset: String(offset) }).toString());
    rows.push(...page.records);
    if (page.records.length < 200 || rows.length >= page.total) return rows;
  }
}

export function meetingBusiness(meeting: Meeting) {
  return typeof meeting.brand === "string" ? meeting.brand : "";
}
