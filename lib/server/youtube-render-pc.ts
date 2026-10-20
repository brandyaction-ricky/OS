import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { YOUTUBE_RENDER_RUN_KIND } from "./youtube-render-run";
import { YOUTUBE_VOICE_RUN_KIND, YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";

// The always-on render PC (Mac mini, owner decision 2026-10-17) reports itself once a minute. The latest report is one
// small JSON object in the private JSON-only bucket, overwritten each time, so no table, migration or row history grows.
const STATUS_PATH = "render-pc/status.json";
export const RENDER_PC_MIN_DISK_GB = 60; // one render decodes about 45 GB of deck frames
const OFFLINE_AFTER_SECONDS = 5 * 60;

export const renderPcSignalSchema = z.object({
  action: z.literal("heartbeat"),
  diskFreeGb: z.number().min(0).max(1_000_000),
  memUsedGb: z.number().min(0).max(4_096),
  memTotalGb: z.number().min(0).max(4_096),
  job: z.object({ renderId: z.string().uuid().optional(), step: z.enum(["voice", "download", "narration", "drawing", "upload"]) }).strict().nullable(),
  packageName: z.string().trim().max(80).optional(),
}).strict();
type Signal = Omit<z.infer<typeof renderPcSignalSchema>, "action"> & { at: string };

export async function saveRenderPcSignal(input: z.infer<typeof renderPcSignalSchema>) {
  const signal: Signal = { diskFreeGb: input.diskFreeGb, memUsedGb: input.memUsedGb, memTotalGb: input.memTotalGb, job: input.job, packageName: input.packageName, at: new Date().toISOString() };
  const { error } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET)
    .upload(STATUS_PATH, new Blob([JSON.stringify(signal)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new ApiError(503, "RENDER_PC_SIGNAL_FAILED", "렌더 PC 신호를 저장하지 못했습니다.");
  return { ok: true, acceptsWork: signal.diskFreeGb >= RENDER_PC_MIN_DISK_GB };
}

/** What the 영상 제작 screen shows: on or off, last signal, current job, disk, and the queue in front of new work. */
export async function readRenderPcStatus() {
  const service = createServiceSupabase();
  const [file, queue, recent] = await Promise.all([
    service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(STATUS_PATH),
    service.from("os_records").select("metadata->>kind,status").eq("record_type", "ai_job").in("metadata->>kind", [YOUTUBE_VOICE_RUN_KIND, YOUTUBE_RENDER_RUN_KIND])
      .in("status", ["backlog", "in_progress"]).is("archived_at", null).limit(200),
    service.from("os_records").select("created_at,updated_at").eq("record_type", "ai_job").eq("metadata->>kind", YOUTUBE_RENDER_RUN_KIND)
      .eq("status", "done").is("archived_at", null).order("updated_at", { ascending: false }).limit(5),
  ]);
  let signal: Signal | null = null;
  if (!file.error && file.data) { try { signal = JSON.parse(await file.data.text()) as Signal; } catch { signal = null; } }
  const ageSeconds = signal ? Math.max(0, Math.round((Date.now() - Date.parse(signal.at)) / 1000)) : null;
  const minutes = (recent.data ?? []).map(row => (Date.parse(row.updated_at) - Date.parse(row.created_at)) / 60_000).filter(value => value > 0 && value < 24 * 60);
  const rows = (queue.data ?? []) as { kind: string; status: string }[];
  return {
    state: signal === null ? "unknown" as const : ageSeconds! > OFFLINE_AFTER_SECONDS ? "offline" as const : "online" as const,
    lastSignalAt: signal?.at ?? null, ageSeconds,
    diskFreeGb: signal?.diskFreeGb ?? null, lowDisk: signal ? signal.diskFreeGb < RENDER_PC_MIN_DISK_GB : false,
    memUsedGb: signal?.memUsedGb ?? null, memTotalGb: signal?.memTotalGb ?? null, job: signal?.job ?? null, packageName: signal?.packageName ?? null,
    // ponytail: counts across all videos; per-video position arrives with the v1 제작 screen.
    queue: { voice: rows.filter(row => row.kind === YOUTUBE_VOICE_RUN_KIND).length, render: rows.filter(row => row.kind === YOUTUBE_RENDER_RUN_KIND).length },
    averageRenderMinutes: minutes.length ? Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length) : null,
  };
}
