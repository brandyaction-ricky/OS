import { ApiError } from "@/lib/http";
import { parseSavedSoundCatalog, soundCatalogSchema, type SoundCatalog } from "@/lib/sound-catalog";
import { createServiceSupabase } from "@/lib/supabase/server";
import { YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";

// Same as the diagram list: one JSON object in the private JSON-only bucket, overwritten on each report.
const CATALOG_PATH = "render-pc/sound-catalog.json";

export async function saveSoundCatalog(input: unknown) {
  const catalog: SoundCatalog = { ...soundCatalogSchema.parse(input), at: new Date().toISOString() };
  const { error } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET)
    .upload(CATALOG_PATH, new Blob([JSON.stringify(catalog)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new ApiError(503, "SOUND_CATALOG_SAVE_FAILED", "사운드 목록을 저장하지 못했습니다.");
  return { ok: true, items: catalog.items.length };
}

/** The last report, or null (no report yet, or unreadable). */
export async function readSoundCatalog(): Promise<SoundCatalog | null> {
  const { data, error } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(CATALOG_PATH);
  if (error || !data) return null;
  try { return parseSavedSoundCatalog(await data.text()); } catch { return null; }
}
