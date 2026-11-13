// 자금 흐름 (/finance/pnl?tab=cash): 통장 거래로 보는 월별 유입 · 유출 · 순유입과 월말 보유 자금. 새 테이블 · 새 API 없음.
// Pure, like pnl.ts. Bank rows carry no business, so there is no business filter here.
import { active, classifiedBank } from "./domain.mjs";
import type { Cell, PnlEntry } from "./pnl";
import type { FinanceData, FinanceRow } from "./schema";

export type CashAccount = { id: string; bank: string; name: string; last4: string; balance: Cell; asOf: string | null };
export type Cash = {
  year: number;
  /** How many months of the year have started (0–12). Later months are null: not yet, not zero. */
  open: number;
  inflow: Cell[]; outflow: Cell[]; net: Cell[];
  /** 보유 자금 at each month end: the known account balances added up. null in a started month = no account balance is known. */
  balance: Cell[];
  /** Every active account with its balance after its latest transaction (지금 잔액). */
  accounts: CashAccount[];
  /** No active account, or no transaction at all: the screen shows how to start instead of a row of zeros. */
  empty: boolean;
};

const MONTHS = Array.from({ length: 12 }, (_, index) => index);
const pad = (value: number) => String(value).padStart(2, "0");
const num = (value: unknown) => Number(value || 0);
const str = (value: unknown) => String(value ?? "");
// Both legs of a move between our own accounts: they change each account's balance but not the company's money.
const isTransfer = (row: FinanceRow) => row.link_type === "transfer" || row.category === "내 통장 간 이체";
/** Active accounts' rows, classified as 통장 내역 does, oldest first (same date and time keep their stored order). */
const ordered = (data: FinanceData) => classifiedBank(data).sort((a, b) => `${str(a.tx_date)}${str(a.time)}`.localeCompare(`${str(b.tx_date)}${str(b.time)}`));

export function cashOf(data: FinanceData, year: number, today: string): Cash {
  const thisYear = Number(today.slice(0, 4)), open = year < thisYear ? 12 : year > thisYear ? 0 : Number(today.slice(5, 7));
  const accounts = active(data.bank_accounts), rows = ordered(data);
  const inflow = MONTHS.map(() => 0), outflow = MONTHS.map(() => 0);
  // Running balance per account, exactly as 통장 내역 shows it: the opening balance plus every movement, replaced by the bank's
  // own figure whenever a row carries one (balance_after). An account with neither stays unknown and is left out of the total.
  const running = new Map<string, Cell>(accounts.map(account => [account.id, account.opening_balance == null ? null : num(account.opening_balance)]));
  const latest = new Map<string, string>();
  const total = (): Cell => { const known = [...running.values()].filter((value): value is number => value !== null); return known.length ? known.reduce((sum, value) => sum + value, 0) : null; };
  let cursor = 0;
  const applyUntil = (lastDay: string) => {
    for (; cursor < rows.length && str(rows[cursor].tx_date) <= lastDay; cursor += 1) {
      const row = rows[cursor], id = str(row.account_id), date = str(row.tx_date), before = running.get(id) ?? null;
      running.set(id, row.balance_after != null ? num(row.balance_after) : before === null ? null : before + num(row.deposit) - num(row.withdrawal));
      latest.set(id, date);
      if (!date.startsWith(`${year}-`) || isTransfer(row)) continue;
      const index = Number(date.slice(5, 7)) - 1;
      inflow[index] += num(row.deposit);
      outflow[index] += num(row.withdrawal);
    }
  };
  // "-31" sorts after every real day of the month, so earlier years fall into January's starting balance.
  const balance = MONTHS.map(index => { applyUntil(`${year}-${pad(index + 1)}-31`); return index < open ? total() : null; });
  applyUntil("9999-12-31");
  const cells = (values: number[]): Cell[] => MONTHS.map(index => index < open ? values[index] : null);
  return {
    year, open, inflow: cells(inflow), outflow: cells(outflow), net: cells(inflow.map((value, index) => value - outflow[index])), balance,
    accounts: accounts.map(account => ({ id: account.id, bank: str(account.bank), name: str(account.name), last4: str(account.last4), balance: running.get(account.id) ?? null, asOf: latest.get(account.id) ?? null })),
    empty: accounts.length === 0 || rows.length === 0,
  };
}

/** The bank rows behind one 유입액 · 유출액 · 순유입액 cell, newest first. In 순유입액 a withdrawal is negative. */
export function cashRows(data: FinanceData, year: number, key: "inflow" | "outflow" | "net", month: number): PnlEntry[] {
  const prefix = `${year}-${pad(month)}`, out: PnlEntry[] = [];
  for (const row of ordered(data)) {
    if (!str(row.tx_date).startsWith(prefix) || isTransfer(row)) continue;
    const base = { line: key, date: str(row.tx_date), category: str(row.category), title: str(row.description) };
    if (key !== "outflow" && num(row.deposit) > 0) out.push({ ...base, kind: "입금", amount: num(row.deposit) });
    if (key !== "inflow" && num(row.withdrawal) > 0) out.push({ ...base, kind: "출금", amount: key === "net" ? -num(row.withdrawal) : num(row.withdrawal) });
  }
  return out.reverse();
}
