// 손익 현황 (/finance/pnl): 이미 불러온 원장에서 월별 손익(매출 − 비용)을 계산한다. 새 테이블 · 새 API 없음.
// Pure — no React, no fetch, no demo data — so the screen, the drill-down dialog and the tests agree.
// 금액은 기록된 그대로(부가세 포함)라 개요 · 매출내역 · 카드지출 화면과 같은 숫자가 나온다. 부가세는 이 판에서 빼지 않는다.
import { active, classifiedBank, classifiedCards, externalAmount, overviewOf, settingsOf } from "./domain.mjs";
import type { FinanceData, FinanceRow } from "./schema";

/** null = 아직 오지 않은 달 (결제 수수료 줄에서는 「미확인」). 0 과 다르다. */
export type Cell = number | null;
export type PnlGroupKey = "revenue" | "labor" | "bank" | "card" | "fee";
export type PnlScreen = "sales" | "cards" | "bank";
export type PnlLine = { key: string; label: string; months: Cell[] };
export type PnlGroup = { key: PnlGroupKey; label: string; screen: PnlScreen; lines: PnlLine[]; months: Cell[] };
export type PnlExcluded = { tax: number; unclassified: number; unclassifiedCount: number };
export type Pnl = {
  year: number; biz: string;
  /** How many months of the year have started (0–12). Later months are null: not yet, not zero. */
  open: number;
  revenue: PnlGroup; costs: PnlGroup[];
  revenueTotal: Cell[]; costTotal: Cell[]; profit: Cell[];
  /** Withdrawals kept out of the totals, per month: 세금 납부 and 미분류 출금. */
  excluded: (PnlExcluded | null)[];
  /** Bank rows carry no business, so bank-paid costs (and `excluded`) are counted only for biz "all". */
  bankIncluded: boolean;
};
/** One underlying row of a cell: 일자 · 구분 · 분류 · 거래처·내용 · 금액. */
export type PnlEntry = { line: string; date: string; kind: string; category: string; title: string; amount: number };

const MONTHS = Array.from({ length: 12 }, (_, index) => index);
const pad = (value: number) => String(value).padStart(2, "0");
const num = (value: unknown) => Number(value || 0);
const str = (value: unknown) => String(value ?? "");

const CARD_ORDER = ["광고선전비", "지급수수료", "소모품비", "도서인쇄비", "여비교통비", "지급임차료", "외주용역비", "회의비", "복리후생비", "접대비"];
// Bank withdrawal categories, decided one by one against the enum in schema.ts:
//   cost    급여 · 4대보험 · 프리랜서 (인건비)   임대료 · 세무 기장료 · 강사 정산 · 기타 출금 (그 밖의 통장 출금)
//   never   카드 대금 (already counted row by row under 카드지출) · 내 통장 간 이체 (our own money moving)
//   beside  세금 납부 → excluded.tax.  미분류, or a deposit-type category on a withdrawal → excluded.unclassified (needs a look in 통장 내역)
const LABOR = ["급여", "4대보험", "프리랜서"];
const BANK_OTHER = ["임대료", "세무 기장료", "강사 정산", "기타 출금"];
const NEVER = ["카드 대금", "내 통장 간 이체"];
const COST_GROUPS: { key: PnlGroupKey; label: string; screen: PnlScreen }[] = [
  { key: "labor", label: "인건비", screen: "bank" },
  { key: "bank", label: "그 밖의 통장 출금", screen: "bank" },
  { key: "card", label: "카드지출", screen: "cards" },
  { key: "fee", label: "결제 수수료", screen: "sales" },
];
const LINE_ORDER = ["toss", "external", ...[...LABOR, ...BANK_OTHER].map(name => `bank:${name}`), ...CARD_ORDER.map(name => `card:${name}`)];
const rank = (line: string) => line === "card:" ? LINE_ORDER.length + 1 : LINE_ORDER.includes(line) ? LINE_ORDER.indexOf(line) : LINE_ORDER.length;

/** Line keys: toss · external · fee · card:<계정과목> (card: = 미분류) · bank:<분류> · tax · unclassified. */
export function groupOf(line: string): PnlGroupKey | null {
  if (line === "toss" || line === "external") return "revenue";
  if (line === "fee") return "fee";
  if (line.startsWith("card:")) return "card";
  if (line.startsWith("bank:")) return LABOR.includes(line.slice(5)) ? "labor" : "bank";
  return null;
}
export const lineLabel = (line: string) => ({ toss: "토스 결제 순매출", external: "외부 매출", fee: "결제 수수료", "card:": "미분류 카드지출", tax: "세금 납부", unclassified: "미분류 출금" } as Record<string, string>)[line] ?? line.slice(line.indexOf(":") + 1);

/** Every row of one year that a cell (or the 제외 note) is made of. Filters mirror overviewOf and budgetOf. */
function entriesOf(data: FinanceData, year: number, biz: string): PnlEntry[] {
  const inYear = (date: unknown) => str(date).startsWith(`${year}-`);
  const mine = (row: FinanceRow | undefined) => biz === "all" || row?.biz === biz;
  const out: PnlEntry[] = [];
  const payments = active(data.payments), byId = new Map(payments.map(payment => [payment.id, payment]));
  for (const payment of payments) {
    if (payment.status === "WAITING_FOR_DEPOSIT" || !inYear(payment.paid_date) || !mine(payment)) continue;
    const base = { date: str(payment.paid_date), category: str(payment.method), title: str(payment.order_name) || "토스 결제" };
    out.push({ ...base, line: "toss", kind: "토스 결제", amount: num(payment.amount) });
    if (payment.fee != null) out.push({ ...base, line: "fee", kind: "결제 수수료", amount: num(payment.fee) });
  }
  for (const cancel of active(data.payment_cancels)) {
    const payment = byId.get(str(cancel.payment_id));
    if (!payment || !inYear(cancel.cancel_date) || !mine(payment)) continue;
    const base = { date: str(cancel.cancel_date), category: str(payment.method), title: str(payment.order_name) || "토스 결제" };
    out.push({ ...base, line: "toss", kind: "토스 취소", amount: -num(cancel.cancel_amount) });
    if (cancel.fee_refund != null) out.push({ ...base, line: "fee", kind: "수수료 환급", amount: -num(cancel.fee_refund) });
  }
  const bank = classifiedBank(data), settings = settingsOf(data);
  for (const revenue of active(data.external_revenues)) {
    if (!inYear(revenue.revenue_date) || !mine(revenue)) continue;
    out.push({ line: "external", date: str(revenue.revenue_date), kind: "외부 매출", category: ({ youtube: "유튜브", outsource: "외주·용역", lecture: "강의", etc: "기타" } as Record<string, string>)[str(revenue.kind)] ?? "", title: [revenue.title, revenue.client].filter(Boolean).join(" · "), amount: externalAmount(revenue, bank, settings) });
  }
  for (const card of classifiedCards(data)) {
    if (!inYear(card.used_date) || !mine(card)) continue;
    out.push({ line: `card:${str(card.category)}`, date: str(card.used_date), kind: "카드", category: str(card.category) || "미분류", title: str(card.merchant), amount: num(card.amount_krw) });
  }
  if (biz !== "all") return out;
  const counted = new Set(active(data.bank_accounts).filter(account => account.include_in_net).map(account => account.id));
  for (const row of bank) {
    const category = str(row.category);
    if (!counted.has(str(row.account_id)) || num(row.withdrawal) <= 0 || !inYear(row.tx_date) || row.link_type === "transfer" || NEVER.includes(category)) continue;
    const line = category === "세금 납부" ? "tax" : LABOR.includes(category) || BANK_OTHER.includes(category) ? `bank:${category}` : "unclassified";
    out.push({ line, date: str(row.tx_date), kind: "통장 출금", category, title: str(row.description), amount: num(row.withdrawal) });
  }
  return out;
}

type Overview = { gross: number; canceled: number; externalRevenue: number; netRevenue: number; fee: number | null };

export function pnlOf(data: FinanceData, year: number, biz: string, today: string): Pnl {
  const thisYear = Number(today.slice(0, 4)), open = year < thisYear ? 12 : year > thisYear ? 0 : Number(today.slice(5, 7));
  const sums = new Map<string, number[]>(), unclassifiedCount = MONTHS.map(() => 0);
  for (const entry of entriesOf(data, year, biz)) {
    const index = Number(entry.date.slice(5, 7)) - 1;
    if (!sums.has(entry.line)) sums.set(entry.line, MONTHS.map(() => 0));
    sums.get(entry.line)![index] += entry.amount;
    if (entry.line === "unclassified") unclassifiedCount[index] += 1;
  }
  const cells = (line: string): Cell[] => MONTHS.map(index => index < open ? sums.get(line)?.[index] ?? 0 : null);
  const line = (key: string, months: Cell[]): PnlLine => ({ key, label: lineLabel(key), months });
  // 매출과 수수료는 개요와 같은 함수에서 가져온다 — 같은 달 · 같은 사업이면 개요의 순매출과 항상 같다.
  // ponytail: overviewOf also works out that month's budget (payout matching is settlements × bank rows), which this page
  // never reads. Revenue and fees do not depend on settlements or budget rows, so those are left out of the 12 calls.
  // If overviewOf ever reads them for revenue, the "equals 개요's 순매출" test fails; then split a revenue-only function out.
  const lean: FinanceData = { ...data, settlements: [], budget_items: [], budget_actuals: [], payout_notes: [] };
  const overview = MONTHS.map(index => index < open ? overviewOf(lean, `${year}-${pad(index + 1)}`, biz, today) as Overview : null);
  const revenue: PnlGroup = {
    key: "revenue", label: "매출", screen: "sales", months: overview.map(month => month ? month.netRevenue : null),
    lines: [line("toss", overview.map(month => month ? month.gross - month.canceled : null)), line("external", overview.map(month => month ? month.externalRevenue : null))],
  };
  const keys = [...sums.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "ko"));
  const costs = COST_GROUPS.map((group): PnlGroup => {
    // 결제 수수료: 그 달 결제나 취소 중 수수료를 모르는 건이 하나라도 있으면 null(미확인). 0 으로 치지 않는다.
    if (group.key === "fee") { const months = overview.map(month => month ? month.fee : null); return { ...group, lines: [line("fee", months)], months }; }
    const lines = keys.filter(key => groupOf(key) === group.key).map(key => line(key, cells(key)));
    return { ...group, lines, months: MONTHS.map(index => index < open ? lines.reduce((sum, item) => sum + (item.months[index] ?? 0), 0) : null) };
  });
  const costTotal = MONTHS.map(index => index < open ? costs.reduce((sum, group) => sum + (group.months[index] ?? 0), 0) : null);
  return {
    year, biz, open, revenue, costs, revenueTotal: revenue.months, costTotal,
    profit: MONTHS.map(index => index < open ? revenue.months[index]! - costTotal[index]! : null),
    excluded: MONTHS.map(index => index < open ? { tax: sums.get("tax")?.[index] ?? 0, unclassified: sums.get("unclassified")?.[index] ?? 0, unclassifiedCount: unclassifiedCount[index] } : null),
    bankIncluded: biz === "all",
  };
}

/** The rows behind one cell, newest first. `key` is a line key or a group key (a group returns all its lines). */
export function pnlRows(data: FinanceData, year: number, biz: string, key: string, month: number): PnlEntry[] {
  const prefix = `${year}-${pad(month)}`;
  return entriesOf(data, year, biz).filter(entry => entry.date.startsWith(prefix) && (entry.line === key || groupOf(entry.line) === key)).sort((a, b) => b.date.localeCompare(a.date));
}

/** Running totals across the months. A null month stays null and does not break the run. */
export function cumulative(values: Cell[]): Cell[] {
  let sum = 0;
  return values.map(value => value === null ? null : (sum += value));
}
/** Sum of the months that have a number; null when none has. */
export const sumCells = (values: Cell[]): Cell => values.some(value => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;

/** Past years that have at least one ledger row, plus the current one, oldest first. */
export function pnlYears(data: FinanceData, today: string): number[] {
  const dates: [string, string][] = [["payments", "paid_date"], ["payment_cancels", "cancel_date"], ["external_revenues", "revenue_date"], ["card_transactions", "used_date"], ["bank_transactions", "tx_date"]];
  const current = Number(today.slice(0, 4)), years = new Set([current]);
  for (const [resource, field] of dates) for (const row of active(data[resource])) { const year = Number(str(row[field]).slice(0, 4)); if (year > 1999 && year < current) years.add(year); }
  return [...years].sort((a, b) => a - b);
}
