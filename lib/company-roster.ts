export const COMPANY_ROSTER = [
  { name: "안저", affiliation: "브랜디액션", roles: ["대표", "전략", "핵심 IP"] },
  { name: "리키", affiliation: "브랜디액션", roles: ["공동대표", "개발", "디자인", "UX/UI"] },
  { name: "제이", affiliation: "브랜디액션", roles: ["콘텐츠", "공정관리", "KPI관리"] },
  { name: "에릭", affiliation: "브랜디액션", roles: ["데이터", "CRM", "광고", "KPI관리"] },
  { name: "유쓰", affiliation: "브랜디액션", roles: ["편집", "유튜브", "콘텐츠", "트렌드"] },
  { name: "로건", affiliation: "브랜디액션", roles: ["편집", "유튜브", "콘텐츠", "시각화"] },
  { name: "시아", affiliation: "브랜디액션", roles: ["회계", "노무", "세무", "경리", "서류"] },
  { name: "윤익", affiliation: "RS 협업", roles: ["마케팅 교육 기획", "웨비나 진행"] },
  { name: "란다", affiliation: "RS 협업", roles: ["마케팅 교육 실무"] },
] as const;

export const BRANDYACTION_ROSTER = COMPANY_ROSTER.filter(
  (member) => member.affiliation === "브랜디액션",
);

export function memberMatchesRoster(
  member: { display_name?: string | null; email?: string | null },
  rosterName: string,
) {
  const displayName = member.display_name?.trim() ?? "";
  const emailName = member.email?.split("@")[0] ?? "";
  return displayName.includes(rosterName) || emailName.includes(rosterName);
}
