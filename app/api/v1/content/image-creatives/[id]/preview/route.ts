import { z } from "zod";
import { getSharp } from "next/dist/server/image-optimizer";
import { authenticateRequest } from "@/lib/server/auth";
import { imageRecord, imageError, imagePng, savedDesignPreview } from "@/lib/server/image-creatives";
import { macReviewPng } from "@/lib/server/image-mac-render";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { isImageDesign, imageVariantProblems, type CreativeVariant, type ImageDesign } from "@/lib/image-creative/model";
import { IMAGE_FILE_MAX } from "@/lib/image-creative/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const inputSchema = z.object({ variantId: z.string().min(1).max(100), design: z.custom<ImageDesign>(isImageDesign).optional() }).strict();
const demoSchema = z.object({ variant: z.custom<CreativeVariant>(v => !imageVariantProblems(v).length),
  photo: z.string().max(Math.ceil(IMAGE_FILE_MAX / 3) * 4 + 100).optional() }).strict();
const headers = { "cache-control": "private, no-store", "content-type": "image/png" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // The local demonstration never needs storage credentials or a public unauthenticated rendering service.
    const hostname = new URL(request.url).hostname;
    const localDemo = id === "demo" && !process.env.VERCEL &&
      ["localhost", "127.0.0.1", "[::1]"].includes(hostname) &&
      (process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (localDemo) {
      const { variant, photo } = demoSchema.parse(await parseJson(request, Math.ceil(IMAGE_FILE_MAX / 3) * 4 + 16_384));
      let dataUrl: string | undefined;
      if (variant.asset || photo) {
        const match = photo?.match(/^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/i);
        if (!variant.asset || !match) throw new ApiError(422, "IMAGE_PREVIEW_ASSET", "작업 사진을 확인해 주세요.");
        const bytes = Buffer.from(match[1], "base64");
        if (bytes.length > IMAGE_FILE_MAX) throw new ApiError(413, "IMAGE_PREVIEW_SIZE", "사진 파일이 너무 큽니다.");
        const png = await getSharp(undefined)(bytes,{ limitInputPixels: 20_000_000, failOn: "warning" }).rotate().png().toBuffer();
        dataUrl = "data:image/png;base64," + png.toString("base64");
      }
      return new Response(new Uint8Array(await imagePng(variant, dataUrl)).buffer, { headers });
    }
    const actor = await authenticateRequest(request);
    const record = await imageRecord(actor.supabase, actor.ownerId, z.string().uuid().parse(id));
    const input = inputSchema.parse(await parseJson(request, 8192));
    const png = await savedDesignPreview(record, input.variantId, input.design);
    return new Response(new Uint8Array(png).buffer, { headers });
  } catch (error) {
    return apiErrorResponse(error instanceof z.ZodError ? new ApiError(422, "IMAGE_PREVIEW_INVALID", "시안과 디자인 입력을 확인해 주세요.") : imageError(error));
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const id = z.string().uuid().parse((await params).id);
    const query = new URL(request.url).searchParams;
    const uuid = z.string().uuid();
    const variantId = uuid.parse(query.get("variantId"));
    const runId = uuid.parse(query.get("runId"));
    const record = await imageRecord(actor.supabase, actor.ownerId, id);
    const review = await macReviewPng(record, variantId, runId);
    return new Response(new Uint8Array(review).buffer, { headers });
  } catch (error) {
    return apiErrorResponse(error instanceof z.ZodError ? new ApiError(422, "IMAGE_REVIEW_INVALID", "검수할 시안과 출력 작업을 확인해 주세요.") : imageError(error));
  }
}
