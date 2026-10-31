import assert from "node:assert/strict";
import test from "node:test";
import { asideLedgerInstruction, asideLedgerPeriod } from "../lib/finance/upload-dialog.mjs";

// 대표 결정 2026-10-31 (95e0d539): bank and card history come in through Aside and the same import, not a paid collector.
test("the period starts at the last imported day, or the 1st of last month when nothing is in yet", () => {
  assert.deepEqual(asideLedgerPeriod([{ date: "2026-10-03" }, { date: "2026-10-20" }], "2026-10-31"), { from: "2026-10-20", to: "2026-10-31" });
  assert.deepEqual(asideLedgerPeriod([], "2026-10-31"), { from: "2026-09-01", to: "2026-10-31" });
  assert.deepEqual(asideLedgerPeriod([], "2027-01-05"), { from: "2026-12-01", to: "2027-01-05" });
});

test("instructions name the account, the period and the OS import, and never ask for sign-in details", () => {
  const bank = asideLedgerInstruction("bank", { from: "2026-10-20", to: "2026-10-31", account: { bank: "KB국민은행", name: "주거래", last: "1234" } });
  for (const part of ["KB국민은행 인터넷뱅킹", "주거래 ••1234", "2026-10-20 ~ 2026-10-31", "「통장 내역 올리기」", "거래일·적요", "묻거나 입력하지 마세요"]) assert.ok(bank.includes(part), part);
  const cards = asideLedgerInstruction("cards", { from: "2026-09-01", to: "2026-10-31" });
  for (const part of ["국민카드", "취소된 건도", "「카드 내역 올리기」", "카드 끝 4자리", "승인번호", "카드 이름·사용자를 담당자가", "CVC"]) assert.ok(cards.includes(part), part);
  assert.doesNotMatch(cards, /통장/);
});

test("the import drawer offers the Aside button and copies the chosen account's instruction", async () => {
  const { createImportFlow } = await import("../lib/finance/upload-dialog.mjs");
  const elements = { importAccount: { value: "a2" }, importNote: { textContent: "" } };
  let html = "", copied = "";
  const flow = createImportFlow({
    root: { querySelector: selector => elements[selector.slice(1)] ?? null, querySelectorAll: () => [] },
    esc: value => String(value), drawer: (title, sub, body) => { html = body; }, amount: String, connected: true,
    accounts: () => [{ id: "a1", bank: "KB국민은행", name: "주거래", last: "1111" }, { id: "a2", bank: "신한은행", name: "연구비", last: "2222" }],
    bank: () => [{ acct: "a1", date: "2026-10-30" }, { acct: "a2", date: "2026-10-12" }], cards: () => [], cardRegistry: () => [], selectedAccount: () => "all",
  });
  const clipboard = { writeText: async text => { copied = text; } };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true });
  flow.open("bank");
  assert.match(html, /data-act="ledgerAside"/);
  assert.equal(await flow.action("ledgerAside"), true);
  assert.ok(copied.includes("신한은행 인터넷뱅킹") && copied.includes("연구비 ••2222") && copied.includes("2026-10-12 ~ "), copied.slice(0, 200));
  assert.match(elements.importNote.textContent, /복사했어요/);
});
