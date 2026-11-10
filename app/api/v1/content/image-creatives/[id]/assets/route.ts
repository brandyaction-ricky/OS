import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { IMAGE_FILE_MAX } from "@/lib/image-creative/storage";
import { imageBundle, imageError, imageRecord, prepareImageAsset, commitImageAsset } from "@/lib/server/image-creatives";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), mimeType: z.enum(["image/png", "image/jpeg"]), fileSize: z.number().int().positive().max(IMAGE_FILE_MAX) }).strict(),
  z.object({ action: z.literal("commit"), path: z.string().max(200), receipt: z.string().uuid() }).strict(),
]);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request), id = z.string().uuid().parse((await params).id);
    const record = await imageRecord(actor.supabase, actor.ownerId, id);
    const input = inputSchema.parse(await parseJson(request, 2_000));
    // Match the existing signed-upload flow: bytes never pass through a serverless request body.
    const binding = `browser:${actor.ownerId}:${id}`;
    const result = input.action === "prepare" ? await prepareImageAsset(record, input.mimeType, input.fileSize, binding) :
      (await commitImageAsset(record, input.path, input.receipt, binding), await imageBundle(await imageRecord(actor.supabase, actor.ownerId, id)));
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error instanceof ZodError ? new ApiError(422, "IMAGE_UPLOAD_INVALID", "작업과 5MB 이하 PNG/JPEG 파일 정보를 확인해 주세요.") : imageError(error)); }
}
