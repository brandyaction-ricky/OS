import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { channelStyleInput, keepsDefault, nextStyles, type ChannelStyle } from "@/lib/youtube-process/channel-style";
import type { RequestActor } from "./auth";
import { ypUuid } from "./youtube-process-stages";

// 채널 모양 (2026-11-02), the 채널 카드 list since 2026-11-07: one company record, like the 최종 화면 진단 카드.
const stylesId = () => ypUuid("yp-channel-styles");

export async function readChannelStyles() {
  const { data, error } = await createServiceSupabase().from("os_records").select("version,metadata").eq("id", stylesId()).maybeSingle();
  if (error) throw new ApiError(503, "CHANNEL_STYLES_READ_FAILED", "채널 모양을 읽지 못했어요.");
  return { styles: ((data?.metadata?.styles ?? []) as ChannelStyle[]), version: (data?.version as number | undefined) ?? 0 };
}

export const channelStylesSchema = z.object({ expectedVersion: z.number().int().min(0), styles: z.array(channelStyleInput).max(50) }).strict();

export async function saveChannelStyles(actor: RequestActor, input: z.infer<typeof channelStylesSchema>) {
  const current = await readChannelStyles();
  if (current.version !== input.expectedVersion) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");
  if (!keepsDefault(current.styles, input.styles)) throw new ApiError(400, "CHANNEL_DEFAULT_KEPT", "맨 위 기본 채널은 빼거나 옮길 수 없어요. 예전 영상이 모두 이 채널이에요.");
  const styles = nextStyles(current.styles, input.styles, actor.name, new Date().toISOString());
  const service = createServiceSupabase(), metadata = { packageKind: "yp_channel_styles", styles };
  const { data, error } = input.expectedVersion
    ? await service.from("os_records").update({ metadata, updated_by: actor.id }).eq("id", stylesId()).eq("version", input.expectedVersion).select("version").maybeSingle()
    : await service.from("os_records").insert({ id: stylesId(), record_type: "content_package", title: "채널 모양", description: "", status: "active", priority: "normal",
      brand: "브랜디액션", team: actor.team || "콘텐츠", owner_id: actor.ownerId, created_by: actor.id, updated_by: actor.id, tags: ["유튜브", "채널 모양"], metadata }).select("version").maybeSingle();
  if (error?.code === "23505" || (!error && !data)) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");
  if (error) throw new ApiError(500, "CHANNEL_STYLES_SAVE_FAILED", "채널 모양을 저장하지 못했어요.");
  return { styles, version: data!.version as number };
}
