export const KNOWLEDGE_CATEGORIES = [
  "회사 공통",
  "상품·브랜드",
  "고객·후기",
  "콘텐츠",
  "운영·업무",
  "성과·데이터",
  "경영지원",
  "개인 인사이트",
] as const;

export const SENSITIVE_ACCESS_ROSTER = ["리키", "안저", "시아", "제이"] as const;

export function roleLabel(role: string) {
  return (
    {
      admin: "관리자",
      lead: "리드",
      member: "구성원",
    } as Record<string, string>
  )[role] ?? "구성원";
}

export function operatingStatusLabel(status: string) {
  return (
    {
      active: "운영 중",
      ready: "준비 완료",
      planned: "예정",
      paused: "일시 중지",
      done: "종료",
    } as Record<string, string>
  )[status] ?? "상태 확인 필요";
}
