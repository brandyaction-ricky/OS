import assert from "node:assert/strict";
import test from "node:test";
import { cashOf, cashRows } from "../lib/finance/cashflow.ts";
import { pnlDemoData } from "../lib/finance/pnl-demo.ts";

// 자금 흐름: synthetic bank ledger only. Today is 2026-05-20, so January–May are open and June–December are "not yet".
const TODAY = "2026-05-20";
let seq = 0;
const row = fields => ({ id: `c${++seq}`, version: 1, archived_at: null, ...fields });
const tx = (account, date, time, deposit, withdrawal, description, extra = {}) => row({ account_id: account, tx_date: date, time, deposit, withdrawal, description, balance_after: null, manual_category: null, link_type: null, link_ref: null, ...extra });

function ledger() {
  const out = tx("A", "2026-03-15", "10:00", 0, 400000, "예비 통장으로", { link_type: "transfer" });
  const into = tx("B", "2026-03-15", "10:00", 400000, 0, "운영 통장에서", { link_type: "transfer", link_ref: out.id });
  out.link_ref = into.id;
  return {
    bank_rules: [],
    bank_accounts: [
      row({ id: "A", bank: "국민은행", name: "운영", last4: "1111", opening_balance: 1000000 }),
      row({ id: "B", bank: "국민은행", name: "예비", last4: "2222", opening_balance: 500000 }),
      row({ id: "C", bank: "신한은행", name: "잔액 모름", last4: null, opening_balance: null }),
      row({ id: "D", bank: "국민은행", name: "닫은 통장", last4: "4444", opening_balance: 7000000, archived_at: "2026-01-01T00:00:00.000Z" }),
    ],
    // Deliberately out of order: the calculation sorts by date and time itself.
    bank_transactions: [
      tx("B", "2026-05-06", "09:00", 30000, 0, "이자", { balance_after: 830000 }),
      tx("A", "2026-04-10", "09:00", 0, 250000, "급여", { manual_category: "급여" }),
      tx("A", "2026-04-10", "08:00", 70000, 0, "환불 입금"),
      tx("C", "2026-04-02", "12:00", 50000, 0, "잔액 없는 입금"),
      tx("B", "2026-03-20", "11:00", 0, 100000, "직접 분류한 이체", { manual_category: "내 통장 간 이체" }),
      out, into,
      // The bank's own balance wins over opening balance + movements (which would be 1,900,000).
      tx("A", "2026-02-05", "15:00", 1000000, 0, "토스페이먼츠 정산", { balance_after: 1950000, manual_category: "토스 정산" }),
      tx("A", "2026-01-10", "09:00", 0, 300000, "임대료", { manual_category: "임대료" }),
      tx("A", "2025-12-20", "09:00", 200000, 0, "작년 입금"),
      tx("D", "2026-05-03", "09:00", 9999999, 0, "닫은 통장 입금"),
    ],
  };
}
const data = ledger(), cash = cashOf(data, 2026, TODAY);
const open = values => values.slice(0, 5);

test("유입 · 유출 · 순유입: deposits and withdrawals by month, without either leg of a move between our own accounts", () => {
  assert.deepEqual(open(cash.inflow), [0, 1000000, 0, 120000, 30000]);
  assert.deepEqual(open(cash.outflow), [300000, 0, 0, 250000, 0]);
  assert.deepEqual(open(cash.net), [-300000, 1000000, 0, -130000, 30000]);
  for (let index = 0; index < 5; index += 1) assert.equal(cash.net[index], cash.inflow[index] - cash.outflow[index]);
});

test("보유 자금: each account's balance at month end, added up; transfers move it between accounts but not in total", () => {
  // A: 1,000,000 + 200,000 (last year) − 300,000 → 900,000; the bank's figure 1,950,000 in February; − 400,000 transfer; + 70,000 − 250,000.
  // B: 500,000 + 400,000 transfer − 100,000 → 800,000; the bank's figure 830,000 in May. C has no balance at all and is left out.
  assert.deepEqual(open(cash.balance), [1400000, 2450000, 2350000, 2170000, 2200000]);
  assert.deepEqual(cash.accounts.map(account => [account.id, account.balance, account.asOf]), [["A", 1370000, "2026-04-10"], ["B", 830000, "2026-05-06"], ["C", null, "2026-04-02"]]);
  assert.deepEqual(cash.accounts[0], { id: "A", bank: "국민은행", name: "운영", last4: "1111", balance: 1370000, asOf: "2026-04-10" });
  assert.equal(cash.balance[4], cash.accounts.reduce((sum, account) => sum + (account.balance ?? 0), 0), "the latest month end is the sum of the account cards");
});

test("아직 오지 않은 달은 null; a past year is full and starts from the opening balances; a future year is empty", () => {
  for (const values of [cash.inflow, cash.outflow, cash.net, cash.balance]) {
    assert.equal(values.length, 12);
    assert.ok(values.slice(5).every(value => value === null));
  }
  assert.equal(cash.open, 5);
  const last = cashOf(data, 2025, TODAY);
  assert.deepEqual([last.open, last.inflow[11], last.balance[0], last.balance[10], last.balance[11]], [12, 200000, 1500000, 1500000, 1700000]);
  assert.deepEqual(last.accounts, cash.accounts, "account cards always show the balance now");
  const next = cashOf(data, 2027, TODAY);
  assert.ok([...next.inflow, ...next.balance].every(value => value === null));
});

test("내역: the rows behind a cell add up to the cell and never include transfers or closed accounts", () => {
  for (const key of ["inflow", "outflow", "net"]) for (let month = 1; month <= 5; month += 1) {
    const rows = cashRows(data, 2026, key, month);
    assert.equal(rows.reduce((sum, entry) => sum + entry.amount, 0), cash[key][month - 1], `${key} ${month}월`);
    assert.ok(rows.every(entry => !/통장으로|통장에서|직접 분류한 이체|닫은 통장/.test(entry.title)));
  }
  assert.deepEqual(cashRows(data, 2026, "net", 4), [
    { line: "net", date: "2026-04-10", category: "급여", title: "급여", kind: "출금", amount: -250000 },
    { line: "net", date: "2026-04-10", category: "미분류", title: "환불 입금", kind: "입금", amount: 70000 },
    { line: "net", date: "2026-04-02", category: "미분류", title: "잔액 없는 입금", kind: "입금", amount: 50000 },
  ]);
  assert.deepEqual(cashRows(data, 2026, "outflow", 4).map(entry => entry.amount), [250000]);
});

test("시작 전 상태 and the 연습용 ledger", () => {
  assert.equal(cashOf({}, 2026, TODAY).empty, true);
  assert.equal(cashOf({ bank_accounts: data.bank_accounts, bank_transactions: [] }, 2026, TODAY).empty, true);
  assert.equal(cashOf({}, 2026, TODAY).balance[0], null, "no account: the balance is unknown, not zero");
  assert.equal(cash.empty, false);
  const demo = pnlDemoData(TODAY), demoCash = cashOf(demo, 2026, TODAY);
  assert.equal(demoCash.empty, false);
  assert.equal(demoCash.accounts.length, 2);
  assert.ok(demoCash.accounts.every(account => account.balance > 0 && account.asOf));
  assert.ok(open(demoCash.balance).every(value => value > 0) && open(demoCash.inflow).some(value => value > 0) && open(demoCash.outflow).some(value => value > 0));
  // Every demo row carries the bank's balance, and it agrees with opening balance + movements.
  const plain = { ...demo, bank_transactions: demo.bank_transactions.map(entry => ({ ...entry, balance_after: null })) };
  assert.deepEqual(cashOf(plain, 2026, TODAY).balance, demoCash.balance);
  assert.ok(demo.bank_transactions.every(entry => Number.isInteger(entry.balance_after)));
});
