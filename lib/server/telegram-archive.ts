// 텔레그램 아카이브 (수정 요청 2026-11-13): a message in one of the archive rooms becomes a reference document per link (or one per
// image), filed in its topic folder. The same link again joins its document as 「추가 언급」. Saved = one reaction on the message (no
// reply, so the room stays as it is); only a failure answers in words.
import { CLAUDE_FAST_MODEL } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { ARCHIVE_FOLDER, ARCHIVE_TOPICS, archiveDocument, commentOf, formatOf, handleOf, linkKey, messageLinks, normalizeLink, platformOf, safeComment, tagTopic, usefulFact, withMention,
  type ArchiveMention, type ArchiveTopic } from "@/lib/telegram-archive";
import { generateContentText, hasClaudeKey } from "./content-model";

type Service = ReturnType<typeof createServiceSupabase>;
export interface ArchiveMessage {
  message_id: number; date?: number; chat: { id: number; title?: string };
  from?: { first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
  text?: string; caption?: string; photo?: { file_id: string; file_size?: number }[];
}
const PHOTO_BUCKET = "os-content-media";
const PHOTO_MAX = 8_000_000;

async function telegram(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new ApiError(503, "TELEGRAM_NOT_CONFIGURED", "텔레그램 설정이 필요합니다.");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; result?: Record<string, unknown> };
  if (!response.ok || !result.ok) throw new ApiError(502, "TELEGRAM_API_FAILED", "텔레그램 요청을 처리하지 못했습니다.");
  return result.result ?? {};
}

const videoId = (url: string) => { try { const u = new URL(url); return u.searchParams.get("v") || u.pathname.match(/^\/shorts\/([\w-]{6,})/)?.[1] || ""; } catch { return ""; } };
const meta = (html: string, key: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`, "i"))?.[1]
  ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, "i"))?.[1] ?? "";
const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Title, channel and thumbnail where the platform gives them (YouTube · TikTok oEmbed, else the page's og: tags); views and likes from the
 *  YouTube Data API. Instagram and Threads mostly answer nothing to a server: those cards keep the link and the note. Never throws. */
export async function linkFacts(url: string) {
  const facts = { title: "", channel: "", thumbnail: "", views: null as number | null, likes: null as number | null };
  try {
    const platform = platformOf(url), host = new URL(url).hostname;
    if (/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(host)) return facts;   // a public page only
    if (platform === "YouTube" || platform === "TikTok") {
      const endpoint = platform === "YouTube" ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}` : `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(6_000) });
      if (response.ok) { const body = await response.json() as Record<string, unknown>; facts.title = String(body.title ?? ""); facts.channel = String(body.author_name ?? ""); facts.thumbnail = String(body.thumbnail_url ?? ""); }
      const id = platform === "YouTube" ? videoId(url) : "", key = process.env.YOUTUBE_API_KEY?.trim();
      if (id && key) {
        const stats = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(6_000) });
        const item = stats.ok ? ((await stats.json()) as { items?: { statistics?: { viewCount?: string; likeCount?: string } }[] }).items?.[0]?.statistics : undefined;
        if (item?.viewCount) facts.views = Number(item.viewCount);
        if (item?.likeCount) facts.likes = Number(item.likeCount);
      }
      return facts;
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; BrandyOS/1.0)" }, redirect: "follow" });
    if (!response.ok || !/text\/html/i.test(response.headers.get("content-type") ?? "")) return facts;
    const html = (await response.text()).slice(0, 400_000);
    facts.title = decode(meta(html, "og:title") || html.match(/<title[^>]*>([^<]{1,200})/i)?.[1] || "");
    facts.channel = decode(meta(html, "og:site_name"));
    facts.thumbnail = decode(meta(html, "og:image"));
  } catch { /* the card keeps the link and the note */ }
  // A login wall answers 「Instagram」 and its logo for every page (first real card, 11-16): those say nothing, the account name does.
  const platform = platformOf(url);
  facts.title = usefulFact(platform, "title", facts.title);
  facts.channel = usefulFact(platform, "channel", facts.channel) || handleOf(url);
  facts.thumbnail = usefulFact(platform, "thumbnail", facts.thumbnail);
  return facts;
}

const TOPIC_SCHEMA = { type: "object", properties: { topic: { type: "string", enum: [...ARCHIVE_TOPICS] } }, required: ["topic"], additionalProperties: false };
/** The folder the company's cheapest Claude picks from the note, the link and what the page says (미분류 when unsure or unavailable). */
export async function aiTopic(input: { comment: string; link: string | null; platform: string; format: string; title: string; channel: string; room: string }): Promise<ArchiveTopic> {
  if (!hasClaudeKey()) return "미분류";
  const prompt = `콘텐츠팀이 텔레그램 레퍼런스 방에 올린 것 하나를 주제 폴더 하나로 나눠. 방 이름이 아니라 올린 사람의 코멘트와 링크 내용으로 판단해.
폴더: 후킹·대본 구조(도입·후킹·말하는 구조) / 썸네일·제목 / 채널·계정 포맷(채널·계정의 운영 방식·시리즈 형식) / 영상 연출·편집(장면·연출·편집 방식) / AI 툴·자동화 / 마케팅·세일즈 사례 / 콘텐츠 주제 소재(다룰 만한 주제·상황·이야깃거리)
가장 가까운 폴더 하나를 골라. 코멘트에 다룰 상황이나 아이디어가 있으면 콘텐츠 주제 소재, 보여 주는 방식을 말하면 영상 연출·편집이야. 코멘트도 제목도 거의 없어 판단할 거리가 없을 때만 미분류.
방: ${input.room}
코멘트: ${input.comment || "(없음)"}
링크: ${input.link ?? "(이미지만)"} · ${input.platform} · ${input.format}
페이지 제목: ${input.title || "(모름)"} · 채널: ${input.channel || "(모름)"}`;
  try {
    const text = await generateContentText({ prompt, model: CLAUDE_FAST_MODEL, jsonSchema: TOPIC_SCHEMA, maxTokens: 100, timeoutMs: 20_000 });
    const topic = (JSON.parse(text) as { topic?: string }).topic;
    return ARCHIVE_TOPICS.includes(topic as ArchiveTopic) ? topic as ArchiveTopic : "미분류";
  } catch (error) {
    console.warn("telegram-archive topic", error instanceof ApiError ? error.code : "AI_TOPIC_FAILED");   // the code only: no note, no key
    return "미분류";
  }
}

/** The message's largest photo, kept in the media bucket (the archive screen signs it); "" when there is none or it cannot be fetched. */
async function keepPhoto(supabase: Service, message: ArchiveMessage) {
  const photo = message.photo?.at(-1), token = process.env.TELEGRAM_BOT_TOKEN;
  if (!photo || !token || (photo.file_size ?? 0) > PHOTO_MAX) return "";
  try {
    const file = await telegram("getFile", { file_id: photo.file_id });
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${String(file.file_path ?? "")}`, { signal: AbortSignal.timeout(15_000) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || bytes.byteLength > PHOTO_MAX) return "";
    const path = `telegram-archive/${String(message.chat.id).replace("-", "g")}/${message.message_id}.jpg`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    return error ? "" : `${PHOTO_BUCKET}/${path}`;
  } catch { return ""; }
}

/** One message from an archive room: a document per new link (or per image when it has no link), 추가 언급 on a link already kept. */
export async function archiveTelegramMessage(supabase: Service, message: ArchiveMessage, owner: () => Promise<string>) {
  const text = (message.text ?? message.caption ?? "").trim();
  const links = messageLinks(text).map(normalizeLink);
  if (!links.length && !message.photo?.length) return { saved: 0, merged: 0 };   // talk in the room is not kept
  const receipt = `telegram:${message.chat.id}:${message.message_id}`;
  const mention: ArchiveMention = { at: new Date((message.date ?? Date.now() / 1000) * 1000).toISOString(), room: message.chat.title || String(message.chat.id),
    who: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "알 수 없음",
    comment: safeComment(commentOf(text, messageLinks(text))), receipt };
  const ownerId = await owner();
  const tagged = tagTopic(text);
  let saved = 0, merged = 0;
  for (const [index, link] of (links.length ? links : [null]).entries()) {
    const key = link ? linkKey(link) : `img:${receipt}`;
    const { data: existing, error: readError } = await supabase.from("os_documents").select("id,content_md,current_version").eq("source", "telegram")
      .contains("tags", [key]).neq("status", "archived").limit(1).maybeSingle();
    if (readError) throw new ApiError(500, "ARCHIVE_READ_FAILED", "보관함을 확인하지 못했어요.");
    if (existing) {
      const next = withMention(String(existing.content_md ?? ""), mention);
      if (next) {
        const { error } = await supabase.from("os_documents").update({ content_md: next }).eq("id", existing.id).eq("current_version", existing.current_version).select("id").single();
        if (error) throw new ApiError(409, "ARCHIVE_MERGE_CONFLICT", "같은 링크 문서가 동시에 바뀌어 합치지 못했어요.");
      }
      merged += 1;
      continue;
    }
    const platform = link ? platformOf(link) : "텔레그램 이미지", format = formatOf(link);
    const facts = link ? await linkFacts(link) : { title: "", channel: "", thumbnail: "", views: null, likes: null };
    const image = index === 0 ? await keepPhoto(supabase, message) : "";
    const topic = tagged ?? await aiTopic({ comment: mention.comment, link, platform, format, title: facts.title, channel: facts.channel, room: mention.room });
    const { title, content } = archiveDocument({ link, platform, format, topic, ...facts, image, first: mention });
    const { error } = await supabase.from("os_documents").insert({ title, content_md: content, folder: `${ARCHIVE_FOLDER}/${topic}`, status: "team", source: "telegram",
      source_ref: links.length > 1 ? `${receipt}#${index + 1}` : receipt, owner_id: ownerId, created_by: ownerId, brand: "", team: "", tags: ["telegram", "reference", key] });
    if (error) throw new ApiError(500, "ARCHIVE_SAVE_FAILED", "레퍼런스 문서를 저장하지 못했어요.");
    saved += 1;
  }
  return { saved, merged };
}

/** The webhook's step for an archive room: keep the message, mark it with one reaction, and say so in words only when keeping failed. */
export async function archiveInRoom(supabase: Service, message: ArchiveMessage, owner: () => Promise<string>) {
  try {
    const result = await archiveTelegramMessage(supabase, message, owner);
    if (result.saved || result.merged)
      await telegram("setMessageReaction", { chat_id: message.chat.id, message_id: message.message_id, reaction: [{ type: "emoji", emoji: "👍" }] }).catch(() => undefined);
    return result;
  } catch (error) {
    const why = error instanceof ApiError ? error.message : "잠시 뒤 다시 올려 주세요.";
    await telegram("sendMessage", { chat_id: message.chat.id, text: `OS 레퍼런스에 보관하지 못했어요. ${why}`, reply_parameters: { message_id: message.message_id } }).catch(() => undefined);
    return { saved: 0, merged: 0, failed: true };
  }
}
