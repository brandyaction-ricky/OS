// /회의준비, /회의기록 명령 파싱. 옛 사내 봇(cmd_meeting_prep/cmd_meeting)과 같은
// "사업 먼저, 추측 금지" 규칙을 그대로 따른다 — 사업을 못 알아들으면 저장하지 않는다.
// 사업 판정 자체(마이인/브랜디에듀)은 웹 회의 워크스페이스와 공유하는
// lib/meeting-business.ts가 소유한다.

import { resolveMeetingBusiness, type MeetingBusiness } from "./meeting-business.ts";

export type { MeetingBusiness };
export interface MeetingRecordCommand { business: MeetingBusiness; content: string }

const MEETING_PREP_PREFIX = /^\/?회의준비(?:@\w+)?(?=\s|$)/;
const MEETING_RECORD_PREFIX = /^\/?회의기록(?:@\w+)?(?=\s|$)/;

export function isMeetingPrepCommand(text: string) {
  return MEETING_PREP_PREFIX.test(text.trim());
}

/** "/회의준비 마이인" → "마이인"(os_records.brand 필터값). 생략·못 알아들으면 ""(전체 브랜드). */
export function parseMeetingPrepBrand(text: string): string {
  const rest = text.trim().replace(MEETING_PREP_PREFIX, "").trim();
  if (!rest) return "";
  return resolveMeetingBusiness(rest.split(/\s+/, 1)[0])?.recordBrand ?? "";
}

export function isMeetingRecordCommand(text: string) {
  return MEETING_RECORD_PREFIX.test(text.trim());
}

/**
 * "/회의기록 마이인 오늘 회의 내용..." → {business, content}.
 * 첫 토큰이 알려진 사업이 아니면 null(사용법 안내만 하고 저장하지 않는다 — 추측 금지).
 */
export function parseMeetingRecordCommand(text: string): MeetingRecordCommand | null {
  const body = text.trim().replace(MEETING_RECORD_PREFIX, "").trim();
  const match = body.match(/^(\S+)\s*([\s\S]*)$/);
  if (!match) return null;
  const business = resolveMeetingBusiness(match[1]);
  if (!business) return null;
  return { business, content: match[2].trim() };
}
