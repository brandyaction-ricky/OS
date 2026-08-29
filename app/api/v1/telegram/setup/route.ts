import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TelegramResult {
  ok?: boolean;
  result?: Record<string, unknown>;
  description?: string;
}

async function requireAdmin(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 텔레그램 연결을 관리할 수 있습니다.");
}

async function telegram(method: string, body: Record<string, unknown> = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new ApiError(503, "TELEGRAM_NOT_CONFIGURED", "텔레그램 봇 토큰이 등록되지 않았습니다.");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json() as TelegramResult;
  if (!response.ok || !result.ok) throw new ApiError(502, "TELEGRAM_API_FAILED", "텔레그램 연결 요청에 실패했습니다.", result.description);
  return result.result ?? {};
}

function publicUrl() {
  return (process.env.OS_PUBLIC_URL ?? "https://brandyaction-os.vercel.app").replace(/\/$/, "");
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
    if (!configured) return NextResponse.json({ configured: false, webhook: null });
    const [bot, webhook] = await Promise.all([telegram("getMe"), telegram("getWebhookInfo")]);
    const { data: pendingUsers } = await createServiceSupabase()
      .from("os_telegram_users")
      .select("external_user_id,external_chat_id,display_name,username,status,requested_at")
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(100);
    return NextResponse.json({
      configured: true,
      bot: { username: bot.username ?? null, name: bot.first_name ?? null },
      webhook: {
        url: webhook.url ?? "",
        pendingUpdates: webhook.pending_update_count ?? 0,
        lastErrorAt: webhook.last_error_date ?? null,
        lastError: webhook.last_error_message ?? null,
      },
      pendingUsers,
    });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin(request);
    const body = await request.json() as { externalUserId?: string; action?: "approve" | "reject" };
    if (!body.externalUserId || !["approve", "reject"].includes(body.action ?? "")) {
      throw new ApiError(400, "INVALID_TELEGRAM_DECISION", "승인할 사용자와 처리 방식을 확인해 주세요.");
    }
    const actor = await authenticateRequest(request);
    const status = body.action === "approve" ? "approved" : "rejected";
    const supabase = createServiceSupabase();
    const { data, error } = await supabase.from("os_telegram_users").update({
      status, decided_at: new Date().toISOString(), decided_by: actor.user?.id ?? null,
    }).eq("external_user_id", body.externalUserId).select("external_user_id,status").single();
    if (error) throw new ApiError(500, "TELEGRAM_DECISION_FAILED", "텔레그램 사용자 승인 상태를 저장하지 못했습니다.", error.message);
    return NextResponse.json({ user: data });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
    if (!process.env.TELEGRAM_BOT_TOKEN || !secret) throw new ApiError(503, "TELEGRAM_NOT_CONFIGURED", "텔레그램 봇 토큰과 웹훅 보안값을 먼저 등록해 주세요.");
    await telegram("setWebhook", {
      url: `${publicUrl()}/api/v1/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    return NextResponse.json({ connected: true, url: `${publicUrl()}/api/v1/telegram/webhook` });
  } catch (error) { return apiErrorResponse(error); }
}
