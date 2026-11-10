import { resolvePlacement } from "@/lib/image-creative/placement";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { ImageResponse } from "next/og";
import { getSharp } from "next/dist/server/image-optimizer";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import { storedZip } from "@/lib/cardnews/zip";
import { isWarehouseFormat } from "@/lib/image-creative/formats";

import { canSaveImageBrief, createImageBatch, emptyImageCreative, imageBriefProblems, imageVariantProblems, imageCreativePrompt, ImageCreativeError, normalizeImageRequest, reviseImageDesign, isImageDesign,
  approveImageFormat, startImageCopyBatch, formatApprovalKey, reviewImageBatch, returnImageReview, type ApprovalStamp,
  type ImageDesign, type ImageCreativeState, type ImageAsset, type ImageBatchRequest, type ImageBatchResult, type CreativeVariant } from "@/lib/image-creative/model";
import { formatTestInput } from "@/lib/image-creative/format-test";
import { IMAGE_CREATIVE_KIND, IMAGE_FILE_MAX, imageFileInfo, ownsImageAsset } from "@/lib/image-creative/storage";
import { ImageCreativeView } from "@/lib/image-creative/view";
import type { RequestActor } from "./auth";
import { MEDIA_BUCKET } from "./youtube-process-stages";

type Db = RequestActor["supabase"];
export const renderTarget = z.enum(["render-pc", "local"]);
export type ImageRenderTarget = z.infer<typeof renderTarget>;
export interface ImageMacRun {
  id: string; batchId: string; variantIds: string[]; target: ImageRenderTarget;
  status: "queued" | "active" | "done" | "failed"; reason?: string;
  leaseHash?: string; expires?: number; files?: { variantId: string; bytes: number; sha256: string }[];
}
export interface ImageMeta { renders?: ImageMacRun[]; space: "personal"; kind: typeof IMAGE_CREATIVE_KIND; state: ImageCreativeState; assets: (ImageAsset & { sha256?: string; upload?: { leaseHash: string; receiptHash: string } })[]; appliedJobs: Record<string, string>;
  pendingAssets?: { path: string; receipt: string; leaseHash: string; size: number; mimeType: string; expiresAt: number }[]; }
export const imageBriefSchema = z.object({ brand: z.string().trim().max(15).optional(), objective: z.string().max(2000), funnel: z.string().max(2000), audience: z.string().max(2000), product: z.string().max(2000),
  offer: z.string().max(2000), landingUrl: z.string().max(2000), facts: z.string().max(10_000) }).strict();
export const imageRequestSchema = z.object({ mode: z.enum(["initial", "appeal", "copy", "image", "standalone"]), count: z.number().int().min(1).max(20),
  baseId: z.string().max(100).optional(), formatIds: z.array(z.string().max(50)).max(20).optional(), copyFields: z.array(z.enum(["headline", "body", "cta"])).max(3).optional(),
  compareFormats: z.literal(true).optional(), size: z.enum(["square", "portrait", "story"]).optional(), assetPaths: z.array(z.string().max(200)).max(20).optional() }).strict();
export const imageCreateSchema = z.object({ title: z.string().trim().min(1).max(200), brief: imageBriefSchema }).strict();
const version = z.number().int().positive();
export const imagePatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve-format"), version, request: imageRequestSchema.optional(), batchId: z.string().min(1).max(100).optional() }).strict(),
  z.object({ action: z.literal("approve-copy"), version, batchId: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("confirm-preview"), version, batchId: z.string().min(1).max(100), target: renderTarget }).strict(),
  z.object({ action: z.literal("approve-final"), version, batchId: z.string().min(1).max(100), runId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("return-review"), version, batchId: z.string().min(1).max(100), stage: z.enum(["copy","preview","final"]), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal("revise-design"), version, target: renderTarget.optional(), baseId: z.string().min(1).max(100), id: z.string().uuid(), design: z.custom<ImageDesign>(isImageDesign) }).strict(),
  z.object({ action: z.literal("save-format-test"), version, id: z.string().uuid(), input: formatTestInput }).strict(),
  z.object({ action: z.literal("save-brief"), version, brief: imageBriefSchema }).strict(),
  z.object({ action: z.literal("select"), version, variantId: z.string().max(100) }).strict(),
  z.object({ action: z.literal("render"), version, batchId: z.string().min(1).max(100), target: renderTarget }).strict(),
  z.object({ action: z.literal("generate"), version, target: renderTarget.optional(), request: imageRequestSchema }).strict(),
  z.object({ action: z.literal("import"), version, target: renderTarget.optional(), request: imageRequestSchema, result: z.unknown() }).strict(),
]);
export const imageError = (error: unknown) => error instanceof ImageCreativeError ? new ApiError(error.status, error.code, error.message) : error;
export function imageMeta(record: OsRecord): ImageMeta {
  const value = record.metadata as unknown as ImageMeta;
  if (value?.kind !== IMAGE_CREATIVE_KIND || value.state?.v !== 1 || !Array.isArray(value.assets)) throw new ApiError(404, "IMAGE_PROJECT_NOT_FOUND", "이미지 작업을 찾지 못했어요.");
  return { ...value, appliedJobs: value.appliedJobs ?? {} };
}
export async function imageRecord(db: Db, ownerId: string, id: string): Promise<OsRecord> {
  const { data, error } = await db.from("os_records").select("*").eq("id", id).eq("record_type", "content_package")
    .eq("owner_id", ownerId).eq("metadata->>kind", IMAGE_CREATIVE_KIND).is("archived_at", null).maybeSingle();
  if (error) throw new ApiError(503, "IMAGE_READ_FAILED", "이미지 작업을 불러오지 못했어요.");
  if (!data) throw new ApiError(404, "IMAGE_PROJECT_NOT_FOUND", "내 이미지 작업을 찾지 못했어요.");
  imageMeta(data as OsRecord); return data as OsRecord;
}
export async function listImageProjects(actor: RequestActor) {
  const { data, error } = await actor.supabase.from("os_records").select("id,title,version,updated_at").eq("record_type", "content_package")
    .eq("owner_id", actor.ownerId).eq("metadata->>kind", IMAGE_CREATIVE_KIND).is("archived_at", null).order("updated_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(503, "IMAGE_READ_FAILED", "목록을 불러오지 못했어요.");
  return (data ?? []).map(row => ({ id: row.id, title: row.title, version: row.version, updatedAt: row.updated_at }));
}
export function canPreviewVariant(meta: ImageMeta, variantId: string) {
  const review = meta.state.batches.find(batch => batch.variantIds.includes(variantId))?.review;
  return Boolean(review?.format && review.copy);
}

/** Only the run created by a human confirming this exact immutable batch may consume the Mac queue. */
export function isApprovedRender(meta: ImageMeta, run: ImageMacRun) {
  const batch = meta.state.batches.find(row => row.id === run.batchId);
  const review = batch?.review;
  return Boolean(review?.format && review.copy && review.preview?.runId === run.id && review.preview.target === run.target &&
    batch!.variantIds.length === run.variantIds.length && batch!.variantIds.every((id, i) => id === run.variantIds[i]));
}
function completedRender(meta: ImageMeta, batchId: string, runId?: string) {
  return meta.renders?.find(run => run.id === runId && run.batchId === batchId && run.status === "done" &&
    isApprovedRender(meta, run) && run.files?.length === run.variantIds.length &&
    run.variantIds.every(id => run.files!.some(file => file.variantId === id)));
}
function confirmPreview(meta: ImageMeta, batchId: string, target: ImageRenderTarget, stamp: ApprovalStamp): ImageMeta {
  const batch = meta.state.batches.find(row => row.id === batchId);
  if (!batch?.review?.copy) throw new ApiError(409, "IMAGE_COPY_APPROVAL_REQUIRED", "전체 카피를 먼저 승인해 주세요.");
  const prior = meta.renders?.find(run => run.id === batch.review?.preview?.runId);
  if (prior && prior.status !== "failed") {
    if (prior.target === target) return meta;
    if (prior.status === "active") throw new ApiError(409, "IMAGE_RENDER_BUSY", "출력 중인 묶음은 완료 후 다시 확인해 주세요.");
    if (prior.status === "done") throw new ApiError(409, "IMAGE_PREVIEW_REQUIRED", "다른 출력본이 필요하면 수정 요청 후 미리보기를 다시 확인해 주세요.");
  }
  const run: ImageMacRun = { id: randomUUID(), batchId, target, status:"queued", variantIds: [...batch.variantIds] };
  const state = reviewImageBatch(meta.state, batchId, "preview", stamp, {runId:run.id, target});
  const renders = (meta.renders ?? []).map(row => row.id === prior?.id && row.status === "queued"
    ? {...row, status: "failed" as const, reason: "다른 컴퓨터에서 출력하도록 다시 확인했어요."} : row);
  return {...meta, state, renders:[...renders, run]};
}
export function macOutputPath(projectId: string, run: ImageMacRun, variantId: string) {
  if (!z.string().uuid().safeParse(projectId).success || !z.string().uuid().safeParse(run.id).success ||
      !z.string().uuid().safeParse(variantId).success || !run.leaseHash || !/^[a-f0-9]{64}$/.test(run.leaseHash))
    throw new ApiError(409, "IMAGE_RENDER_INVALID", "저장한 출력 경로를 확인해 주세요.");
  return `image-creatives/${projectId}/renders/${run.id}/${run.leaseHash}/${variantId}.png`;
}
export async function imageBundle(record: OsRecord) {
  const value = imageMeta(record), service = createServiceSupabase();
  const assets = await Promise.all(value.assets.map(async asset => {
    if (!ownsImageAsset(record.id, asset.path)) throw new ApiError(409, "IMAGE_ASSET_INVALID", "등록된 이미지 경로를 확인해 주세요.");
    const { data, error } = await service.storage.from(MEDIA_BUCKET).createSignedUrl(asset.path, 3600);
    if (error || !data) throw new ApiError(503, "IMAGE_ASSET_UNAVAILABLE", "이미지 미리보기를 열지 못했어요. 다시 불러와 주세요.");
    return { path: asset.path, w: asset.w, h: asset.h, url: data.signedUrl };
  }));
  const { data: jobs, error } = await service.from("os_records").select("id,status,metadata").eq("record_type", "ai_job").eq("parent_id", record.id)
    .eq("owner_id", record.owner_id).eq("metadata->>task", "image-creative").is("archived_at", null).order("created_at", { ascending: false }).limit(10);
  if (error) throw new ApiError(503, "IMAGE_JOB_READ_FAILED", "작업 상태를 읽지 못했어요.");
  const runs = value.renders ?? [];
  const latest = new Map(runs.flatMap(run => run.variantIds.map(id => [id, run] as const)));
  const reviewable = Object.fromEntries(Array.from(latest).filter(([, run]) =>
    completedRender(value, run.batchId, run.id)).map(([id,run]) => [id,run.id]));
  const ready = Array.from(latest).filter(([id, run]) => reviewable[id] === run.id &&
    value.state.batches.find(b => b.id === run.batchId)?.review?.final?.runId === run.id);
  const paths = ready.map(([id, run]) => macOutputPath(record.id, run, id));
  const urls = paths.length ? await service.storage.from(MEDIA_BUCKET).createSignedUrls(paths, 3600) : null;
  const signed = new Map(urls?.data?.map(item => [item.path, item.signedUrl]));
  if (urls?.error || paths.some(path => !signed.get(path)))
    throw new ApiError(503, "IMAGE_RENDER_URL", "컴퓨터에서 완성한 이미지를 열지 못했어요.");
  const rendered = Object.fromEntries(ready.map(([id], i) => [id, signed.get(paths[i])!]));
  return { project: { id: record.id, title: record.title, version: record.version }, state: value.state, assets, rendered, reviewable,
    renders: runs.filter(run => isApprovedRender(value,run)).map(({id, batchId, target, status, variantIds, reason}) => ({id, batchId, target, status, variantIds, reason})),
    jobs: (jobs ?? []).map(row => ({ id: row.id, status: row.status, task: "image-creative", failReason: row.metadata?.failReason ?? null, issues: row.metadata?.issues ?? [],
      target: row.metadata?.target ?? null, model: row.metadata?.model ?? null, requestedAt: row.metadata?.requestedAt, doneAt: row.metadata?.doneAt ?? null })) };
}
export async function createImageProject(actor: RequestActor, input: z.infer<typeof imageCreateSchema>) {
  const state = { ...emptyImageCreative(), brief: input.brief };
  const { data, error } = await createServiceSupabase().from("os_records").insert({ id: randomUUID(), record_type: "content_package", title: input.title, status: "draft",
    owner_id: actor.ownerId, created_by: actor.ownerId, updated_by: actor.ownerId, team: actor.team, brand: actor.brand ?? "", metadata: { space: "personal", kind: IMAGE_CREATIVE_KIND, state, assets: [], appliedJobs: {} } })
    .select("*").single();
  if (error || !data) throw new ApiError(503, "IMAGE_CREATE_FAILED", "이미지 작업을 저장하지 못했어요.");
  return data as OsRecord;
}
export async function saveImageMeta(db: Db, record: OsRecord, value: ImageMeta) {
  // Bound the record without ever dropping a previous candidate. A new test project is the escape hatch.
  if (JSON.stringify(value).length > 1_000_000) throw new ApiError(422, "IMAGE_PROJECT_FULL", "이 작업의 결과가 많아요. 이전 결과는 보존하고 새 작업에서 이어가 주세요.");
  const { data, error } = await db.from("os_records").update({ metadata: value, updated_by: record.owner_id }).eq("id", record.id)
    .eq("owner_id", record.owner_id).eq("version", record.version).eq("metadata->>kind", IMAGE_CREATIVE_KIND).is("archived_at", null).select("*").maybeSingle();
  if (error) throw new ApiError(503, "IMAGE_SAVE_FAILED", "저장하지 못했어요. 기존 결과는 유지돼요.");
  if (!data) throw new ApiError(409, "IMAGE_VERSION_CONFLICT", "다른 곳에서 바뀌었어요. 새로 불러온 뒤 다시 해 주세요.");
  return data as OsRecord;
}
function validImageRequest(record: OsRecord, request: ImageBatchRequest) {
  const data = imageMeta(record), req = normalizeImageRequest(data.state, request);
  const issue = imageBriefProblems(data.state.brief)[0];
  if (issue) throw new ApiError(422, "IMAGE_BRIEF_REQUIRED", issue);
  for (const path of request.assetPaths ?? []) if (!data.assets.some(row => row.path === path) || !ownsImageAsset(record.id, path))
    throw new ApiError(422, "IMAGE_ASSET_NOT_OWNED", "이 작업에 실제로 올린 이미지를 골라 주세요.");
  return req;
}
export function checkedImageRequest(record: OsRecord, request: ImageBatchRequest) {
  const state = imageMeta(record).state;
  const req = validImageRequest(record, request);
  if (!state.formatApproval || state.formatApproval.key !== formatApprovalKey(state, req))
    throw new ApiError(409, "IMAGE_FORMAT_APPROVAL_REQUIRED", "현재 포맷과 작업 조건을 먼저 승인해 주세요.");
  if (req.baseId && !state.batches.find(b => b.variantIds.includes(req.baseId!))?.review?.final)
    throw new ApiError(409, "IMAGE_FINAL_REQUIRED", "최종 검수를 마친 시안으로 다음 비교를 시작해 주세요.");
  return req;
}
/** New files may arrive while the AI draws. They do not change the frozen brief, base candidate or requested fields. */
export function imageInputKey(record: OsRecord, request: ImageBatchRequest) {
  return createHash("sha256").update(JSON.stringify([imageMeta(record).state, checkedImageRequest(record, request)])).digest("hex");
}
export function imageJobInstructions(record: OsRecord, request: ImageBatchRequest) {
  return imageCreativePrompt(imageMeta(record).state, request) + `\n\n## 쓸 수 있는 실제 이미지\n${JSON.stringify(imageMeta(record).assets.map(({ path, w, h }) => ({ path, w, h })))}\n\n` +
    "이미지가 더 필요하면 구독 도구로 글자 없는 원본 이미지를 만든 뒤 image_creative_asset의 prepare → 반환 주소로 파일 업로드 → commit 순서로 이 작업에 넣습니다. " +
    "참고 원본을 무단 복제하거나 존재하지 않는 경로를 만들지 않습니다. 유료 AI API·광고 매체 호출은 하지 않습니다. " +
    "처리할 수 없으면 fail로 이유를 남깁니다. 결과만 준비하고 사용자의 선택이나 승인을 대신하지 않습니다.\n" +
    "제출: process_youtube_ai_job(action=complete, job_id, lease, model, result). 결과는 요청한 개수와 허용 변경 필드만 담습니다.";
}
export async function importImageResults(db: Db, record: OsRecord, request: ImageBatchRequest, result: unknown, by: string, jobId?: string) {
  const meta = imageMeta(record);
  if (jobId && meta.appliedJobs[jobId]) return { record, batchId: meta.appliedJobs[jobId] };
  checkedImageRequest(record, request);
  let state: ImageCreativeState;
  try { state = createImageBatch(meta.state, request, result as ImageBatchResult, { now: new Date().toISOString(), by, newId: randomUUID }); } catch (error) { throw imageError(error); }
  const batch = state.batches.at(-1)!;
  for (const variant of state.variants.filter(row => batch.variantIds.includes(row.id))) {
    if (variant.asset && (!ownsImageAsset(record.id, variant.asset.path) || !meta.assets.some(asset => asset.path === variant.asset!.path && asset.w === variant.asset!.w && asset.h === variant.asset!.h)))
      throw new ApiError(422, "IMAGE_ASSET_NOT_OWNED", "이미지 파일과 실제 크기를 확인한 뒤 이 작업에 먼저 등록해 주세요.");
  }
  if (request.mode === "image") {
    const key = (variant: CreativeVariant) => meta.assets.find(asset => asset.path === variant.asset?.path)?.sha256 ?? variant.asset?.path;
    const base = meta.state.variants.find(variant => variant.id === batch.baseId);
    const seen = new Set(base ? [key(base)] : []);
    for (const variant of state.variants.filter(row => batch.variantIds.includes(row.id))) {
      const imageKey = key(variant);
      if (seen.has(imageKey)) throw new ApiError(422, "IMAGE_DUPLICATE_FILE", "파일 이름만 다른 같은 이미지는 비교할 수 없어요. 실제로 다른 이미지를 넣어 주세요.");
      seen.add(imageKey);
    }
  }
  state = startImageCopyBatch(meta.state, state, request);
  const saved = await saveImageMeta(db, record, { ...meta, state, appliedJobs: { ...meta.appliedJobs, ...(jobId ? { [jobId]: batch.id } : {}) } });
  return { record: saved, batchId: batch.id };
}
export async function patchImageProject(actor: RequestActor, record: OsRecord, input: Exclude<z.infer<typeof imagePatchSchema>, { action: "generate" }>) {
  if (record.owner_id !== actor.ownerId) throw new ApiError(403,"IMAGE_PROJECT_OWNER","본인의 작업을 열어 주세요.");
  const meta = imageMeta(record);
  if (input.action === "revise-design") {
    if (!canPreviewVariant(meta,input.baseId)) throw new ApiError(409,"IMAGE_COPY_APPROVAL_REQUIRED","전체 카피 승인 후 디자인을 편집해 주세요.");
    let state: ImageCreativeState;
    try { state = reviseImageDesign(meta.state, input.baseId, input.id, input.design, {now: new Date().toISOString(), by: actor.name}); }
    catch (err) { throw imageError(err); }
    if (state === meta.state) return record;
    if (record.version !== input.version) throw new ApiError(409, "IMAGE_VERSION_CONFLICT", "다른 곳에서 바뀌었어요. 새로 불러와 주세요.");
    const photo = state.variants.at(-1)?.asset;
    if (photo && (!ownsImageAsset(record.id, photo.path) || !meta.assets.some(a => a.path === photo.path && a.w === photo.w && a.h === photo.h)))
      throw new ApiError(422, "IMAGE_ASSET_NOT_OWNED", "원본 사진이 현재 프로젝트에 등록되어 있어야 해요.");
    return saveImageMeta(createServiceSupabase(), record, {...meta, state});
  }
  if (input.action === "approve-format" || input.action === "approve-copy" || input.action === "confirm-preview" ||
      input.action === "approve-final" || input.action === "return-review") {
    if (actor.type !== "user" || actor.id !== record.owner_id || actor.ownerId !== record.owner_id)
      throw new ApiError(403, "IMAGE_HUMAN_REQUIRED", "작업 소유자가 직접 승인해 주세요.");
    const stamp = {by: actor.id, name: actor.name, at: new Date().toISOString()};
    let next: ImageMeta = meta;
    switch (input.action) {
      case "approve-format": {
        if (Boolean(input.request) === Boolean(input.batchId)) throw new ApiError(422,"IMAGE_FORMAT_REQUEST","포맷 요청 또는 기존 묶음 하나를 골라 주세요.");
        if (input.request) {
          validImageRequest(record, input.request);
          next = {...meta, state:approveImageFormat(meta.state,input.request,stamp)};
        } else next = {...meta,state:reviewImageBatch(meta.state,input.batchId!,"format",stamp)};
        break;
      }
      case "approve-copy":
        next = {...meta, state:reviewImageBatch(meta.state,input.batchId,"copy",stamp)};
        break;
      case "confirm-preview":
        next = confirmPreview(meta,input.batchId,input.target,stamp);
        break;
      case "approve-final": {
        const run = completedRender(meta,input.batchId,input.runId);
        if (!run) throw new ApiError(409,"IMAGE_RENDER_PENDING","선택한 Mac에서 완료한 현재 PNG를 먼저 확인해 주세요.");
        next = {...meta,state:reviewImageBatch(meta.state,input.batchId,"final",stamp,{target:run.target,runId:run.id})};
        break;
      }
      case "return-review": {
        const batch = meta.state.batches.find(b=>b.id===input.batchId);
        const run = meta.renders?.find(r=>r.id===batch?.review?.preview?.runId);
        if (input.stage==="final" && !completedRender(meta,input.batchId,run?.id))
          throw new ApiError(409,"IMAGE_RENDER_PENDING","최종 파일이 완성된 뒤 검수해 주세요.");
        const state = returnImageReview(meta.state,input.batchId,input.stage,input.reason,stamp);
        const renders = meta.renders?.map(r => r.id === run?.id && (r.status === "active" || r.status === "queued")
          ? {...r,status:"failed" as const, reason:"담당자가 수정을 요청했어요."} : r);
        next = {...meta,state,...(renders ? {renders} : {})};
        break;
      }
    }
    if (next.state === meta.state) return record;
    if (record.version !== input.version) throw new ApiError(409, "IMAGE_VERSION_CONFLICT", "검토한 화면이 바뀌었어요. 새로 불러와 주세요.");
    return saveImageMeta(createServiceSupabase(),record,next);
  }
  if (record.version !== input.version) throw new ApiError(409, "IMAGE_VERSION_CONFLICT", "다른 곳에서 바뀌었어요. 새로 불러와 주세요.");
  if (input.action === "render") throw new ApiError(409,"IMAGE_PREVIEW_REQUIRED","미리보기를 확인한 뒤 최종 출력을 요청해 주세요.");
  if (input.action === "save-format-test") throw new ApiError(409,"IMAGE_FORMAT_APPROVAL_REQUIRED","포맷 창고에서 선택한 다음 일반 제작에서 승인 절차를 시작해 주세요.");
  if (input.action === "import") return (await importImageResults(createServiceSupabase(), record, input.request, input.result, actor.name)).record;
  if (input.action === "select") {
    if (!meta.state.variants.some(row => row.id === input.variantId)) throw new ApiError(404, "IMAGE_VARIANT_NOT_FOUND", "선택한 소재가 없어요.");
    if (!meta.state.batches.find(b=>b.variantIds.includes(input.variantId))?.review?.final)
      throw new ApiError(409,"IMAGE_FINAL_REQUIRED","최종 검수를 마친 시안을 기준으로 선택해 주세요.");
    return saveImageMeta(createServiceSupabase(), record, { ...meta, state: { ...meta.state, selectedId: input.variantId } });
  }
  // A different offer/goal is a different experiment. Existing candidate lineage must remain interpretable.
  if (!canSaveImageBrief(meta.state, input.brief))
    throw new ApiError(409, "IMAGE_BRIEF_LOCKED", "소재가 만들어진 작업의 조건은 보존해요. 목표·상품을 바꾸려면 새 작업으로 시작해 주세요.");
  if ((Object.keys(imageBriefSchema.shape) as (keyof typeof input.brief)[]).every(field =>
      (input.brief[field] ?? "") === (meta.state.brief[field] ?? ""))) return record;
  return saveImageMeta(createServiceSupabase(), record, { ...meta, state: { ...meta.state, brief: input.brief, formatApproval: undefined } });
}

async function validateImage(bytes: Uint8Array) {
  let info: ReturnType<typeof imageFileInfo>;
  try {
    info = imageFileInfo(bytes);
    // Reuse the decoder bundled with Next; a successful ImageResponse can still contain a blank image.
    const { info: decoded } = await getSharp(undefined)(bytes, { failOn: "warning", limitInputPixels: 20_000_000 }).rotate().raw().toBuffer({ resolveWithObject: true });
    info = { ...info, w: decoded.width, h: decoded.height };
  } catch { throw new ApiError(422, "IMAGE_FILE_INVALID", "파일을 이미지로 읽지 못했어요. 5MB 이하 PNG/JPEG를 다시 넣어 주세요."); }
  return info;
}
export async function registerImageBytes(record: OsRecord, bytes: Uint8Array, fixedPath?: string, upload?: { leaseHash: string; receiptHash: string }) {
  const info = await validateImage(bytes), service = createServiceSupabase();
  const path = fixedPath ?? `image-creatives/${record.id}/${randomUUID()}.${info.ext}`;
  if (!ownsImageAsset(record.id, path) || !path.endsWith(`.${info.ext}`)) throw new ApiError(422, "IMAGE_ASSET_INVALID", "파일 종류와 경로가 달라요.");
  const before = imageMeta(record);
  if (before.assets.some(row => row.path === path)) return record;
  if (before.assets.length >= 200) throw new ApiError(422, "IMAGE_ASSETS_FULL", "이 작업의 이미지가 많아요. 새 작업을 만들어 주세요.");
  if (!fixedPath) {
    const { error } = await service.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: info.mime, upsert: false });
    if (error) throw new ApiError(503, "IMAGE_UPLOAD_FAILED", "파일을 올리지 못했어요.");
  }
  // A concurrent image upload is additive. Re-read once; never overwrite another candidate or brief.
  for (let attempt = 0; ; attempt++) {
    const current = attempt ? await imageRecord(service, record.owner_id!, record.id) : record, meta = imageMeta(current);
    if (meta.assets.some(row => row.path === path)) return current;
    try { return await saveImageMeta(service, current, { ...meta, assets: [...meta.assets, { path, w: info.w, h: info.h, sha256: createHash("sha256").update(bytes).digest("hex"), ...(upload ? { upload } : {}) }], pendingAssets: meta.pendingAssets?.filter(row => row.path !== path) }); }
    catch (error) { if (attempt || !(error instanceof ApiError && error.status === 409)) throw error; }
  }
}
export async function prepareImageAsset(record: OsRecord, mimeType: string, size: number, lease: string) {
  if (size < 1 || size > IMAGE_FILE_MAX || !["image/png", "image/jpeg"].includes(mimeType)) throw new ApiError(422, "IMAGE_FILE_INVALID", "5MB 이하 PNG/JPEG만 올릴 수 있어요.");
  const path = `image-creatives/${record.id}/${randomUUID()}.${mimeType === "image/png" ? "png" : "jpg"}`;
  const meta = imageMeta(record), pending = (meta.pendingAssets ?? []).filter(row => row.expiresAt > Date.now()), receipt = randomUUID();
  if (pending.length >= 20) throw new ApiError(409, "IMAGE_UPLOADS_PENDING", "먼저 준비한 이미지 업로드를 마쳐 주세요.");
  await saveImageMeta(createServiceSupabase(), record, { ...meta, pendingAssets: [...pending, { path, receipt,
    leaseHash: createHash("sha256").update(lease).digest("hex"), size, mimeType, expiresAt: Date.now() + 30 * 60_000 }] });
  const { data, error } = await createServiceSupabase().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data) throw new ApiError(503, "IMAGE_UPLOAD_FAILED", "업로드 주소를 만들지 못했어요.");
  return { path, signedUrl: data.signedUrl, token: data.token, receipt, mimeType, maxBytes: IMAGE_FILE_MAX };
}
export async function commitImageAsset(record: OsRecord, path: string, receipt: string, lease: string) {
  const meta = imageMeta(record), upload = { leaseHash: createHash("sha256").update(lease).digest("hex"), receiptHash: createHash("sha256").update(receipt).digest("hex") };
  const done = meta.assets.find(row => row.path === path && row.upload?.leaseHash === upload.leaseHash && row.upload.receiptHash === upload.receiptHash);
  if (done) return { path: done.path, w: done.w, h: done.h };
  const pending = meta.pendingAssets?.find(row => row.path === path && row.receipt === receipt && row.expiresAt > Date.now()
    && row.leaseHash === createHash("sha256").update(lease).digest("hex"));
  if (!ownsImageAsset(record.id, path) || !pending) throw new ApiError(403, "IMAGE_UPLOAD_RECEIPT", "이 작업에서 준비한 업로드가 아니거나 시간이 지났어요.");
  const { data, error } = await createServiceSupabase().storage.from(MEDIA_BUCKET).download(path);
  if (error || !data || data.size > IMAGE_FILE_MAX || data.size !== pending.size || data.type !== pending.mimeType) throw new ApiError(422, "IMAGE_UPLOAD_MISSING", "준비한 크기·종류와 업로드 파일이 달라요.");
  const saved = await registerImageBytes(record, new Uint8Array(await data.arrayBuffer()), path, upload);
  const asset = imageMeta(saved).assets.find(row => row.path === path)!;
  return { path: asset.path, w: asset.w, h: asset.h };
}
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 600; style: "normal" }[]>;
const loadFonts = () => fonts ??= Promise.all(([400,500,600] as const).map(async weight => ({ name: "Pretendard", data: await readFile(join(process.cwd(), "lib/cardnews/fonts", `Pretendard-${weight}.woff`)), weight, style: "normal" as const })));
const extraFonts = new Map<string, Promise<Buffer>>();
async function renderFonts(design?: ImageDesign) {
  const primary = await loadFonts();
  if (!design || design.font === "original" || design.font === "sans") return primary;
  const name = design.font;
  if (!["hand","serif","sign"].includes(name)) throw new ApiError(422, "IMAGE_FONT", "지원하는 서체를 골라 주세요.");
  let file = extraFonts.get(name);
  if (!file) {
    file = readFile(join(process.cwd(), "lib/image-creative/fonts", name + ".woff")).catch(error => { extraFonts.delete(name); throw error; });
    extraFonts.set(name, file);
  }
  return [...primary,{ name: "Ad-" + name, data: await file, weight: 600 as const, style: "normal" as const }];
}
export async function imagePng(variant: CreativeVariant, assetUrl?: string) {
  if (isWarehouseFormat(variant.formatId)) throw new ApiError(422, "IMAGE_BROWSER_RENDER", "이 포맷은 작업 화면에서 표시한 PNG로 내보내세요.");
  const problem = imageVariantProblems(variant)[0];
  if (problem) throw new ApiError(422, "IMAGE_RENDER_INVALID", problem);
  if (variant.asset && !assetUrl) throw new ApiError(422, "IMAGE_ASSET_MISSING", "이미지 원본을 확인한 뒤 내보내 주세요.");
  const { width, height } = resolvePlacement(variant.size, variant.design?.placement, variant.design?.outputWidth);
  const response = new ImageResponse(createElement(ImageCreativeView, { variant, assetUrl }), { width, height, fonts: await renderFonts(variant.design) });
  return new Uint8Array(await response.arrayBuffer());
}
function ownedPhoto(record: OsRecord, variant: CreativeVariant) {
  if (!variant.asset) return undefined;
  const photo = variant.asset;
  const known = imageMeta(record).assets.find(a => a.path === photo.path && a.w === photo.w && a.h === photo.h);
  if (!known || !ownsImageAsset(record.id, photo.path)) throw new ApiError(403, "IMAGE_ASSET_NOT_OWNED", "등록된 이미지가 아니에요.");
  return known;
}
async function normalizedPhoto(path: string) {
  const {data,error} = await createServiceSupabase().storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) throw new ApiError(503, "IMAGE_ASSET_MISSING", "원본 이미지를 읽지 못했어요.");
  return getSharp(undefined)(new Uint8Array(await data.arrayBuffer()), {failOn:"warning",limitInputPixels:20_000_000}).rotate().png().toBuffer();
}
async function renderProjectPng(record: OsRecord, variant: CreativeVariant) {
  const asset = ownedPhoto(record, variant);
  const src = asset ? "data:image/png;base64," + (await normalizedPhoto(asset.path)).toString("base64") : undefined;
  return imagePng(variant, src);
}
export async function macPhotoUrl(record: OsRecord, variant: CreativeVariant) {
  const asset = ownedPhoto(record, variant);
  if (!asset) return undefined;
  const bucket = createServiceSupabase().storage.from(MEDIA_BUCKET);
  let path = asset.path;
  if (!isWarehouseFormat(variant.formatId)) {
    // The legacy renderer normalizes EXIF orientation and color before handing PNG pixels to ImageResponse.
    // Input paths are immutable; older assets without a recorded content hash still have distinct paths.
    const key = createHash("sha256").update(asset.sha256 || asset.path).digest("hex");
    path = `image-creatives/${record.id}/render-sources/v1/${key}.png`;
    const exists = await bucket.exists(path);
    if (!exists.data) {
      const result = await bucket.upload(path, await normalizedPhoto(asset.path), {contentType:"image/png",upsert:true});
      if (result.error) throw new ApiError(503,"IMAGE_ASSET_UNAVAILABLE","출력에 쓸 원본 이미지를 준비하지 못했어요.");
    }
  }
  const link = await bucket.createSignedUrl(path,900);
  if (link.error || !link.data) throw new ApiError(503,"IMAGE_ASSET_UNAVAILABLE","원본 이미지를 가져오지 못했어요.");
  return link.data.signedUrl;
}

export async function savedDesignPreview(record: OsRecord, baseId: string, design?: ImageDesign) {
  const base = imageMeta(record).state.variants.find(row => row.id === baseId);
  if (!base) throw new ApiError(404, "IMAGE_VARIANT_NOT_FOUND", "이 작업의 시안을 골라 주세요.");
  if (!canPreviewVariant(imageMeta(record), baseId)) throw new ApiError(409,"IMAGE_COPY_APPROVAL_REQUIRED","카피를 먼저 승인해 주세요.");
  const variant = design ? { ...base, design, size: resolvePlacement(base.size, design.placement, design.outputWidth).size } : base;
  return renderProjectPng(record, variant);
}
type ExportFile = { body: Uint8Array; type: string; name: string };
/** Final exports use only the PNG files verified on the selected computer and reviewed by the owner. */
export async function exportImageCreative(record: OsRecord, input: { variantId?: string; batchId?: string }): Promise<ExportFile> {
  const meta = imageMeta(record);
  const batch = input.batchId ? meta.state.batches.find(row => row.id === input.batchId) : undefined;
  const ids = batch?.variantIds ?? (input.variantId ? [input.variantId] : []);
  const variants = ids.map(id => {
    const variant = meta.state.variants.find(row => row.id === id);
    if (!variant) throw new ApiError(404, "IMAGE_VARIANT_NOT_FOUND", "내보낼 소재가 없어요.");
    return variant;
  });
  if (!variants.length) throw new ApiError(404, "IMAGE_VARIANT_NOT_FOUND", "내보낼 소재가 없어요.");
  for (const variant of variants) {
    if (variant.asset && (!ownsImageAsset(record.id, variant.asset.path) || !meta.assets.some(row => row.path === variant.asset!.path))) {
      throw new ApiError(403, "IMAGE_ASSET_NOT_OWNED", "등록된 이미지가 아니에요.");
    }
    const problem = imageVariantProblems(variant)[0];
    if (problem) throw new ApiError(422, "IMAGE_RENDER_INVALID", problem);
  }
  const origin = batch ?? meta.state.batches.find(row => row.variantIds.includes(variants[0].id));
  const macRun = origin && completedRender(meta,origin.id,origin.review?.preview?.runId);
  if (!macRun) throw new ApiError(409,"IMAGE_RENDER_PENDING","승인한 미리보기를 선택한 Mac에서 출력한 뒤 내려받을 수 있어요.");
  if (origin?.review?.final?.runId !== macRun.id)
    throw new ApiError(409,"IMAGE_FINAL_REQUIRED","완성 PNG를 최종 검수한 뒤 내려받을 수 있어요.");
  const files = [];
  for (const variant of variants) {
    const blob = await createServiceSupabase().storage.from(MEDIA_BUCKET).download(macOutputPath(record.id, macRun, variant.id));
    if (blob.error || !blob.data) throw new ApiError(503, "IMAGE_RENDER_FILE", "완성된 PNG를 불러오지 못했어요.");
    const data = new Uint8Array(await blob.data.arrayBuffer());
    files.push({ name: `${String(files.length + 1).padStart(2, "0")}-${variant.id}.png`, data });
  }
  if (!input.batchId) return { body: files[0].data, type: "image/png", name: files[0].name };
  files.push({ name: "variants.json", data: new TextEncoder().encode(JSON.stringify({ brief: meta.state.brief, batch, variants, placements: variants.map(v => ({ variantId: v.id, ...resolvePlacement(v.size, v.design?.placement, v.design?.outputWidth) })) }, null, 2)) });
  return { body: new Uint8Array(storedZip(files)), type: "application/zip", name: `image-test-${input.batchId}.zip` };
}

/** Private, content-addressed derivatives keep large PNG/ZIP bodies off the serverless response. */
export async function signedImageExport(record: OsRecord, file: ExportFile) {
  const extension = file.type === "application/zip" ? "zip" : "png";
  const digest = createHash("sha256").update(file.body).digest("hex");
  const path = `image-creatives/${record.id}/exports/${digest}.${extension}`;
  const bucket = createServiceSupabase().storage.from(MEDIA_BUCKET);
  // The same hash has identical bytes; repeated exports reuse this key and never replace source images.
  const { error } = await bucket.upload(path, file.body, { contentType: file.type, upsert: true });
  if (error) throw new ApiError(503, "IMAGE_EXPORT_UPLOAD", "내보낼 파일을 저장하지 못했어요. 저장소 설정을 확인해 주세요.");
  const { data, error: signError } = await bucket.createSignedUrl(path, 900, { download: file.name });
  if (signError || !data) throw new ApiError(503, "IMAGE_EXPORT_URL", "다운로드 주소를 만들지 못했어요.");
  return { url: data.signedUrl, name: file.name, type: file.type };
}
