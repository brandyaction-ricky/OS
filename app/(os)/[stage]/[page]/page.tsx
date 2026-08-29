import { OperationsWorkspace } from "@/components/operations-workspace";
import { PlaceholderPage } from "@/components/placeholder-page";
import { MembersWorkspace } from "@/components/members-workspace";
import { AuditWorkspace } from "@/components/audit-workspace";
import { NAV_STAGES } from "@/lib/navigation";
import { WORKSPACE_CONFIGS } from "@/lib/workspace-config";

export default async function GenericPage({ params }: { params: Promise<{ stage: string; page: string }> }) {
  const resolved = await params;
  const href = `/${resolved.stage}/${resolved.page}`;
  const stage = NAV_STAGES.find((item) => item.pages.some((page) => page.href === href));
  const page = stage?.pages.find((item) => item.href === href);
  if (href === "/organization/members") return <MembersWorkspace />;
  if (href === "/settings/audit") return <AuditWorkspace />;
  const config = WORKSPACE_CONFIGS[href];
  if (config) return <OperationsWorkspace config={config} />;
  return <PlaceholderPage title={page?.label ?? "기능 준비"} stage={stage?.label ?? "OS"} />;
}
