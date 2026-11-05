import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";

// 내 컴퓨터로 시안 (owner decisions 2026-10-27: Logan's engine may go on staff PCs; keep the bundle in the OS). The render PC packs
// its current v13 engine once per fingerprint and uploads it in parts; a staff PC downloads the render PC's current one, checks every
// part's hash, and installs it. Private bucket, signed URLs only; the manifest is a small JSON beside the render PC's status file.
// 영상 편집기 (2026-11-04): an edited final names the engine it was drawn with, and its material bundle lies here under edits/ — never
// delete an engine an edited final names, or that final can no longer be edited on another computer.
export const ENGINE_BUCKET = "os-render-engine";
export const ENGINE_PART_BYTES = 45_000_000; // under the project's 50 MB upload limit
const MAX_PARTS = 24; // about 1 GB
const fingerprint = z.string().regex(/^[a-f0-9]{32}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const partPath = (fp: string, n: number) => `engines/${fp}/part${String(n).padStart(2, "0")}.bin`;
const manifestPath = (fp: string) => `render-pc/engine/${fp}.json`;
// 엔진 · 자료 분리 (로건 개발 문서 v3 7.2-13, 2026-11-04): the engine's pictures, music and sounds (about 300 MB of its 374) change
// rarely, so they travel as their own bundle keyed by their own fingerprint. An engine change then stores and downloads its code
// (tens of MB), and a staff PC keeps the assets it already has.
const assetPartPath = (fp: string, n: number) => `assets/${fp}/part${String(n).padStart(2, "0")}.bin`;
const assetManifestPath = (fp: string) => `render-pc/assets/${fp}.json`;
const partsSchema = z.array(z.object({ bytes: z.number().int().positive().max(ENGINE_PART_BYTES), sha256: hex }).strict()).min(1).max(MAX_PARTS);

export const engineUploadSchema = z.object({ action: z.literal("engine_upload"), fingerprint, parts: z.number().int().min(1).max(MAX_PARTS) }).strict();
export const engineReadySchema = z.object({ action: z.literal("engine_ready"), fingerprint, python: z.string().regex(/^\d+\.\d+$/),
  parts: partsSchema, /** the assets bundle this code bundle needs (none: the bundle carries its own, as before 2026-11-04) */ assets: hex.optional() }).strict();
const manifestSchema = engineReadySchema.omit({ action: true }).extend({ at: z.string().datetime() });
export const assetsUploadSchema = z.object({ action: z.literal("assets_upload"), fingerprint: hex, parts: z.number().int().min(1).max(MAX_PARTS) }).strict();
export const assetsReadySchema = z.object({ action: z.literal("assets_ready"), fingerprint: hex, parts: partsSchema }).strict();
const assetsManifestSchema = assetsReadySchema.omit({ action: true }).extend({ at: z.string().datetime() });

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
  const manifest = { fingerprint: input.fingerprint, python: input.python, parts: input.parts, ...(input.assets ? { assets: input.assets } : {}), at: new Date().toISOString() };
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

/** Render PC: where the assets bundle's parts go — nothing to do when the OS already keeps that one. */
export async function assetsUploadUrls(input: z.infer<typeof assetsUploadSchema>) {
  if (await readAssets(input.fingerprint)) return { have: true, urls: [] as string[] };
  const storage = createServiceSupabase().storage.from(ENGINE_BUCKET);
  const urls = await Promise.all(Array.from({ length: input.parts }, async (_, n) => {
    const { data, error } = await storage.createSignedUploadUrl(assetPartPath(input.fingerprint, n), { upsert: true });
    if (error || !data) throw new ApiError(503, "ENGINE_SIGN_FAILED", "자료 묶음 업로드 주소를 만들지 못했어요.");
    return data.signedUrl;
  }));
  return { have: false, urls };
}
export async function saveAssetsManifest(input: z.infer<typeof assetsReadySchema>) {
  const manifest = { fingerprint: input.fingerprint, parts: input.parts, at: new Date().toISOString() };
  const { error } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET)
    .upload(assetManifestPath(input.fingerprint), new Blob([JSON.stringify(manifest)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new ApiError(503, "ENGINE_MANIFEST_FAILED", "자료 묶음 목록을 저장하지 못했어요.");
  return { ok: true };
}
async function readAssets(fp: string) {
  const file = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(assetManifestPath(fp));
  if (file.error || !file.data) return null;
  const parsed = assetsManifestSchema.safeParse(JSON.parse(await file.data.text()));
  return parsed.success ? parsed.data : null;
}
const signParts = async (parts: { bytes: number; sha256: string }[], path: (n: number) => string) => {
  const storage = createServiceSupabase().storage.from(ENGINE_BUCKET);
  return Promise.all(parts.map(async (part, n) => {
    const { data, error } = await storage.createSignedUrl(path(n), 600);
    if (error || !data) throw new ApiError(503, "ENGINE_SIGN_FAILED", "엔진 묶음 주소를 만들지 못했어요.");
    return { ...part, url: data.signedUrl };
  }));
};

/**
 * Staff PC: the render PC's current engine (or a given one), with download addresses (10 minutes) when its bundle is up. A split
 * engine (code + assets) goes only to a runner that installs both (`split`); an older runner is told to get the new runner first.
 */
export async function currentEngineDownload(renderPcEngine: string | undefined, split = false) {
  if (!renderPcEngine) return { fingerprint: null, available: false as const };
  const manifest = await readManifest(renderPcEngine);
  if (!manifest) return { fingerprint: renderPcEngine, available: false as const };
  let assets: { fingerprint: string; parts: { bytes: number; sha256: string; url: string }[] } | undefined;
  if (manifest.assets) {
    if (!split) return { fingerprint: manifest.fingerprint, available: false as const, update: true as const };
    const kept = await readAssets(manifest.assets);
    if (!kept) return { fingerprint: manifest.fingerprint, available: false as const };
    assets = { fingerprint: kept.fingerprint, parts: await signParts(kept.parts, (n) => assetPartPath(kept.fingerprint, n)) };
  }
  const parts = await signParts(manifest.parts, (n) => partPath(manifest.fingerprint, n));
  return { fingerprint: manifest.fingerprint, available: true as const, python: manifest.python, parts, ...(assets ? { assets } : {}) };
}
