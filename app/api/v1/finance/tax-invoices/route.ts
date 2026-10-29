import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { financeActor } from "@/lib/server/finance";
import { decideLink, importSchema, importTaxInvoices, linkSchema, listQuery, listTaxInvoices } from "@/lib/server/finance-tax";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await financeActor(request);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const input = listQuery.safeParse({ from: params.from, to: params.to, biz: params.biz || undefined });
    if (!input.success) throw new ApiError(400, "TAX_INVOICE_QUERY_INVALID", "기간과 사업자를 확인해 주세요.");
    return NextResponse.json(await listTaxInvoices(actor, input.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await financeActor(request);
    const body = await parseJson(request) as { action?: string };
    if (body?.action === "import") {
      const input = importSchema.safeParse(body);
      if (!input.success) throw new ApiError(400, "TAX_INVOICE_IMPORT_INVALID", input.error.issues[0]?.message ?? "올린 내용을 확인해 주세요.");
      return NextResponse.json(await importTaxInvoices(actor, input.data));
    }
    const input = linkSchema.safeParse(body);
    if (!input.success) throw new ApiError(400, "TAX_LINK_INVALID", "연결할 항목을 확인해 주세요.");
    return NextResponse.json(await decideLink(actor, input.data));
  } catch (error) { return apiErrorResponse(error); }
}
