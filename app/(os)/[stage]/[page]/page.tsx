import {WorkspaceTabHub} from "@/components/workspace-tab-hub";
import {AccountWorkspace} from "@/components/account-workspace";
import {retiredRoute} from "@/lib/final-routes";
import {AiOperationsWorkspace} from "@/components/organization-v3-workspaces";
import { OperationsWorkspace } from "@/components/operations-workspace";
import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";
import { MembersWorkspace } from "@/components/members-workspace";
import { AuditWorkspace } from "@/components/audit-workspace";
import { redirect } from "next/navigation";
import { MeetingWorkspace } from "@/components/meeting-workspace";
import { SystemStatusWorkspace } from "@/components/system-status-workspace";
import { TasksWorkspace } from "@/components/tasks-workspace";
import { SettingsWorkspace } from "@/components/settings-workspaces";
import { ProjectHubWorkspace } from "@/components/project-hub-workspace";
import { findPage, NAV_STAGES } from "@/lib/navigation";
import { WORKSPACE_CONFIGS } from "@/lib/workspace-config";
import { legacyTeamMenusHidden } from "@/lib/server/hr-legacy-menus";
import { teamV1Enabled } from "@/lib/team/gate";
import { TeamWorkspaceV1 } from "@/components/team/team-workspace-v1";

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
  const teamEnabled = teamV1Enabled();
  if (["/organization/members", "/organization/leave", "/organization/schedule"].includes(href) && !(teamEnabled && href === "/organization/schedule") && await legacyTeamMenusHidden()) {
    redirect(href === "/organization/members" ? "/hr/employees" : href === "/organization/schedule" ? "/hr/leave?tab=calendar" : "/hr/leave");
  }
  const legacy = retiredRoute(href);
  if(legacy)redirect(legacy);
  const stage = NAV_STAGES.find((item) => item.pages.some((page) => page.href === href));
  const page = stage?.pages.find((item) => item.href === href);
  if (href === "/organization/people") {
    if (!teamEnabled) redirect("/organization/members");
    return <TeamWorkspaceV1 section="people" />;
  }
  if (teamEnabled && href === "/organization/meetings") return <TeamWorkspaceV1 section="meetings" />;
  if (teamEnabled && href === "/organization/tasks") return <TeamWorkspaceV1 section="tasks" />;
  if (teamEnabled && href === "/organization/schedule") return <TeamWorkspaceV1 section="schedule" />;
  if (teamEnabled && href === "/home/decisions") {
    const query = await searchParams;
    const next = new URLSearchParams({ tab: "decisions" });
    if (typeof query.record === "string") next.set("record", query.record);
    redirect(`/organization/meetings?${next}`);
  }
  if (href === "/organization/members") return <MembersWorkspace />;
  if (href === "/settings/audit") return <AuditWorkspace />;
  if (href === "/organization/projects") redirect("/organization/meetings");
  if (href === "/home/decisions") return <MeetingWorkspace initialTab="decisions" />;
  if (href === "/organization/meetings") return <MeetingWorkspace />;
  if (href === "/organization/tasks") return <TasksWorkspace />;
  if (href === "/organization/agents") return <AiOperationsWorkspace />;
  if(href==="/organization/schedule")return <WorkspaceTabHub hub="schedule"/>;
  if(href==="/organization/leave")return <WorkspaceTabHub hub="schedule" initialTab="leave"/>;
  if (href === "/knowledge/development") return <ProjectHubWorkspace />;
  if (href === "/performance/connections") redirect("/settings/connections");
  if (href === "/settings/monitoring") return <SystemStatusWorkspace tab="monitoring" />;
  if (href === "/settings/connections") return <SystemStatusWorkspace />;
  if (href === "/settings/access") return <SettingsWorkspace page="access" />;
  if (href === "/settings/account") return <AccountWorkspace />;
  if (href === "/settings/company") return <SettingsWorkspace page="company" />;
  if (href === "/settings/channels") return <SystemStatusWorkspace tab="channels" />;
  if (resolved.stage === "performance") redirect("/performance/overview");
  const config = WORKSPACE_CONFIGS[href];
  if (config) return <OperationsWorkspace config={config} />;
  return <PlaceholderPage title={page?.label ?? "기능 준비"} stage={stage?.label ?? "OS"} />;
}
