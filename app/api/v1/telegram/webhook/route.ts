import { NextResponse } from "next/server";
import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { answerFromKnowledge } from "@/lib/server/answer";
import { safeSecretMatch, type RequestActor } from "@/lib/server/auth";
import { searchDocuments } from "@/lib/server/search";

export const runtime = "nodejs";

interface TelegramPhoto { file_id: string; file_size?: number }
interface TelegramMessage {
  message_id: number; chat: { id: number; type: string }; from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string; caption?: string; photo?: TelegramPhoto[]; reply_to_message?: { from?: { is_bot?: boolean } };
}
interface TelegramUpdate { update_id: number; message?: TelegramMessage }

function shouldRespond(message: TelegramMessage) {
  if (message.chat.type === "private") return true;
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").toLowerCase();
  const text = message.text ?? message.caption ?? "";
  return Boolean(username && text.toLowerCase().includes(`@${username}`) || message.reply_to_message?.from?.is_bot);
}

async function telegramApi(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new ApiError(503, "TELEGRAM_NOT_CONFIGURED", "텔레그램 설정이 필요합니다.");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { ok?: boolean; result?: Record<string, unknown> };
  if (!response.ok || !result.ok) throw new ApiError(502, "TELEGRAM_API_FAILED", "텔레그램 요청을 처리하지 못했습니다.");
  return result.result ?? {};
}

async function sendTelegram(chatId: number, text: string, replyTo: number) {
  await telegramApi("sendMessage", { chat_id: chatId, text: text.slice(0, 3900), reply_parameters: { message_id: replyTo } });
}

async function ownerId(supabase: ReturnType<typeof createServiceSupabase>) {
  const email = process.env.TELEGRAM_CAPTURE_OWNER_EMAIL || "wjdgh1346@gmail.com";
  const { data, error } = await supabase.from("os_profiles").select("id").eq("email", email).eq("is_active", true).maybeSingle();
  if (error || !data) throw new ApiError(503, "CAPTURE_OWNER_MISSING", "폰 캡처를 저장할 활성 구성원이 없습니다.");
  return data.id as string;
}

async function imageData(message: TelegramMessage) {
  const photo = message.photo?.at(-1); if (!photo) return null;
  if (photo.file_size && photo.file_size > 4_000_000) throw new ApiError(413, "PHOTO_TOO_LARGE", "사진은 4MB 이하만 처리할 수 있습니다.");
  const result = await telegramApi("getFile", { file_id: photo.file_id });
  const filePath = String(result.file_path ?? ""); const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!filePath || !token) throw new ApiError(502, "PHOTO_DOWNLOAD_FAILED", "사진을 가져오지 못했습니다.");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`); const bytes = await response.arrayBuffer();
  if (!response.ok || bytes.byteLength > 4_000_000) throw new ApiError(413, "PHOTO_TOO_LARGE", "사진은 4MB 이하만 처리할 수 있습니다.");
  return `data:${response.headers.get("content-type") || "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function vision(dataUrl: string | null, instruction: string) {
  if (!dataUrl) return "";
  const key = process.env.OPENAI_API_KEY; if (!key) return "[이미지 첨부 · OCR 연결 대기]";
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_VISION_MODEL || OPENAI_ANSWER_MODEL, instructions: instruction, input: [{ role: "user", content: [{ type: "input_text", text: "사진의 정보를 원문에 충실하게 정리해 주세요." }, { type: "input_image", image_url: dataUrl }] }], max_output_tokens: 1000 }) });
  const body = await response.json() as { output?: { content?: { type?: string; text?: string }[] }[] };
  if (!response.ok) return "[이미지 첨부 · OCR 처리 실패]";
  return (body.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n").trim();
}

function captureKind(text: string) {
  if (/^\/?후기\b/.test(text)) return "review";
  if (/^\/?썸네일기록\b/.test(text)) return "thumbnail";
  if (/^#raw\b/i.test(text)) return "raw";
  if (/^\/?인박스\b/.test(text) || /^#인박스\b/.test(text)) return "inbox";
  if (/^\/?요약\b/.test(text)) return "summary";
  return "question";
}

function titleFrom(text: string, fallback: string) {
  const clean = text.replace(/^[/#]?\S+\s*/, "").trim(); return (clean || fallback).slice(0, 120);
}

async function saveCapture(supabase: ReturnType<typeof createServiceSupabase>, message: TelegramMessage, text: string, extracted: string) {
  const owner = await ownerId(supabase); const kind = captureKind(text); const now = new Date(); const date = now.toISOString().slice(0, 10); const month = date.slice(0, 7);
  const content = [`# ${titleFrom(text, kind === "review" ? "상품 후기" : kind === "thumbnail" ? "썸네일 결정" : "아이디어")}`, "", text.replace(/^[/#]?\S+\s*/, "").trim(), extracted ? `\n## 이미지 기록\n${extracted}` : "", `\n---\n텔레그램 캡처: ${now.toISOString()} · 메시지 ${message.message_id}`].filter(Boolean).join("\n");
  if (kind === "inbox") {
    const sourceRef = `inbox:${month}`; const { data: current } = await supabase.from("os_documents").select("id,content_md").eq("source", "telegram_capture").eq("source_ref", sourceRef).maybeSingle();
    if (current) { const { error } = await supabase.from("os_documents").update({ content_md: `${current.content_md}\n\n${content}` }).eq("id", current.id); if (error) throw error; return current.id as string; }
    const { data, error } = await supabase.from("os_documents").insert({ title: `${month} 아이디어 인박스`, content_md: content, folder: "01_Raw/아이디어인박스", status: "draft", source: "telegram_capture", source_ref: sourceRef, owner_id: owner, created_by: owner, brand: "", team: "", tags: ["telegram", "inbox"] }).select("id").single(); if (error) throw error; return data.id as string;
  }
  const folder = kind === "review" ? "02_Wiki/상품후기" : kind === "thumbnail" ? "03_Content/썸네일결정로그" : kind === "summary" ? "01_Raw/개인인사이트" : "01_Raw/폰캡처";
  const status = kind === "review" ? "canonical" : "draft";
  const { data, error } = await supabase.from("os_documents").insert({ title: titleFrom(text, `${date} 폰 캡처`), content_md: content, folder, status, source: "telegram_capture", source_ref: `telegram:${message.chat.id}:${message.message_id}`, owner_id: owner, created_by: owner, brand: "", team: "", tags: ["telegram", kind] }).select("id").single();
  if (error) throw error; return data.id as string;
}

async function summarizeUrl(text: string) {
  const url = text.match(/https?:\/\/\S+/)?.[0]; if (!url) return "요약할 URL을 함께 보내 주세요.";
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "BrandyActionOS/1.0" } });
  if (!response.ok) return `원문을 가져오지 못했습니다: ${url}`;
  const source = (await response.text()).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 60_000);
  const key = process.env.OPENAI_API_KEY; if (!key) return `${url}\n\n${source.slice(0, 1800)}`;
  const ai = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: OPENAI_ANSWER_MODEL, instructions: "제공된 웹 원문만 사용해 한국어로 핵심 주장, 실무 적용점, 확인할 점을 글머리표로 요약하세요.", input: source, max_output_tokens: 1000 }) });
  const body = await ai.json() as { output?: { content?: { type?: string; text?: string }[] }[] };
  return (body.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n").trim() || source.slice(0, 1800);
}

const OPERATIONAL_INTENTS = [
  { pattern: /프로젝트|사업\s*진행/, types: ["project"], label: "진행 프로젝트" },
  { pattern: /업무|할\s*일|태스크/, types: ["task"], label: "업무" },
  { pattern: /목표|오케이알|okr/i, types: ["goal", "kpi"], label: "목표·KPI" },
  { pattern: /콘텐츠|영상|유튜브/, types: ["content_topic", "content_script", "content_package", "content_short", "content_publish"], label: "콘텐츠" },
] as const;

async function operationalAnswer(supabase: ReturnType<typeof createServiceSupabase>, question: string) {
  const intent = OPERATIONAL_INTENTS.find((candidate) => candidate.pattern.test(question));
  if (!intent) return "";
  const { data, error } = await supabase
    .from("os_records")
    .select("title,status,stage,brand,team,due_date,progress,updated_at")
    .in("record_type", [...intent.types])
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (error) return "";
  if (!data?.length) return `현재 브랜디 OS에 등록된 ${intent.label}이 없습니다.`;
  const rows = data.map((record, index) => {
    const detail = [record.status, record.stage, record.brand, record.team, record.due_date ? `기한 ${record.due_date}` : "", Number(record.progress) > 0 ? `진행 ${record.progress}%` : ""].filter(Boolean).join(" · ");
    return `${index + 1}. ${record.title}${detail ? ` — ${detail}` : ""}`;
  });
  return `브랜디 OS의 최신 ${intent.label}입니다.\n\n${rows.join("\n")}`;
}

export async function POST(request: Request) {
  try {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""; const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_WEBHOOK_SECRET", "웹훅 인증에 실패했습니다.");
    const message = (await request.json() as TelegramUpdate).message;
    if (!message?.from || !shouldRespond(message)) return NextResponse.json({ ok: true, ignored: true });
    const text = (message.text ?? message.caption ?? "").replace(/@[A-Za-z0-9_]+/g, "").trim(); const kind = captureKind(text); const supabase = createServiceSupabase();
    const externalUserId = String(message.from.id);
    const allowed = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
    const { data: registered } = await supabase.from("os_telegram_users").select("status").eq("external_user_id", externalUserId).maybeSingle();
    if (!allowed.has(externalUserId) && registered?.status !== "approved") {
      await supabase.from("os_telegram_users").upsert({
        external_user_id: externalUserId,
        external_chat_id: String(message.chat.id),
        display_name: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
        username: message.from.username ?? "",
        status: registered?.status === "rejected" ? "rejected" : "pending",
        requested_at: new Date().toISOString(),
      }, { onConflict: "external_user_id" });
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: String(message.from.id), external_chat_id: String(message.chat.id), question: (text || "[사진 또는 빈 메시지]").slice(0, 4000), answer: "TELEGRAM_ACCESS_PENDING", source_document_ids: [] });
      await sendTelegram(message.chat.id, "등록 요청을 확인했습니다. 관리자가 승인하면 브랜디 OS를 사용할 수 있습니다.", message.message_id);
      return NextResponse.json({ ok: true, blocked: true, registrationPending: true });
    }
    if (kind !== "question" || message.photo?.length) {
      const dataUrl = await imageData(message); const extracted = await vision(dataUrl, kind === "review" ? "상품 후기 사진에서 상품명, 구매자 표현, 장점, 개선점, 수치와 문구를 정확히 추출하세요." : kind === "thumbnail" ? "썸네일 이미지의 문구, 구성, 색상, 선택 근거로 보이는 메모를 정확히 기록하세요." : "사진 속 텍스트를 OCR하고 아이디어와 해야 할 일을 구분하세요.");
      const source = kind === "summary" ? await summarizeUrl(text) : extracted; const id = await saveCapture(supabase, message, text, source);
      await sendTelegram(message.chat.id, `브랜디 OS에 저장했습니다.\n분류: ${kind === "review" ? "상품 후기 정본" : kind === "thumbnail" ? "썸네일 결정 기록" : kind === "summary" ? "URL 요약" : kind === "inbox" ? "아이디어 인박스" : "Raw 캡처"}\n문서 ID: ${id}`, message.message_id);
      return NextResponse.json({ ok: true, captured: true, documentId: id });
    }
    if (!text) return NextResponse.json({ ok: true, ignored: true });
    const actor: RequestActor = { type: "agent", id: `telegram:${message.from.id}`, user: null, role: "member", team: "", brand: null, allowedStatuses: ["canonical"], supabase };
    const [{ results }, liveOperations] = await Promise.all([
      searchDocuments(actor, { query: text, mode: "hybrid", topK: 8, filters: { statuses: ["canonical"] } }),
      operationalAnswer(supabase, text),
    ]);
    const knowledgeAnswer = results.length ? await answerFromKnowledge(text, results) : "";
    const answer = [liveOperations, knowledgeAnswer].filter(Boolean).join("\n\n") || "관련 회사 지식이나 운영 기록을 찾지 못했습니다. 핵심 단어를 바꿔 다시 물어봐 주세요.";
    await sendTelegram(message.chat.id, answer, message.message_id);
    await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: String(message.from.id), external_chat_id: String(message.chat.id), question: text, answer, source_document_ids: [...new Set(results.map((result) => result.documentId))] });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiErrorResponse(error); }
}
