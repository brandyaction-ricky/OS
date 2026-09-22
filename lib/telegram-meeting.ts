// /회의준비, /회의기록 명령 파싱. 옛 사내 봇(cmd_meeting_prep/cmd_meeting)과 같은
// "사업 먼저, 추측 금지" 규칙을 그대로 따른다 — 사업을 못 알아들으면 저장하지 않는다.

export interface MeetingBusiness {
  /** os_records.brand에 쓰는 값(성과관리·업무·회의 레코드 전체와 동일 표기). */
  recordBrand: string;
  /** 지식 문서함 폴더의 사업 세그먼트: 02_Wiki/{wikiFolderSegment}/운영/주간회의요약. */
  wikiFolderSegment: string;
  /** 회의 요약/원문 문서의 business 프런트매터·제목에 쓰는 표시 라벨(기존 문서와 동일). */
  label: string;
}

export interface MeetingRecordCommand { business: MeetingBusiness; content: string }

const MEETING_PREP_PREFIX = /^\/?회의준비(?:@\w+)?(?=\s|$)/;
const MEETING_RECORD_PREFIX = /^\/?회의기록(?:@\w+)?(?=\s|$)/;

// 실제 OS 지식창고에 이미 쌓인 관례(02_Wiki/마이인·브랜디에듀/운영/주간회의요약)와
// os_records.brand 표기(성과관리·회의·업무 등에서 공통으로 쓰는 값)를 그대로 따른다.
const MYIN: MeetingBusiness = { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" };
const BRANDYEDU: MeetingBusiness = { recordBrand: "브랜디액션 에듀", wikiFolderSegment: "브랜디에듀", label: "자영업 교육" };

const BRAND_ALIASES: Record<string, MeetingBusiness> = {
  "마이인": MYIN,
  "myin": MYIN,
  "브랜디에듀": BRANDYEDU,
  "브랜디액션에듀": BRANDYEDU,
  "자영업교육": BRANDYEDU,
  "교육": BRANDYEDU,
  "brandyedu": BRANDYEDU,
};

export function resolveMeetingBusiness(token: string): MeetingBusiness | null {
  const normalized = token.trim().replace(/\s+/g, "").toLowerCase();
  return BRAND_ALIASES[normalized] ?? null;
}

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
