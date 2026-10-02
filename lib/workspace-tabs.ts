export const WORKSPACE_TABS = {
 company: { href: "/performance/overview", tabs: [["overview","성과 통합"],["goals","목표·KPI"],["reports","월간 보고서"],["weekly-kpi","주간 KPI"]] },
 revenue: { href: "/performance/revenue", tabs: [["revenue","매출"],["customers","주문 관리"]] },
 ads: { href: "/performance/ads", tabs: [["ads","광고 성과"],["funnels","퍼널"]] },
 schedule: { href: "/organization/schedule", tabs: [["schedule","이번 주 일정"],["leave","연차·휴가"]] },
} as const;
export type WorkspaceHub = keyof typeof WORKSPACE_TABS;
export const LEGACY_WORKSPACE_TABS: Record<string,[string,string]> = {
 "/home/goals":["/performance/overview","goals"], "/home/reports":["/performance/overview","reports"],
 "/performance/weekly-kpi":["/performance/overview","weekly-kpi"], "/performance/customers":["/performance/revenue","customers"],
 "/performance/funnels":["/performance/ads","funnels"], "/organization/leave":["/organization/schedule","leave"],
};
export function workspaceRedirect(path:string, values:Record<string,string|string[]|undefined>) {
 const target=LEGACY_WORKSPACE_TABS[path]; if(!target)return null;
 const query=new URLSearchParams(); for(const [key,value] of Object.entries(values))if(key!=="tab")for(const item of Array.isArray(value)?value:value?[value]:[])query.append(key,item);
 query.set("tab",target[1]);return `${target[0]}?${query}`;
}
export function productionRedirect(path:string, values:Record<string,string|string[]|undefined>) {
 const steps:Record<string,string>={"/content/scripts":"script","/content/packages":"package","/content/shorts":"short","/content/youtube":"publish"};
 const step=steps[path];if(!step)return null;
 const query=new URLSearchParams();for(const [key,value] of Object.entries(values))for(const item of Array.isArray(value)?value:value?[value]:[])query.append(key,item);
 query.set("step",step); if(!query.get("sourceId"))query.set("view","tools");
 return `/content/production?${query}`;
}
