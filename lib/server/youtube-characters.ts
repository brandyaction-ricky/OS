import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";

export const YOUTUBE_CHARACTER_BUCKET = "os-youtube-character";
export const YOUTUBE_CHARACTER_CATALOG_VERSION = "brandyaction-character-catalog-v2";

// The catalog and artwork are owner-provided and live only in private storage.
export const youtubeCharacterCatalogSchema = z.object({
  version: z.literal(YOUTUBE_CHARACTER_CATALOG_VERSION),
  scope: z.string().max(300).optional(),
  assets: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/), file: z.string().regex(/^[a-z0-9_-]{1,40}\.png$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive(),
    transparent: z.boolean(), usable: z.boolean(), title: z.string().min(1).max(80), description: z.string().max(300),
    embeddedText: z.string().max(120), sourceName: z.string().max(200).optional(), blockedReason: z.string().max(200).optional(),
  }).strict()).min(1).max(300),
}).strict().refine((catalog) => new Set(catalog.assets.map((asset) => asset.id)).size === catalog.assets.length, { message: "duplicate id" });
export type YoutubeCharacterCatalog = z.infer<typeof youtubeCharacterCatalogSchema>;

export function summarizeCharacterCatalog(catalog: YoutubeCharacterCatalog) {
  const usable = catalog.assets.filter((asset) => asset.usable);
  return {
    digest: createHash("sha256").update(JSON.stringify(catalog)).digest("hex"),
    ids: new Set(usable.map((asset) => asset.id)),
    sizes: new Map(usable.map((asset) => [asset.id, { width: asset.width, height: asset.height }])),
    prompt: usable.map((asset) => `${asset.id} (${asset.width}x${asset.height}) ${asset.title}: ${asset.description}${asset.embeddedText ? ` [그림 속 글자: ${asset.embeddedText}]` : ""}`).join("\n"),
  };
}

export async function readYoutubeCharacterCatalog() {
  const { data, error } = await createServiceSupabase().storage.from(YOUTUBE_CHARACTER_BUCKET).download("catalog.json");
  if (error || !data) throw new ApiError(503, "CHARACTER_CATALOG_NOT_CONFIGURED", "비공개 캐릭터 목록을 먼저 연결해 주세요.");
  const parsed = youtubeCharacterCatalogSchema.safeParse(JSON.parse(await data.text()));
  if (!parsed.success || !parsed.data.assets.some((asset) => asset.usable))
    throw new ApiError(503, "CHARACTER_CATALOG_INVALID", "비공개 캐릭터 목록을 읽을 수 없습니다.");
  return summarizeCharacterCatalog(parsed.data);
}
