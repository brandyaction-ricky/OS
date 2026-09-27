import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { formatCandidates } from "@/lib/instagram-topics";
import { researchInstagramTopics } from "@/lib/server/instagram-topic-research";

export const maxDuration = 60;

type TelegramMessage = { message_id: number; chat: { id: number; type: string }; from?: { id: number }; text?: string };
type TelegramUpdate = { message?: TelegramMessage };

function matchesSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received); const b = Buffer.from(expected);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

async function sendMessage(chatId: number, replyTo: number, text: string): Promise<void> {
  const token = process.env.INSTAGRAM_TOPICS_TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_TOKEN_NOT_CONFIGURED");
  const chunks = text.match(/[\s\S]{1,3900}/g) ?? [];
  for (const chunk of chunks) {
    const result = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, reply_parameters: { message_id: replyTo } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) throw new Error(`TELEGRAM_SEND_FAILED:${result.status}`);
  }
}

export async function POST(request: Request) {
  const expected = process.env.INSTAGRAM_TOPICS_TELEGRAM_WEBHOOK_SECRET ?? "";
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || !matchesSecret(received, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const update = await request.json() as TelegramUpdate;
  const message = update.message;
  if (!message?.from || message.chat.type !== "private") return NextResponse.json({ ok: true, ignored: true });
  const text = message.text?.trim() ?? "";
  const allowed = new Set((process.env.INSTAGRAM_TOPICS_ALLOWED_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  if (!allowed.has(String(message.from.id))) {
    await sendMessage(message.chat.id, message.message_id, `이 봇은 승인된 사용자만 사용할 수 있습니다. 관리자에게 이 사용자 ID를 전달해 주세요: ${message.from.id}`);
    return NextResponse.json({ ok: true, blocked: true });
  }
  if (/^\/start(?:@[\w_]+)?$/i.test(text) || /^\/help(?:@[\w_]+)?$/i.test(text)) {
    await sendMessage(message.chat.id, message.message_id, "브랜디액션 인스타그램 주제 기획 봇입니다. /주제 명령을 보내면 최근 공개 자료를 조사해 근거가 있는 주제 후보 3개를 제안합니다. /주제 뒤에 원하는 대상이나 분야를 덧붙일 수 있습니다.");
    return NextResponse.json({ ok: true });
  }
  const match = text.match(/^\/(?:주제|topics)(?:@[\w_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) {
    await sendMessage(message.chat.id, message.message_id, "주제 기획을 시작하려면 /주제 를 보내 주세요.");
    return NextResponse.json({ ok: true });
  }
  try {
    const candidates = await researchInstagramTopics(match[1] ?? "");
    await sendMessage(message.chat.id, message.message_id, formatCandidates(candidates));
    return NextResponse.json({ ok: true, candidates: 3 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("instagram-topics research failed", /^[A-Z_]+(?::\d{3})?$/.test(code) ? code : "UNKNOWN");
    const notice = code === "CHANNEL_BRIEF_NOT_CONFIGURED" || code === "OPENAI_NOT_CONFIGURED"
      ? "기획 자료 설정이 아직 완료되지 않았습니다. 관리자에게 연결 상태를 확인해 달라고 요청해 주세요."
      : code === "OPENAI_REQUEST_FAILED:429"
        ? "OpenAI API 사용 한도 또는 크레딧을 확인해 주세요. 확인되지 않은 주제는 제안하지 않았습니다."
      : "자료 조사 또는 주제 생성에 실패했습니다. 확인되지 않은 주제는 제안하지 않았습니다. 잠시 뒤 다시 시도해 주세요.";
    await sendMessage(message.chat.id, message.message_id, notice);
    return NextResponse.json({ ok: true, failed: true });
  }
}
