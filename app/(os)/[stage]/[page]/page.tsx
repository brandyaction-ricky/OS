import {WorkspaceTabHub} from "@/components/workspace-tab-hub";
import {ContentProductionWorkspace} from "@/components/content-production-workspace";
import {workspaceRedirect,productionRedirect} from "@/lib/workspace-tabs";
import {AiOperationsWorkspace} from "@/components/organization-v3-workspaces";
import { OperationsWorkspace } from "@/components/operations-workspace";
import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";
import { MembersWorkspace } from "@/components/members-workspace";
import { AuditWorkspace } from "@/components/audit-workspace";
import { redirect } from "next/navigation";
import { MeetingWorkspace } from "@/components/meeting-workspace";
import { ContentAutomationWorkspace } from "@/components/content-automation-workspace";
import { PublishingCalendarWorkspace } from "@/components/publishing-calendar-workspace";
import { SkillsWorkspace } from "@/components/skills-workspace";
import { SystemStatusWorkspace } from "@/components/system-status-workspace";
import { DataConnectionsWorkspace } from "@/components/data-connections-workspace";
import { TasksWorkspace } from "@/components/tasks-workspace";
import { FinanceWorkspace } from "@/components/finance-workspace";
import { ContentRadarWorkspace as ContentTopicsWorkspace } from "@/components/content-radar-workspace";
import { ContentPerformanceDashboard as ContentPerformanceWorkspace } from "@/components/content-performance-dashboard";
import { SettingsWorkspace } from "@/components/settings-workspaces";
import { KnowledgeGraphWorkspace } from "@/components/knowledge-graph-workspace";
import { ProjectHubWorkspace } from "@/components/project-hub-workspace";
import { findPage, NAV_STAGES } from "@/lib/navigation";
import { WORKSPACE_CONFIGS } from "@/lib/workspace-config";
import { canUseContentPlanningHandoff } from "@/lib/content-planning-handoff-gate";
import { canUseContentJevAssist } from "@/lib/content-jev-assist-gate";
import { canUseContentTopicJevAssist } from "@/lib/content-topic-jev-assist-gate";

type GenericPageProps = { params: Promise<{ stage: string; page: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: GenericPageProps): Promise<Metadata> {
  const resolved = await params;
  const query = await searchParams;
  const page = findPage(`/${resolved.stage}/${resolved.page}?tab=${typeof query.tab === "string" ? query.tab : ""}`);
  return { title: `${page.label} | 브랜디 OS` };
}

export default async function GenericPage({ params, searchParams }: GenericPageProps) {
  const resolved = await params;
  const href = `/${resolved.stage}/${resolved.page}`;
  const query = await searchParams;
  const legacy = workspaceRedirect(href,query) ?? productionRedirect(href,query);
  if(legacy)redirect(legacy);
  if(href==="/content/topics"&&query.tab==="planning") { const next=new URLSearchParams();for(const [key,value]of Object.entries(query))if(key!=="tab"&&typeof value==="string")next.set(key,value);next.set("step","planning");if(!next.has("sourceId"))next.set("view","tools");redirect(`/content/production?${next}`); }
  const contentPlanningHandoffEnabled = canUseContentPlanningHandoff(process.env);
  const contentJevAssistEnabled = canUseContentJevAssist(process.env);
  const contentTopicJevAssistEnabled = canUseContentTopicJevAssist(process.env);
  const stage = NAV_STAGES.find((item) => item.pages.some((page) => page.href === href));
  const page = stage?.pages.find((item) => item.href === href);
  if (href === "/organization/members") return <MembersWorkspace />;
  if (href === "/settings/audit") return <AuditWorkspace />;
  if (href === "/organization/projects") redirect("/organization/meetings");
  if (href === "/home/decisions") {
    const previous = await searchParams; const query = new URLSearchParams({tab:"decisions"});
    for(const [key,value] of Object.entries(previous)) if(key!=="tab"&&typeof value==="string") query.set(key,value);
    redirect(`/organization/meetings?${query}`);
  }
  if (href === "/organization/meetings") return <MeetingWorkspace />;
  if (href === "/organization/tasks") return <TasksWorkspace />;
  if (href === "/organization/agents") return <AiOperationsWorkspace />;
  if (href === "/organization/finance") return <FinanceWorkspace />;
  if(href==="/content/production") return <ContentProductionWorkspace showPlanningHandoff={contentPlanningHandoffEnabled} showJevAssist={contentJevAssistEnabled} showTopicJevAssist={contentTopicJevAssistEnabled}/>;
  if(href==="/performance/overview")return <WorkspaceTabHub hub="company"/>;
  if(href==="/performance/revenue")return <WorkspaceTabHub hub="revenue"/>;
  if(href==="/performance/ads")return <WorkspaceTabHub hub="ads"/>;
  if(href==="/organization/schedule")return <WorkspaceTabHub hub="schedule"/>;
  if (href === "/content/topics") return <ContentTopicsWorkspace showPlanningHandoff={contentPlanningHandoffEnabled} showTopicJevAssist={contentTopicJevAssistEnabled} />;
  if (href === "/content/automation") return <ContentAutomationWorkspace />;
  if (href === "/content/review") return <ContentAutomationWorkspace initialView="review" />;
  if (href === "/content/publishing") return <ContentAutomationWorkspace initialView="review" />;
  if (href === "/content/calendar") return <PublishingCalendarWorkspace />;
  if (href === "/content/performance") return <ContentPerformanceWorkspace />;
  if (href === "/knowledge/skills") return <SkillsWorkspace />;
  if (href === "/knowledge/development") return <ProjectHubWorkspace />;
  if (href === "/knowledge/graph") return <KnowledgeGraphWorkspace />;
  if (href === "/performance/connections") return <DataConnectionsWorkspace />;
  if (href === "/settings/monitoring") return <SystemStatusWorkspace tab="monitoring" />;
  if (href === "/settings/connections") return <SystemStatusWorkspace />;
  if (href === "/settings/access") return <SettingsWorkspace page="access" />;
  if (href === "/settings/company") return <SettingsWorkspace page="company" />;
  if (href === "/settings/channels") return <SystemStatusWorkspace tab="channels" />;
  if (resolved.stage === "performance") redirect("/performance/overview");
  const config = WORKSPACE_CONFIGS[href];
  if (config) return <OperationsWorkspace config={config} />;
  return <PlaceholderPage title={page?.label ?? "기능 준비"} stage={stage?.label ?? "OS"} />;
}
