import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { financeActor, financeError } from "@/lib/server/finance";
import { listQuery } from "@/lib/server/finance-tax";
import { importPurchaseInvoices, listPurchaseInvoices, purchaseImportSchema } from "@/lib/server/finance-purchase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await financeActor(request);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const input = listQuery.safeParse({ from: params.from, to: params.to, biz: params.biz || undefined });
    if (!input.success) throw new ApiError(400, "PURCHASE_INVOICE_QUERY_INVALID", "기간과 사업자를 확인해 주세요.");
    return NextResponse.json(await listPurchaseInvoices(actor, input.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(financeError(error)); }
}

export async function POST(request: Request) {
  try {
    const actor = await financeActor(request);
    const input = purchaseImportSchema.safeParse(await parseJson(request));
    if (!input.success) throw new ApiError(400, "PURCHASE_INVOICE_IMPORT_INVALID", input.error.issues[0]?.message ?? "올린 내용을 확인해 주세요.");
    return NextResponse.json(await importPurchaseInvoices(actor, input.data));
  } catch (error) { return apiErrorResponse(financeError(error)); }
}
