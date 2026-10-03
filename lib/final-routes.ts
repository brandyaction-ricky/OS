// UI retirement only: storage, API endpoints and scheduled jobs remain unchanged.
export const RETIRED_ROUTES: Record<string, string> = {
  "/home/goals": "목표·KPI",
  "/home/reports": "월간 보고서",
  "/knowledge/skills": "Skill 관리",
  "/organization/finance": "경영지원",
  "/performance/overview": "성과 통합 현황",
  "/performance/weekly-kpi": "주간 KPI",
  "/performance/revenue": "매출",
  "/performance/funnels": "퍼널",
  "/performance/ads": "광고 성과",
  "/performance/customers": "자사몰 어드민",
};
export function retiredRoute(path: string) {
  const name = RETIRED_ROUTES[path];
  return name ? `/home?${new URLSearchParams({moved: name})}` : null;
}
