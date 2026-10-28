import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { readUtmLink, syncUtmLedger, utmActor } from "@/lib/server/utm-links";

export const runtime = "nodejs";

/** Retries putting the saved links into the company 링크 대장 document (no new link is made). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await utmActor(request);
    const { id } = await params;
    const ledgerSaved = await syncUtmLedger(actor.id);
    return NextResponse.json({ link: await readUtmLink(id), ledgerSaved }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
