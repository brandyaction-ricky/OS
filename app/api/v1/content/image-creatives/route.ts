import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createImageProject, imageBundle, imageCreateSchema, imageError, listImageProjects } from "@/lib/server/image-creatives";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  try { return Response.json({ projects: await listImageProjects(await authenticateRequest(request)) }, { headers }); }
  catch (error) { return apiErrorResponse(imageError(error)); }
}
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request), input = imageCreateSchema.parse(await parseJson(request, 30_000));
    return Response.json(await imageBundle(await createImageProject(actor, input)), { status: 201, headers });
  } catch (error) { return apiErrorResponse(error instanceof ZodError ? new ApiError(422, "IMAGE_INPUT_INVALID", "작업명과 제작 조건을 확인해 주세요.") : imageError(error)); }
}
