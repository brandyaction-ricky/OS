import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { channelBriefText, channelOf, purposeCanonTitle } from "@/lib/youtube-process/channel-style";
import { readChannelStyles } from "./youtube-channel-styles";

// 다채널 3단계 (2026-11-07, OS 문서 「다채널 콘텐츠 운영 설계」 §2): a channel other than the 기본 채널 makes its content by its
// 목적 정본 — one OS document per purpose, titled 「목적 정본 — {목적}」, shared by every channel with that purpose — and by its
// channel card. The 기본 채널 keeps reading the canons it always read, so nothing changes for it.

/** The newest live 목적 정본 for a purpose, or null. */
export async function purposeCanon(purpose: string) {
  const { data, error } = await createServiceSupabase().from("os_documents").select("id,title").eq("title", purposeCanonTitle(purpose))
    .neq("status", "archived").order("updated_at", { ascending: false }).limit(1);
  if (error) throw new ApiError(503, "CHANNEL_CANON_READ_FAILED", "목적 정본을 읽지 못했어요. 잠시 뒤 다시 해 주세요.");
  return (data?.[0] ?? null) as { id: string; title: string } | null;
}

/**
 * The channel a project is made for when it is not the 기본 채널, with its 목적 정본; null for the 기본 채널, a record that is not a
 * project, or before any card exists. A card without a purpose, or a purpose without its 목적 정본, stops the AI work with what to do.
 */
export async function channelContext(projectId: string | null | undefined) {
  if (!projectId) return null;
  const [{ data }, { styles }] = await Promise.all([
    createServiceSupabase().from("os_records").select("metadata").eq("id", projectId).maybeSingle(), readChannelStyles()]);
  const card = channelOf(styles, (data?.metadata?.yp as { topic?: { channel?: string } } | undefined)?.topic?.channel);
  if (!card || card.id === styles[0].id) return null;
  if (!card.purpose?.trim()) throw new ApiError(409, "CHANNEL_PURPOSE_MISSING", `「${card.name}」 채널 카드에 목적을 적어 주세요. 채널/링크 관리 › 채널에서 적어요.`);
  const canon = await purposeCanon(card.purpose);
  if (!canon) throw new ApiError(409, "CHANNEL_CANON_MISSING", `「${purposeCanonTitle(card.purpose)}」 문서가 OS에 없어요. 이 채널은 목적 정본을 만든 뒤에 AI로 만들 수 있어요.`);
  return { card, canon, text: channelBriefText(card, canon) };
}
