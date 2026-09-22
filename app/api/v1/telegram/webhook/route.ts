import { NextResponse } from "next/server";
import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { answerFromKnowledge } from "@/lib/server/answer";
import { safeSecretMatch, type RequestActor } from "@/lib/server/auth";
import { captureKind, isBotAddressed, type CaptureKind } from "@/lib/telegram-intents";
import { searchDocuments } from "@/lib/server/search";
import { evidenceQueryText, hasLexicalEvidence, rankTelegramEvidence, telegramAuthorityQueryText } from "@/lib/search-relevance";
import { actionPreview, isOutdatedEvidence, knowledgeConflictNotice, parseTelegramAction, type TelegramActionDraft } from "@/lib/telegram-team";
import { isMeetingPrepCommand, isMeetingRecordCommand, parseMeetingPrepBrand, parseMeetingRecordCommand, type MeetingBusiness } from "@/lib/telegram-meeting";
import { buildMeetingRawDocument, buildMeetingSummaryDocument } from "@/lib/meeting-documents";
import { prepareMeetingBrief } from "@/lib/server/meeting-prep";
import { summarizeMeetingText } from "@/lib/server/meeting-summary";

export const runtime = "nodejs";

interface TelegramPhoto { file_id: string; file_size?: number }
interface TelegramMessage {
  message_id: number; chat: { id: number; type: string; title?: string }; from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string; caption?: string; photo?: TelegramPhoto[]; voice?: { file_id: string }; reply_to_message?: { message_id?: number; text?: string; from?: { is_bot?: boolean; username?: string } };
}
interface TelegramCallbackQuery {
  id: string;
  from: NonNullable<TelegramMessage["from"]>;
  data?: string;
  message?: TelegramMessage;
}
interface TelegramUpdate { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }

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

async function sendTelegram(chatId: number, text: string, replyTo?: number, replyMarkup?: Record<string, unknown>) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 3900),
    ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

const actionKeyboard = (turnId: number | string) => ({ inline_keyboard: [[
  { text: "OS에 저장", callback_data: `act:${turnId}:confirm` },
  { text: "취소", callback_data: `act:${turnId}:cancel` },
]] });

const feedbackKeyboard = (turnId: number | string) => ({ inline_keyboard: [[
  { text: "👍 맞음", callback_data: `fb:${turnId}:ok` },
  { text: "오래됨", callback_data: `fb:${turnId}:stale` },
  { text: "틀림", callback_data: `fb:${turnId}:wrong` },
  { text: "정본 수정", callback_data: `fb:${turnId}:canonical` },
]] });

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

async function saveCapture(supabase: ReturnType<typeof createServiceSupabase>, message: TelegramMessage, text: string, extracted: string, kind: CaptureKind) {
  const owner = await ownerId(supabase); const now = new Date(); const date = now.toISOString().slice(0, 10); const month = date.slice(0, 7);
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

async function callbackNotice(callback: TelegramCallbackQuery, text: string) {
  await telegramApi("answerCallbackQuery", { callback_query_id: callback.id, text: text.slice(0, 190), show_alert: false });
}

async function editCallbackMessage(callback: TelegramCallbackQuery, text: string) {
  if (!callback.message) return;
  await telegramApi("editMessageText", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, text: text.slice(0, 3900) });
}

async function handleCallback(supabase: ReturnType<typeof createServiceSupabase>, callback: TelegramCallbackQuery) {
  const data = callback.data ?? "";
  const chatId = String(callback.message?.chat.id ?? "");
  const userId = String(callback.from.id);
  const { data: user, error: userError } = await supabase.from("os_telegram_users").select("status,profile_id").eq("external_user_id", userId).maybeSingle();
  if (userError || user?.status !== "approved") {
    await callbackNotice(callback, "승인된 사용자만 처리할 수 있습니다.");
    return { blocked: true };
  }

  const feedback = data.match(/^fb:(\d+):(ok|stale|wrong|canonical)$/);
  if (feedback) {
    const turnId = Number(feedback[1]); const kind = feedback[2];
    const { data: turn, error } = await supabase.from("os_channel_turns").select("id,external_chat_id,question,answer,source_document_ids").eq("id", turnId).eq("channel", "telegram").maybeSingle();
    if (error || !turn || turn.external_chat_id !== chatId) { await callbackNotice(callback, "답변 기록을 찾지 못했습니다."); return { missing: true }; }
    const { error: feedbackError } = await supabase.from("os_telegram_feedback").upsert({ turn_id: turnId, reporter_external_user_id: userId, kind }, { onConflict: "turn_id,reporter_external_user_id" });
    if (feedbackError) throw new ApiError(500, "TELEGRAM_FEEDBACK_FAILED", "피드백을 저장하지 못했습니다.");
    if (kind !== "ok" && user.profile_id) {
      const dedupeKey = `telegram-feedback:${turnId}`;
      const { data: existing } = await supabase.from("os_records").select("id").eq("record_type", "task").eq("metadata->>dedupeKey", dedupeKey).is("archived_at", null).maybeSingle();
      if (!existing) {
        const label = kind === "stale" ? "오래된 답변" : kind === "wrong" ? "잘못된 답변" : "정본 수정 요청";
        const { error: taskError } = await supabase.from("os_records").insert({
          record_type: "task", title: `[Telegram] ${label}: ${String(turn.question).slice(0, 140)}`,
          description: `질문: ${turn.question}\n\n답변: ${turn.answer}`.slice(0, 20_000), status: "backlog", priority: kind === "wrong" ? "high" : "normal",
          owner_id: user.profile_id, assignee_id: user.profile_id, created_by: user.profile_id, updated_by: user.profile_id,
          tags: ["telegram", "answer-feedback"], metadata: { kind: "telegram_answer_feedback", dedupeKey, turnId, feedback: kind, sourceDocumentIds: turn.source_document_ids ?? [] },
        });
        if (taskError && taskError.code !== "23505") throw new ApiError(500, "TELEGRAM_FEEDBACK_TASK_FAILED", "피드백은 저장했지만 확인 업무를 만들지 못했습니다.");
      }
    }
    await callbackNotice(callback, kind === "ok" ? "확인했습니다. 감사합니다." : user.profile_id ? "피드백과 확인 업무를 OS에 기록했습니다." : "피드백은 저장했습니다. OS 업무 생성은 계정 연결 후 가능합니다.");
    return { feedback: kind };
  }

  const action = data.match(/^act:(\d+):(confirm|cancel)$/);
  if (!action) { await callbackNotice(callback, "지원하지 않는 버튼입니다."); return { ignored: true }; }
  const turnId = Number(action[1]);
  const { data: turn, error } = await supabase.from("os_channel_turns").select("id,external_chat_id,question,answer,metadata").eq("id", turnId).eq("channel", "telegram").maybeSingle();
  if (error || !turn || turn.external_chat_id !== chatId || turn.answer !== "TELEGRAM_ACTION_PENDING") { await callbackNotice(callback, "이미 처리됐거나 찾을 수 없는 요청입니다."); return { missing: true }; }
  if (action[2] === "cancel") {
    await supabase.from("os_channel_turns").update({ answer: "TELEGRAM_ACTION_CANCELLED", metadata: { ...(turn.metadata ?? {}), state: "cancelled" } }).eq("id", turnId);
    await editCallbackMessage(callback, `${turn.question}\n\n취소했습니다. OS에는 저장하지 않았습니다.`);
    await callbackNotice(callback, "취소했습니다."); return { cancelled: true };
  }
  if (!user.profile_id) { await callbackNotice(callback, "설정에서 Telegram 사용자와 OS 구성원을 먼저 연결해 주세요."); return { needsProfile: true }; }
  const actionMetadata = turn.metadata as { draft?: TelegramActionDraft; expiresAt?: string } | null;
  if (actionMetadata?.expiresAt && new Date(actionMetadata.expiresAt).getTime() < Date.now()) {
    await supabase.from("os_channel_turns").update({ answer: "TELEGRAM_ACTION_EXPIRED", metadata: { ...(turn.metadata ?? {}), state: "expired" } }).eq("id", turnId);
    await editCallbackMessage(callback, `${turn.question}\n\n확인 시간이 지나 만료됐습니다. 명령을 다시 보내 주세요.`);
    await callbackNotice(callback, "확인 시간이 지나 만료됐습니다."); return { expired: true };
  }
  const draft = actionMetadata?.draft;
  if (!draft?.title) { await callbackNotice(callback, "기록 초안을 읽지 못했습니다."); return { invalid: true }; }
  const { data: existingAction } = await supabase.from("os_records").select("id").eq("metadata->>kind", "telegram_confirmed_action").eq("metadata->>telegramTurnId", String(turnId)).is("archived_at", null).maybeSingle();
  if (existingAction) { await callbackNotice(callback, "이미 OS에 저장된 기록입니다."); return { created: true, recordId: existingAction.id }; }
  let assigneeId = user.profile_id;
  if (draft.assigneeUsername) {
    const { data: target } = await supabase.from("os_telegram_users").select("profile_id").ilike("username", draft.assigneeUsername).eq("status", "approved").maybeSingle();
    if (!target?.profile_id) { await callbackNotice(callback, `@${draft.assigneeUsername}의 OS 계정 연결을 찾지 못했습니다.`); return { missingAssignee: true }; }
    assigneeId = target.profile_id;
  }
  const { data: record, error: recordError } = await supabase.from("os_records").insert({
    record_type: draft.recordType, title: draft.title, description: `Telegram에서 확인 후 생성됨. 원문: ${turn.question}`,
    status: draft.status, priority: "normal", owner_id: user.profile_id, assignee_id: assigneeId, due_date: draft.dueDate,
    created_by: user.profile_id, updated_by: user.profile_id, tags: ["telegram"], metadata: { kind: "telegram_confirmed_action", telegramTurnId: turnId },
  }).select("id").single();
  if (recordError) throw new ApiError(500, "TELEGRAM_ACTION_CREATE_FAILED", "OS 기록을 만들지 못했습니다.");
  await supabase.from("os_channel_turns").update({ answer: `TELEGRAM_ACTION_CREATED:${record.id}`, metadata: { ...(turn.metadata ?? {}), state: "created", recordId: record.id } }).eq("id", turnId);
  await editCallbackMessage(callback, `${turn.question}\n\n✅ OS에 저장했습니다.\n${(process.env.OS_PUBLIC_URL || "https://brandyaction-os.vercel.app").replace(/\/$/, "")}/home/operations`);
  await callbackNotice(callback, "OS에 저장했습니다.");
  return { created: true, recordId: record.id };
}

async function handleMeetingPrep(supabase: ReturnType<typeof createServiceSupabase>, text: string) {
  const brand = parseMeetingPrepBrand(text);
  const brief = await prepareMeetingBrief(supabase, { brand });
  const todos = brief.todos.slice(0, 8) as Array<{ title?: string; due_date?: string | null }>;
  const lines = [
    `📋 회의 준비${brand ? ` · ${brand}` : ""}`,
    "",
    "▪ 지난 회의 미해결",
    ...(brief.pending.length ? brief.pending.map((item) => `- ${item}`) : ["남은 안건이 없습니다."]),
    "",
    "▪ 완료 전 업무",
    ...(todos.length ? todos.map((item) => `- ${item.title ?? ""}${item.due_date ? ` · ${item.due_date}` : ""}`) : ["미완료 업무가 없습니다."]),
    "",
    "▪ 최근 KPI 신호",
    ...(brief.kpis.length ? brief.kpis.slice(0, 8).map((item) => `- ${item.title} ${item.current}${item.unit} · ${item.signal}`) : ["최근 KPI가 없습니다."]),
  ];
  return lines.join("\n");
}

// /회의기록 {사업} {회의 내용} — 사업별 회의 레코드 생성 + AI 추출(결정·미결·업무) +
// 지식 문서함 반영을 한 메시지로 끝낸다. Telegram은 실패해도 웹훅을 재전송하므로
// telegramReceipt로 같은 메시지의 중복 저장을 막는다.
async function handleMeetingRecord(
  supabase: ReturnType<typeof createServiceSupabase>,
  message: TelegramMessage,
  ownerProfileId: string,
  business: MeetingBusiness,
  content: string,
) {
  if (content.length < 20) throw new ApiError(400, "MEETING_CONTENT_TOO_SHORT", "회의 내용은 20자 이상 적어 주세요. 저장하지 않았습니다.");
  const receipt = `telegram:${message.chat.id}:${message.message_id}`;
  const { data: existingMeeting, error: existingError } = await supabase.from("os_records").select("id,metadata").eq("record_type", "meeting").eq("metadata->>telegramReceipt", receipt).is("archived_at", null).maybeSingle();
  if (existingError) throw new ApiError(500, "MEETING_RECEIPT_CHECK_FAILED", "중복 저장 확인에 실패해 회의를 기록하지 않았습니다. 잠시 뒤 다시 보내 주세요.");
  if (existingMeeting) return { duplicate: true as const, meetingId: existingMeeting.id as string, rawDocumentId: null, summaryDocumentId: null, result: null, title: "" };

  const { recordBrand, label } = business;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, Asia/Seoul 서버 시각 기준
  const result = await summarizeMeetingText(content, today);
  const title = `${recordBrand} 회의 · ${new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date())}`;

  const { data: meeting, error: meetingError } = await supabase.from("os_records").insert({
    record_type: "meeting", title, description: content.slice(0, 4000), status: "done", priority: "normal",
    brand: recordBrand, team: "", owner_id: ownerProfileId, created_by: ownerProfileId, updated_by: ownerProfileId, tags: [],
    metadata: { transcript: content, summary: result.summary, summaryMode: result.mode, decisions: result.decisions, pending: result.pending, todos: result.todos, source: "telegram", telegramReceipt: receipt },
  }).select("id").single();
  if (meetingError || !meeting) throw new ApiError(500, "MEETING_CREATE_FAILED", "회의 기록을 저장하지 못했습니다.", meetingError?.message);

  for (const decisionTitle of result.decisions) {
    const { error } = await supabase.from("os_records").insert({
      record_type: "decision", title: decisionTitle, description: `회의: ${title}`, status: "decided", brand: recordBrand, team: "",
      owner_id: ownerProfileId, created_by: ownerProfileId, updated_by: ownerProfileId, parent_id: meeting.id, tags: [],
      metadata: { meetingId: meeting.id, source: "meeting" },
    });
    if (error) throw new ApiError(500, "MEETING_DECISION_CREATE_FAILED", "회의는 저장됐지만 결정사항 일부를 만들지 못했습니다.", error.message);
  }
  for (const todo of result.todos) {
    const { error } = await supabase.from("os_records").insert({
      record_type: "task", title: todo.title, status: "planned", brand: recordBrand, team: "", due_date: todo.dueDate || null,
      description: `회의 후속 업무: ${title}${todo.assignee ? ` · 담당 ${todo.assignee}` : ""}${todo.dueLabel ? ` · ${todo.dueLabel}` : ""}`,
      owner_id: ownerProfileId, created_by: ownerProfileId, updated_by: ownerProfileId, parent_id: meeting.id, tags: [],
      metadata: { meetingId: meeting.id, source: "meeting", assigneeName: todo.assignee, dueLabel: todo.dueLabel },
    });
    if (error) throw new ApiError(500, "MEETING_TASK_CREATE_FAILED", "회의는 저장됐지만 후속 업무 일부를 만들지 못했습니다.", error.message);
  }

  // 지식 문서함 반영 — 웹 회의 워크스페이스와 같은 빌더(lib/meeting-documents)로
  // 옛 사내 봇과 같은 두 곳(raw 원문 + wiki 요약)에 같이 쌓는다. 여기서 실패해도
  // 회의·결정·업무는 이미 저장된 상태로 둔다.
  let rawDocumentId: string | null = null;
  let summaryDocumentId: string | null = null;
  try {
    const raw = buildMeetingRawDocument(business, today, content);
    const { data: rawDoc, error: rawError } = await supabase.from("os_documents").insert({
      ...raw, brand: recordBrand, team: "", status: "draft", source: "meeting_raw", source_ref: meeting.id,
      owner_id: ownerProfileId, created_by: ownerProfileId, tags: ["주간회의", label],
    }).select("id").single();
    if (rawError) throw rawError;
    rawDocumentId = rawDoc.id as string;
  } catch (rawError) {
    console.error("meeting raw document creation failed", rawError);
  }
  try {
    const summary = buildMeetingSummaryDocument(business, today, result);
    const { data: summaryDoc, error: summaryError } = await supabase.from("os_documents").insert({
      ...summary, brand: recordBrand, team: "", status: "draft", source: "meeting_summary", source_ref: meeting.id,
      owner_id: ownerProfileId, created_by: ownerProfileId, tags: ["주간회의요약", label],
    }).select("id").single();
    if (summaryError) throw summaryError;
    summaryDocumentId = summaryDoc.id as string;
  } catch (summaryError) {
    console.error("meeting summary document creation failed", summaryError);
  }

  return { duplicate: false as const, meetingId: meeting.id as string, rawDocumentId, summaryDocumentId, result, title };
}

async function configureDigest(supabase: ReturnType<typeof createServiceSupabase>, message: TelegramMessage, profileId: string | null, text: string) {
  const match = text.match(/^\/요약(켜기|끄기)(?:@\w+)?(?:\s+(\d{1,2}))?$/);
  if (!match) return null;
  if (!profileId) throw new ApiError(403, "TELEGRAM_PROFILE_REQUIRED", "OS 구성원 계정 연결 후 사용할 수 있습니다.");
  const { data: profile } = await supabase.from("os_profiles").select("role,is_active").eq("id", profileId).maybeSingle();
  if (!profile?.is_active || profile.role !== "admin") throw new ApiError(403, "TELEGRAM_ADMIN_REQUIRED", "관리자만 팀 요약을 설정할 수 있습니다.");
  const enabled = match[1] === "켜기"; const hour = match[2] === undefined ? 9 : Number(match[2]);
  if (hour < 0 || hour > 23) throw new ApiError(400, "INVALID_DIGEST_HOUR", "요약 시간은 0~23시로 입력해 주세요.");
  const { error } = await supabase.from("os_telegram_chats").upsert({ external_chat_id: String(message.chat.id), chat_type: message.chat.type, title: message.chat.title ?? "", digest_enabled: enabled, digest_hour_kst: hour, enabled_by: profileId, updated_at: new Date().toISOString() }, { onConflict: "external_chat_id" });
  if (error) throw new ApiError(500, "DIGEST_SETTING_FAILED", "팀 요약 설정을 저장하지 못했습니다.");
  return enabled ? `변경이 있을 때만 매일 ${hour}시(KST)에 팀 요약을 보냅니다.` : "팀 요약을 껐습니다.";
}

export async function POST(request: Request) {
  let verifiedMessage: TelegramMessage | undefined;
  let savedDocumentId = "";
  try {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""; const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_WEBHOOK_SECRET", "웹훅 인증에 실패했습니다.");
    const update = await request.json() as TelegramUpdate;
    if (update.callback_query) {
      const result = await handleCallback(createServiceSupabase(), update.callback_query);
      return NextResponse.json({ ok: true, ...result });
    }
    const message = update.message;
    if (!message?.from || !shouldRespond(message)) return NextResponse.json({ ok: true, ignored: true });
    const rawText = (message.text ?? message.caption ?? "").trim();
    const botUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
    const text = botUsername ? rawText.replace(new RegExp(`@${botUsername}\\b`, "ig"), "").trim() : rawText;
    const kind = await captureKind(text); const supabase = createServiceSupabase();
    verifiedMessage = message;
    const externalUserId = String(message.from.id);
    const allowed = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
    const { data: registered, error: registrationError } = await supabase.from("os_telegram_users").select("status,profile_id").eq("external_user_id", externalUserId).maybeSingle();
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
    await supabase.from("os_telegram_chats").upsert({ external_chat_id: String(message.chat.id), chat_type: message.chat.type, title: message.chat.title ?? "", updated_at: new Date().toISOString() }, { onConflict: "external_chat_id" });
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
      const source = kind === "summary" ? await summarizeUrl(text) : extracted; const id = await saveCapture(supabase, message, text, source, kind);
      savedDocumentId = id;
      const { error: captureLogError } = await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), question: (text || "[사진]").slice(0, 4000), answer: `CAPTURE_SAVED:${id}`, source_document_ids: [id] });
      if (captureLogError) throw new ApiError(500, "CAPTURE_LOG_FAILED", "문서는 저장됐지만 수신 기록을 남기지 못했습니다.");
      await sendTelegram(message.chat.id, `브랜디 OS에 저장했습니다.\n분류: ${kind === "review" ? "상품 후기 초안 · 승인 전" : kind === "thumbnail" ? "썸네일 결정 기록" : kind === "summary" ? "URL 요약" : kind === "inbox" ? "아이디어 인박스" : "Raw 캡처"}\n문서: ${(process.env.OS_PUBLIC_URL || "https://brandyaction-os.vercel.app").replace(/\/$/, "")}/knowledge?document=${encodeURIComponent(id)}`, message.message_id);
      return NextResponse.json({ ok: true, captured: true, documentId: id });
    }
    if (!text) return NextResponse.json({ ok: true, ignored: true });
    if (/^\/?start$/i.test(text)) {
      const welcome = "브랜디 OS 봇입니다. 회사 지식 질문과 프로젝트·업무·목표 조회를 할 수 있습니다. 저장은 #인박스, /후기, /썸네일기록, #raw, /요약 명령을 사용하세요. 팀 기록은 /업무, /결정, /보류 뒤에 내용을 쓰고 확인 버튼을 누르세요. 회의는 /회의준비 [사업]으로 안건을 받고, /회의기록 [사업] [내용]으로 한 번에 정리·저장합니다. 관리자는 /요약켜기 9 또는 /요약끄기로 변경 요약을 설정할 수 있습니다.";
      await sendTelegram(message.chat.id, welcome, message.message_id);
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), question: text, answer: welcome, source_document_ids: [] });
      return NextResponse.json({ ok: true, started: true });
    }
    if (isMeetingPrepCommand(text)) {
      const brief = await handleMeetingPrep(supabase, text);
      await sendTelegram(message.chat.id, brief, message.message_id);
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), request_message_id: message.message_id, question: text, answer: brief, source_document_ids: [] });
      return NextResponse.json({ ok: true, meetingPrep: true });
    }
    if (isMeetingRecordCommand(text)) {
      if (!registered?.profile_id) throw new ApiError(403, "TELEGRAM_PROFILE_REQUIRED", "OS 구성원 계정 연결 후 회의를 기록할 수 있습니다. 관리자에게 설정의 Telegram 계정 연결을 요청해 주세요.");
      const parsed = parseMeetingRecordCommand(text);
      if (!parsed) {
        const usage = "사용법: /회의기록 [사업] [회의 내용]\n예) /회의기록 마이인 광고 예산 20만원 유지 결정. 네이버 유입 원인 파악은 에릭이 이번주까지.\n사업은 마이인 또는 브랜디에듀(교육)만 인식합니다. 저장하지 않았습니다.";
        await sendTelegram(message.chat.id, usage, message.message_id);
        await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), request_message_id: message.message_id, question: text, answer: usage, source_document_ids: [] });
        return NextResponse.json({ ok: true, meetingUsage: true });
      }
      const recorded = await handleMeetingRecord(supabase, message, registered.profile_id, parsed.business, parsed.content);
      const osUrl = (process.env.OS_PUBLIC_URL || "https://brandyaction-os.vercel.app").replace(/\/$/, "");
      const documentIds = [recorded.rawDocumentId, recorded.summaryDocumentId].filter((id): id is string => Boolean(id));
      const answer = recorded.duplicate
        ? "이미 기록된 회의입니다(중복 전송). 다시 저장하지 않았습니다."
        : [
            `✅ [${parsed.business.label}] 회의 기록 완료`,
            "",
            `📌 결정사항 ${recorded.result!.decisions.length}개`,
            ...recorded.result!.decisions.map((item) => `  • ${item}`),
            "",
            `📋 미결사항 ${recorded.result!.pending.length}개`,
            ...recorded.result!.pending.map((item) => `  • ${item}`),
            "",
            `✅ 후속 업무 ${recorded.result!.todos.length}개`,
            ...recorded.result!.todos.map((item) => `  • ${item.title}${item.dueLabel || item.dueDate ? ` (${item.dueLabel || item.dueDate})` : ""}`),
            "",
            recorded.summaryDocumentId ? `📁 요약: ${osUrl}/knowledge?document=${encodeURIComponent(recorded.summaryDocumentId)}` : "⚠️ 요약 문서함 반영 실패(회의·결정·업무는 저장됨).",
            recorded.rawDocumentId ? `📄 원문: ${osUrl}/knowledge?document=${encodeURIComponent(recorded.rawDocumentId)}` : "⚠️ 원문 문서함 반영 실패.",
          ].join("\n");
      await sendTelegram(message.chat.id, answer, message.message_id);
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), request_message_id: message.message_id, question: text, answer, source_document_ids: documentIds });
      return NextResponse.json({ ok: true, meetingRecorded: true, meetingId: recorded.meetingId, rawDocumentId: recorded.rawDocumentId, summaryDocumentId: recorded.summaryDocumentId });
    }
    const digestResponse = await configureDigest(supabase, message, registered?.profile_id ?? null, rawText);
    if (digestResponse) {
      await sendTelegram(message.chat.id, digestResponse, message.message_id);
      await supabase.from("os_channel_turns").insert({ channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), request_message_id: message.message_id, question: text, answer: digestResponse, source_document_ids: [] });
      return NextResponse.json({ ok: true, digestConfigured: true });
    }
    const actionDraft = parseTelegramAction(rawText);
    if (actionDraft) {
      if (!registered?.profile_id) throw new ApiError(403, "TELEGRAM_PROFILE_REQUIRED", "OS 구성원 계정 연결 후 업무·결정 기록을 만들 수 있습니다. 관리자에게 설정의 Telegram 계정 연결을 요청해 주세요.");
      const { data: pending, error: pendingError } = await supabase.from("os_channel_turns").insert({
        channel: "telegram", external_user_id: externalUserId, external_chat_id: String(message.chat.id), request_message_id: message.message_id,
        question: text, answer: "TELEGRAM_ACTION_PENDING", source_document_ids: [], metadata: { kind: "telegram_action", state: "pending", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), draft: actionDraft },
      }).select("id").single();
      if (pendingError) throw new ApiError(500, "TELEGRAM_ACTION_DRAFT_FAILED", "확인할 기록 초안을 만들지 못했습니다.");
      const sent = await sendTelegram(message.chat.id, actionPreview(actionDraft), message.message_id, actionKeyboard(pending.id));
      await supabase.from("os_channel_turns").update({ response_message_id: sent.message_id ?? null }).eq("id", pending.id);
      return NextResponse.json({ ok: true, actionPending: true });
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
    let priorContext: { question: string; answer: string } | null = null;
    if (message.reply_to_message?.from?.is_bot && message.reply_to_message.message_id) {
      const { data: prior } = await supabase.from("os_channel_turns")
        .select("question,answer").eq("channel", "telegram").eq("external_chat_id", String(message.chat.id))
        .eq("response_message_id", message.reply_to_message.message_id).maybeSingle();
      if (prior && !String(prior.answer).startsWith("TELEGRAM_")) priorContext = { question: prior.question, answer: prior.answer };
    }
    const retrievalQuestion = priorContext ? `${priorContext.question}\n후속 질문: ${text}` : text;
    const authorityQuery = telegramAuthorityQueryText(retrievalQuestion);
    const [knowledgeSearches, liveOperations] = await Promise.all([
      Promise.all([
        // Retrieve a wider hybrid candidate set, then apply the Telegram-specific
        // lexical evidence gate below. The RPC's vector/keyword RRF can otherwise
        // truncate the literal answer chunk before application-side reranking.
        searchDocuments(actor, { query: retrievalQuestion, mode: "hybrid", topK: 30, filters: { statuses: ["canonical"] } }),
        // A broad topic query can still omit the governing procedure from the
        // candidate window entirely. Add a bounded role-specific lookup for
        // recognized how-to questions before applying the same evidence gate.
        ...(authorityQuery ? [searchDocuments(actor, { query: authorityQuery, mode: "hybrid" as const, topK: 8, filters: { statuses: ["canonical" as const] } })] : []),
      ]),
      operationalAnswer(supabase, retrievalQuestion),
    ]);
    const seenChunks = new Set<string>();
    const results = knowledgeSearches.flatMap((search) => search.results).filter((result) => {
      const key = `${result.documentId}:${result.chunkId ?? result.heading}`;
      if (seenChunks.has(key)) return false;
      seenChunks.add(key);
      return true;
    });
    // Telegram is an external, conversational surface. Require a literal
    // evidence overlap after removing an optional leading label before using
    // semantic candidates, so an embedding nearest-neighbour is never shown
    // as proof for an unrelated or misunderstood request.
    const evidenceQuery = evidenceQueryText(retrievalQuestion);
    const literalResults = rankTelegramEvidence(results.filter((result) => hasLexicalEvidence(result, evidenceQuery)), evidenceQuery).slice(0, 12);
    const conflictNotice = knowledgeConflictNotice(retrievalQuestion, literalResults);
    const activeResults = literalResults.filter((result) => !isOutdatedEvidence(result));
    const verifiedResults = activeResults.slice(0, 8);
    const knowledgeAnswer = verifiedResults.length ? await answerFromKnowledge(text, verifiedResults, priorContext ?? undefined, conflictNotice) : "";
    // A bare topic word (e.g. "콘텐츠") should not force an unrelated live
    // operations listing into a question that grounded company knowledge
    // already answers. Only surface the operations listing when no verified
    // document evidence was found for the actual question.
    const answer = [conflictNotice, verifiedResults.length ? "" : liveOperations, knowledgeAnswer].filter(Boolean).join("\n\n") || "관련 회사 지식이나 운영 기록을 찾지 못했습니다. 핵심 단어를 바꿔 다시 물어봐 주세요.";
    const { data: turn, error: turnError } = await supabase.from("os_channel_turns").insert({
      channel: "telegram", external_user_id: String(message.from.id), external_chat_id: String(message.chat.id), request_message_id: message.message_id,
      reply_to_message_id: message.reply_to_message?.message_id ?? null, question: text, answer,
      source_document_ids: [...new Set(verifiedResults.map((result) => result.documentId))], metadata: priorContext ? { kind: "knowledge_followup", priorQuestion: priorContext.question } : { kind: "knowledge_answer" },
    }).select("id").single();
    if (turnError) throw new ApiError(500, "TELEGRAM_TURN_LOG_FAILED", "답변 기록을 저장하지 못했습니다.");
    const sent = await sendTelegram(message.chat.id, answer, message.message_id, feedbackKeyboard(turn.id));
    await supabase.from("os_channel_turns").update({ response_message_id: sent.message_id ?? null }).eq("id", turn.id);
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
