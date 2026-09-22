import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { prepareMeetingBrief } from "@/lib/server/meeting-prep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const brand = url.searchParams.get("brand")?.trim() || "";
    const team = url.searchParams.get("team")?.trim() || "";
    return NextResponse.json(await prepareMeetingBrief(actor.supabase, { brand, team }));
  } catch (error) { return apiErrorResponse(error); }
}
