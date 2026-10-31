import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { ENDSCREEN_CARD_DEFAULT, ENDSCREEN_IMAGE_MAX, type EndscreenCard } from "@/lib/youtube-process/endscreen-card";
import type { RequestActor } from "./auth";
import { ypUuid } from "./youtube-process-stages";

// One company record, like the 음성 사전.
const cardId = () => ypUuid("yp-endscreen-card");

export async function readEndscreenCard() {
  const { data, error } = await createServiceSupabase().from("os_records").select("version,metadata").eq("id", cardId()).maybeSingle();
  if (error) throw new ApiError(503, "ENDSCREEN_CARD_READ_FAILED", "진단 카드를 읽지 못했어요.");
  return { card: { ...ENDSCREEN_CARD_DEFAULT, ...(data?.metadata?.card ?? {}) } as EndscreenCard, version: (data?.version as number | undefined) ?? 0 };
}

export const endscreenCardSchema = z.object({
  expectedVersion: z.number().int().min(0),
  name: z.string().trim().max(60), cta: z.string().trim().max(30), link: z.union([z.literal(""), z.string().trim().url().max(500)]),
  image: z.union([z.literal(""), z.string().max(ENDSCREEN_IMAGE_MAX).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)]),
}).strict();

export async function saveEndscreenCard(actor: RequestActor, input: z.infer<typeof endscreenCardSchema>) {
  const { expectedVersion, ...card } = input;
  const service = createServiceSupabase(), metadata = { packageKind: "yp_endscreen_card", card };
  const { data, error } = expectedVersion
    ? await service.from("os_records").update({ metadata, updated_by: actor.id }).eq("id", cardId()).eq("version", expectedVersion).select("version").maybeSingle()
    : await service.from("os_records").insert({ id: cardId(), record_type: "content_package", title: "최종 화면 진단 카드", description: "", status: "active", priority: "normal",
      brand: "브랜디액션", team: actor.team || "콘텐츠", owner_id: actor.ownerId, created_by: actor.id, updated_by: actor.id, tags: ["유튜브", "최종 화면"], metadata }).select("version").maybeSingle();
  if (error?.code === "23505" || (!error && !data)) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");
  if (error) throw new ApiError(500, "ENDSCREEN_CARD_SAVE_FAILED", "진단 카드를 저장하지 못했어요.");
  return { card, version: data!.version as number };
}
