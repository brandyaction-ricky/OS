import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";

// 내 컴퓨터로 시안 (owner decisions 2026-10-27: Logan's engine may go on staff PCs; keep the bundle in the OS). The render PC packs
// its current v13 engine once per fingerprint and uploads it in parts; a staff PC downloads the render PC's current one, checks every
// part's hash, and installs it. Private bucket, signed URLs only; the manifest is a small JSON beside the render PC's status file.
export const ENGINE_BUCKET = "os-render-engine";
export const ENGINE_PART_BYTES = 45_000_000; // under the project's 50 MB upload limit
const MAX_PARTS = 24; // about 1 GB
const fingerprint = z.string().regex(/^[a-f0-9]{32}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const partPath = (fp: string, n: number) => `engines/${fp}/part${String(n).padStart(2, "0")}.bin`;
const manifestPath = (fp: string) => `render-pc/engine/${fp}.json`;

export const engineUploadSchema = z.object({ action: z.literal("engine_upload"), fingerprint, parts: z.number().int().min(1).max(MAX_PARTS) }).strict();
export const engineReadySchema = z.object({ action: z.literal("engine_ready"), fingerprint, python: z.string().regex(/^\d+\.\d+$/),
  parts: z.array(z.object({ bytes: z.number().int().positive().max(ENGINE_PART_BYTES), sha256: hex }).strict()).min(1).max(MAX_PARTS) }).strict();
const manifestSchema = engineReadySchema.omit({ action: true }).extend({ at: z.string().datetime() });

/** Render PC: where to put each part of the bundle for this fingerprint. */
export async function engineUploadUrls(input: z.infer<typeof engineUploadSchema>) {
  const storage = createServiceSupabase().storage.from(ENGINE_BUCKET);
  const urls = await Promise.all(Array.from({ length: input.parts }, async (_, n) => {
    const { data, error } = await storage.createSignedUploadUrl(partPath(input.fingerprint, n), { upsert: true });
    if (error || !data) throw new ApiError(503, "ENGINE_SIGN_FAILED", "엔진 묶음 업로드 주소를 만들지 못했어요.");
    return data.signedUrl;
  }));
  return { urls };
}

/** Render PC: every part is up; staff PCs may now install this engine. */
export async function saveEngineManifest(input: z.infer<typeof engineReadySchema>) {
  const manifest = { fingerprint: input.fingerprint, python: input.python, parts: input.parts, at: new Date().toISOString() };
  const { error } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET)
    .upload(manifestPath(input.fingerprint), new Blob([JSON.stringify(manifest)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new ApiError(503, "ENGINE_MANIFEST_FAILED", "엔진 묶음 목록을 저장하지 못했어요.");
  return { ok: true };
}

async function readManifest(fp: string) {
  const file = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(manifestPath(fp));
  if (file.error || !file.data) return null;
  const parsed = manifestSchema.safeParse(JSON.parse(await file.data.text()));
  return parsed.success ? parsed.data : null;
}
/** Whether the render PC still has to upload the bundle for its engine (its heartbeat asks). */
export const engineBundleSaved = async (fp: string) => Boolean(await readManifest(fp));

/** Staff PC: the render PC's current engine, with download addresses (10 minutes) when its bundle is up. */
export async function currentEngineDownload(renderPcEngine: string | undefined) {
  if (!renderPcEngine) return { fingerprint: null, available: false as const };
  const manifest = await readManifest(renderPcEngine);
  if (!manifest) return { fingerprint: renderPcEngine, available: false as const };
  const storage = createServiceSupabase().storage.from(ENGINE_BUCKET);
  const parts = await Promise.all(manifest.parts.map(async (part, n) => {
    const { data, error } = await storage.createSignedUrl(partPath(manifest.fingerprint, n), 600);
    if (error || !data) throw new ApiError(503, "ENGINE_SIGN_FAILED", "엔진 묶음 주소를 만들지 못했어요.");
    return { ...part, url: data.signedUrl };
  }));
  return { fingerprint: manifest.fingerprint, available: true as const, python: manifest.python, parts };
}
