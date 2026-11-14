// 재무 요청 a5310134 (2026-10-29): 홈택스 전자(세금)계산서 매출을 엑셀로 올리고, 같은 매출의 토스 결제·외부 매출과
// 겹쳐 세지 않게 짝을 찾는다. Pure, so the upload preview, the server and the tests agree.

export type Biz = "ba" | "edu" | "myin" | "hm";
export const TAX_BIZ: Record<Biz, string> = { ba: "브랜디액션", edu: "브랜디액션 에듀", myin: "마이인", hm: "하루멜라" };

export type TaxInvoiceInput = {
  approval_no: string; invoice_class: "tax" | "exempt"; is_modified: boolean; kind_label: string;
  written_date: string; issued_date: string | null; sent_date: string | null;
  supplier_reg_no: string; supplier_name: string; buyer_reg_no: string; buyer_name: string; buyer_email: string;
  item_summary: string; supply_amount: number; tax_amount: number; total_amount: number; receipt_type: string; memo: string;
};

// Header names as the 홈택스 목록 download writes them (both 전자세금계산서 and 전자계산서 lists).
const COLUMNS: Record<keyof TaxInvoiceInput | "class_label" | "supplier_reg_no_dup", string[]> = {
  approval_no: ["승인번호"],
  written_date: ["작성일자", "작성일"],
  issued_date: ["발급일자", "발급일"],
  sent_date: ["전송일자", "전송일"],
  supplier_reg_no: ["공급자사업자등록번호", "공급자 사업자등록번호", "공급자등록번호"],
  supplier_reg_no_dup: [],
  supplier_name: ["공급자상호", "상호"],
  buyer_reg_no: ["공급받는자사업자등록번호", "공급받는자 사업자등록번호", "공급받는자등록번호"],
  buyer_name: ["공급받는자상호"],
  buyer_email: ["공급받는자이메일1", "공급받는자 이메일1", "공급받는자이메일"],
  total_amount: ["합계금액", "합계"],
  supply_amount: ["공급가액"],
  tax_amount: ["세액"],
  class_label: ["전자세금계산서분류", "전자계산서분류", "분류"],
  kind_label: ["전자세금계산서종류", "전자계산서종류", "종류"],
  receipt_type: ["영수/청구 구분", "영수/청구구분", "영수청구구분"],
  item_summary: ["품목명"],
  memo: ["비고"],
  invoice_class: [], is_modified: [],
};

const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "").trim();
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

/** 2026-10-05 · 20261005 · 2026.10.05 · 2026/10/05 · an Excel serial → YYYY-MM-DD, else null. */
export function hometaxDate(value: unknown): string | null {
  if (typeof value === "number" && value > 20000 && value < 80000) return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString().slice(0, 10);
  const match = String(value ?? "").trim().match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}
/** "1,100,000" · "-55,000" · 1100000 → whole won, else null. */
export function hometaxWon(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  const text = String(value ?? "").replace(/[,\s원]/g, "");
  if (!/^-?\d+$/.test(text)) return null;
  const won = Number(text);
  return Number.isSafeInteger(won) ? won : null;
}

export type ParsedInvoices = { invoices: TaxInvoiceInput[]; errors: string[]; supplierRegNos: string[]; headerRow: number };

/**
 * Rows of a 홈택스 매출 목록 (title lines first, then one header row, then one row per invoice or per item).
 * A 매입 목록 has the same layout with the roles reversed: the supplier is the counterparty and the buyer is our business.
 */
export function parseHometaxRows(rows: unknown[][], direction: "sales" | "purchase" = "sales"): ParsedInvoices {
  const headerRow = rows.findIndex(row => row.some(cell => squash(cell) === "승인번호") && row.some(cell => ["작성일자", "작성일"].includes(squash(cell))));
  if (headerRow < 0) return { invoices: [], errors: [`홈택스 목록 파일이 아니에요. 「승인번호」와 「작성일자」 칸이 있는 ${direction === "purchase" ? "매입" : "매출"} 목록을 올려 주세요.`], supplierRegNos: [], headerRow: -1 };
  const header = rows[headerRow].map(squash);
  // The first 상호 column belongs to the supplier, the second to the buyer.
  const at = (names: string[], nth = 0) => header.map((cell, index) => names.map(squash).includes(cell) ? index : -1).filter(index => index >= 0)[nth] ?? -1;
  const col = {
    approval_no: at(COLUMNS.approval_no), written_date: at(COLUMNS.written_date), issued_date: at(COLUMNS.issued_date), sent_date: at(COLUMNS.sent_date),
    supplier_reg_no: at(COLUMNS.supplier_reg_no) >= 0 ? at(COLUMNS.supplier_reg_no) : at(["사업자등록번호", "등록번호"]),
    buyer_reg_no: at(COLUMNS.buyer_reg_no) >= 0 ? at(COLUMNS.buyer_reg_no) : at(["사업자등록번호", "등록번호"], 1),
    supplier_name: at(["공급자상호"]) >= 0 ? at(["공급자상호"]) : at(["상호"]),
    buyer_name: at(COLUMNS.buyer_name) >= 0 ? at(COLUMNS.buyer_name) : at(["상호"], 1),
    buyer_email: at(COLUMNS.buyer_email), total_amount: at(COLUMNS.total_amount), supply_amount: at(COLUMNS.supply_amount), tax_amount: at(COLUMNS.tax_amount),
    class_label: at(COLUMNS.class_label), kind_label: at(COLUMNS.kind_label), receipt_type: at(COLUMNS.receipt_type), item_summary: at(COLUMNS.item_summary), memo: at(COLUMNS.memo),
  };
  const missing = (["approval_no", "written_date", "supply_amount"] as const).filter(key => col[key] < 0);
  if (missing.length) return { invoices: [], errors: [`필요한 칸이 없어요: ${missing.map(key => ({ approval_no: "승인번호", written_date: "작성일자", supply_amount: "공급가액" })[key]).join(", ")}`], supplierRegNos: [], headerRow };
  // 전자계산서(면세) lists have no 세액 column.
  const exemptFile = col.tax_amount < 0;
  const byApproval = new Map<string, TaxInvoiceInput>();
  const errors: string[] = [];
  rows.slice(headerRow + 1).forEach((row, index) => {
    const cell = (key: keyof typeof col) => col[key] >= 0 ? row[col[key]] : "";
    const approval = clean(cell("approval_no"), 40).replace(/\s/g, "");
    if (!approval) return; // blank or summary lines
    const line = headerRow + index + 2;
    const written = hometaxDate(cell("written_date"));
    const supply = hometaxWon(cell("supply_amount"));
    const tax = exemptFile ? 0 : hometaxWon(cell("tax_amount"));
    const total = col.total_amount >= 0 ? hometaxWon(cell("total_amount")) : supply !== null && tax !== null ? supply + tax : null;
    if (!written || supply === null || tax === null || total === null) { errors.push(`${line}행 (${approval}): 날짜나 금액을 읽지 못했어요.`); return; }
    if (supply + tax !== total) { errors.push(`${line}행 (${approval}): 공급가액+세액이 합계와 달라요.`); return; }
    const item = clean(cell("item_summary"), 120);
    const existing = byApproval.get(approval);
    // A list downloaded with 품목 repeats an invoice once per item: keep the invoice once, gather item names.
    if (existing) { if (item && !existing.item_summary.includes(item)) existing.item_summary = clean(`${existing.item_summary}, ${item}`, 300); return; }
    const classLabel = clean(cell("class_label"), 40);
    byApproval.set(approval, {
      approval_no: approval, invoice_class: exemptFile || /계산서/.test(classLabel) && !/세금/.test(classLabel) ? "exempt" : "tax", is_modified: /수정/.test(classLabel),
      kind_label: clean(cell("kind_label"), 40), written_date: written, issued_date: hometaxDate(cell("issued_date")), sent_date: hometaxDate(cell("sent_date")),
      supplier_reg_no: digits(cell("supplier_reg_no")).slice(0, 10), supplier_name: clean(cell("supplier_name"), 120),
      buyer_reg_no: digits(cell("buyer_reg_no")).slice(0, 13), buyer_name: clean(cell("buyer_name"), 120), buyer_email: clean(cell("buyer_email"), 200),
      item_summary: item, supply_amount: supply, tax_amount: tax, total_amount: total, receipt_type: clean(cell("receipt_type"), 20), memo: clean(cell("memo"), 500),
    });
  });
  const invoices = [...byApproval.values()];
  const supplierRegNos = [...new Set(invoices.map(row => row.supplier_reg_no).filter(Boolean))];
  // Our own business must be one: the supplier of a 매출 list, the buyer of a 매입 list (a 매출 list uploaded as 매입 usually trips this).
  const buyers = new Set(invoices.map(row => row.buyer_reg_no).filter(Boolean)).size;
  if (direction === "purchase") { if (buyers > 1) errors.push(`공급받는자 사업자번호가 ${buyers}개 섞여 있어요. 매출 목록이 아닌지 확인하고, 사업자별로 따로 내려받아 올려 주세요.`); }
  else if (supplierRegNos.length > 1) errors.push(`공급자 사업자번호가 ${supplierRegNos.length}개 섞여 있어요. 사업자별로 따로 내려받아 올려 주세요.`);
  return { invoices, errors, supplierRegNos, headerRow };
}

/**
 * The instructions staff paste into Aside: they sign in to 홈택스 themselves; Aside does the rest.
 * 매출 goes in through 매출내역, 매입 through 부가세 신고 참고 자료 (saved as the company's own, under 회사 전체).
 */
export function asideHometaxInstruction(from: string, to: string, direction: "sales" | "purchase" = "sales") {
  const side = direction === "purchase" ? "매입" : "매출";
  return [
    `[홈택스 ${side} 계산서 → 브랜디 OS 올리기]`,
    "0. 홈택스 로그인은 담당자가 직접 합니다. 로그인 정보·인증서는 묻거나 입력하지 마세요.",
    "1. 홈택스 › 조회/발급 › 전자세금계산서 › 목록조회 를 엽니다.",
    `2. 「${side}」을 고르고, 작성일자 ${from} ~ ${to} 로 조회합니다.`,
    "3. 결과 아래 「내려받기」(엑셀)로 파일을 저장합니다. 받은 파일(.xls)은 다시 저장하지 않고 그대로 씁니다.",
    ...(direction === "purchase" ? [
      "4. 브랜디 OS › 재무관리 › 부가세 신고 참고 자료 에서 사업자를 「회사 전체」로 두고, 아래쪽 「홈택스 매입 엑셀 올리기」로 파일을 올립니다.",
      "5. 미리보기에 나온 건수·합계와 오류 줄을 담당자에게 보여 주고, 담당자가 「저장」을 누르게 합니다.",
      "※ 같은 파일을 다시 올려도 이미 올린 계산서는 건너뜁니다.",
    ] : [
      "4. 면세 매출이 있으면 조회/발급 › 전자계산서 › 목록조회 에서 같은 기간 「매출」을 한 번 더 내려받습니다.",
      "5. 브랜디 OS › 재무관리 › 매출내역 › 세금계산서(홈택스) 칸에서 사업자를 고르고 (담당자가 따로 정하지 않았으면 「브랜디액션」) 「홈택스 엑셀 올리기」로 파일을 올립니다.",
      "6. 미리보기에 나온 건수·합계와 오류 줄을 담당자에게 보여 주고, 담당자가 「저장」을 누르게 합니다.",
      "※ 같은 파일을 다시 올려도 이미 올린 계산서는 건너뜁니다.",
    ]),
  ].join("\n");
}

// ---- 같은 매출 찾기 -------------------------------------------------------------------------------------------------

export type MatchInvoice = { id: string; biz: string; written_date: string; total_amount: number; supply_amount: number; is_modified: boolean };
export type MatchPayment = { payment_key: string; biz: string; paid_date: string | null; amount: number; canceled_amount: number; order_name?: string | null };
export type MatchExternal = { id: string; biz: string; revenue_date: string; supply: number | null; vat: number | null; title?: string };
export type MatchBank = { id: string; tx_date: string; deposit: number; description: string };
export type RevenueLink = { tax_invoice_id: string; target_type: "payment" | "external_revenue" | "bank_tx"; target_ref: string; state: "confirmed" | "rejected" };
export type Candidate = { type: "payment" | "external_revenue"; ref: string; date: string; amount: number; label: string };
/** linked = 담당자가 같은 매출로 확인 · suspect = 짝 하나 · review = 짝 여럿이거나 수정세금계산서 · single = 계산서로만 잡힌 매출 */
export type MatchState = { state: "linked" | "suspect" | "review" | "single"; candidates: Candidate[]; linked: Candidate | null };

export const MATCH_DAYS = 7;
const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** Candidates are the same business, the same total, within 7 days; a rejected pair is never suggested again. */
export function matchInvoices(invoices: MatchInvoice[], payments: MatchPayment[], externals: MatchExternal[], links: RevenueLink[]): Map<string, MatchState> {
  const result = new Map<string, MatchState>();
  for (const invoice of invoices) {
    const mine = links.filter(link => link.tax_invoice_id === invoice.id && link.target_type !== "bank_tx");
    const rejected = new Set(mine.filter(link => link.state === "rejected").map(link => `${link.target_type}:${link.target_ref}`));
    const candidates: Candidate[] = [
      ...payments.filter(payment => payment.biz === invoice.biz && payment.paid_date && dayGap(payment.paid_date, invoice.written_date) <= MATCH_DAYS
        && [payment.amount, payment.amount - payment.canceled_amount].includes(invoice.total_amount))
        .map(payment => ({ type: "payment" as const, ref: payment.payment_key, date: payment.paid_date!, amount: payment.amount - payment.canceled_amount, label: payment.order_name || "토스 결제" })),
      ...externals.filter(row => row.biz === invoice.biz && dayGap(row.revenue_date, invoice.written_date) <= MATCH_DAYS
        && ((row.supply ?? 0) + (row.vat ?? 0) === invoice.total_amount || row.supply === invoice.supply_amount))
        .map(row => ({ type: "external_revenue" as const, ref: row.id, date: row.revenue_date, amount: (row.supply ?? 0) + (row.vat ?? 0), label: row.title || "외부 매출" })),
    ].filter(candidate => !rejected.has(`${candidate.type}:${candidate.ref}`));
    const confirmed = mine.find(link => link.state === "confirmed");
    if (confirmed) {
      const linked = candidates.find(candidate => candidate.type === confirmed.target_type && candidate.ref === confirmed.target_ref)
        ?? { type: confirmed.target_type as Candidate["type"], ref: confirmed.target_ref, date: invoice.written_date, amount: invoice.total_amount, label: "확인한 짝" };
      result.set(invoice.id, { state: "linked", candidates: [], linked });
    } else if (invoice.is_modified) result.set(invoice.id, { state: "review", candidates, linked: null });
    else result.set(invoice.id, { state: candidates.length === 1 ? "suspect" : candidates.length > 1 ? "review" : "single", candidates, linked: null });
  }
  return result;
}

/** 입금 확인: a confirmed bank link, else the only deposit of the same amount from 3 days before to 90 days after 작성일. */
export function matchDeposit(invoice: MatchInvoice, banks: MatchBank[], links: RevenueLink[]): { state: "confirmed" | "likely" | "unclear" | "none"; bank: MatchBank | null; count: number } {
  const confirmed = links.find(link => link.tax_invoice_id === invoice.id && link.target_type === "bank_tx" && link.state === "confirmed");
  if (confirmed) return { state: "confirmed", bank: banks.find(row => row.id === confirmed.target_ref) ?? null, count: 1 };
  const rejected = new Set(links.filter(link => link.tax_invoice_id === invoice.id && link.target_type === "bank_tx" && link.state === "rejected").map(link => link.target_ref));
  const start = Date.parse(`${invoice.written_date}T00:00:00Z`) - 3 * 86_400_000, end = start + 93 * 86_400_000;
  const hits = banks.filter(row => !rejected.has(row.id) && row.deposit === invoice.total_amount && Date.parse(`${row.tx_date}T00:00:00Z`) >= start && Date.parse(`${row.tx_date}T00:00:00Z`) <= end);
  return { state: hits.length === 1 ? "likely" : hits.length > 1 ? "unclear" : "none", bank: hits.length === 1 ? hits[0] : null, count: hits.length };
}

/** 매출 합계 by source; an invoice confirmed as the same sale as a payment or external revenue is counted once. */
export function revenueBySource(invoices: MatchInvoice[], states: Map<string, MatchState>, paymentsNet: number, externalTotal: number) {
  const invoiceTotal = invoices.reduce((sum, row) => sum + row.total_amount, 0);
  const linkedTotal = invoices.filter(row => states.get(row.id)?.state === "linked").reduce((sum, row) => sum + row.total_amount, 0);
  const suspectTotal = invoices.filter(row => ["suspect", "review"].includes(states.get(row.id)?.state ?? "")).reduce((sum, row) => sum + row.total_amount, 0);
  return { toss: paymentsNet, invoices: invoiceTotal, external: externalTotal, linkedExcluded: linkedTotal, suspect: suspectTotal, total: paymentsNet + externalTotal + invoiceTotal - linkedTotal };
}
