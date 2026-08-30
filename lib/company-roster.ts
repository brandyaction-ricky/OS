export const COMPANY_ROSTER = [
  { name: "안저", affiliation: "브랜디액션" },
  { name: "리키", affiliation: "브랜디액션" },
  { name: "제이", affiliation: "브랜디액션" },
  { name: "에릭", affiliation: "브랜디액션" },
  { name: "유쓰", affiliation: "브랜디액션" },
  { name: "로건", affiliation: "브랜디액션" },
  { name: "시아", affiliation: "브랜디액션" },
  { name: "윤익", affiliation: "RS 협업" },
  { name: "란다", affiliation: "RS 협업" },
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
