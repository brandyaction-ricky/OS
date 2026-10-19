import { agentKeyPolicy, defaultAgentExpiry } from "@/lib/agent-key-policy";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/server/auth";
import { getDefaultOrganization } from "@/lib/server/organization";

const TOOL_LABEL = { claude: "Claude", codex: "Codex" } as const;
const inputSchema = z.object({ tool: z.enum(["claude", "codex"]) }).strict();

/**
 * [내 AI 연결]: a signed-in member issues a key for their own AI, without an admin. It is always theirs, 초안 쓰기 (no canonical
 * writes) and 90 days; pressing again for the same AI revokes the previous one, so a lost key is replaced, not piled up.
 * The answer is a connector address with the key inside, shown once, so no terminal or config file is needed.
 * Admins still issue other access levels and keys for other people in 설정 › 권한·접근 키.
 */
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: false });
    const { tool } = inputSchema.parse(await parseJson(request, 1_000));
    const service = createServiceSupabase();
    const { data: profile } = await service.from("os_profiles").select("display_name,email,is_active,is_shared_account").eq("id", actor.id).maybeSingle();
    if (!profile?.is_active) throw new ApiError(403, "AGENT_OWNER_INVALID", "활성 구성원만 내 AI를 연결할 수 있습니다.");
    if (profile.is_shared_account) throw new ApiError(403, "SHARED_ACCOUNT_SELF_KEY", "공용 계정은 직접 연결할 수 없습니다. 개인 계정으로 로그인해 주세요.");
    const organization = await getDefaultOrganization();
    const name = `${profile.display_name || profile.email || "구성원"} · 내 ${TOOL_LABEL[tool]}`;
    const revoked = await service.from("os_agent_keys").update({ active: false, revoked_at: new Date().toISOString() })
      .eq("organization_id", organization.id).eq("owner_user_id", actor.id).eq("name", name).eq("active", true);
    if (revoked.error) throw new ApiError(400, "AGENT_KEY_REVOKE_FAILED", "이전 키를 정리하지 못했습니다.", revoked.error.message);
    const raw = `bos_pat_${randomBytes(24).toString("base64url")}`;
    const { scopes, allowedStatuses } = agentKeyPolicy("draft");
    const { error } = await service.from("os_agent_keys").insert({
      name, key_hash: createHash("sha256").update(raw).digest("hex"), key_prefix: raw.slice(0, 16),
      created_by: actor.id, owner_user_id: actor.id, organization_id: organization.id, team: "", brand: null,
      scopes, allowed_statuses: allowedStatuses, enforce_write_statuses: true,
      expires_at: new Date(`${defaultAgentExpiry()}T23:59:59Z`).toISOString(),
    });
    if (error) throw new ApiError(400, "AGENT_KEY_CREATE_FAILED", "내 AI 연결 키를 만들지 못했습니다.", error.message);
    // One line to paste into Claude's 커넥터 추가: the MCP address with the key in it (app/api/mcp reads ?key=).
    const connectorUrl = new URL(`/api/mcp?${new URLSearchParams({ organizationId: organization.id, key: raw })}`, request.url).toString();
    return NextResponse.json({ name, connectorUrl }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AGENT_KEY", "연결할 AI를 골라 주세요."));
    return apiErrorResponse(error);
  }
}
