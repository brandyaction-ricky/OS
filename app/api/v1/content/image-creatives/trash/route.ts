import { authenticateRequest } from "@/lib/server/auth";
import { apiErrorResponse } from "@/lib/http";
import { listImageTrash } from "@/lib/server/image-project-trash";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {return Response.json({projects:await listImageTrash(await authenticateRequest(request))},{headers:{"cache-control":"private, no-store"}});}
  catch(error) {return apiErrorResponse(error);}
}
