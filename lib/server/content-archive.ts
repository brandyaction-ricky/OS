// 아카이브 화면 (수정 요청 2026-11-13, 2단계): the reference documents the Telegram rooms fill (03_Content/레퍼런스/{주제}) as cards.
// They are read with the member's own access (team documents); a 상태 or 주제 change is written by the server once the member can read
// the card, with who changed it written into the document.
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { ARCHIVE_FOLDER, ARCHIVE_STATES, ARCHIVE_TOPICS, readArchive, withArchiveChange } from "@/lib/telegram-archive";
import type { RequestActor } from "./auth";

const LIMIT = 500;
const SIGN_SECONDS = 1_800;

export async function listArchive(actor: RequestActor) {
  const { data, error } = await actor.supabase.from("os_documents").select("id,title,folder,content_md,current_version,created_at,updated_at")
    .like("folder", `${ARCHIVE_FOLDER}/%`).neq("status", "archived").order("created_at", { ascending: false }).limit(LIMIT);
  if (error) throw new ApiError(500, "ARCHIVE_READ_FAILED", "아카이브를 읽지 못했어요.");
  const rows = (data ?? []).map((doc) => ({ doc, card: readArchive(String(doc.content_md ?? "")) }));
  // A picture kept from the room sits in the private media bucket: a short-lived address for the cards the member can read.
  const service = createServiceSupabase();
  const images = await Promise.all(rows.map(async ({ card }) => {
    const path = card.image.startsWith("os-content-media/") ? card.image.slice("os-content-media/".length) : "";
    if (!path) return "";
    const { data: signed } = await service.storage.from("os-content-media").createSignedUrl(path, SIGN_SECONDS);
    return signed?.signedUrl ?? "";
  }));
  return { cards: rows.map(({ doc, card }, i) => ({ id: doc.id as string, version: doc.current_version as number, title: String(doc.title ?? ""),
    folderTopic: String(doc.folder ?? "").slice(ARCHIVE_FOLDER.length + 1), createdAt: String(doc.created_at ?? ""), ...card, image: images[i] })),
    topics: ARCHIVE_TOPICS, states: ARCHIVE_STATES, truncated: rows.length === LIMIT };
}

export const archiveChangeSchema = z.object({ id: z.string().uuid(), version: z.number().int().min(1),
  state: z.enum(ARCHIVE_STATES).optional(), topic: z.enum(ARCHIVE_TOPICS).optional() }).strict().refine((input) => input.state || input.topic, "바꿀 상태나 주제를 골라 주세요.");

/** 상태 or 주제 (the folder moves with it — a person moving a card is the answer); stale versions are refused, never overwritten. */
export async function changeArchive(actor: RequestActor, input: z.infer<typeof archiveChangeSchema>) {
  const { data: seen, error: seenError } = await actor.supabase.from("os_documents").select("id,folder,content_md,current_version")
    .eq("id", input.id).like("folder", `${ARCHIVE_FOLDER}/%`).neq("status", "archived").maybeSingle();
  if (seenError) throw new ApiError(500, "ARCHIVE_READ_FAILED", "카드를 읽지 못했어요.");
  if (!seen) throw new ApiError(404, "ARCHIVE_CARD_NOT_FOUND", "볼 수 있는 아카이브 카드가 아니에요.");
  if (seen.current_version !== input.version) throw new ApiError(409, "ARCHIVE_CARD_CHANGED", "다른 사람이 먼저 바꿨어요. 목록을 새로 불러왔어요.");
  const content = withArchiveChange(String(seen.content_md ?? ""), { state: input.state, topic: input.topic }, actor.name || "구성원", new Date().toISOString());
  const { data, error } = await createServiceSupabase().from("os_documents").update({ content_md: content, ...(input.topic ? { folder: `${ARCHIVE_FOLDER}/${input.topic}` } : {}) })
    .eq("id", input.id).eq("current_version", input.version).select("id,current_version").maybeSingle();
  if (error || !data) throw new ApiError(409, "ARCHIVE_CARD_CHANGED", "다른 사람이 먼저 바꿨어요. 목록을 새로 불러왔어요.");
  return { id: data.id as string, version: data.current_version as number };
}
