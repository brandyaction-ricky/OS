import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { trialWorker } from "@/lib/server/content-automation-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request:Request){
  try {
    const result = await trialWorker(await authenticateRequest(request),request);
    return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
  } catch(error){ return apiErrorResponse(error); }
}
