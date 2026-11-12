import { createHash, randomUUID } from "node:crypto";
import { getSharp } from "next/dist/server/image-optimizer";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { resolvePlacement } from "@/lib/image-creative/placement";
import { usesBackgroundPhoto } from "@/lib/image-creative/formats";
import { IMAGE_CREATIVE_KIND } from "@/lib/image-creative/storage";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import { imageMeta, isApprovedRender, macOutputPath, macPhotoUrl, saveImageMeta, type ImageMacRun, type ImageRenderTarget } from "./image-creatives";
import { MEDIA_BUCKET } from "./youtube-process-stages";

const lease = { jobId: z.string().uuid(), lease: z.string().uuid() };
const variantId = z.string().uuid();
const fileSize = z.number().int().positive().max(20 * 1024 * 1024);
const file = z.object({variantId, bytes: fileSize, sha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const imageMacActions = [
  z.object({action:z.literal("image_creative_claim"), rendererVersion:z.union([z.literal(1),z.literal(2),z.literal(3)])}).strict(),
  z.object({action:z.literal("image_creative_scene"), ...lease, variantId}).strict(),
  z.object({action:z.literal("image_creative_prepare"), ...lease, variantId, fileSize}).strict(),
  z.object({action:z.literal("image_creative_complete"), ...lease, files:z.array(file).min(1).max(20)}).strict(),
  z.object({action:z.literal("image_creative_fail"), ...lease, reason:z.string().trim().min(1).max(200)}).strict(),
] as const;
type Action = z.infer<(typeof imageMacActions)[number]>;
export const isImageMacAction = (input:{action:string}): input is Action => input.action.startsWith("image_creative_");

type Computer = {target:"local"; ownerId:string} | {target:"render-pc"};
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const missed = () => new ApiError(404, "IMAGE_RENDER_NOT_FOUND", "선택한 컴퓨터의 출력 요청을 찾지 못했어요.");
const stale = () => new ApiError(409, "IMAGE_RENDER_LEASE", "이 컴퓨터의 출력 요청이 만료되었어요.");

function projects(computer: Computer, rule: {target: ImageRenderTarget; id?:string; status?:string}) {
  let query = createServiceSupabase().from("os_records").select("*").eq("record_type", "content_package")
    .eq("metadata->>kind", IMAGE_CREATIVE_KIND).contains("metadata", {renders:[rule]}).is("archived_at", null);
  if (computer.target === "local") query = query.eq("owner_id", computer.ownerId);
  return query;
}
async function updateRun(record: OsRecord, run: ImageMacRun) {
  const meta = imageMeta(record);
  return saveImageMeta(createServiceSupabase(), record, { ...meta, renders: meta.renders!.map(r => r.id === run.id ? run : r) });
}
async function claim(computer: Computer, rendererVersion: 1 | 2 | 3) {
  for (const status of ["queued", "active"] as const) {
    for (let start = 0;; start += 20) {
      const {data,error} = await projects(computer,{target:computer.target,status})
        .order("updated_at",{ascending:true}).order("id",{ascending:true}).range(start,start+19);
      if (error) throw new ApiError(503, "IMAGE_RENDER_READ", "출력할 시안을 읽지 못했어요.");
      const rows = (data ?? []) as OsRecord[];
      for (const record of rows) {
        const meta = imageMeta(record);
        const run = meta.renders?.find(r => r.target === computer.target && r.status === status &&
          (status === "queued" || (r.expires ?? 0) <= Date.now()) && isApprovedRender(meta, r) &&
          meta.state.variants.every(v => !r.variantIds.includes(v.id) ||
            rendererVersion >= (v.formatId === "thumbnail_subject" ? 3 : usesBackgroundPhoto(v) ? 2 : 1)));
        if (!run) continue;
        const token = randomUUID();
        try {
          await updateRun(record, {...run,status:"active",leaseHash:sha(token),expires:Date.now()+30*60_000});
        } catch (error) {
          if (error instanceof ApiError && error.code === "IMAGE_VERSION_CONFLICT") continue;
          throw error;
        }
        return { jobId:run.id, lease:token, variantIds:run.variantIds };
      }
      if (rows.length < 20) break;
    }
  }
  return { idle:true };
}
async function assigned(computer: Computer, input: Exclude<Action,{action:"image_creative_claim"}>) {
  const {data,error} = await projects(computer,{id:input.jobId,target:computer.target}).maybeSingle();
  if (error) throw new ApiError(503, "IMAGE_RENDER_READ", "출력할 시안을 읽지 못했어요.");
  if (!data) throw missed();
  const record = data as OsRecord;
  const meta = imageMeta(record);
  const run = meta.renders?.find(row => row.id === input.jobId && row.target === computer.target);
  if (!run || !isApprovedRender(meta, run)) throw missed();
  if (run.leaseHash !== sha(input.lease)) throw stale();
  const done = input.action === "image_creative_complete" && run.status === "done";
  if (!done && (run.status !== "active" || (run.expires ?? 0) <= Date.now())) throw stale();
  return { record,run };
}
function variantOf(record: OsRecord, run: ImageMacRun, id: string) {
  const variant = imageMeta(record).state.variants.find(v => v.id === id);
  if (!run.variantIds.includes(id) || !variant) throw missed();
  return variant;
}
export async function imageMacWork(computer: Computer, input: Action) {
  if (input.action === "image_creative_claim") return claim(computer,input.rendererVersion);
  const { record,run } = await assigned(computer,input);
  if (input.action === "image_creative_fail") {
    await updateRun(record,{...run,status:"failed",reason:input.reason});
    return { failed:true };
  }
  const bucket = createServiceSupabase().storage.from(MEDIA_BUCKET);
  if (input.action === "image_creative_scene") {
    const variant = variantOf(record,run,input.variantId);
    const photoUrl = await macPhotoUrl(record,variant);
    const {width,height} = resolvePlacement(variant.size,variant.design?.placement,variant.design?.outputWidth);
    return { variant,photoUrl,width,height };
  }
  if (input.action === "image_creative_prepare") {
    variantOf(record,run,input.variantId);
    const path = macOutputPath(record.id,run,input.variantId);
    const link = await bucket.createSignedUploadUrl(path,{upsert:false});
    if (link.error || !link.data) throw new ApiError(503,"IMAGE_RENDER_UPLOAD","PNG 업로드를 준비하지 못했어요.");
    return { signedUrl:link.data.signedUrl };
  }
  const files = new Map(input.files.map(f => [f.variantId,f]));
  if (files.size !== input.files.length || files.size !== run.variantIds.length || run.variantIds.some(id => !files.has(id)))
    throw new ApiError(422,"IMAGE_RENDER_INCOMPLETE","묶음의 모든 PNG를 올린 뒤 완료해 주세요.");
  if (run.status === "done") {
    if (!run.files || run.files.length !== files.size ||
        run.files.some(saved => files.get(saved.variantId)?.sha256 !== saved.sha256 ||
          files.get(saved.variantId)?.bytes !== saved.bytes))
      throw new ApiError(409, "IMAGE_RENDER_RECEIPT", "이미 완료된 PNG 묶음과 제출한 파일이 다릅니다.");
    return { done:true };
  }
  for (const [id, expected] of files) {
    const variant = variantOf(record,run,id);
    const {width,height} = resolvePlacement(variant.size,variant.design?.placement,variant.design?.outputWidth);
    const path = macOutputPath(record.id,run,id);
    const head = await bucket.info(path);
    if (head.error || head.data?.size !== expected.bytes || head.data.contentType !== "image/png")
      throw new ApiError(422,"IMAGE_RENDER_FILE","올라온 PNG 파일과 크기를 확인해 주세요.");
    const {data,error} = await bucket.download(path);
    if (error || !data || data.size !== expected.bytes || data.type !== "image/png") throw new ApiError(422,"IMAGE_RENDER_FILE","올라온 PNG 파일과 크기를 확인해 주세요.");
    const bytes = Buffer.from(await data.arrayBuffer());
    if (sha(bytes) !== expected.sha256 || bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) throw new ApiError(422,"IMAGE_RENDER_HASH","올라온 PNG와 제출한 파일이 다릅니다.");
    try {
      const decoder = getSharp(undefined)(bytes,{failOn:"warning",limitInputPixels:width*height});
      const info = await decoder.metadata();
      if (info.format !== "png" || info.width !== width || info.height !== height || (info.pages ?? 1) !== 1) throw Error();
      await decoder.raw().toBuffer();
    } catch { throw new ApiError(422,"IMAGE_RENDER_SIZE","PNG가 손상되었거나 시안의 규격과 달라요."); }
  }
  // Re-read after network downloads. An expired/reclaimed lease must not publish the older computer's files.
  const latest = await assigned(computer,input);
  if (latest.run.status !== "done") await updateRun(latest.record,{...latest.run,status:"done",files:input.files});
  return { done:true };
}

/** The owner reviews a scaled copy of the completed Mac file; its signed original is released after final approval. */
export async function macReviewPng(record: OsRecord, id: string, runId: string) {
  const meta = imageMeta(record);
  const run = meta.renders?.find(row => row.id === runId && row.status === "done" && row.variantIds.includes(id));
  const receipt = run?.files?.find(file => file.variantId === id);
  if (!run || !receipt || !isApprovedRender(meta, run)) throw missed();
  const {data, error} = await createServiceSupabase().storage.from(MEDIA_BUCKET).download(macOutputPath(record.id, run, id));
  if (error || !data || data.type !== "image/png" || data.size !== receipt.bytes || data.size > 20 * 1024 * 1024)
    throw new ApiError(503, "IMAGE_REVIEW_FILE", "Mac이 출력한 검수용 파일을 읽지 못했어요.");
  try {
    const bytes = Buffer.from(await data.arrayBuffer());
    if (sha(bytes) !== receipt.sha256) throw Error("receipt mismatch");
    return await getSharp(undefined)(bytes, { failOn: "warning", limitInputPixels: 1440 * 2560 })
      .resize({ width: 900, withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new ApiError(422, "IMAGE_REVIEW_FILE", "Mac이 출력한 검수용 파일을 열지 못했어요.");
  }
}
