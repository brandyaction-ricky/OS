import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { financeActor } from "@/lib/server/finance";
import { vatQuery, vatReference } from "@/lib/server/finance-tax";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await financeActor(request);
    const params = new URL(request.url).searchParams;
    const input = vatQuery.safeParse({ period: params.get("period") ?? "", biz: params.get("biz") ?? "" });
    if (!input.success) throw new ApiError(400, "VAT_QUERY_INVALID", "기간과 사업자를 확인해 주세요.");
    return NextResponse.json(await vatReference(actor, input.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
