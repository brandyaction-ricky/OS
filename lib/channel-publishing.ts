import { z } from "zod";

export const publicationSettingsSchema = z.object({
  account: z.object({ platform: z.enum(["instagram", "threads"]), ownerId: z.string().uuid() }),
  platformFormat: z.enum(["ig_carousel", "ig_reel", "threads_text", "threads_chain", "threads_carousel"]),
  publishMode: z.enum(["confirm", "now", "manual"]).default("confirm"),
  caption: z.string().trim().max(2200), hashtags: z.string().trim().max(600).default(""),
  firstComment: z.string().trim().max(2200).default(""),
  replyControl: z.enum(["everyone", "accounts_you_follow", "mentioned_only"]).default("everyone"),
  parts: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  media: z.array(z.object({ path: z.string().min(1).max(500), mimeType: z.enum(["image/png", "image/jpeg", "video/mp4"]), width: z.number().int().positive(), height: z.number().int().positive(), size: z.number().int().positive() })).max(20).default([]),
});
export type PublicationSettings = z.infer<typeof publicationSettingsSchema>;
export type PublishReceipt = { id: string; permalink: string };
export type PublishCheckpoint = {
  receipts: PublishReceipt[];
  container?: { id: string; index: number; phase: "created" | "publishing" };
};
export function publicationProblems(settings: PublicationSettings) {
  const errors: string[] = [], instagram = settings.account.platform === "instagram";
  if (instagram !== settings.platformFormat.startsWith("ig_")) errors.push("게시 형식과 연결 플랫폼이 다릅니다.");
  const copy = [settings.caption, settings.hashtags].filter(Boolean).join("\n\n");
  if (!copy && !settings.parts.length) errors.push("게시 문안을 입력해 주세요.");
  if (instagram && Array.from(copy).length > 2200) errors.push("인스타 캡션과 해시태그는 합쳐서 2,200자 이하여야 합니다.");
  if (!instagram && settings.platformFormat !== "threads_chain" && Array.from(copy).length > 500) errors.push("Threads 문안은 해시태그 포함 500자 이하여야 합니다.");
  if (settings.platformFormat === "threads_chain" && (settings.parts.length < 2 || settings.parts.some(part => Array.from(part).length > 500))) errors.push("글타래는 500자 이하의 글을 2개 이상 입력해 주세요.");
  if (settings.platformFormat.endsWith("carousel")) {
    const max = instagram ? 10 : 20;
    if (settings.media.length < 2 || settings.media.length > max) errors.push(`캐러셀 이미지는 2~${max}장이어야 합니다.`);
    if (settings.media.some(media => !media.mimeType.startsWith("image/") || media.size > 8 * 1024 * 1024)) errors.push("이미지는 JPEG/PNG, 한 장 8MB 이하만 사용할 수 있습니다.");
    if (instagram && settings.media.some(media => Math.abs(media.width / media.height - settings.media[0].width / settings.media[0].height) > 0.001)) errors.push("인스타 카드의 가로세로 비율을 통일해 주세요.");
  }
  if (settings.platformFormat === "ig_reel" && (settings.media.length !== 1 || settings.media[0].mimeType !== "video/mp4")) errors.push("릴스는 MP4 영상 한 개가 필요합니다.");
  return errors;
}
export function defaultPublicationSettings(metadata: Record<string, unknown>, description: string, ownerId: string): PublicationSettings {
  const instagram = metadata.platform === "instagram";
  const parsed = publicationSettingsSchema.safeParse({ account: { platform: instagram ? "instagram" : "threads", ownerId }, platformFormat: instagram ? "ig_carousel" : "threads_text", caption: description.slice(0, 2200), ...metadata });
  return parsed.success ? parsed.data : { account: { platform: instagram ? "instagram" : "threads", ownerId }, platformFormat: instagram ? "ig_carousel" : "threads_text", publishMode: "confirm", caption: description.slice(0,2200), hashtags: "", firstComment: "", replyControl: "everyone", parts: [], media: [] };
}

export interface PublishProvider {
  create(index: number, replyToId?: string): Promise<string>;
  inspect(containerId: string): Promise<"ready" | "processing" | "expired" | "published">;
  publish(containerId: string): Promise<PublishReceipt>;
}
export class PublicationError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// Persist intent before each external side effect. Ambiguous outcomes never auto-republish.
export async function executePublication(settings: PublicationSettings, initial: PublishCheckpoint, provider: PublishProvider, save: (checkpoint: PublishCheckpoint) => Promise<void>) {
  const state: PublishCheckpoint = structuredClone(initial);
  const total = settings.platformFormat === "threads_chain" ? settings.parts.length : 1;
  for (let index = state.receipts.length; index < total; index++) {
    if (state.container?.phase === "publishing") throw new PublicationError("PUBLISH_RESULT_UNCERTAIN", "직전 게시 결과 확인이 필요합니다. 중복 방지를 위해 자동 재게시하지 않습니다.");
    if (!state.container || state.container.index !== index) {
      state.container = { id: await provider.create(index, state.receipts.at(-1)?.id), index, phase: "created" };
      await save(structuredClone(state));
    }
    const status = await provider.inspect(state.container.id);
    if (status === "expired") {
      delete state.container; await save(structuredClone(state));
      throw new PublicationError("PUBLISH_CONTAINER_EXPIRED", "준비 이미지가 만료되었습니다. 다시 확인하고 게시하면 미게시 부분만 새로 준비합니다.");
    }
    if (status === "processing") throw new PublicationError("PUBLISH_MEDIA_PROCESSING", "플랫폼에서 파일을 준비하고 있습니다. 잠시 후 결과를 다시 확인하세요.");
    if (status === "published") throw new PublicationError("PUBLISH_RESULT_UNCERTAIN", "플랫폼에 게시된 준비 항목입니다. 게시 결과를 확인해야 합니다.");
    state.container.phase = "publishing";
    await save(structuredClone(state));
    let receipt: PublishReceipt;
    try { receipt = await provider.publish(state.container.id); }
    catch (error) {
      if (error instanceof PublicationError && error.code === "META_PUBLISH_REJECTED") {
        state.container.phase = "created";
        await save(structuredClone(state));
      }
      throw error;
    }
    if (!receipt.id) throw new PublicationError("PUBLISH_RESULT_UNCERTAIN", "플랫폼 게시 ID를 받지 못했습니다. 결과를 먼저 확인해 주세요.");
    state.receipts.push(receipt); delete state.container;
    await save(structuredClone(state));
  }
  return state;
}
