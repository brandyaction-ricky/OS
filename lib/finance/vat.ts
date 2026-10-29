// 부가세 신고 참고 자료 (재무 요청 a5310134): 월·신고기간별로 결제·취소를 증빙별로 묶는다. 신고서가 아니라 참고 자료다.
// Pure, so the screen, the download and the tests agree.
import type { RevenueLink } from "./tax-invoices.ts";

export type VatPeriodKind = "month" | "quarter" | "half";
export type VatPeriod = { kind: VatPeriodKind; key: string; label: string; from: string; to: string };

const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** month 2026-10 · quarter 2026-Q4 (2기 확정 · 10~12월) · half 2026-H2 (2기 · 7~12월). */
export function vatPeriod(key: string): VatPeriod | null {
  let match = key.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const [year, month] = [Number(match[1]), Number(match[2])];
    if (month < 1 || month > 12) return null;
    return { kind: "month", key, label: `${year}년 ${month}월`, from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${lastDay(year, month)}` };
  }
  match = key.match(/^(\d{4})-Q([1-4])$/);
  if (match) {
    const [year, quarter] = [Number(match[1]), Number(match[2])];
    const first = (quarter - 1) * 3 + 1;
    return { kind: "quarter", key, label: `${year}년 ${quarter <= 2 ? 1 : 2}기 ${quarter % 2 ? "예정" : "확정"} (${first}~${first + 2}월)`, from: `${year}-${pad(first)}-01`, to: `${year}-${pad(first + 2)}-${lastDay(year, first + 2)}` };
  }
  match = key.match(/^(\d{4})-H([12])$/);
  if (match) {
    const [year, half] = [Number(match[1]), Number(match[2])];
    const first = half === 1 ? 1 : 7;
    return { kind: "half", key, label: `${year}년 ${half}기 전체 (${first}~${first + 5}월)`, from: `${year}-${pad(first)}-01`, to: `${year}-${pad(first + 5)}-${lastDay(year, first + 5)}` };
  }
  return null;
}

export type VatPayment = { payment_key: string; biz: string; method: string | null; amount: number; paid_date: string | null; order_name?: string | null };
export type VatCancel = { payment_key: string; cancel_amount: number; cancel_date: string };
export type VatInvoice = { id: string; biz: string; approval_no: string; invoice_class: "tax" | "exempt"; is_modified: boolean; written_date: string; issued_date: string | null; buyer_name: string; supply_amount: number; tax_amount: number; total_amount: number };
export type VatExternal = { id: string; biz: string; title: string; revenue_date: string; supply: number | null; vat: number | null };

export type Evidence = "card" | "cash" | "other_pg" | "tax_invoice" | "exempt_invoice" | "external";
export const EVIDENCE_LABEL: Record<Evidence, string> = {
  card: "신용카드·간편결제 (토스)", cash: "계좌이체·가상계좌 (토스, 현금영수증 발급 여부는 토스에서 확인)", other_pg: "기타 결제 (토스 휴대폰·상품권 등)",
  tax_invoice: "전자세금계산서 (홈택스)", exempt_invoice: "전자계산서 · 면세 (홈택스)", external: "외부 매출 (계산서 미연결)",
};
export const DATE_BASIS: Record<Evidence, string> = { card: "결제일·취소일", cash: "결제일·취소일", other_pg: "결제일·취소일", tax_invoice: "작성일자", exempt_invoice: "작성일자", external: "매출일" };

export function paymentEvidence(method: string | null): Evidence {
  const value = (method ?? "").replace(/\s/g, "");
  if (["카드", "간편결제", "CARD", "EASY_PAY"].includes(value)) return "card";
  if (["계좌이체", "가상계좌", "TRANSFER", "VIRTUAL_ACCOUNT"].includes(value)) return "cash";
  return "other_pg";
}
/** Card and transfer totals include VAT: 세액 = round(합계 / 11). Assumes a taxable sale; tax-free goods differ. */
export const splitVat = (total: number) => { const tax = Math.round(total / 11); return { supply: total - tax, tax }; };

export type VatRow = { evidence: Evidence; kind: "결제" | "취소" | "발급" | "수정" | "매출"; date: string; basis: string; source: string; title: string; ref: string; supply: number; tax: number; total: number; note: string };
export type VatLine = { evidence: Evidence; label: string; basis: string; count: number; payCount: number; cancelCount: number; supply: number; tax: number; total: number };

const inRange = (date: string | null, from: string, to: string) => Boolean(date && date >= from && date <= to);

/**
 * Rows for one business and period. A payment or external sale confirmed as the same sale as a tax invoice is reported
 * under the invoice (and left out of its own line), so one sale is never counted twice.
 */
export function vatRows(input: { biz: string; from: string; to: string; payments: VatPayment[]; cancels: VatCancel[]; invoices: VatInvoice[]; externals: VatExternal[]; links: RevenueLink[] }): VatRow[] {
  const { biz, from, to } = input;
  const confirmed = input.links.filter(link => link.state === "confirmed");
  const invoiced = new Set(confirmed.filter(link => link.target_type !== "bank_tx").map(link => `${link.target_type}:${link.target_ref}`));
  const rows: VatRow[] = [];
  const mine = input.payments.filter(row => row.biz === biz);
  const byKey = new Map(mine.map(row => [row.payment_key, row]));
  for (const payment of mine) {
    if (!inRange(payment.paid_date, from, to)) continue;
    const evidence = paymentEvidence(payment.method), linked = invoiced.has(`payment:${payment.payment_key}`);
    const { supply, tax } = splitVat(payment.amount);
    rows.push({ evidence, kind: "결제", date: payment.paid_date!, basis: "결제일", source: "토스", title: payment.order_name || "토스 결제", ref: payment.payment_key,
      supply: linked ? 0 : supply, tax: linked ? 0 : tax, total: linked ? 0 : payment.amount, note: linked ? "세금계산서와 같은 매출로 확인 · 세금계산서 줄에서 셈" : "" });
  }
  for (const cancel of input.cancels) {
    const payment = byKey.get(cancel.payment_key);
    if (!payment || !inRange(cancel.cancel_date, from, to)) continue;
    const linked = invoiced.has(`payment:${payment.payment_key}`);
    const { supply, tax } = splitVat(cancel.cancel_amount);
    rows.push({ evidence: paymentEvidence(payment.method), kind: "취소", date: cancel.cancel_date, basis: "취소일", source: "토스", title: payment.order_name || "토스 결제", ref: payment.payment_key,
      supply: linked ? 0 : -supply, tax: linked ? 0 : -tax, total: linked ? 0 : -cancel.cancel_amount, note: linked ? "세금계산서와 같은 매출 · 취소분은 수정세금계산서로 반영" : payment.paid_date && payment.paid_date < from ? "이전 기간 결제의 취소" : "" });
  }
  for (const invoice of input.invoices) {
    if (invoice.biz !== biz || !inRange(invoice.written_date, from, to)) continue;
    rows.push({ evidence: invoice.invoice_class === "exempt" ? "exempt_invoice" : "tax_invoice", kind: invoice.is_modified ? "수정" : "발급", date: invoice.written_date, basis: "작성일자", source: "홈택스",
      title: invoice.buyer_name || "공급받는자 미기재", ref: invoice.approval_no, supply: invoice.supply_amount, tax: invoice.tax_amount, total: invoice.total_amount,
      note: invoice.issued_date && invoice.issued_date.slice(0, 7) !== invoice.written_date.slice(0, 7) ? `발급일 ${invoice.issued_date}` : "" });
  }
  for (const external of input.externals) {
    if (external.biz !== biz || !inRange(external.revenue_date, from, to) || invoiced.has(`external_revenue:${external.id}`)) continue;
    const supply = external.supply ?? 0, tax = external.vat ?? 0;
    rows.push({ evidence: "external", kind: "매출", date: external.revenue_date, basis: "매출일", source: "직접 입력", title: external.title, ref: external.id, supply, tax, total: supply + tax, note: "세금계산서와 연결되지 않은 외부 매출 · 증빙 확인 필요" });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.evidence.localeCompare(b.evidence));
}

export function vatLines(rows: VatRow[]): VatLine[] {
  const order: Evidence[] = ["card", "cash", "other_pg", "tax_invoice", "exempt_invoice", "external"];
  return order.map(evidence => {
    const mine = rows.filter(row => row.evidence === evidence && row.total !== 0);
    return { evidence, label: EVIDENCE_LABEL[evidence], basis: DATE_BASIS[evidence], count: mine.length, payCount: mine.filter(row => row.kind !== "취소" && row.total > 0).length, cancelCount: mine.filter(row => row.kind === "취소" || row.total < 0).length,
      supply: mine.reduce((sum, row) => sum + row.supply, 0), tax: mine.reduce((sum, row) => sum + row.tax, 0), total: mine.reduce((sum, row) => sum + row.total, 0) };
  });
}

/** CSV with a BOM; cells that a spreadsheet would run as a formula are prefixed with a quote. */
export function vatCsv(rows: VatRow[]): string {
  const safe = (value: string | number) => { const text = String(value); const guarded = /^[=+\-@\t\r]/.test(text) && typeof value !== "number" ? `'${text}` : text; return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded; };
  const head = ["증빙", "구분", "기준일", "날짜", "출처", "거래처·상품", "번호", "공급가액", "세액", "합계", "메모"];
  return "﻿" + [head, ...rows.map(row => [EVIDENCE_LABEL[row.evidence], row.kind, row.basis, row.date, row.source, row.title, row.ref, row.supply, row.tax, row.total, row.note])].map(line => line.map(safe).join(",")).join("\n");
}
