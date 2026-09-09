import { NextResponse } from "next/server";
import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { answerFromKnowledge } from "@/lib/server/answer";
import { safeSecretMatch, type RequestActor } from "@/lib/server/auth";
import { captureKind, isBotAddressed } from "@/lib/telegram-intents";
import { searchDocuments } from "@/lib/server/search";
import { evidenceQueryText, hasLexicalEvidence } from "@/lib/search-relevance";

export const runtime = "nodejs";

interface TelegramPhoto { file_id: string; file_size?: number }
interface TelegramMessage {
  message_id: number; chat: { id: number; type: string }; from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string; caption?: string; photo?: TelegramPhoto[]; voice?: { file_id: string }; reply_to_message?: { from?: { is_bot?: boolean; username?: string } };
}
interface TelegramUpdate { update_id: number; message?: TelegramMessage }

function shouldRespond(message: TelegramMessage) {
  return isBotAddressed(message, process.env.TELEGRAM_BOT_USERNAME);
}

async function telegramApi(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new ApiError(503, "TELEGRAM_NOT_CONFIGURED", "텔레그램 설정이 필요합니다.");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const result = await response.json() as { ok?: boolean; result?: Record<string, unknown> };
  if (!response.ok || !result.ok) throw new ApiError(502, "TELEGRAM_API_FAILED", "텔레그램 요청을 처리하지 못했습니다.");
  return result.result ?? {};
}

async function sendTelegram(chatId: number, text: string, replyTo: number) {
  await telegramApi("sendMessage", { chat_id: chatId, text: text.slice(0, 3900), reply_parameters: { message_id: replyTo } });
}

async function ownerId(supabase: ReturnType<typeof createServiceSupabase>) {
  const email = process.env.TELEGRAM_CAPTURE_OWNER_EMAIL?.trim();
  let configuredOwnerId = "";
  if (!email) {
    const { data: setting, error: settingError } = await supabase
      .from("os_records")
      .select("assignee_id")
      .eq("record_type", "company_setting")
      .eq("title", "Telegram 캡처 담당자")
      .eq("status", "active")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (settingError) throw new ApiError(503, "CAPTURE_OWNER_SETTING_FAILED", "폰 캡처 저장 담당자 설정을 확인하지 못했습니다. 잠시 뒤 다시 요청해 주세요.");
    configuredOwnerId = String(setting?.assignee_id ?? "").trim();
  }
  if (!email && !configuredOwnerId) throw new ApiError(503, "CAPTURE_OWNER_NOT_CONFIGURED", "폰 캡처 저장 담당자가 연결되지 않아 저장하지 않았습니다. 관리자에게 연결을 요청해 주세요.");
  let query = supabase.from("os_profiles").select("id").eq("is_active", true);
  query = email ? query.eq("email", email) : query.eq("id", configuredOwnerId);
  const { data, error } = await query.maybeSingle();
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
  const key = process.env.OPENAI_API_KEY; if (!key) throw new ApiError(503, "OCR_NOT_CONFIGURED", "사진 글자 읽기가 아직 연결되지 않았습니다. 저장하지 않았습니다. 텍스트로 보내거나 관리자에게 연결을 요청해 주세요.");
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_VISION_MODEL || OPENAI_ANSWER_MODEL, instructions: instruction, input: [{ role: "user", content: [{ type: "input_text", text: "사진의 정보를 원문에 충실하게 정리해 주세요." }, { type: "input_image", image_url: dataUrl }] }], max_output_tokens: 1000 }) });
  const body = await response.json() as { output?: { content?: { type?: string; text?: string }[] }[] };
  if (!response.ok) throw new ApiError(502, "OCR_FAILED", "사진 글자를 읽지 못해 저장하지 않았습니다. 선명한 사진으로 다시 보내 주세요.");
  const extracted = (body.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n").trim();
  if (!extracted) throw new ApiError(502, "OCR_EMPTY", "사진에서 읽을 수 있는 글자를 찾지 못해 저장하지 않았습니다. 선명한 사진이나 텍스트로 다시 보내 주세요.");
  return extracted;
}


function titleFrom(text: string, fallback: string) {
  const clean = text.replace(/^[/#]?\S+\s*/, "").trim(); return (clean || fallback).slice(0, 120);
}

async function saveCapture(supabase: ReturnType<typeof createServiceSupabase>, message: TelegramMessage, text: string, extracted: string) {
  const owner = await ownerId(supabase); const kind = captureKind(text); const now = new Date(); const date = now.toISOString().slice(0, 10); const month = date.slice(0, 7);
  const receipt = `telegram:${message.chat.id}:${message.message_id}`;
  const { data: existing, error: existingError } = await supabase.from("os_documents").select("id").eq("source", "telegram_capture").eq("source_ref", receipt).eq("owner_id", owner).neq("status", "archived").maybeSingle();
  if (existingError) throw new ApiError(500, "CAPTURE_RECEIPT_FAILED", "기존 저장 기록을 확인하지 못해 새 문서를 만들지 않았습니다. 잠시 뒤 다시 확인해 주세요.");
  if (existing) return existing.id as string;
  const content = [`# ${titleFrom(text, kind === "review" ? "상품 후기" : kind === "thumbnail" ? "썸네일 결정" : "아이디어")}`, "", text.replace(/^[/#]?\S+\s*/, "").trim(), extracted ? `\n## 이미지 기록\n${extracted}` : "", `\n---\n텔레그램 캡처: ${now.toISOString()} · 메시지 ${message.message_id} · ${receipt}`].filter(Boolean).join("\n");
  if (kind === "inbox") {
    const sourceRef = `inbox:${month}`; const { data: current, error: inboxReadError } = await supabase.from("os_documents").select("id,content_md,current_version").eq("source", "telegram_capture").eq("source_ref", sourceRef).eq("owner_id", owner).neq("status", "archived").maybeSingle();
    if (inboxReadError) throw new ApiError(500, "INBOX_READ_FAILED", "인박스를 읽지 못해 저장하지 않았습니다. 잠시 뒤 다시 보내 주세요.");
    if (current?.content_md?.includes(receipt)) return current.id as string;
    if (current) { const { error } = await supabase.from("os_documents").update({ content_md: `${current.content_md}\n\n${content}` }).eq("id", current.id).eq("current_version", current.current_version).select("id").single(); if (error) throw new ApiError(409, "INBOX_SAVE_CONFLICT", "인박스가 변경되어 저장하지 못했습니다. 다시 보내 주세요."); return current.id as string; }
    const { data, error } = await supabase.from("os_documents").insert({ title: `${month} 아이디어 인박스`, content_md: content, folder: "01_Raw/아이디어인박스", status: "draft", source: "telegram_capture", source_ref: sourceRef, owner_id: owner, created_by: owner, brand: "", team: "", tags: ["telegram", "inbox"] }).select("id").single(); if (error) throw error; return data.id as string;
  }
  const folder = kind === "review" ? "02_Wiki/상품후기" : kind === "thumbnail" ? "03_Content/썸네일결정로그" : kind === "summary" ? "01_Raw/개인인사이트" : "01_Raw/폰캡처";
  const status = "draft"; // Captures are never automatically approved as company canon.
  const { data, error } = await supabase.from("os_documents").insert({ title: titleFrom(text, `${date} 폰 캡처`), content_md: content, folder, status, source: "telegram_capture", source_ref: `telegram:${message.chat.id}:${message.message_id}`, owner_id: owner, created_by: owner, brand: "", team: "", tags: ["telegram", kind] }).select("id").single();
  if (error) throw error; return data.id as string;
}

async function summarizeUrl(text: string) {
  const url = text.match(/https?:\/\/\S+/)?.[0]; if (!url) throw new ApiError(400, "SUMMARY_URL_REQUIRED", "저장하지 않았습니다. /요약 뒤에 요약할 URL을 함께 보내 주세요.");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "BrandyActionOS/1.0" } });
  if (!response.ok) throw new ApiError(502, "SUMMARY_SOURCE_FAILED", "원문을 읽지 못해 저장하지 않았습니다. 주소와 공개 여부를 확인해 주세요.");
  const source = (await response.text()).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 60_000);
  const key = process.env.OPENAI_API_KEY; if (!key) throw new ApiError(503, "SUMMARY_NOT_CONFIGURED", "주소 요약 기능이 아직 연결되지 않았습니다. 요약 문서를 저장하지 않았습니다.");
  const ai = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: OPENAI_ANSWER_MODEL, instructions: "제공된 웹 원문만 사용해 한국어로 핵심 주장, 실무 적용점, 확인할 점을 글머리표로 요약하세요.", input: source, max_output_tokens: 1000 }) });
  const body = await ai.json() as { output?: { content?: { type?: string; text?: string }[] }[] };
  const summary = (body.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n").trim();
  if (!ai.ok || !summary) throw new ApiError(502, "SUMMARY_FAILED", "요약을 생성하지 못해 저장하지 않았습니다. 잠시 뒤 다시 요청해 주세요.");
  return summary;
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
  if (error) throw new ApiError(500, "OPERATIONS_READ_FAILED", "운영 기록을 읽지 못했습니다. 기록이 없다는 뜻은 아닙니다. 잠시 뒤 다시 요청해 주세요.");
  if (!data?.length) return `현재 브랜디 OS에 등록된 ${intent.label}이 없습니다.`;
  const rows = data.map((record, index) => {
    const detail = [record.status, record.stage, record.brand, record.team, record.due_date ? `기한 ${record.due_date}` : "", Number(record.progress) > 0 ? `진행 ${record.progress}%` : ""].filter(Boolean).join(" · ");
    return `${index + 1}. ${record.title}${detail ? ` — ${detail}` : ""}`;
  });
  return `브랜디 OS의 최신 ${intent.label}입니다.\n\n${rows.join("\n")}`;
}

export async function POST(request: Request) {
  let verifiedMessage: TelegramMessage | undefined;
  let savedDocumentId = "";
  try {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""; const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_WEBHOOK_SECRET", "웹훅 인증에 실패했습니다.");
    const message = (await request.json() as TelegramUpdate).message;
    if (!message?.from || !shouldRespond(message)) return NextResponse.json({ ok: true, ignored: true });
    const text = (message.text ?? message.caption ?? "").replace(/@[A-Za-z0-9_]+/g, "").trim(); const kind = captureKind(text); const supabase = createServiceSupabase();
    verifiedMessage = message;
    const externalUserId = String(message.from.id);
    const allowed = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
    const { data: registered, error: registrationError } = await supabase.from("os_telegram_users").select("status").eq("external_user_id", externalUserId).maybeSingle();
    if (registrationError) throw new ApiError(503, "TELEGRAM_REGISTRATION_READ_FAILED", "사용자 승인 상태를 확인하지 못했습니다. 잠시 뒤 다시 요청해 주세요.");
    if (!allowed.has(externalUserId) && registered?.status !== "approved") {
      const { error: pendingError } = await supabase.from("os_telegram_users").upsert({
        external_user_id: externalUserId,
        external_chat_id: String(message.chat.id),
        display_name: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
        username: message.from.username ?? "",
        status: registered?.status === "rejected" ? "rejected" : "pending",
        requested_at: new Date().toISOString(),
      }, { onConflict: "external_user_id", ignoreDuplicates: true });
      if (pendingError) throw new ApiError(500, "TELEGRAM_REGISTRATION_FAILED", "등록 요청이 저장되지 않았습니다. 잠시 뒤 다시 보내거나 관리자에게 알려 주세요.");
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: String(message.from.id), external_chat_id: String(message.chat.id), question: (text || "[사진 또는 빈 메시지]").slice(0, 4000), answer: "TELEGRAM_ACCESS_PENDING", source_document_ids: [] });
      await sendTelegram(message.chat.id, registered?.status === "rejected" ? "접근 요청이 거절된 상태입니다. 관리자에게 승인을 문의해 주세요." : "등록 요청을 확인했습니다. 관리자가 승인하면 브랜디 OS를 사용할 수 있습니다.", message.message_id);
      return NextResponse.json({ ok: true, blocked: true, registrationPending: true });
    }
    if (message.voice) {
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), question: "[음성 메시지]", answer: "TELEGRAM_UNSUPPORTED_VOICE", source_document_ids: [] });
      await sendTelegram(message.chat.id, "음성 전사·개인 메모 저장은 아직 연결되지 않았습니다. 저장된 내용은 없습니다. 텍스트로 보내 주세요.", message.message_id);
      return NextResponse.json({ ok: true, unsupported: "voice" });
    }
    if (message.photo?.length && kind === "question") {
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), question: "[분류 없는 사진]", answer: "TELEGRAM_DESTINATION_REQUIRED", source_document_ids: [] });
      await sendTelegram(message.chat.id, "어디에 저장할 사진인가요? 사진 설명에 /후기, /썸네일기록, #인박스, #raw 중 하나를 적어 다시 보내 주세요. 아직 저장하지 않았습니다.", message.message_id);
      return NextResponse.json({ ok: true, needsDestination: true });
    }
    if (kind !== "question") {
      const dataUrl = await imageData(message); const extracted = await vision(dataUrl, kind === "review" ? "상품 후기 사진에서 상품명, 구매자 표현, 장점, 개선점, 수치와 문구를 정확히 추출하세요." : kind === "thumbnail" ? "썸네일 이미지의 문구, 구성, 색상, 선택 근거로 보이는 메모를 정확히 기록하세요." : "사진 속 텍스트를 OCR하고 아이디어와 해야 할 일을 구분하세요.");
      const source = kind === "summary" ? await summarizeUrl(text) : extracted; const id = await saveCapture(supabase, message, text, source);
      savedDocumentId = id;
      const { error: captureLogError } = await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), question: (text || "[사진]").slice(0, 4000), answer: `CAPTURE_SAVED:${id}`, source_document_ids: [id] });
      if (captureLogError) throw new ApiError(500, "CAPTURE_LOG_FAILED", "문서는 저장됐지만 수신 기록을 남기지 못했습니다.");
      await sendTelegram(message.chat.id, `브랜디 OS에 저장했습니다.\n분류: ${kind === "review" ? "상품 후기 초안 · 승인 전" : kind === "thumbnail" ? "썸네일 결정 기록" : kind === "summary" ? "URL 요약" : kind === "inbox" ? "아이디어 인박스" : "Raw 캡처"}\n문서: ${(process.env.OS_PUBLIC_URL || "https://brandyaction-os.vercel.app").replace(/\/$/, "")}/knowledge?document=${encodeURIComponent(id)}`, message.message_id);
      return NextResponse.json({ ok: true, captured: true, documentId: id });
    }
    if (!text) return NextResponse.json({ ok: true, ignored: true });
    if (/^\/?start$/i.test(text)) {
      const welcome = "브랜디 OS 봇입니다. 회사 지식 질문과 프로젝트·업무·목표 조회를 할 수 있습니다. 저장은 #인박스, /후기, /썸네일기록, #raw, /요약 명령을 사용해 주세요.";
      await sendTelegram(message.chat.id, welcome, message.message_id);
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), question: text, answer: welcome, source_document_ids: [] });
      return NextResponse.json({ ok: true, started: true });
    }
    const actor: RequestActor = {
      type: "agent",
      id: `telegram:${message.from.id}`,
      name: message.from.username || message.from.first_name || "Telegram",
      user: null,
      role: "member",
      team: "",
      brand: null,
      allowedStatuses: ["canonical"],
      scopes: ["knowledge.read"],
      organizationId: null,
      ownerId: "",
      mustChangePassword: false,
      supabase,
    };
    const [{ results }, liveOperations] = await Promise.all([
      searchDocuments(actor, { query: text, mode: "hybrid", topK: 8, filters: { statuses: ["canonical"] } }),
      operationalAnswer(supabase, text),
    ]);
    // Telegram is an external, conversational surface. Require a literal
    // evidence overlap after removing an optional leading label before using
    // semantic candidates, so an embedding nearest-neighbour is never shown
    // as proof for an unrelated or misunderstood request.
    const evidenceQuery = evidenceQueryText(text);
    const verifiedResults = results.filter((result) => hasLexicalEvidence(result, evidenceQuery));
    const knowledgeAnswer = verifiedResults.length ? await answerFromKnowledge(text, verifiedResults) : "";
    const answer = [liveOperations, knowledgeAnswer].filter(Boolean).join("\n\n") || "관련 회사 지식이나 운영 기록을 찾지 못했습니다. 핵심 단어를 바꿔 다시 물어봐 주세요.";
    await sendTelegram(message.chat.id, answer, message.message_id);
    await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: String(message.from.id), external_chat_id: String(message.chat.id), question: text, answer, source_document_ids: [...new Set(verifiedResults.map((result) => result.documentId))] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Never disclose failures to an unauthenticated webhook sender or imply a failed save succeeded.
    if (verifiedMessage) {
      const notice = savedDocumentId
        ? `문서는 저장됐지만 결과 안내 중 오류가 발생했습니다. 중복 저장하지 말고 OS 지식에서 확인해 주세요. 문서 ID: ${savedDocumentId}`
        : error instanceof ApiError ? error.message : "요청을 완료하지 못했습니다. 저장 여부는 OS에서 확인한 뒤 다시 요청해 주세요.";
      try {
        await createServiceSupabase().from("os_channel_turns").insert({ channel: "telegram", external_user_id: String(verifiedMessage.from!.id), external_chat_id: String(verifiedMessage.chat.id), question: (verifiedMessage.text ?? verifiedMessage.caption ?? "[첨부 메시지]").slice(0, 4000), answer: `TELEGRAM_ERROR:${notice}`, source_document_ids: savedDocumentId ? [savedDocumentId] : [] });
      } catch { /* Failure telemetry must not hide the original actionable error. */ }
      try {
        await sendTelegram(verifiedMessage.chat.id, notice, verifiedMessage.message_id);
        return NextResponse.json({ ok: true, handledError: true });
      } catch { /* Keep a non-2xx response so Telegram knows delivery failed. */ }
    }
    return apiErrorResponse(error);
  }
}
