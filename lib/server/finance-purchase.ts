import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { RequestActor } from "./auth";
import { financeDbError } from "./finance";
import { all, BIZ, invoiceSchema, vatReference, type listQuery, type vatQuery } from "./finance-tax";
import type { TaxInvoiceInput } from "@/lib/finance/tax-invoices";
import { vatPayable, vatPurchase } from "@/lib/finance/vat-payable";

// 재무 2026-11-13: 홈택스 매입 계산서 목록·올리기, 그리고 부가세 참고 자료의 매입세액 · 예상 납부세액. Every read and write goes
// through the caller's own client, so the os_fin_* finance-access policies decide what is visible.

const TABLE = "os_fin_purchase_invoices";
const COLUMNS = "id,biz,approval_no,invoice_class,is_modified,kind_label,written_date,issued_date,sent_date,supplier_reg_no,supplier_name,buyer_reg_no,buyer_name,buyer_email,item_summary,supply_amount,tax_amount,total_amount,receipt_type,memo,source,created_at";
type PurchaseRow = TaxInvoiceInput & { id: string; biz: string; source: string; created_at: string };

export const PURCHASE_NOT_READY = "FINANCE_PURCHASE_NOT_READY";
/** The table comes with a migration that waits for the owner's approval; the code may be live before it. */
export const missingTable = (error: { code?: string; message?: string }) => error.code === "42P01" || error.code === "PGRST205" || /could not find the table|relation "[^"]*" does not exist/i.test(error.message ?? "");
function dbError(error: { code?: string; message?: string }): never {
  if (missingTable(error)) throw new ApiError(503, PURCHASE_NOT_READY, "매입 세금계산서 저장 공간이 아직 준비되지 않았어요. 관리자 승인 후 사용할 수 있어요.");
  financeDbError(error);
}

/** Saved 매입 계산서 of a period by 작성일자, oldest first. */
export async function listPurchaseInvoices(actor: RequestActor, input: z.infer<typeof listQuery>) {
  const invoices = await all<PurchaseRow>((a, b) => {
    let query = actor.supabase.from(TABLE).select(COLUMNS).is("archived_at", null).gte("written_date", input.from).lte("written_date", input.to);
    if (input.biz) query = query.eq("biz", input.biz);
    return query.order("written_date").order("id").range(a, b);
  }, dbError);
  return { invoices };
}

export const purchaseImportSchema = z.object({ action: z.literal("import"), biz: BIZ, invoices: z.array(invoiceSchema).min(1).max(5000) }).strict()
  .refine(value => new Set(value.invoices.map(row => row.buyer_reg_no).filter(Boolean)).size <= 1, "공급받는자 사업자번호가 섞여 있어요.");

/** Saves new invoices; an approval number already saved is skipped (re-uploading the same month is safe). */
export async function importPurchaseInvoices(actor: RequestActor, input: z.infer<typeof purchaseImportSchema>) {
  const batch = crypto.randomUUID();
  const approvals = input.invoices.map(row => row.approval_no);
  const known = new Set<string>();
  for (let index = 0; index < approvals.length; index += 500) {
    const { data, error } = await actor.supabase.from(TABLE).select("approval_no,biz").in("approval_no", approvals.slice(index, index + 500));
    if (error) dbError(error);
    for (const row of data ?? []) {
      if (row.biz !== input.biz) throw new ApiError(409, "PURCHASE_INVOICE_OTHER_BIZ", `이미 다른 사업자로 올린 계산서가 있어요 (${row.approval_no}). 사업자 선택을 확인해 주세요.`);
      known.add(row.approval_no);
    }
  }
  const fresh = input.invoices.filter(row => !known.has(row.approval_no));
  for (let index = 0; index < fresh.length; index += 500) {
    const { error } = await actor.supabase.from(TABLE).upsert(fresh.slice(index, index + 500).map(row => ({ ...row, biz: input.biz, source: "hometax_excel", import_batch_id: batch, created_by: actor.id, updated_by: actor.id })),
      { onConflict: "approval_no", ignoreDuplicates: true });
    if (error) dbError(error);
  }
  return { saved: fresh.length, skipped: known.size, batch };
}

/**
 * 부가세 참고 자료 plus 매입세액 and 예상 납부세액 = 매출세액 (the tax total the page already shows) − 매입세액.
 * Until the purchase table exists the sales side answers as before, with `purchase: { available: false }`.
 */
export async function vatWithPurchase(actor: RequestActor, input: z.infer<typeof vatQuery>) {
  const reference = await vatReference(actor, input);
  const { from, to } = reference.period;
  const salesTax = reference.lines.reduce((sum, line) => sum + line.tax, 0);
  const listed = await listPurchaseInvoices(actor, { from, to, biz: input.biz }).catch(error => { if (error instanceof ApiError && error.code === PURCHASE_NOT_READY) return null; throw error; });
  if (!listed) return { ...reference, salesTax, purchase: { available: false as const }, payable: null };
  const db = actor.supabase;
  const [cards, rules] = await Promise.all([
    all<Record<string, unknown>>((a, b) => db.from("os_fin_card_transactions").select("id,used_date,merchant,amount_krw,canceled,manual_biz,manual_vat,archived_at").is("archived_at", null).eq("canceled", false).gte("used_date", from).lte("used_date", to).order("id").range(a, b)),
    all<Record<string, unknown>>((a, b) => db.from("os_fin_card_rules").select("id,keywords,biz,vat_type,enabled,sort_order,archived_at").is("archived_at", null).order("id").range(a, b)),
  ]);
  const purchase = vatPurchase({ biz: input.biz, from, to, invoices: listed.invoices, cards, rules });
  return { ...reference, salesTax, purchase: { available: true as const, ...purchase }, payable: vatPayable(salesTax, purchase.inputTax) };
}
