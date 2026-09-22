// /회의준비, /회의기록 명령 파싱. 옛 사내 봇(cmd_meeting_prep/cmd_meeting)과 같은
// "사업 먼저, 추측 금지" 규칙을 그대로 따른다 — 사업을 못 알아들으면 저장하지 않는다.

export interface MeetingRecordCommand { brand: string; content: string }

const MEETING_PREP_PREFIX = /^\/?회의준비(?:@\w+)?(?=\s|$)/;
const MEETING_RECORD_PREFIX = /^\/?회의기록(?:@\w+)?(?=\s|$)/;

// os_records.brand에 실제 저장되는 한글 라벨(성과관리 브랜드 표기와 동일: 마이인 / 브랜디액션 에듀).
const BRAND_ALIASES: Record<string, string> = {
  "마이인": "마이인",
  "myin": "마이인",
  "브랜디에듀": "브랜디액션 에듀",
  "브랜디액션에듀": "브랜디액션 에듀",
  "브랜디에듀사업": "브랜디액션 에듀",
  "교육": "브랜디액션 에듀",
  "brandyedu": "브랜디액션 에듀",
};

export function resolveMeetingBrand(token: string): string | null {
  const normalized = token.trim().replace(/\s+/g, "").toLowerCase();
  return BRAND_ALIASES[normalized] ?? null;
}

export function isMeetingPrepCommand(text: string) {
  return MEETING_PREP_PREFIX.test(text.trim());
}

/** "/회의준비 마이인" → "마이인". 사업 생략·못 알아들으면 ""(전체 브랜드 보여줌). */
export function parseMeetingPrepBrand(text: string): string {
  const rest = text.trim().replace(MEETING_PREP_PREFIX, "").trim();
  if (!rest) return "";
  return resolveMeetingBrand(rest.split(/\s+/, 1)[0]) ?? "";
}

export function isMeetingRecordCommand(text: string) {
  return MEETING_RECORD_PREFIX.test(text.trim());
}

/**
 * "/회의기록 마이인 오늘 회의 내용..." → {brand, content}.
 * 첫 토큰이 알려진 사업이 아니면 null(사용법 안내만 하고 저장하지 않는다 — 추측 금지).
 */
export function parseMeetingRecordCommand(text: string): MeetingRecordCommand | null {
  const body = text.trim().replace(MEETING_RECORD_PREFIX, "").trim();
  const match = body.match(/^(\S+)\s*([\s\S]*)$/);
  if (!match) return null;
  const brand = resolveMeetingBrand(match[1]);
  if (!brand) return null;
  return { brand, content: match[2].trim() };
}
