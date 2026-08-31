import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";

export async function getDefaultOrganization() {
  const { data, error } = await createServiceSupabase()
    .from("os_organizations")
    .select("id,slug,name")
    .eq("slug", "brandyaction")
    .single();
  if (error || !data) {
    throw new ApiError(503, "ORGANIZATION_NOT_READY", "조직 식별자가 아직 준비되지 않았습니다.");
  }
  return data as { id: string; slug: string; name: string };
}

export async function assertOrganization(actor: RequestActor, organizationId: string) {
  if (actor.type === "agent") {
    if (!actor.organizationId || actor.organizationId !== organizationId) {
      throw new ApiError(403, "ORGANIZATION_FORBIDDEN", "이 에이전트 키의 조직과 요청 조직이 일치하지 않습니다.");
    }
    return;
  }
  const organization = await getDefaultOrganization();
  if (organization.id !== organizationId) {
    throw new ApiError(403, "ORGANIZATION_FORBIDDEN", "요청한 조직에 접근할 수 없습니다.");
  }
}
