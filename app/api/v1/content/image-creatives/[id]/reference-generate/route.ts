import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { imageError } from "@/lib/server/image-creatives";
import { generateReferenceArtwork, referenceGenerateRequest } from "@/lib/server/image-reference-generate";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const actor=await authenticateRequest(request,{allowAgent:false});
    const id=z.string().uuid().parse((await params).id);
    return Response.json(await generateReferenceArtwork(actor,id,referenceGenerateRequest.parse(await parseJson(request,8192))),
      {headers:{"cache-control":"private, no-store"}});
  } catch(error) {
    return apiErrorResponse(error instanceof ZodError ? new ApiError(422,"IMAGE_REFERENCE_INPUT","현재 작업과 카피를 확인해 주세요.") : imageError(error));
  }
}
