import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readAnthropicCost } from "@/lib/server/anthropic-cost";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // Every signed-in member sees it (owner 2026-11-13): staff watch the spend and pace their own AI use.
    await authenticateRequest(request);
    return NextResponse.json(await readAnthropicCost(), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
