import { releaseLogText, requestCommentRooms, requestCommentText, type CommentRoom } from "@/lib/development-comment-telegram";
import { createServiceSupabase } from "@/lib/supabase/server";

/** Sends one text, as the bot, to every room set for those businesses (os_telegram_chats.meeting_share_business). Returns how many got it. */
async function sendToRooms(token: string, rooms: CommentRoom[], text: string, label: string) {
  if (!rooms.length) return 0;
  const { data: chats } = await createServiceSupabase().from("os_telegram_chats").select("external_chat_id").in("meeting_share_business", rooms);
  let sent = 0;
  for (const chat of chats ?? []) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat.external_chat_id, text, link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (response?.ok) sent += 1; else console.warn(`[telegram] ${label} not sent`, response?.status ?? "network");
  }
  return sent;
}

/** 수정 요청 댓글 → 텔레그램 업무 소통방. Returns how many rooms got it (0: no bot token, no room set for that business). */
export async function shareRequestComment(input: { requestId: string; title: string; projectId: string | null; author: string; mentionIds: string[]; body: string; origin: string }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !input.mentionIds.length) return 0;
  const supabase = createServiceSupabase();
  const [{ data: project }, { data: people }, { data: linked }] = await Promise.all([
    input.projectId ? supabase.from("os_records").select("title,brand").eq("id", input.projectId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("os_profiles").select("id,display_name,email,affiliation").in("id", input.mentionIds),
    supabase.from("os_telegram_users").select("profile_id,username").in("profile_id", input.mentionIds).eq("status", "approved"),
  ]);
  const rooms = requestCommentRooms(project ?? {}, (people ?? []).map((person) => String(person.affiliation ?? "")));
  const usernames = new Map((linked ?? []).filter((row) => row.username).map((row) => [row.profile_id, row.username as string]));
  const byId = new Map((people ?? []).map((person) => [person.id, String(person.display_name || person.email || "구성원").split("@")[0]]));
  const text = requestCommentText({ author: input.author, title: input.title, body: input.body,
    mentions: input.mentionIds.map((id) => ({ name: byId.get(id) ?? "구성원", username: usernames.get(id) })),
    url: `${input.origin}/knowledge/development?request=${input.requestId}` });
  return sendToRooms(token, rooms, text, "request comment");
}

/** 운영 · 완료 개발 로그 → 그 프로젝트 사업의 업무 소통방. A company-wide project (브랜디액션 OS, TIPS) has no room, so nothing is sent. */
export async function shareReleaseLog(log: { id: string; title: string; description?: string | null; parent_id?: string | null }, origin: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !log.parent_id) return 0;
  const { data: project } = await createServiceSupabase().from("os_records").select("title,brand").eq("id", log.parent_id).maybeSingle();
  const rooms = requestCommentRooms(project ?? {}, []);
  const text = releaseLogText({ project: String(project?.title || project?.brand || ""), title: log.title, summary: log.description ?? "",
    url: `${origin}/knowledge/development?project=${log.parent_id}&tab=history` });
  return sendToRooms(token, rooms, text, "release log");
}
