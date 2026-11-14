import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { asideAllInstruction, asideLedgerInstruction, asideLedgerPeriod } from "../lib/finance/upload-dialog.mjs";
import { asideHometaxInstruction } from "../lib/finance/tax-invoices.ts";

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

test("홈택스 매입 has its own instruction: the 매입 list, as downloaded, into 부가세 신고 참고 자료 under 회사 전체", () => {
  const purchase = asideHometaxInstruction("2026-10-01", "2026-11-14", "purchase");
  for (const part of ["[홈택스 매입 계산서 → 브랜디 OS 올리기]", "「매입」을 고르고, 작성일자 2026-10-01 ~ 2026-11-14", "그대로 씁니다", "부가세 신고 참고 자료", "「회사 전체」", "「홈택스 매입 엑셀 올리기」", "묻거나 입력하지 마세요", "담당자가 「저장」을 누르게 합니다"]) assert.ok(purchase.includes(part), part);
  assert.doesNotMatch(purchase, /매출/);
  const sales = asideHometaxInstruction("2026-10-01", "2026-11-14");
  for (const part of ["[홈택스 매출 계산서 → 브랜디 OS 올리기]", "「매출」을 고르고", "매출내역 › 세금계산서(홈택스)", "「홈택스 엑셀 올리기」"]) assert.ok(sales.includes(part), part);
  assert.doesNotMatch(sales, /부가세 신고 참고 자료/);
  assert.match(readFileSync(new URL("../components/finance/purchase-invoice-panel.tsx", import.meta.url), "utf8"), /Aside에 맡기기 \(지침 복사\)/);
});

test("한 번에 맡기기: 홈택스 매출 · 매입, every 통장 and the cards in one paste, each with its own period and the same rules", () => {
  const accounts = [{ id: "a1", bank: "KB국민은행", name: "주거래", last: "1111" }, { id: "a2", bank: "신한은행", name: "연구비", last: "2222" }];
  const text = asideAllInstruction({ today: "2026-11-14", accounts, bank: [{ acct: "a1", date: "2026-11-10" }, { acct: "a1", date: "2026-10-02" }], cards: [{ date: "2026-07-31" }] });
  const order = ["── 1 / 5 ──", "[홈택스 매출 계산서", "── 2 / 5 ──", "[홈택스 매입 계산서", "── 3 / 5 ──", "주거래 ••1111", "── 4 / 5 ──", "연구비 ••2222", "── 5 / 5 ──", "[카드 이용내역"].map(part => text.indexOf(part));
  assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), `the five parts come in order: ${order}`);
  assert.equal(text.split("작성일자 2026-10-01 ~ 2026-11-14").length - 1, 2, "홈택스: the 1st of last month to today, for 매출 and 매입");
  for (const part of ["2026-11-10 ~ 2026-11-14", "2026-10-01 ~ 2026-11-14", "2026-07-31 ~ 2026-11-14"]) assert.ok(text.includes(part), `통장 with history · 통장 without · 카드: ${part}`);
  for (const part of ["아래 5가지를 위에서부터 차례로", "로그인은 담당자가 직접", "그 자리에서 멈추고", "저장(가져오기)은 담당자가 누릅니다", "「올린 건수 · 건너뛴 건수 · 오류 건수」", "「승인내역」은 해외 결제가 달러로만"]) assert.ok(text.includes(part), part);
  assert.doesNotMatch(text, /등록된 통장이 없어/);
  // Every part keeps its own "never ask for sign-in details" line.
  assert.equal(text.split("묻거나 입력하지 마세요").length - 1, 5);

  const none = asideAllInstruction({ today: "2026-11-14" });
  assert.match(none, /아래 3가지를/);
  assert.match(none, /등록된 통장이 없어 통장 내역은 이번에 건너뜁니다/);
  assert.doesNotMatch(none, /인터넷뱅킹/);
  assert.match(none, /2026-10-01 ~ 2026-11-14 로 정하고 조회|2026-10-01 ~ 2026-11-14/);
});

test("개요 offers 한 번에 맡기기 to finance staff only, and it only copies text", () => {
  const source = readFileSync(new URL("../lib/finance/workspace.mjs", import.meta.url), "utf8");
  assert.match(source, /\$\{STAFF \? "" : '<button class="secondary-button compact" data-act="asideall"[^']*>Aside에 한 번에 맡기기 \(지침 복사\)<\/button>'\}/);
  const start = source.indexOf("asideall: async () => {"), action = source.slice(start, source.indexOf("\n      },", start));
  assert.ok(start > 0);
  assert.match(action, /asideAllInstruction\(\{ today: [^}]*accounts: DB\.accounts, bank: BANK, cards: CR \}\)/);
  assert.match(action, /navigator\.clipboard\.writeText\(text\)/);
  assert.doesNotMatch(action, /save\(|importRows|fetch\(/);
});
