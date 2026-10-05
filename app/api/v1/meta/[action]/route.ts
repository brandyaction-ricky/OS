import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { assertConnectionAccess, auditChannelAction, canUseConnection } from "@/lib/server/channel-access";
import { authorizeMetaConnection, createMetaState, META_COOKIE, metaAuthorizationUrl, metaMode, publicMetaConnection, refreshMetaConnection, saveMetaConnection, testMetaConnection, type MetaConnection } from "@/lib/server/meta-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
const inputSchema = z.object({ platform: z.enum(["instagram", "threads"]), ownerId: z.string().uuid().optional(), teamShared: z.boolean().optional() });

export async function GET(request: Request, context: Context) {
  try {
    if ((await context.params).action !== "status") throw new ApiError(404, "NOT_FOUND", "지원하지 않는 채널 작업입니다.");
    const actor = await authenticateRequest(request);
    const { data, error } = await createServiceSupabase().from("os_meta_connections").select("*").or(`owner_id.eq.${actor.id},team_shared.eq.true`);
    if (error) throw new ApiError(503, "META_SCHEMA_REQUIRED", "채널 연결 저장소 적용이 필요합니다.");
    return NextResponse.json({ mode: metaMode(), connections: ((data ?? []) as MetaConnection[]).filter(row => canUseConnection(actor, row)).map(publicMetaConnection) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const actor = await authenticateRequest(request);
    const { action } = await context.params;
    const input = inputSchema.parse(await parseJson(request));
    const ownerId = input.ownerId ?? actor.id;
    if (action === "start") {
      assertConnectionAccess(actor, { owner_id: ownerId }, "reconnect");
      if (metaMode() === "mock") return NextResponse.json({ mock: true, connection: await saveMetaConnection(actor.id, input.platform) });
      const state = createMetaState(actor.id, input.platform);
      const response = NextResponse.json({ authorizationUrl: metaAuthorizationUrl(input.platform, state.nonce), mock: false });
      response.cookies.set(META_COOKIE, state.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/v1/meta", maxAge: 600 });
      return response;
    }
    if (!["test", "share", "disconnect", "refresh"].includes(action)) throw new ApiError(404, "NOT_FOUND", "지원하지 않는 채널 작업입니다.");
    const connection = await authorizeMetaConnection(actor, ownerId, input.platform, action === "share" ? "share" : action === "disconnect" ? "disconnect" : "use");
    if (action === "test") await testMetaConnection(actor, connection);
    if (action === "refresh") await refreshMetaConnection(actor, connection);
    if (action === "share") {
      if (typeof input.teamShared !== "boolean") throw new ApiError(400, "SHARE_REQUIRED", "공유 여부를 지정해 주세요.");
      const { error } = await createServiceSupabase().from("os_meta_connections").update({ team_shared: input.teamShared, updated_at: new Date().toISOString() }).eq("owner_id", ownerId).eq("platform", input.platform);
      if (error) throw new ApiError(500, "META_SHARE_FAILED", "팀 공유를 저장하지 못했습니다.");
      await auditChannelAction(actor.id, ownerId, input.platform, input.teamShared ? "팀 공유 켜기" : "팀 공유 끄기");
    }
    if (action === "disconnect") {
      const { error } = await createServiceSupabase().from("os_meta_connections").delete().eq("owner_id", ownerId).eq("platform", input.platform);
      if (error) throw new ApiError(500, "META_DISCONNECT_FAILED", "연결을 해제하지 못했습니다.");
      await auditChannelAction(actor.id, ownerId, input.platform, "OS 연결 해제");
    }
    return NextResponse.json({ ok: true, mock: metaMode() === "mock" });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "META_INPUT_INVALID", "채널 요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
