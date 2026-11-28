import { z } from "zod";
import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { adSourceBundle, adSourceError, adSourceRecord } from "@/lib/server/ad-source-studio";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request), id = z.string().uuid().parse((await params).id);
    return Response.json(await adSourceBundle(await adSourceRecord(actor, id)), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(adSourceError(error)); }
}
