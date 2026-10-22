import { ApiError } from "@/lib/http";
import { diagramCatalogSchema, type DiagramCatalog } from "@/lib/diagram-catalog";
import { createServiceSupabase } from "@/lib/supabase/server";
import { YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";

// Like the render PC heartbeat: the latest list is one JSON object in the private JSON-only bucket, overwritten on each
// report, so no table or migration grows.
const CATALOG_PATH = "render-pc/diagram-catalog.json";

export async function saveDiagramCatalog(input: unknown) {
  const catalog: DiagramCatalog = { ...diagramCatalogSchema.parse(input), at: new Date().toISOString() };
  const { error } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET)
    .upload(CATALOG_PATH, new Blob([JSON.stringify(catalog)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new ApiError(503, "DIAGRAM_CATALOG_SAVE_FAILED", "도식 목록을 저장하지 못했습니다.");
  return { ok: true, items: catalog.items.length };
}

/** The last report, or null (no report yet, or unreadable) — callers then keep the fixed v13 types. */
export async function readDiagramCatalog(): Promise<DiagramCatalog | null> {
  const { data, error } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(CATALOG_PATH);
  if (error || !data) return null;
  try {
    const parsed = diagramCatalogSchema.safeParse(JSON.parse(await data.text()));
    return parsed.success && parsed.data.items.length ? parsed.data : null;
  } catch { return null; }
}
