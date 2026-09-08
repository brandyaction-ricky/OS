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
  return actor;
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
    const supabase = createServiceSupabase();
    const fields = "external_user_id,external_chat_id,display_name,username,status,requested_at,decided_at";
    const [pending, approved, turns, botResult, webhookResult] = await Promise.all([
      supabase.from("os_telegram_users").select(fields, { count: "exact" }).eq("status", "pending").order("requested_at", { ascending: false }).limit(100),
      supabase.from("os_telegram_users").select(fields, { count: "exact" }).eq("status", "approved").order("decided_at", { ascending: false }).limit(100),
      supabase.from("os_channel_turns").select("external_user_id,created_at,answer").eq("channel", "telegram").order("created_at", { ascending: false }).limit(1000),
      configured ? telegram("getMe").catch(() => null) : Promise.resolve(null),
      configured ? telegram("getWebhookInfo").catch(() => null) : Promise.resolve(null),
    ]);
    if (pending.error || approved.error || turns.error) throw new ApiError(500, "TELEGRAM_STATUS_READ_FAILED", "텔레그램 사용자·수신 이력을 읽지 못했습니다. 다시 확인해 주세요.");
    const bot = botResult ?? {}; const webhook = webhookResult ?? {};
    const withLastSeen = (users: NonNullable<typeof pending.data>) => users.map((user) => ({ ...user, last_received_at: turns.data?.find((turn) => turn.external_user_id === user.external_user_id)?.created_at ?? null }));
    return NextResponse.json({
      configured,
      diagnosticError: configured && (!botResult || !webhookResult) ? "Telegram 연결 상태를 확인하지 못했습니다. 저장된 사용자·수신 이력만 표시합니다." : null,
      lastReceivedAt: turns.data?.[0]?.created_at ?? null,
      lastProcessingError: turns.data?.filter((turn) => turn.answer?.startsWith("TELEGRAM_ERROR:")).slice(0, 1).map((turn) => ({ at: turn.created_at, message: turn.answer.slice("TELEGRAM_ERROR:".length) }))[0] ?? null,
      pendingCount: pending.count ?? 0,
      approvedCount: approved.count ?? 0,
      approvedUsers: withLastSeen(approved.data ?? []),
      bot: { username: bot.username ?? null, name: bot.first_name ?? null },
      webhook: webhookResult ? {
        url: webhook.url ?? "",
        pendingUpdates: webhook.pending_update_count ?? 0,
        lastErrorAt: webhook.last_error_date ?? null,
        lastError: webhook.last_error_message ?? null,
        lastSynchronizationErrorAt: webhook.last_synchronization_error_date ?? null,
      } : null,
      pendingUsers: withLastSeen(pending.data ?? []),
    });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const body = await request.json() as { externalUserId?: string; action?: "approve" | "reject" };
    if (!body.externalUserId || !["approve", "reject"].includes(body.action ?? "")) {
      throw new ApiError(400, "INVALID_TELEGRAM_DECISION", "승인할 사용자와 처리 방식을 확인해 주세요.");
    }
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
