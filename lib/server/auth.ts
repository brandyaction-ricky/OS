import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ApiError, getBearerToken } from "@/lib/http";
import { createServiceSupabase, createUserSupabase } from "@/lib/supabase/server";
import type { DocumentStatus, OsRole } from "@/lib/types";

export interface RequestActor {
  type: "user" | "agent";
  id: string;
  name: string;
  user: User | null;
  role: OsRole;
  team: string;
  brand: string | null;
  allowedStatuses: DocumentStatus[];
  scopes: string[];
  organizationId: string | null;
  ownerId: string;
  mustChangePassword: boolean;
  supabase: SupabaseClient;
}

export type AgentScope = "knowledge.read" | "knowledge.write" | "records.read" | "records.write";

export function hashAgentKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeSecretMatch(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function authenticateRequest(
  request: Request,
  options: { allowAgent?: boolean; requiredAgentScope?: AgentScope; allowPasswordChangeRequired?: boolean } = {},
): Promise<RequestActor> {
  const token = getBearerToken(request);
  if (token.startsWith("bos_pat_")) {
    if (!options.allowAgent) throw new ApiError(403, "AGENT_READ_ONLY", "에이전트 키는 이 작업을 수행할 수 없습니다.");
    const service = createServiceSupabase();
    const { data, error } = await service
      .from("os_agent_keys")
      .select("id,name,active,team,brand,allowed_statuses,scopes,organization_id,owner_user_id,expires_at")
      .eq("key_hash", hashAgentKey(token))
      .maybeSingle();
    if (error || !data || !data.active || (data.expires_at && new Date(data.expires_at) <= new Date())) {
      throw new ApiError(401, "INVALID_AGENT_KEY", "에이전트 키가 유효하지 않습니다.");
    }
    const scopes = (data.scopes ?? []).map((scope: string) => scope === "knowledge:search" ? "knowledge.read" : scope);
    const requiredScope = options.requiredAgentScope ?? "knowledge.read";
    if (!scopes.includes(requiredScope)) {
      throw new ApiError(403, "AGENT_SCOPE_REQUIRED", `에이전트 키에 ${requiredScope} 권한이 없습니다.`);
    }
    await service.from("os_agent_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return {
      type: "agent",
      id: data.id,
      name: data.name,
      user: null,
      role: "member",
      team: data.team ?? "",
      brand: data.brand,
      allowedStatuses: data.allowed_statuses ?? ["canonical"],
      scopes,
      organizationId: data.organization_id,
      ownerId: data.owner_user_id,
      mustChangePassword: false,
      supabase: service,
    };
  }

  const supabase = createUserSupabase(token);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) throw new ApiError(401, "INVALID_SESSION", "로그인 세션이 만료되었습니다.");
  const { data: profile } = await supabase
    .from("os_profiles")
    .select("role,team,is_active,must_change_password")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profile && profile.is_active === false) throw new ApiError(403, "ACCOUNT_DISABLED", "사용이 중지된 계정입니다.");
  if (profile?.must_change_password && !options.allowPasswordChangeRequired) {
    throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "비밀번호를 먼저 변경해야 합니다.");
  }
  return {
    type: "user",
    id: userData.user.id,
    name: userData.user.email ?? "구성원",
    user: userData.user,
    role: profile?.role ?? "member",
    team: profile?.team ?? "",
    brand: null,
    allowedStatuses: ["draft", "team", "review", "reviewed", "canonical"],
    scopes: ["knowledge.read", "knowledge.write", "records.read", "records.write"],
    organizationId: null,
    ownerId: userData.user.id,
    mustChangePassword: Boolean(profile?.must_change_password),
    supabase,
  };
}

export function requireAgentScope(actor: RequestActor, scope: AgentScope) {
  if (actor.type === "agent" && !actor.scopes.includes(scope)) {
    throw new ApiError(403, "AGENT_SCOPE_REQUIRED", `에이전트 키에 ${scope} 권한이 없습니다.`);
  }
}
