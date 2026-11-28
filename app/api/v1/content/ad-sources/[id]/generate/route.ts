import { z } from "zod";
import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { adGenerateSchema, adSourceBundle, adSourceError, generateAdSource, readAdJson } from "@/lib/server/ad-source-studio";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request), id = z.string().uuid().parse((await params).id);
    const input = adGenerateSchema.parse(await readAdJson(request));
    return Response.json(await adSourceBundle(await generateAdSource(actor, id, input)), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(adSourceError(error)); }
}
