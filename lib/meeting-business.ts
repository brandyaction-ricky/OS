// 회의 사업(마이인/브랜디에듀) 판정 — 웹 회의 워크스페이스와 텔레그램
// /회의준비·/회의기록이 함께 쓴다. 클라이언트·서버 어디서도 안전하게 import
// 가능하도록 외부 의존성이 없는 순수 함수로만 구성한다.

export interface MeetingBusiness {
  /** os_records.brand에 쓰는 값(성과관리·업무·회의 레코드 전체와 동일 표기). */
  recordBrand: string;
  /** 지식 문서함 폴더의 사업 세그먼트: 02_Wiki/{wikiFolderSegment}/운영/주간회의요약. */
  wikiFolderSegment: string;
  /** 회의 요약/원문 문서의 business 프런트매터·제목에 쓰는 표시 라벨(기존 문서와 동일). */
  label: string;
}

// 실제 OS 지식창고에 이미 쌓인 관례(02_Wiki/마이인·브랜디에듀/운영/주간회의요약)와
// os_records.brand 표기(성과관리·회의·업무 등에서 공통으로 쓰는 값)를 그대로 따른다.
const MYIN: MeetingBusiness = { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" };
const BRANDYEDU: MeetingBusiness = { recordBrand: "브랜디액션 에듀", wikiFolderSegment: "브랜디에듀", label: "자영업 교육" };
// 마이인·브랜디에듀 어느 쪽도 아닌 회의(콘텐츠 운영, 전사 경영 등)의 목적지.
// 기존에 이미 쓰이는 02_Wiki/회사/전략 같은 "회사" 최상위 폴더 관례를 그대로 따른다.
const COMPANY: MeetingBusiness = { recordBrand: "브랜디액션", wikiFolderSegment: "회사", label: "브랜디액션(전체)" };

const BRAND_ALIASES: Record<string, MeetingBusiness> = {
  "마이인": MYIN,
  "myin": MYIN,
  "브랜디에듀": BRANDYEDU,
  "브랜디액션에듀": BRANDYEDU,
  "자영업교육": BRANDYEDU,
  "교육": BRANDYEDU,
  "brandyedu": BRANDYEDU,
  "회사": COMPANY,
  "전체": COMPANY,
  "브랜디액션": COMPANY,
  "company": COMPANY,
};

export function resolveMeetingBusiness(token: string): MeetingBusiness | null {
  const normalized = token.trim().replace(/\s+/g, "").toLowerCase();
  return BRAND_ALIASES[normalized] ?? null;
}

/** 사업을 지정하지 않고 /회의준비를 부르면 순회할 KPI 추적 대상 사업 두 곳.
 * 회사(전체)는 회의 문서함 목적지일 뿐 KPI를 추적하는 사업이 아니라 제외한다. */
export const PRIMARY_MEETING_BUSINESSES: MeetingBusiness[] = [MYIN, BRANDYEDU];
