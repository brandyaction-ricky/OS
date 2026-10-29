import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { RequestActor } from "./auth";
import { financeDbError } from "./finance";
import { matchDeposit, matchInvoices, revenueBySource, type RevenueLink, type TaxInvoiceInput } from "@/lib/finance/tax-invoices";
import { vatLines, vatPeriod, vatRows, type VatCancel, type VatExternal, type VatInvoice, type VatPayment } from "@/lib/finance/vat";

// 재무 요청 a5310134: 세금계산서 목록·같은 매출 짝·입금 확인, 그리고 부가세 참고 자료. Every read and write goes through the
// caller's own client, so the os_fin_* finance-access policies decide what is visible.

const BIZ = z.enum(["ba", "edu", "myin", "hm"]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PAGE = 1000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function all<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await read(offset, offset + PAGE - 1);
    if (error) financeDbError(error);
    rows.push(...(data ?? []) as T[]);
    if ((data?.length ?? 0) < PAGE) return rows;
  }
}

const INVOICE_COLUMNS = "id,biz,approval_no,invoice_class,is_modified,kind_label,written_date,issued_date,sent_date,supplier_reg_no,supplier_name,buyer_reg_no,buyer_name,buyer_email,item_summary,supply_amount,tax_amount,total_amount,receipt_type,memo,source,created_at";
type InvoiceRow = TaxInvoiceInput & { id: string; biz: string; source: string; created_at: string };
type PaymentRow = { id: string; payment_key: string; biz: string; method: string | null; amount: number; canceled_amount: number; paid_date: string | null; order_name: string | null; status: string };

async function readWindow(actor: RequestActor, from: string, to: string, biz?: string) {
  const db = actor.supabase;
  const invoiceQuery = () => { let query = db.from("os_fin_tax_invoices").select(INVOICE_COLUMNS).is("archived_at", null).gte("written_date", from).lte("written_date", to); if (biz) query = query.eq("biz", biz); return query; };
  const paymentQuery = () => { let query = db.from("os_fin_payments").select("id,payment_key,biz,method,amount,canceled_amount,paid_date,order_name,status").neq("status", "WAITING_FOR_DEPOSIT").gte("paid_date", shift(from, -7)).lte("paid_date", shift(to, 7)); if (biz) query = query.eq("biz", biz); return query; };
  const externalQuery = () => { let query = db.from("os_fin_external_revenues").select("id,biz,title,revenue_date,supply,vat").is("archived_at", null).gte("revenue_date", shift(from, -7)).lte("revenue_date", shift(to, 7)); if (biz) query = query.eq("biz", biz); return query; };
  const [invoices, payments, externals, links] = await Promise.all([
    all<InvoiceRow>((a, b) => invoiceQuery().order("written_date").order("id").range(a, b)),
    all<PaymentRow>((a, b) => paymentQuery().order("id").range(a, b)),
    all<VatExternal>((a, b) => externalQuery().order("id").range(a, b)),
    all<RevenueLink>((a, b) => db.from("os_fin_revenue_links").select("tax_invoice_id,target_type,target_ref,state").is("archived_at", null).order("id").range(a, b)),
  ]);
  return { invoices, payments, externals, links };
}

export const listQuery = z.object({ from: day, to: day, biz: BIZ.optional() }).refine(value => value.from <= value.to, "기간을 확인해 주세요.");

/** 매출내역 › 세금계산서 and 정산입금 › 계산서 입금: each invoice with its same-sale state and deposit check. */
export async function listTaxInvoices(actor: RequestActor, input: z.infer<typeof listQuery>) {
  const { invoices, payments, externals, links } = await readWindow(actor, input.from, input.to, input.biz);
  const banks = await all<{ id: string; tx_date: string; deposit: number; description: string }>((a, b) => actor.supabase.from("os_fin_bank_transactions")
    .select("id,tx_date,deposit,description").is("archived_at", null).gt("deposit", 0).gte("tx_date", shift(input.from, -3)).lte("tx_date", shift(input.to, 93)).order("id").range(a, b));
  const states = matchInvoices(invoices, payments, externals, links);
  const inRange = (date: string | null) => Boolean(date && date >= input.from && date <= input.to);
  const paymentsNet = payments.filter(row => inRange(row.paid_date)).reduce((sum, row) => sum + row.amount - row.canceled_amount, 0);
  const externalTotal = externals.filter(row => inRange(row.revenue_date)).reduce((sum, row) => sum + (row.supply ?? 0) + (row.vat ?? 0), 0);
  const { data: last } = await actor.supabase.from("os_fin_tax_invoices").select("biz,created_at").is("archived_at", null).order("created_at", { ascending: false }).limit(200);
  const lastImport = Object.fromEntries((last ?? []).reverse().map(row => [row.biz, row.created_at]));
  return {
    invoices: invoices.map(row => ({ ...row, match: states.get(row.id)!, deposit: matchDeposit(row, banks, links) })),
    totals: revenueBySource(invoices, states, paymentsNet, externalTotal),
    lastImport,
  };
}

const won = z.number().int().refine(Number.isSafeInteger);
const invoiceSchema = z.object({
  approval_no: z.string().trim().min(1).max(40), invoice_class: z.enum(["tax", "exempt"]), is_modified: z.boolean(), kind_label: z.string().max(40),
  written_date: day, issued_date: day.nullable(), sent_date: day.nullable(),
  supplier_reg_no: z.string().regex(/^\d{0,10}$/), supplier_name: z.string().max(120), buyer_reg_no: z.string().regex(/^\d{0,13}$/), buyer_name: z.string().max(120), buyer_email: z.string().max(200),
  item_summary: z.string().max(300), supply_amount: won, tax_amount: won, total_amount: won, receipt_type: z.string().max(20), memo: z.string().max(500),
}).strict().refine(row => row.total_amount === row.supply_amount + row.tax_amount && (row.invoice_class === "tax" || row.tax_amount === 0), "금액을 확인해 주세요.");
export const importSchema = z.object({ action: z.literal("import"), biz: BIZ, invoices: z.array(invoiceSchema).min(1).max(5000) }).strict()
  .refine(value => new Set(value.invoices.map(row => row.supplier_reg_no).filter(Boolean)).size <= 1, "공급자 사업자번호가 섞여 있어요.");

/** Saves new invoices; an approval number already saved is skipped (re-uploading the same month is safe). */
export async function importTaxInvoices(actor: RequestActor, input: z.infer<typeof importSchema>) {
  const batch = crypto.randomUUID();
  const approvals = input.invoices.map(row => row.approval_no);
  const known = new Set<string>();
  for (let index = 0; index < approvals.length; index += 500) {
    const { data, error } = await actor.supabase.from("os_fin_tax_invoices").select("approval_no,biz").in("approval_no", approvals.slice(index, index + 500));
    if (error) financeDbError(error);
    for (const row of data ?? []) {
      if (row.biz !== input.biz) throw new ApiError(409, "TAX_INVOICE_OTHER_BIZ", `이미 다른 사업자로 올린 계산서가 있어요 (${row.approval_no}). 사업자 선택을 확인해 주세요.`);
      known.add(row.approval_no);
    }
  }
  const fresh = input.invoices.filter(row => !known.has(row.approval_no));
  for (let index = 0; index < fresh.length; index += 500) {
    const { error } = await actor.supabase.from("os_fin_tax_invoices").upsert(fresh.slice(index, index + 500).map(row => ({ ...row, biz: input.biz, source: "hometax_excel", import_batch_id: batch, created_by: actor.id, updated_by: actor.id })),
      { onConflict: "approval_no", ignoreDuplicates: true });
    if (error) financeDbError(error);
  }
  return { saved: fresh.length, skipped: known.size, batch };
}

export const linkSchema = z.object({
  action: z.literal("link"), invoiceId: z.string().uuid(), targetType: z.enum(["payment", "external_revenue", "bank_tx"]), targetRef: z.string().trim().min(1).max(200),
  state: z.enum(["confirmed", "rejected", "clear"]), note: z.string().trim().max(300).default(""),
}).strict();

/** 같은 매출로 확인 · 다른 매출로 표시 · 되돌리기 (and the same for a deposit). */
export async function decideLink(actor: RequestActor, input: z.infer<typeof linkSchema>) {
  const db = actor.supabase;
  const { data: invoice, error: invoiceError } = await db.from("os_fin_tax_invoices").select("id").eq("id", input.invoiceId).is("archived_at", null).maybeSingle();
  if (invoiceError) financeDbError(invoiceError);
  if (!invoice) throw new ApiError(404, "TAX_INVOICE_NOT_FOUND", "계산서를 찾지 못했어요.");
  const { data: existing, error } = await db.from("os_fin_revenue_links").select("id,version,archived_at").eq("tax_invoice_id", input.invoiceId).eq("target_type", input.targetType).eq("target_ref", input.targetRef).maybeSingle();
  if (error) financeDbError(error);
  const now = new Date().toISOString();
  if (input.state === "clear") {
    if (existing && !existing.archived_at) { const result = await db.from("os_fin_revenue_links").update({ archived_at: now, updated_by: actor.id, updated_at: now, version: existing.version + 1 }).eq("id", existing.id); if (result.error) financeDbError(result.error); }
    return { ok: true };
  }
  const result = existing
    ? await db.from("os_fin_revenue_links").update({ state: input.state, note: input.note, archived_at: null, updated_by: actor.id, updated_at: now, version: existing.version + 1 }).eq("id", existing.id)
    : await db.from("os_fin_revenue_links").insert({ tax_invoice_id: input.invoiceId, target_type: input.targetType, target_ref: input.targetRef, state: input.state, note: input.note, created_by: actor.id, updated_by: actor.id });
  if (result.error?.code === "23505") throw new ApiError(409, "TAX_LINK_TAKEN", input.targetType === "bank_tx" ? "이 계산서에는 이미 확인한 입금이 있어요. 먼저 되돌려 주세요." : "이 계산서에는 이미 같은 매출로 확인한 짝이 있어요. 먼저 되돌려 주세요.");
  if (result.error) financeDbError(result.error);
  return { ok: true };
}

export const vatQuery = z.object({ period: z.string(), biz: BIZ });

/** 부가세 신고 참고 자료 for one business and one month / 예정·확정 quarter / half. */
export async function vatReference(actor: RequestActor, input: z.infer<typeof vatQuery>) {
  const period = vatPeriod(input.period);
  if (!period) throw new ApiError(400, "VAT_PERIOD_INVALID", "기간을 확인해 주세요.");
  const { invoices, payments, externals, links } = await readWindow(actor, period.from, period.to, input.biz);
  // A cancel in this period may belong to a payment from an earlier one.
  const cancels = await all<{ payment_id: string; cancel_amount: number; cancel_date: string }>((a, b) => actor.supabase.from("os_fin_payment_cancels").select("payment_id,cancel_amount,cancel_date").gte("cancel_date", period.from).lte("cancel_date", period.to).order("id").range(a, b));
  const missing = [...new Set(cancels.map(row => row.payment_id))].filter(id => !payments.some(row => row.id === id));
  for (let index = 0; index < missing.length; index += 200) {
    const { data, error } = await actor.supabase.from("os_fin_payments").select("id,payment_key,biz,method,amount,canceled_amount,paid_date,order_name,status").in("id", missing.slice(index, index + 200));
    if (error) financeDbError(error);
    payments.push(...(data ?? []) as PaymentRow[]);
  }
  const keyOf = new Map(payments.map(row => [row.id, row.payment_key]));
  const rows = vatRows({
    biz: input.biz, from: period.from, to: period.to, payments: payments as VatPayment[], invoices: invoices as unknown as VatInvoice[], externals, links,
    cancels: cancels.flatMap(row => keyOf.has(row.payment_id) ? [{ payment_key: keyOf.get(row.payment_id)!, cancel_amount: row.cancel_amount, cancel_date: row.cancel_date } satisfies VatCancel] : []),
  });
  const states = matchInvoices(invoices, payments, externals, links);
  const review = invoices.filter(row => ["suspect", "review"].includes(states.get(row.id)?.state ?? "")).length;
  return { period, lines: vatLines(rows), rows, review };
}
