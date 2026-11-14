// 예상 납부세액 = 매출세액 − 매입세액 (재무 2026-11-13). 신고서가 아니라 참고 자료다.
// Pure, so the screen, the server and the tests agree.
import { classifiedCards } from "./domain.mjs";
import type { FinanceData } from "./schema.ts";
import { COMPANY, splitVat } from "./vat.ts";

/** The card VAT labels of lib/finance/schema.ts that matter here. */
export const CARD_DEDUCTIBLE = "공제 예상";
export const CARD_UNDECIDED = "판단 필요";
const BUSINESSES = ["ba", "edu", "myin", "hm"];

export type PurchaseInvoice = { biz: string; invoice_class: "tax" | "exempt"; written_date: string; tax_amount: number; archived_at?: string | null };
type CardUse = { biz: string | null; vat: string; used_date: string; amount_krw: number };
type Tally = { count: number; amount: number };
export type VatPurchase = {
  /** 전자세금계산서 (매입): taxable purchase invoices by 작성일자. */
  invoice: { count: number; tax: number };
  /** 신용카드 (공제 예상): this business's card uses by 사용일; 세액 = round(합계 / 11). */
  card: Tally & { tax: number };
  /** 매입 합계 세액 (B). */
  inputTax: number;
  /** 판단 필요 cards of this business or of no single business: the estimate may rise once they are classified. */
  undecided: Tally;
  /** 공제 예상 cards marked 공통 or with no business: left out, because they belong to no single 사업자. */
  unassigned: Tally;
};

/**
 * 매입세액 for one business and period. For 회사 전체 every purchase invoice and every card use counts, so nothing is left unassigned. Cancelled and archived card uses are ignored, and a card use counts only when
 * its label (the person's choice, else the first matching rule) is 공제 예상; every other label adds 0.
 */
export function vatPurchase(input: { biz: string; from: string; to: string; invoices: PurchaseInvoice[]; cards: Record<string, unknown>[]; rules: Record<string, unknown>[] }): VatPurchase {
  const inRange = (date: string) => date >= input.from && date <= input.to;
  const company = input.biz === COMPANY;
  const invoices = input.invoices.filter(row => !row.archived_at && (company || row.biz === input.biz) && row.invoice_class === "tax" && inRange(row.written_date));
  const cards = (classifiedCards({ card_transactions: input.cards, card_rules: input.rules } as unknown as FinanceData) as unknown as CardUse[]).filter(row => inRange(row.used_date));
  const mine = company ? cards : cards.filter(row => row.biz === input.biz), shared = company ? [] : cards.filter(row => !BUSINESSES.includes(row.biz ?? ""));
  const tally = (rows: CardUse[]): Tally => ({ count: rows.length, amount: rows.reduce((sum, row) => sum + row.amount_krw, 0) });
  const deductible = mine.filter(row => row.vat === CARD_DEDUCTIBLE);
  const invoiceTax = invoices.reduce((sum, row) => sum + row.tax_amount, 0);
  const cardTax = deductible.reduce((sum, row) => sum + splitVat(row.amount_krw).tax, 0);
  return {
    invoice: { count: invoices.length, tax: invoiceTax },
    card: { ...tally(deductible), tax: cardTax },
    inputTax: invoiceTax + cardTax,
    undecided: tally([...mine, ...shared].filter(row => row.vat === CARD_UNDECIDED)),
    unassigned: tally(shared.filter(row => row.vat === CARD_DEDUCTIBLE)),
  };
}

/** 예상 납부세액 (A) − (B); below zero is a refund. */
export const vatPayable = (salesTax: number, inputTax: number) => salesTax - inputTax;
export const payableLabel = (payable: number) => payable < 0 ? "환급 대상" : "납부 대상";
