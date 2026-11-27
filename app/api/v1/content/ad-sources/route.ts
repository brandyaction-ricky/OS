import { apiErrorResponse } from "@/lib/http";
import { adSourceInputSchema } from "@/lib/ad-source-studio";
import { authenticateRequest } from "@/lib/server/auth";
import { adSourceBundle, adSourceError, createAdSource, listAdSources, readAdJson } from "@/lib/server/ad-source-studio";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  try { return Response.json({ projects: await listAdSources(await authenticateRequest(request)) }, { headers }); }
  catch (error) { return apiErrorResponse(adSourceError(error)); }
}
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    return Response.json(await adSourceBundle(await createAdSource(actor, adSourceInputSchema.parse(await readAdJson(request)))), { status: 201, headers });
  } catch (error) { return apiErrorResponse(adSourceError(error)); }
}
