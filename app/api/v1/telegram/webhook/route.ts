import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { answerFromKnowledge } from "@/lib/server/answer";
import { safeSecretMatch, type RequestActor } from "@/lib/server/auth";
import { searchDocuments } from "@/lib/server/search";

export const runtime = "nodejs";

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string };
  text?: string;
  reply_to_message?: { from?: { is_bot?: boolean } };
}

interface TelegramUpdate { update_id: number; message?: TelegramMessage; }

function shouldRespond(message: TelegramMessage) {
  if (message.chat.type === "private") return true;
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").toLowerCase();
  const mentioned = username ? message.text?.toLowerCase().includes(`@${username}`) : false;
  return Boolean(mentioned || message.reply_to_message?.from?.is_bot);
}

async function sendTelegram(chatId: number, text: string, replyTo: number) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new ApiError(503, "TELEGRAM_NOT_CONFIGURED", "텔레그램 설정이 필요합니다.");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), reply_parameters: { message_id: replyTo } }),
  });
  if (!response.ok) throw new ApiError(502, "TELEGRAM_SEND_FAILED", "텔레그램 답변을 보내지 못했습니다.");
}

export async function POST(request: Request) {
  try {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
    const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_WEBHOOK_SECRET", "웹훅 인증에 실패했습니다.");
    const update = await request.json() as TelegramUpdate;
    const message = update.message;
    if (!message?.text || !message.from || !shouldRespond(message)) return NextResponse.json({ ok: true, ignored: true });
    const allowed = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
    if (allowed.size && !allowed.has(String(message.from.id))) {
      await sendTelegram(message.chat.id, "등록된 구성원만 브랜디 OS 지식을 사용할 수 있습니다.", message.message_id);
      return NextResponse.json({ ok: true, blocked: true });
    }
    const query = message.text.replace(/@[A-Za-z0-9_]+/g, "").trim();
    const supabase = createServiceSupabase();
    const actor: RequestActor = { type: "agent", id: `telegram:${message.from.id}`, user: null, role: "member", team: "", brand: null, allowedStatuses: ["canonical"], supabase };
    const { results } = await searchDocuments(actor, { query, mode: "hybrid", topK: 8, filters: { statuses: ["canonical"] } });
    const answer = await answerFromKnowledge(query, results);
    await sendTelegram(message.chat.id, answer, message.message_id);
    await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: String(message.from.id), external_chat_id: String(message.chat.id), question: query, answer, source_document_ids: [...new Set(results.map((result) => result.documentId))] });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiErrorResponse(error); }
}
