import { createServiceSupabase } from "@/lib/supabase/server";

const BUCKET = "os-content-media";

export async function cleanupExpiredContentMedia() {
  const service = createServiceSupabase();
  const now = new Date().toISOString();
  const { data, error } = await service.from("os_records").select("id,metadata")
    .not("metadata->>contentMediaPath", "is", null)
    .lt("metadata->>contentMediaRetentionUntil", now)
    .limit(100);
  if (error) throw new Error(`CONTENT_MEDIA_CLEANUP_LOOKUP_FAILED:${error.message}`);

  let deleted = 0;
  let failed = 0;
  for (const record of data ?? []) {
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
    const path = typeof metadata.contentMediaPath === "string" ? metadata.contentMediaPath : "";
    if (!path) continue;
    const { error: removeError } = await service.storage.from(BUCKET).remove([path]);
    if (removeError) { failed += 1; continue; }
    const { error: updateError } = await service.from("os_records").update({
      metadata: { ...metadata, contentMediaPath: null, contentMediaDeletedAt: now },
    }).eq("id", record.id);
    if (updateError) { failed += 1; continue; }
    deleted += 1;
  }
  return { checked: data?.length ?? 0, deleted, failed };
}
