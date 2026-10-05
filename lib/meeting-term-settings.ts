import type { OsRecord } from "./record-types";

export const MEETING_TERM_SETTING_KEY = "meeting_term_dictionary";
export type MeetingTerm = { from: string; to: string };

export function validMeetingTerms(value: unknown): MeetingTerm[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).filter((term): term is MeetingTerm => Boolean(term)
    && typeof term.from === "string" && typeof term.to === "string"
    && term.from.trim().length > 0 && term.from.trim().length <= 40
    && term.to.trim().length > 0 && term.to.trim().length <= 40)
    .map(term => ({ from: term.from.trim(), to: term.to.trim() }));
}

export function meetingTermSetting(records: OsRecord[]) {
  return records.find(record => record.record_type === "company_setting"
    && !record.archived_at && record.metadata.settingKey === MEETING_TERM_SETTING_KEY);
}

export function customMeetingTerms(records: OsRecord[]) {
  return validMeetingTerms(meetingTermSetting(records)?.metadata.terms);
}
