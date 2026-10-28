import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { shortenUtmLink, syncUtmLedger, utmActor } from "@/lib/server/utm-links";

export const runtime = "nodejs";

/** Makes the MYIN short link for a saved UTM link, connects it to the same row, then updates the 링크 대장 line. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await utmActor(request);
    const { id } = await params;
    const link = await shortenUtmLink(id, actor);
    return NextResponse.json({ link, ledgerSaved: await syncUtmLedger(actor.id) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
