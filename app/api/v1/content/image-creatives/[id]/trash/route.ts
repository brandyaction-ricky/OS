import { z } from "zod";
import { authenticateRequest } from "@/lib/server/auth";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { actOnImageTrash,imageTrashActionSchema } from "@/lib/server/image-project-trash";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const actor=await authenticateRequest(request),id=z.string().uuid().parse((await params).id);
    return Response.json(await actOnImageTrash(actor,id,imageTrashActionSchema.parse(await parseJson(request,4096))),{headers:{"cache-control":"private, no-store"}});
  } catch(error) {return apiErrorResponse(error instanceof z.ZodError ? new ApiError(422,"IMAGE_TRASH_INPUT","프로젝트와 현재 버전을 확인해 주세요.") : error);}
}
