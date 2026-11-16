import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readImageAdReferences } from "@/lib/server/image-ad-references";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(await readImageAdReferences(await authenticateRequest(request)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return apiErrorResponse(error); }
}
