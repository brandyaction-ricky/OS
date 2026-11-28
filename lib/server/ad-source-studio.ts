import { randomUUID } from "node:crypto";
import { getSharp } from "next/dist/server/image-optimizer";
import { ZodError, z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  AD_REFERENCE_MAX, AD_SOURCE_KIND, AD_SOURCE_SIZES, adSourceInputSchema, adSourceIsActive,
  adSourceOwnsPath, adSourcePlan, adSourcePrompt, adSourceTitle,
  type AdSourceAsset, type AdSourceBundle, type AdSourceInput, type AdSourceMeta, type AdSourceRow,
} from "@/lib/ad-source-studio";
import type { RequestActor } from "./auth";
import { drawImageBytes } from "./card-draw";
import { MEDIA_BUCKET } from "./youtube-process-stages";

export const adGenerateSchema = z.object({ version: z.number().int().positive(), itemId: z.string().regex(/^source-\d{1,2}$/) }).strict();
export function adSourceError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) return new ApiError(422, "AD_SOURCE_INPUT", "입력 내용과 장면 수, 이미지 수를 확인해 주세요.");
  return new ApiError(503, "AD_SOURCE_UNAVAILABLE", "소재 작업을 처리하지 못했어요. 저장된 작업을 다시 열어 주세요.");
}
function member(actor: RequestActor) {
  if (actor.type !== "user" || actor.id !== actor.ownerId) throw new ApiError(403, "AD_SOURCE_OWNER", "본인 계정으로 로그인해 주세요.");
}
export function adSourceMeta(record: OsRecord): AdSourceMeta {
  const meta = record.metadata as unknown as AdSourceMeta;
  if (meta?.kind !== AD_SOURCE_KIND || meta.v !== 1 || !Array.isArray(meta.items) || !Array.isArray(meta.references))
    throw new ApiError(404, "AD_SOURCE_NOT_FOUND", "소재 작업을 찾지 못했어요.");
  return meta;
}
export async function adSourceRecord(actor: RequestActor, id: string) {
  member(actor);
  const { data, error } = await actor.supabase.from("os_records").select("*").eq("id", id)
    .eq("owner_id", actor.ownerId).eq("record_type", "content_package").eq("metadata->>kind", AD_SOURCE_KIND).is("archived_at", null).maybeSingle();
  if (error) throw new ApiError(503, "AD_SOURCE_READ", "소재 작업을 불러오지 못했어요.");
  if (!data) throw new ApiError(404, "AD_SOURCE_NOT_FOUND", "내 소재 작업을 찾지 못했어요.");
  adSourceMeta(data as OsRecord);
  return data as OsRecord;
}
async function save(record: OsRecord, metadata: AdSourceMeta) {
  const { data, error } = await createServiceSupabase().from("os_records").update({ metadata, updated_by: record.owner_id })
    .eq("id", record.id).eq("owner_id", record.owner_id).eq("record_type", "content_package")
    .eq("metadata->>kind", AD_SOURCE_KIND).eq("version", record.version).is("archived_at", null).select("*").maybeSingle();
  if (error) throw new ApiError(503, "AD_SOURCE_SAVE", "작업을 저장하지 못했어요. 다시 불러와 주세요.");
  if (!data) throw new ApiError(409, "AD_SOURCE_CONFLICT", "다른 창에서 작업이 바뀌었어요. 다시 불러와 주세요.");
  return data as OsRecord;
}
export async function listAdSources(actor: RequestActor): Promise<AdSourceRow[]> {
  member(actor);
  const { data, error } = await actor.supabase.from("os_records").select("id,title,updated_at,metadata")
    .eq("owner_id", actor.ownerId).eq("record_type", "content_package").eq("metadata->>kind", AD_SOURCE_KIND)
    .is("archived_at", null).order("updated_at", { ascending: false }).limit(50);
  if (error) throw new ApiError(503, "AD_SOURCE_LIST", "최근 소재를 불러오지 못했어요.");
  return (data ?? []).map(row => {
    const meta = adSourceMeta(row as OsRecord);
    return { id: row.id, title: row.title, updatedAt: row.updated_at, mode: meta.input.mode, done: meta.items.filter(item => item.status === "done").length, total: meta.items.length };
  });
}
export async function adSourceBundle(record: OsRecord): Promise<AdSourceBundle> {
  const meta = adSourceMeta(record), bucket = createServiceSupabase().storage.from(MEDIA_BUCKET);
  async function signed(asset: AdSourceAsset): Promise<AdSourceAsset> {
    if (!adSourceOwnsPath(record.id, asset.path)) throw new ApiError(409, "AD_SOURCE_PATH", "이미지 경로를 확인하지 못했어요.");
    const { data, error } = await bucket.createSignedUrl(asset.path, 3600);
    if (error || !data) throw new ApiError(503, "AD_SOURCE_URL", "이미지를 열지 못했어요. 다시 불러와 주세요.");
    return { ...asset, url: data.signedUrl };
  }
  const [references, items] = await Promise.all([
    Promise.all(meta.references.map(signed)),
    Promise.all(meta.items.map(async item => ({ ...item, ...(item.asset ? { asset: await signed(item.asset) } : {}) }))),
  ]);
  return { id: record.id, title: record.title, version: record.version, updatedAt: record.updated_at,
    input: meta.input, references, items, activeUntil: adSourceIsActive(meta) ? meta.lease!.expiresAt : null };
}
export async function createAdSource(actor: RequestActor, raw: AdSourceInput) {
  member(actor);
  const input = adSourceInputSchema.parse(raw);
  const metadata: AdSourceMeta = { space: "personal", kind: AD_SOURCE_KIND, v: 1, input, references: [], items: adSourcePlan(input) };
  const { data, error } = await createServiceSupabase().from("os_records").insert({ id: randomUUID(), record_type: "content_package",
    title: adSourceTitle(input), status: "draft", owner_id: actor.ownerId, created_by: actor.ownerId, updated_by: actor.ownerId,
    team: actor.team, brand: actor.brand ?? "", metadata }).select("*").single();
  if (error || !data) throw new ApiError(503, "AD_SOURCE_CREATE", "소재 작업을 저장하지 못했어요.");
  return data as OsRecord;
}
export async function readAdBytes(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new ApiError(413, "AD_SOURCE_SIZE", "입력 또는 파일 크기가 너무 커요.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "AD_SOURCE_EMPTY", "입력이 비어 있어요.");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new ApiError(413, "AD_SOURCE_SIZE", "입력 또는 파일 크기가 너무 커요."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function readAdJson(request: Request) {
  const bytes = await readAdBytes(request, 40_000);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new ApiError(400, "AD_SOURCE_JSON", "입력 형식을 확인해 주세요."); }
}
function versionMatches(record: OsRecord, version: number) {
  if (record.version !== version) throw new ApiError(409, "AD_SOURCE_CONFLICT", "다른 창에서 작업이 바뀌었어요. 다시 불러와 주세요.");
}
async function storeImage(record: OsRecord, bytes: Uint8Array, w: number, h: number): Promise<AdSourceAsset> {
  if (bytes.byteLength > 5 * 1024 * 1024) throw new ApiError(422, "AD_SOURCE_OUTPUT_SIZE", "이미지가 너무 커서 저장하지 못했어요.");
  const path = `ad-sources/${record.id}/${randomUUID()}.png`;
  const { error } = await createServiceSupabase().storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: "image/png", upsert: false });
  if (error) throw new ApiError(503, "AD_SOURCE_UPLOAD", "이미지를 저장하지 못했어요.");
  return { path, w, h };
}
async function discardUnlinked(actor: RequestActor, id: string, asset: AdSourceAsset) {
  // A save can succeed even when its response is lost. Re-read before deleting an orphan.
  const latest = adSourceMeta(await adSourceRecord(actor, id));
  if (latest.references.some(ref => ref.path === asset.path) || latest.items.some(item => item.asset?.path === asset.path)) return;
  await createServiceSupabase().storage.from(MEDIA_BUCKET).remove([asset.path]);
}
export async function uploadAdReference(actor: RequestActor, id: string, version: number, file: File) {
  const record = await adSourceRecord(actor, id), meta = adSourceMeta(record);
  versionMatches(record, version);
  if (adSourceIsActive(meta) || meta.items.some(item => item.attempts > 0)) throw new ApiError(409, "AD_SOURCE_LOCKED", "제작을 시작한 작업의 참고 이미지는 바꿀 수 없어요. 새 작업으로 만들어 주세요.");
  if (meta.references.length >= meta.input.referenceCount) throw new ApiError(422, "AD_SOURCE_REFS_FULL", "선택한 참고 이미지를 모두 올렸어요.");
  if (file.size < 1 || file.size > AD_REFERENCE_MAX || !["image/png", "image/jpeg"].includes(file.type)) throw new ApiError(422, "AD_SOURCE_FILE", "한 장에 3MB 이하인 PNG 또는 JPG를 넣어 주세요.");
  let bytes: Buffer, w: number, h: number;
  try {
    const decoder = getSharp(undefined)(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 20_000_000, failOn: "warning" });
    const info = await decoder.metadata();
    if (!["png", "jpeg"].includes(info.format ?? "") || (info.pages ?? 1) > 1) throw new Error("invalid");
    const decoded = await decoder.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    bytes = decoded.data; w = decoded.info.width; h = decoded.info.height;
  } catch { throw new ApiError(422, "AD_SOURCE_FILE", "이미지를 읽지 못했어요. PNG 또는 JPG 파일을 다시 선택해 주세요."); }
  const asset = await storeImage(record, bytes, w, h);
  try { return await save(record, { ...meta, references: [...meta.references, asset] }); }
  catch (error) { await discardUnlinked(actor, id, asset).catch(() => {}); throw error; }
}
export async function generateAdSource(actor: RequestActor, id: string, input: z.infer<typeof adGenerateSchema>) {
  const record = await adSourceRecord(actor, id), meta = adSourceMeta(record);
  const item = meta.items.find(row => row.id === input.itemId);
  if (!item) throw new ApiError(404, "AD_SOURCE_ITEM", "만들 장면을 찾지 못했어요.");
  // A retried HTTP request for a completed item must never incur another provider call.
  if (item.status === "done" && item.asset) return record;
  versionMatches(record, input.version);
  if (adSourceIsActive(meta)) throw new ApiError(409, "AD_SOURCE_BUSY", "이미 소재를 만들고 있어요. 잠시 후 다시 불러와 주세요.");
  if (meta.references.length !== meta.input.referenceCount) throw new ApiError(422, "AD_SOURCE_REFS_MISSING", "선택한 참고 이미지를 모두 올린 뒤 만들어 주세요.");
  if (item.attempts >= 3) throw new ApiError(422, "AD_SOURCE_RETRY_LIMIT", "이 소재는 3회 시도했어요. 입력을 확인하고 새 작업으로 만들어 주세요.");
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "이미지 생성 연결이 필요해요. 관리자에게 OpenAI 연결을 요청해 주세요.");
  const lease = { id: randomUUID(), itemId: item.id, expiresAt: Date.now() + 6 * 60_000 };
  const reserved = await save(record, { ...meta, lease, items: meta.items.map(row => row.id === item.id ? { ...row, status: "generating", attempts: row.attempts + 1, error: undefined } : row) });
  let unlinked: AdSourceAsset | undefined;
  try {
    const service = createServiceSupabase();
    const files = await Promise.all(meta.references.map(async (ref, index) => {
      if (!adSourceOwnsPath(id, ref.path)) throw new ApiError(409, "AD_SOURCE_PATH", "참고 이미지 경로를 확인하지 못했어요.");
      const { data, error } = await service.storage.from(MEDIA_BUCKET).download(ref.path);
      if (error || !data) throw new ApiError(503, "AD_SOURCE_REFERENCE", "참고 이미지를 읽지 못했어요.");
      return new File([data], `reference-${index + 1}.png`, { type: "image/png" });
    }));
    const size = AD_SOURCE_SIZES[meta.input.aspect];
    const generated = await drawImageBytes({ prompt: adSourcePrompt(meta.input, item), files, size: size.provider, quality: "high" });
    const bytes = await getSharp(undefined)(generated.bytes, { limitInputPixels: 20_000_000 }).rotate()
      .resize(size.w, size.h, { fit: "contain", background: "#ffffff" }).png().toBuffer();
    const current = await adSourceRecord(actor, id), state = adSourceMeta(current);
    if (current.version !== reserved.version || state.lease?.id !== lease.id) throw new ApiError(409, "AD_SOURCE_CHANGED", "작업 상태가 바뀌어 결과를 반영하지 않았어요. 다시 불러와 주세요.");
    unlinked = await storeImage(current, bytes, size.w, size.h);
    const saved = await save(current, { ...state, lease: undefined, items: state.items.map(row => row.id === item.id ? { ...row, status: "done", asset: unlinked, error: undefined } : row) });
    unlinked = undefined;
    return saved;
  } catch (error) {
    if (unlinked) await discardUnlinked(actor, id, unlinked).catch(() => {});
    const safe = adSourceError(error);
    try {
      const current = await adSourceRecord(actor, id), state = adSourceMeta(current);
      if (state.lease?.id === lease.id && !state.items.find(row => row.id === item.id)?.asset) await save(current, { ...state, lease: undefined, items: state.items.map(row => row.id === item.id ? { ...row, status: "failed", error: safe.message } : row) });
    } catch { /* The lease expires; a later explicit retry can recover. */ }
    throw safe;
  }
}
