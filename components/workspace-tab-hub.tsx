"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {WORKSPACE_TABS,type WorkspaceHub} from "@/lib/workspace-tabs";
import {PageTitle} from "./page-title";
import {WorkspaceSection} from "./workspace-section";
import {GrowthDashboard} from "./growth-dashboard";
import {GoalsWorkspace} from "./goals-workspace";
import {ReportsWorkspace} from "./reports-workspace";
import {RevenueWorkspace,CommerceAdminLinks,AcquisitionFunnelWorkspace,WeeklyKpiWorkspace} from "./performance-workspaces";
import {AdPerformanceWorkspace} from "./ad-performance-workspace";
import {WeeklyScheduleWorkspace,LeaveWorkspace} from "./organization-v3-workspaces";
const views={overview:GrowthDashboard,goals:GoalsWorkspace,reports:ReportsWorkspace,"weekly-kpi":WeeklyKpiWorkspace,revenue:RevenueWorkspace,customers:CommerceAdminLinks,ads:AdPerformanceWorkspace,funnels:AcquisitionFunnelWorkspace,schedule:WeeklyScheduleWorkspace,leave:LeaveWorkspace};
export function WorkspaceTabHub({hub,initialTab}:{hub:WorkspaceHub;initialTab?:string}) {
 const search=useSearchParams(), config=WORKSPACE_TABS[hub];const current=config.tabs.find(([key])=>key===(search.get("tab")??initialTab))??config.tabs[0];const View=views[current[0]];
 return <><header className="page-header"><div className="page-title-group"><PageTitle/><p>관련 업무를 한 화면에서 확인합니다. 탭 주소를 복사해 같은 화면을 공유할 수 있습니다.</p></div></header><nav className="studio-tabs hub-tabs" aria-label="업무 화면 탭">{config.tabs.map(([key,label])=><Link key={key} className={current[0]===key?"active":""} aria-current={current[0]===key?"page":undefined} href={`${config.href}?tab=${key}`}>{label}</Link>)}</nav><WorkspaceSection title={current[1]} key={current[0]}><View/></WorkspaceSection></>;
}
