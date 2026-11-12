import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { imageBundle, imageMeta, imageError, imagePatchSchema, imageRecord, patchImageProject } from "@/lib/server/image-creatives";
import { requestStaffJob } from "@/lib/server/youtube-ai-jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await authenticateRequest(request), id = z.string().uuid().parse((await params).id);
    return Response.json(await imageBundle(await imageRecord(actor.supabase, actor.ownerId, id)), { headers });
  } catch (error) { return apiErrorResponse(error instanceof ZodError ? new ApiError(400, "IMAGE_ID_INVALID", "작업 주소를 확인해 주세요.") : imageError(error)); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await authenticateRequest(request), id = z.string().uuid().parse((await params).id);
    const input = imagePatchSchema.parse(await parseJson(request, 150_000));
    const record = await imageRecord(actor.supabase, actor.ownerId, id);
    if (input.action === "generate") {
      if (record.version !== input.version) throw new ApiError(409, "IMAGE_VERSION_CONFLICT", "다른 곳에서 바뀌었어요. 새로 불러와 주세요.");
      await requestStaffJob(actor, { task: "image-creative", sourceId: id, request: input.request, target: input.target, guided: input.guided });
      return Response.json(await imageBundle(record), { headers });
    }
    const saved = await patchImageProject(actor, record, input);
    const plan = imageMeta(saved).state.formatRecommendation;
    if ((input.action === "recommend-appeals" && !plan?.appealOptions?.length) ||
        (input.action === "recommend-formats" && !(plan?.conceptFirst ? plan.appeals?.length : plan?.items?.length)) ||
        (input.action === "plan-scene" && !plan?.scene))
      await requestStaffJob(actor, {task:"image-creative", sourceId:id, request:{phase:"formats"}});
    if (input.action === "approve-and-generate" && imageMeta(saved).state.formatApproval)
      await requestStaffJob(actor, {task:"image-creative", sourceId:id, request:input.request,guided:true});
    return Response.json(await imageBundle(saved), { headers });
  } catch (error) { return apiErrorResponse(error instanceof ZodError ? new ApiError(422, "IMAGE_INPUT_INVALID", "요청할 항목과 개수를 확인해 주세요.") : imageError(error)); }
}
