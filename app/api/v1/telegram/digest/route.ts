import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { digestFingerprintParts } from "@/lib/telegram-team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function kstParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new ApiError(503, "TELEGRAM_NOT_CONFIGURED", "텔레그램 봇 토큰이 등록되지 않았습니다.");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900) }), signal: AbortSignal.timeout(15_000) });
  const result = await response.json() as { ok?: boolean };
  if (!response.ok || !result.ok) throw new ApiError(502, "TELEGRAM_DIGEST_SEND_FAILED", "팀 요약을 보내지 못했습니다.");
}

export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_CRON_SECRET", "크론 인증에 실패했습니다.");
    const supabase = createServiceSupabase(); const now = kstParts();
    const { data: chats, error: chatsError } = await supabase.from("os_telegram_chats").select("external_chat_id,digest_hour_kst,last_digest_fingerprint").eq("digest_enabled", true).eq("digest_hour_kst", now.hour);
    if (chatsError) throw new ApiError(500, "DIGEST_CHAT_READ_FAILED", "팀 요약 설정을 읽지 못했습니다.");
    if (!chats?.length) return NextResponse.json({ ok: true, eligible: 0, sent: 0, unchanged: 0 });
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [recordResult, documentResult] = await Promise.all([
      supabase.from("os_records").select("id,title,record_type,status,assignee_id,due_date,updated_at").in("record_type", ["task", "decision"]).is("archived_at", null).order("updated_at", { ascending: false }).limit(100),
      supabase.from("os_documents").select("id,title,status,current_version,updated_at").eq("status", "canonical").gte("updated_at", since).order("updated_at", { ascending: false }).limit(20),
    ]);
    if (recordResult.error || documentResult.error) throw new ApiError(500, "DIGEST_DATA_READ_FAILED", "팀 요약 데이터를 읽지 못했습니다.");
    const records = recordResult.data ?? []; const documents = documentResult.data ?? [];
    const due = records.filter((row) => row.record_type === "task" && row.due_date && row.due_date <= now.date && !["done", "completed"].includes(row.status));
    const unassigned = records.filter((row) => row.record_type === "task" && !row.assignee_id && !["done", "completed"].includes(row.status));
    const review = records.filter((row) => ["review", "pending", "on_hold", "blocked"].includes(row.status));
    const parts = [...digestFingerprintParts(due), ...digestFingerprintParts(unassigned), ...digestFingerprintParts(review), ...digestFingerprintParts(documents)];
    const fingerprint = createHash("sha256").update(parts.sort().join("|")).digest("hex");
    if (!parts.length) return NextResponse.json({ ok: true, eligible: chats.length, sent: 0, unchanged: chats.length });
    const section = (title: string, rows: Array<{ title: string; due_date?: string | null; status?: string }>) => rows.length ? `\n${title}\n${rows.slice(0, 8).map((row) => `- ${row.title}${row.due_date ? ` · ${row.due_date}` : ""}${row.status ? ` · ${row.status}` : ""}`).join("\n")}` : "";
    const message = `브랜디 OS 변경 요약 · ${now.date}${section("기한 도래·초과", due)}${section("담당 미지정", unassigned)}${section("검토·보류", review)}${section("최근 변경 정본", documents)}\n\n변경이 있을 때만 전송됩니다.`;
    let sent = 0; let unchanged = 0;
    for (const chat of chats) {
      if (chat.last_digest_fingerprint === fingerprint) { unchanged += 1; continue; }
      await sendTelegram(chat.external_chat_id, message);
      const { error } = await supabase.from("os_telegram_chats").update({ last_digest_fingerprint: fingerprint, last_digest_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("external_chat_id", chat.external_chat_id);
      if (error) throw new ApiError(500, "DIGEST_RECEIPT_FAILED", "요약은 보냈지만 전송 기록을 저장하지 못했습니다.");
      sent += 1;
    }
    return NextResponse.json({ ok: true, eligible: chats.length, sent, unchanged });
  } catch (error) { return apiErrorResponse(error); }
}
