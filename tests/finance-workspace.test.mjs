import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import ExcelJS from "exceljs";
import { createFinanceDemo } from "../lib/finance/workspace.mjs";
import {
  inferMapping,
  parseCsv,
  previewImport,
  readImportFile,
  importDate,
  checkXlsxZip,
} from "../lib/finance/import-file.mjs";
import { recurringCandidates } from "../lib/finance/recurring.mjs";

test("finance mock model preserves all reference monthly totals", () => {
  const model = createFinanceDemo();
  const expected = [-12051908, -7425948, 12970576, 343462];
  ["2026-07", "2026-08", "2026-09", "2026-10"].forEach((month, i) =>
    assert.equal(model.netOf(month).net, expected[i]),
  );
  const { inn, fixed, variable, labor, missing } = model.netOf("2026-09");
  assert.deepEqual(
    { inn, fixed, variable, labor, missing },
    {
      inn: 49875976,
      fixed: 2229150,
      variable: 19681250,
      labor: 14995000,
      missing: 0,
    },
  );
  assert.equal(model.netOf("2026-10").missing, 13);
});

test("manual actual updates propagate to the same overview/budget calculation", () => {
  const model = createFinanceDemo();
  model.state.budget.find((x) => x.id === "bi").actual["2026-09"] = 14000000;
  assert.equal(model.netOf("2026-09").net, 14470576);
  const other = createFinanceDemo();
  assert.equal(other.netOf("2026-09").net, 12970576, "isolated mount state");
});

test("research funds are excluded by default and account opt-out removes its costs", () => {
  const m = createFinanceDemo(),
    before = m.netOf("2026-07").net;
  m.state.netRnd = true;
  assert.equal(m.netOf("2026-07").net, before + 30000000);
  m.state.accounts.find((x) => x.id === "a2").incl = false;
  assert.equal(m.netOf("2026-09").labor, 1800000);
});

test("external revenue does not inherit hidden Toss business filters", () => {
  const m = createFinanceDemo();
  const before = m.extRows().map((x) => x.id);
  m.setBusiness("hm");
  assert.deepEqual(
    m.extRows().map((x) => x.id),
    before,
  );
  assert.equal(m.salesRows().length, 0);
});

test("closed months compare full prior month; current month compares elapsed days", () => {
  const m = createFinanceDemo();
  assert.deepEqual(m.prevRange(), ["2026-08-01", "2026-08-31"]);
  m.period.month = "2026-10";
  assert.deepEqual(m.prevRange(), ["2026-09-01", "2026-09-07"]);
  m.period.mode = "all";
  assert.equal(m.prevRange(), null);
});

test("manual classification and explicit blank memo survive rule reordering", () => {
  const m = createFinanceDemo(),
    row = m.cards.find((x) => x.merchant === "SUPABASE");
  m.state.ov[row.id] = { cat: null, biz: null, memo: "" };
  m.state.rules.reverse();
  assert.equal(m.cls(row).cat, null);
  assert.equal(m.cls(row).memo, "");
  assert.equal(m.crState(row), "미분류");
  m.state.ov[row.id] = {
    cat: "접대비",
    biz: "common",
    memo: "모의 회의",
    receipt: false,
  };
  assert.equal(m.crState(row), "영수증 필요");
  m.state.ov[row.id].receipt = true;
  assert.equal(m.crState(row), "완료");
});

test("payout issues remain explicit and transfers preserve the consolidated balance", () => {
  const m = createFinanceDemo();
  assert.equal(m.payouts.filter((p) => p.state === "금액 다름").length, 1);
  assert.equal(m.payouts.filter((p) => p.state === "미확인").length, 1);
  const transfers = m.bankRows().filter((x) => x.cat === "내 통장 간 이체");
  assert.equal(
    transfers.reduce((n, x) => n + x.in - x.out, 0),
    0,
  );
});

test("recurring suggestions detect five services without relying on seed flags", () => {
  const rows = createFinanceDemo().cards.map((x) => ({ ...x, rec: false }));
  assert.deepEqual(
    recurringCandidates(rows).map((x) => x.merchant),
    ["VERCEL INC.", "SUPABASE", "ANTHROPIC", "NOTION LABS", "GOOGLE WORKSPACE"],
  );
  const sporadic = [
    { merchant: "A", date: "2026-08-01", krw: 100 },
    { merchant: "A", date: "2026-09-25", krw: 100 },
  ];
  assert.equal(recurringCandidates(sporadic).length, 0);
});

const csv =
  '이용일자,카드번호,가맹점명,이용금액,승인번호\r\n2026-10-06,1234,"예시,상점","15,000",A1\r\n2026-10-06,1234,"예시,상점","15,000",A1\r\n2026-02-30,1234,오류,300,A2';
test("CSV mapping skips duplicate and invalid rows without silently changing amounts", () => {
  const table = parseCsv("\ufeff" + csv),
    map = inferMapping(table.headers, "cards");
  const p = previewImport(table, map, "cards", []);
  assert.equal(p.valid.length, 1);
  assert.equal(p.duplicates.length, 1);
  assert.equal(p.errors.length, 1);
  assert.equal(p.valid[0].merchant, "예시,상점");
  assert.equal(p.valid[0].krw, 15000);
  assert.equal(previewImport(table, map, "cards", p.valid).valid.length, 0);
  assert.throws(() => previewImport(table, {}, "cards", []), /필수 열/);
  assert.throws(() => parseCsv('a,b\n"broken'), /따옴표/);
  assert.equal(importDate("2026-02-30"), null);
  assert.equal(importDate("20261007"), "2026-10-07");
});

test("bank mapping rejects ambiguous directions and decimal won amounts", () => {
  const table = parseCsv(
    "거래일,적요,입금,출금\n2026-10-06,예시,1000,0\n2026-10-06,양쪽,1000,1000\n2026-10-06,소수,1.5,0",
  );
  const p = previewImport(
    table,
    inferMapping(table.headers, "bank"),
    "bank",
    [],
    "a1",
  );
  assert.equal(p.valid.length, 1);
  assert.equal(p.errors.length, 2);
});

test("XLSX reads locally, rejects formulas and unsupported/oversized files", async () => {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("예시");
  sheet.addRow(["거래일", "적요", "입금", "출금"]);
  sheet.addRow([new Date("2026-10-06T00:00:00Z"), "예시", 5000, 0]);
  sheet.addRow(["2026-10-06", "수식", { formula: "2+2", result: 4 }, 0]);
  const buffer = await book.xlsx.writeBuffer();
  const data = await readImportFile(new File([buffer], "example.xlsx"));
  const p = previewImport(
    data,
    inferMapping(data.headers, "bank"),
    "bank",
    [],
    "a1",
  );
  assert.equal(p.valid.length, 1);
  assert.equal(p.errors.length, 1);
  await assert.rejects(
    () => readImportFile({ size: 6 * 1024 * 1024, name: "big.csv" }),
    /5MB/,
  );
  await assert.rejects(
    () => readImportFile({ size: 100, name: "legacy.xls" }),
    /xlsx/,
  );
  assert.throws(() => checkXlsxZip(new ArrayBuffer(30)), /XLSX/);
});

test("finance UI gate is fail-closed and matches existing active/admin/finance policy", () => {
  const source = fs.readFileSync(
    new URL("../lib/finance/access.ts", import.meta.url),
    "utf8",
  );
  const compiled = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { module: compiled, exports: compiled.exports },
  );
  const can = compiled.exports.canAccessFinance;
  assert.equal(can(null), false);
  assert.equal(can({ role: "admin" }), false);
  assert.equal(can({ role: "admin", isActive: true }), true);
  assert.equal(
    can({ role: "member", isActive: true, financeAccess: true }),
    true,
  );
  assert.equal(
    can({ role: "admin", isActive: false, financeAccess: true }),
    false,
  );
  assert.equal(can({ role: "member", isActive: true }), false);
});

test("finance runtime has no API calls or persistent ledger storage", () => {
  const source = fs.readFileSync(
    new URL("../lib/finance/workspace.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\bfetch\s*\(|XMLHttpRequest|location\.hash|localStorage\.setItem\([^)]*JSON/,
  );
  assert.match(source, /finance\.hideAmounts/);
  const navigation = fs.readFileSync(
    new URL("../lib/navigation.ts", import.meta.url),
    "utf8",
  );
  for (const page of [
    "overview",
    "sales",
    "settlements",
    "bank",
    "cards",
    "recurring",
    "budget",
  ])
    assert.ok(navigation.includes("/finance/" + page));
});

test("settlement exports and tables share status filtering; empty budget starts at zero", () => {
  const m = createFinanceDemo();
  assert.equal(m.settlementRows("확인 필요").length, 1);
  m.period.mode = "all";
  assert.equal(m.settlementRows("확인 필요").length, 2);
  const original = m.state.budget;
  m.startBudgetDefaults();
  assert.equal(m.state.budget, original);
  m.state.budget = [];
  m.startBudgetDefaults();
  assert.equal(m.state.budget.length, 14);
  assert.ok(
    m.state.budget.every(
      (item) =>
        item.amount === 0 &&
        Object.keys(item.actual).length === 0 &&
        item.owner === "",
    ),
  );
});
