import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as domain from "../lib/finance/domain.mjs";
import * as taxInvoices from "../lib/finance/tax-invoices.ts";
import * as vat from "../lib/finance/vat.ts";
import * as payable from "../lib/finance/vat-payable.ts";

const { parseHometaxRows } = taxInvoices;
const { payableLabel, vatPayable, vatPurchase } = payable;

// ---- 홈택스 매입 목록 --------------------------------------------------------------------------------------------------

const header = ["작성일자", "승인번호", "발급일자", "전송일자", "공급자사업자등록번호", "종사업장번호", "상호", "대표자명", "주소", "공급받는자사업자등록번호", "종사업장번호", "상호", "대표자명", "주소", "합계금액", "공급가액", "세액", "전자세금계산서분류", "전자세금계산서종류", "발급유형", "비고", "영수/청구 구분", "공급자 이메일", "공급받는자 이메일1", "공급받는자 이메일2", "품목일자", "품목명"];
const line = (approval, written, total, supply, tax, options = {}) => [written, approval, written, written, options.supplierNo ?? "111-22-33333", "", options.supplier ?? "거래처", "대표", "주소", options.buyerNo ?? "123-45-67890", "", options.buyer ?? "브랜디액션", "", "", total, supply, tax, options.cls ?? "세금계산서", "일반", "", "", "청구", "", "us@b.c", "", written, options.item ?? "사무용품"];

test("홈택스 매입 목록: the supplier is the counterparty, the buyer is our business, and many suppliers are fine", () => {
  const parsed = parseHometaxRows([["전자세금계산서 목록조회"], [], header,
    line("P1", "2026-10-05", "1,100,000", "1,000,000", "100,000", { supplier: "광고 대행사", supplierNo: "111-22-33333" }),
    line("P2", "2026-10-09", "55,000", "50,000", "5,000", { supplier: "문구점", supplierNo: "444-55-66666" }),
    line("P3", "2026-10-20", "-11,000", "-10,000", "-1,000", { cls: "수정세금계산서" }),
    line("P4", "2026-10-21", "1,000", "900", "90")], "purchase");
  assert.equal(parsed.invoices.length, 3);
  assert.deepEqual(parsed.invoices[0], { approval_no: "P1", invoice_class: "tax", is_modified: false, kind_label: "일반", written_date: "2026-10-05", issued_date: "2026-10-05", sent_date: "2026-10-05",
    supplier_reg_no: "1112233333", supplier_name: "광고 대행사", buyer_reg_no: "1234567890", buyer_name: "브랜디액션", buyer_email: "us@b.c", item_summary: "사무용품", supply_amount: 1000000, tax_amount: 100000, total_amount: 1100000, receipt_type: "청구", memo: "" });
  assert.deepEqual(parsed.supplierRegNos, ["1112233333", "4445566666"]);
  assert.equal(parsed.invoices[2].is_modified, true);
  assert.deepEqual(parsed.errors.length, 1, "only the row whose amounts do not add up; two suppliers are not an error here");
  assert.match(parsed.errors[0], /P4.*합계와 달라요/);
});

test("a 매입 upload refuses mixed buyers (a 매출 list uploaded by mistake) and names the 매입 list when the file is wrong", () => {
  const mixed = parseHometaxRows([header, line("S1", "2026-10-01", 11, 10, 1, { buyerNo: "222-33-44444" }), line("S2", "2026-10-01", 11, 10, 1, { buyerNo: "999-99-99999" })], "purchase");
  assert.match(mixed.errors.at(-1), /공급받는자 사업자번호가 2개 섞여 있어요\. 매출 목록이 아닌지/);
  assert.match(parseHometaxRows([["날짜", "금액"]], "purchase").errors[0], /매입 목록을 올려 주세요/);
});

test("sales parsing is unchanged: the default direction is 매출 and still refuses mixed suppliers, not mixed buyers", () => {
  const rows = [header, line("S1", "2026-10-01", 11, 10, 1, { buyerNo: "222-33-44444" }), line("S2", "2026-10-01", 11, 10, 1, { buyerNo: "999-99-99999" })];
  assert.deepEqual(parseHometaxRows(rows), parseHometaxRows(rows, "sales"));
  assert.deepEqual(parseHometaxRows(rows).errors, [], "two buyers are normal for sales");
  const suppliers = parseHometaxRows([header, line("S1", "2026-10-01", 11, 10, 1), line("S2", "2026-10-01", 11, 10, 1, { supplierNo: "999-99-99999" })]);
  assert.deepEqual(suppliers.errors, ["공급자 사업자번호가 2개 섞여 있어요. 사업자별로 따로 내려받아 올려 주세요."]);
  assert.match(parseHometaxRows([["날짜", "금액"]]).errors[0], /매출 목록을 올려 주세요/);
});

// ---- 매입세액 · 예상 납부세액 -------------------------------------------------------------------------------------------

const invoice = (biz, written, tax, extra = {}) => ({ biz, invoice_class: "tax", written_date: written, tax_amount: tax, ...extra });
const card = (n, used, amount, extra = {}) => ({ id: `c${n}`, version: 1, archived_at: null, used_date: used, merchant: `가맹점 ${n}`, amount_krw: amount, canceled: false, manual_biz: "edu", manual_vat: "공제 예상", ...extra });
const period = { biz: "edu", from: "2026-10-01", to: "2026-12-31" };

test("매입세액: taxable purchase invoices of the business by 작성일자, 수정 계산서 subtracting", () => {
  const result = vatPurchase({ ...period, cards: [], rules: [], invoices: [
    invoice("edu", "2026-10-01", 100000), invoice("edu", "2026-12-31", 5000), invoice("edu", "2026-11-10", -1000),
    invoice("edu", "2026-09-30", 999), invoice("edu", "2027-01-01", 999), invoice("myin", "2026-10-05", 999),
    invoice("edu", "2026-10-05", 0, { invoice_class: "exempt" }), invoice("edu", "2026-10-06", 999, { archived_at: "2026-11-01T00:00:00Z" }),
  ] });
  assert.deepEqual(result.invoice, { count: 3, tax: 104000 });
  assert.deepEqual(result.card, { count: 0, amount: 0, tax: 0 });
  assert.equal(result.inputTax, 104000);
});

test("card 매입세액: round(합계 / 11) only for 공제 예상 of this business by 사용일; cancelled, archived and other labels add 0", () => {
  const rules = [{ id: "r1", version: 1, archived_at: null, keywords: ["광고"], category: "광고선전비", biz: "edu", vat_type: "공제 예상", memo_template: "", enabled: true, sort_order: 1 }];
  const result = vatPurchase({ ...period, invoices: [], rules, cards: [
    card(1, "2026-10-02", 110000), card(2, "2026-11-03", 10000),
    card(3, "2026-10-04", 55000, { manual_biz: null, manual_vat: null, merchant: "메타 광고" }),
    card(4, "2026-10-05", 220000, { canceled: true }), card(5, "2026-10-06", 220000, { archived_at: "2026-10-07T00:00:00Z" }),
    card(6, "2026-10-07", 330000, { manual_vat: "불공제 예상" }), card(7, "2026-10-08", 440000, { manual_vat: "해당 없음(면세)" }), card(8, "2026-10-09", 550000, { manual_vat: "해당 없음(해외)" }),
    card(9, "2026-10-10", 66000, { manual_vat: "판단 필요" }),
    card(10, "2026-10-11", 77000, { manual_biz: null, manual_vat: null }),
    card(11, "2026-10-12", 88000, { manual_biz: "myin", manual_vat: "판단 필요" }), card(12, "2026-10-13", 99000, { manual_biz: "myin" }),
    card(13, "2026-10-14", 22000, { manual_biz: "common" }),
    card(14, "2026-09-30", 110000), card(15, "2027-01-01", 110000),
  ] });
  assert.deepEqual(result.card, { count: 3, amount: 175000, tax: 10000 + 909 + 5000 }, "10,000원 → 909원; the rule labels the unlabelled 메타 광고 use");
  assert.equal(result.inputTax, 15909);
  assert.deepEqual(result.undecided, { count: 2, amount: 66000 + 77000 }, "this business's and unassigned 판단 필요 uses; another business's is not ours to decide");
  assert.deepEqual(result.unassigned, { count: 1, amount: 22000 }, "공통 공제 예상 is reported, not added");
});

test("회사 전체 매입세액: every business's invoices and every 공제 예상 card use count, shared ones included — nothing is left unassigned", () => {
  const input = { from: period.from, to: period.to, rules: [],
    invoices: [invoice("ba", "2026-10-01", 100000), invoice("edu", "2026-10-02", 20000), invoice("myin", "2026-11-03", 3000), invoice("ba", "2026-09-30", 999), invoice("ba", "2026-10-04", 999, { archived_at: "2026-11-01T00:00:00Z" })],
    cards: [card(1, "2026-10-02", 110000), card(2, "2026-10-03", 22000, { manual_biz: "myin" }), card(3, "2026-10-04", 33000, { manual_biz: "common" }), card(4, "2026-10-05", 44000, { manual_biz: null }),
      card(5, "2026-10-06", 55000, { manual_biz: "hm", manual_vat: "판단 필요" }), card(6, "2026-10-07", 66000, { manual_vat: "불공제 예상" })] };
  const company = vatPurchase({ ...input, biz: "all" });
  assert.deepEqual(company.invoice, { count: 3, tax: 123000 });
  assert.deepEqual(company.card, { count: 4, amount: 209000, tax: 10000 + 2000 + 3000 + 4000 });
  assert.equal(company.inputTax, 142000);
  assert.deepEqual(company.undecided, { count: 1, amount: 55000 });
  assert.deepEqual(company.unassigned, { count: 0, amount: 0 });
  const edu = vatPurchase({ ...input, biz: "edu" });
  assert.deepEqual([edu.invoice.tax, edu.card.tax, edu.unassigned], [20000, 10000, { count: 2, amount: 77000 }], "one business alone still leaves shared uses out");
});

test("예상 납부세액 = 매출세액 − 매입세액; below zero is a refund", () => {
  const purchase = vatPurchase({ ...period, invoices: [invoice("edu", "2026-10-01", 300000)], cards: [card(1, "2026-10-02", 110000)], rules: [] });
  assert.equal(purchase.inputTax, 310000);
  assert.equal(vatPayable(1000000, purchase.inputTax), 690000);
  assert.equal(payableLabel(690000), "납부 대상");
  assert.equal(payableLabel(0), "납부 대상");
  assert.equal(vatPayable(200000, purchase.inputTax), -110000);
  assert.equal(payableLabel(-110000), "환급 대상");
});

// ---- 서버: 표가 아직 없을 때 · 입력 검사 -------------------------------------------------------------------------------

class ApiError extends Error { constructor(status, code, message) { super(message); Object.assign(this, { status, code }); } }
// Values built inside the vm context carry that context's prototypes; compare their plain copies.
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, Response, URL, crypto: globalThis.crypto, console: { error() {} }, require(name) {
    if (name === "zod") return zod;
    if (name === "@/lib/http") return { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) };
    assert.ok(name in imports, `unmocked import ${name}`);
    return imports[name];
  } });
  return exports;
}
const schema = load("lib/finance/schema.ts");
const finance = load("lib/server/finance.ts", { "./auth": {}, "@/lib/finance/schema": schema, "@/lib/finance/domain.mjs": domain, "@/lib/finance/access": load("lib/finance/access.ts") });
const tax = load("lib/server/finance-tax.ts", { "./finance": finance, "@/lib/finance/tax-invoices": taxInvoices, "@/lib/finance/vat": vat });
const reference = { period: { kind: "quarter", key: "2026-Q4", label: "2026년 2기 확정 (10~12월)", from: "2026-10-01", to: "2026-12-31" }, lines: [{ evidence: "card", tax: 700000 }, { evidence: "tax_invoice", tax: 300000 }], rows: [{ ref: "r" }], review: 2 };
const purchaseApi = load("lib/server/finance-purchase.ts", { "./finance": finance, "./finance-tax": { ...tax, vatReference: async () => structuredClone(reference) }, "@/lib/finance/vat": vat, "@/lib/finance/vat-payable": payable });

/** A caller's Supabase client: `tables[name]` is its rows or `{ error }`; every read and write is recorded. */
function actorFor(tables) {
  const calls = [];
  const actor = { id: "00000000-0000-4000-8000-000000000900", supabase: { from(table) {
    const state = tables[table], call = { table, filters: [] };
    calls.push(call);
    const answer = () => state?.error ? { data: null, error: state.error } : { data: state ?? [], error: null };
    const builder = {
      select(columns) { call.select = columns; return builder; },
      is(...args) { call.filters.push(["is", ...args]); return builder; }, eq(...args) { call.filters.push(["eq", ...args]); return builder; },
      gte(...args) { call.filters.push(["gte", ...args]); return builder; }, lte(...args) { call.filters.push(["lte", ...args]); return builder; },
      in(...args) { call.filters.push(["in", ...args]); return builder; }, order() { return builder; },
      range(from, to) { const result = answer(); return Promise.resolve(result.data ? { ...result, data: result.data.slice(from, to + 1) } : result); },
      upsert(rows, options) { call.upsert = { rows, options }; return Promise.resolve({ error: state?.error ?? null }); },
      then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); },
    };
    return builder;
  } } };
  return { actor, calls };
}
const TABLE = "os_fin_purchase_invoices";
const MISSING = [
  { code: "PGRST205", message: "Could not find the table 'public.os_fin_purchase_invoices' in the schema cache" },
  { code: "42P01", message: 'relation "public.os_fin_purchase_invoices" does not exist' },
  { message: "Could not find the table 'public.os_fin_purchase_invoices' in the schema cache" },
];

test("부가세 참고 자료 keeps working before the purchase table exists: purchase is unavailable, the sales fields are untouched", async () => {
  for (const error of MISSING) {
    const { actor, calls } = actorFor({ [TABLE]: { error } });
    const result = await purchaseApi.vatWithPurchase(actor, { period: "2026-Q4", biz: "edu" });
    assert.deepEqual(plain(result), { ...reference, salesTax: 1000000, purchase: { available: false }, payable: null });
    assert.deepEqual(calls.map(call => call.table), [TABLE], "no card read when there is nothing to add it to");
    await assert.rejects(purchaseApi.listPurchaseInvoices(actor, { from: "2026-10-01", to: "2026-10-31", biz: "edu" }), error => error.status === 503 && error.code === "FINANCE_PURCHASE_NOT_READY" && /아직 준비되지 않았어요/.test(error.message));
    await assert.rejects(purchaseApi.importPurchaseInvoices(actor, { action: "import", biz: "edu", invoices: [{ approval_no: "P1" }] }), error => error.code === "FINANCE_PURCHASE_NOT_READY");
  }
});

test("any other database error is not mistaken for a missing table", async () => {
  const { actor } = actorFor({ [TABLE]: { error: { code: "42501", message: "permission denied for table os_fin_purchase_invoices" } } });
  await assert.rejects(purchaseApi.vatWithPurchase(actor, { period: "2026-Q4", biz: "edu" }), error => error.code === "FINANCE_SAVE_FAILED" && !/permission denied/.test(error.message));
});

test("with the table: 매입세액 from the period's invoices and 공제 예상 cards, payable = the page's tax total − 매입세액", async () => {
  const { actor, calls } = actorFor({
    [TABLE]: [invoice("edu", "2026-10-05", 250000), invoice("edu", "2026-11-05", 50000)],
    os_fin_card_transactions: [card(1, "2026-10-02", 110000), card(2, "2026-10-03", 33000, { manual_biz: null, manual_vat: null })],
    os_fin_card_rules: [],
  });
  const result = plain(await purchaseApi.vatWithPurchase(actor, { period: "2026-Q4", biz: "edu" }));
  assert.deepEqual(result.purchase, { available: true, invoice: { count: 2, tax: 300000 }, card: { count: 1, amount: 110000, tax: 10000 }, inputTax: 310000, undecided: { count: 1, amount: 33000 }, unassigned: { count: 0, amount: 0 } });
  assert.deepEqual([result.salesTax, result.payable], [1000000, 690000]);
  assert.deepEqual([result.period, result.lines, result.rows, result.review], [reference.period, reference.lines, reference.rows, reference.review], "existing fields unchanged");
  const read = calls.find(call => call.table === TABLE);
  assert.deepEqual(read.filters, [["is", "archived_at", null], ["gte", "written_date", "2026-10-01"], ["lte", "written_date", "2026-12-31"], ["eq", "biz", "edu"]]);
  const cards = calls.find(call => call.table === "os_fin_card_transactions");
  assert.deepEqual(cards.filters, [["is", "archived_at", null], ["eq", "canceled", false], ["gte", "used_date", "2026-10-01"], ["lte", "used_date", "2026-12-31"]]);
});

test("회사 전체 on the server: 「all」 is a valid 사업자, and the purchase read drops the business filter", async () => {
  assert.equal(tax.vatQuery.safeParse({ period: "2026-Q4", biz: "all" }).success, true);
  assert.equal(tax.vatQuery.safeParse({ period: "2026-Q4", biz: "everyone" }).success, false);
  const { actor, calls } = actorFor({
    [TABLE]: [invoice("ba", "2026-10-05", 250000), invoice("edu", "2026-11-05", 50000)],
    os_fin_card_transactions: [card(1, "2026-10-02", 110000), card(2, "2026-10-03", 33000, { manual_biz: "common" })],
    os_fin_card_rules: [],
  });
  const result = plain(await purchaseApi.vatWithPurchase(actor, { period: "2026-Q4", biz: "all" }));
  assert.deepEqual(result.purchase, { available: true, invoice: { count: 2, tax: 300000 }, card: { count: 2, amount: 143000, tax: 13000 }, inputTax: 313000, undecided: { count: 0, amount: 0 }, unassigned: { count: 0, amount: 0 } });
  assert.equal(result.payable, 1000000 - 313000);
  assert.deepEqual(calls.find(call => call.table === TABLE).filters, [["is", "archived_at", null], ["gte", "written_date", "2026-10-01"], ["lte", "written_date", "2026-12-31"]]);
  // Saving still needs one real business: a file uploaded from 회사 전체 goes in as 브랜디액션.
  assert.equal(purchaseApi.purchaseImportSchema.safeParse({ action: "import", biz: "all", invoices: [good("P1")] }).success, false);
  assert.match(readFileSync(new URL("../components/finance/purchase-invoice-panel.tsx", import.meta.url), "utf8"), /const saveAs: Biz = biz === COMPANY \? "ba" : biz;/);
});

const good = (approval, extra = {}) => ({ approval_no: approval, invoice_class: "tax", is_modified: false, kind_label: "일반", written_date: "2026-10-05", issued_date: null, sent_date: null, supplier_reg_no: "1112233333", supplier_name: "거래처",
  buyer_reg_no: "1234567890", buyer_name: "브랜디액션", buyer_email: "", item_summary: "", supply_amount: 1000, tax_amount: 100, total_amount: 1100, receipt_type: "", memo: "", ...extra });
function route(actor, denied = false) {
  return load("app/api/v1/finance/purchase-invoices/route.ts", { "next/server": { NextResponse: Response }, "@/lib/server/finance-tax": tax, "@/lib/server/finance-purchase": purchaseApi,
    "@/lib/server/finance": { ...finance, financeActor: async () => { if (denied) throw new ApiError(403, "FINANCE_FORBIDDEN", "재무관리 권한이 없습니다."); return actor; } } });
}
const get = query => new Request(`https://example.invalid/api/v1/finance/purchase-invoices?${query}`);
const post = body => new Request("https://example.invalid/api/v1/finance/purchase-invoices", { method: "POST", body: JSON.stringify(body) });

test("purchase API: finance access first, then input checks, and nothing reaches the database on a bad request", async () => {
  const { actor, calls } = actorFor({ [TABLE]: [] });
  assert.equal((await route(actor, true).GET(get("from=2026-10-01&to=2026-10-31"))).status, 403);
  assert.equal((await route(actor, true).POST(post({ action: "import", biz: "edu", invoices: [good("P1")] }))).status, 403);
  const api = route(actor);
  for (const query of ["", "from=2026-10-01", "from=2026-10-31&to=2026-10-01", "from=20261001&to=2026-10-31", "from=2026-10-01&to=2026-10-31&biz=all"]) {
    const response = await api.GET(get(query));
    assert.deepEqual([response.status, (await response.json()).error.code], [400, "PURCHASE_INVOICE_QUERY_INVALID"], query);
  }
  const bad = [
    { action: "import", biz: "edu", invoices: [] },
    { action: "import", biz: "all", invoices: [good("P1")] },
    { action: "delete", biz: "edu", invoices: [good("P1")] },
    { action: "import", biz: "edu", invoices: [good("P1", { total_amount: 1200 })] },
    { action: "import", biz: "edu", invoices: [good("P1", { invoice_class: "exempt" })] },
    { action: "import", biz: "edu", invoices: [good("P1", { supply_amount: 1000.5, total_amount: 1100.5 })] },
    { action: "import", biz: "edu", invoices: [good("P1", { created_by: "someone" })] },
    { action: "import", biz: "edu", invoices: [good("P1"), good("P2", { buyer_reg_no: "9999999999" })] },
    { action: "import", biz: "edu", invoices: Array.from({ length: 5001 }, (_, index) => good(`P${index}`)) },
    { action: "import", biz: "edu", invoices: [good("P1")], source: "popbill" },
  ];
  for (const body of bad) {
    const response = await api.POST(post(body));
    assert.deepEqual([response.status, (await response.json()).error.code], [400, "PURCHASE_INVOICE_IMPORT_INVALID"], JSON.stringify(body).slice(0, 120));
  }
  assert.equal(calls.length, 0);
  const missing = await route(actorFor({ [TABLE]: { error: MISSING[0] } }).actor).GET(get("from=2026-10-01&to=2026-10-31&biz=edu"));
  assert.deepEqual([missing.status, (await missing.json()).error.code], [503, "FINANCE_PURCHASE_NOT_READY"]);
});

test("purchase import: known approval numbers are skipped, new ones go in as ignore-duplicate upserts, another business's is refused", async () => {
  const { actor, calls } = actorFor({ [TABLE]: [{ approval_no: "P1", biz: "edu" }] });
  const response = await route(actor).POST(post({ action: "import", biz: "edu", invoices: [good("P1"), good("P2"), good("P3")] }));
  const body = await response.json();
  assert.deepEqual([response.status, body.saved, body.skipped], [200, 2, 1]);
  assert.match(body.batch, /^[0-9a-f-]{36}$/);
  const write = plain(calls.find(call => call.upsert).upsert);
  assert.deepEqual(write.options, { onConflict: "approval_no", ignoreDuplicates: true });
  assert.deepEqual(write.rows.map(row => [row.approval_no, row.biz, row.source, row.import_batch_id, row.created_by, row.updated_by]), ["P2", "P3"].map(approval => [approval, "edu", "hometax_excel", body.batch, actor.id, actor.id]));
  const other = await route(actor).POST(post({ action: "import", biz: "myin", invoices: [good("P1")] }));
  assert.deepEqual([other.status, (await other.json()).error.code], [409, "PURCHASE_INVOICE_OTHER_BIZ"]);
  const listed = await route(actor).GET(get("from=2026-10-01&to=2026-10-31&biz=edu"));
  assert.deepEqual([listed.status, listed.headers.get("cache-control"), (await listed.json()).invoices.length], [200, "private, no-store", 1]);
});

// ---- 마이그레이션 · 화면 ------------------------------------------------------------------------------------------------

test("the purchase table mirrors os_fin_tax_invoices: same columns, checks, grants and policies, nothing else touched", () => {
  const sales = readFileSync("supabase/migrations/20261029120000_finance_tax_invoices.sql", "utf8");
  const purchase = readFileSync("supabase/migrations/20261113100000_finance_purchase_invoices.sql", "utf8");
  const table = (sql, name) => sql.slice(sql.indexOf(`create table public.os_fin_${name} (`), sql.indexOf(`where archived_at is null;`, sql.indexOf(`create table public.os_fin_${name} (`))).replaceAll(name, "X");
  assert.equal(table(purchase, "purchase_invoices"), table(sales, "tax_invoices"));
  const policies = sql => sql.split("\n").filter(text => text.trim().startsWith("execute format("));
  assert.deepEqual(policies(purchase), policies(sales));
  assert.equal(policies(purchase).length, 7);
  assert.match(purchase, /foreach t in array array\['purchase_invoices'\] loop/);
  const statements = purchase.split("\n").filter(text => !text.startsWith("--")).join("\n");
  assert.ok(!/\bdelete\b|drop |alter table public\.os_fin_(?!%I)|create or replace function|insert into/i.test(statements), "additive only: no delete grant, no change to an existing object, no rows");
  assert.match(purchase.split("\n").slice(0, 6).join("\n"), /Additive[\s\S]*REVIEW ONLY/);
  assert.match(readFileSync("supabase/rollback/20261113100000_finance_purchase_invoices.down.sql", "utf8"), /drop table if exists public\.os_fin_purchase_invoices;/);
  const entry = JSON.parse(readFileSync("supabase/migration-baseline.json", "utf8")).forwardMigrations.at(-1);
  assert.deepEqual([entry.file, entry.requiresApproval, entry.productionApprovedAt, entry.appliedEnvironments], ["20261113100000_finance_purchase_invoices.sql", true, "2026-11-13", ["development", "production"]]);
});

test("the purchase routes stay behind finance access and the 부가세 page shows the assumptions it makes", () => {
  for (const file of ["app/api/v1/finance/purchase-invoices/route.ts", "app/api/v1/finance/vat/route.ts"]) assert.match(readFileSync(file, "utf8"), /await financeActor\(request\)/, file);
  const purchaseRoute = readFileSync("app/api/v1/finance/purchase-invoices/route.ts", "utf8");
  assert.equal(purchaseRoute.match(/apiErrorResponse\(financeError\(error\)\)/g).length, 2);
  assert.ok(!/console\./.test(purchaseRoute + readFileSync("lib/server/finance-purchase.ts", "utf8")), "no payload logging");
  const page = readFileSync("components/finance/vat-reference.tsx", "utf8");
  for (const text of ["예상 납부세액", "매출 합계 세액 (A)", "매입 합계 세액 (B)", "전자세금계산서 (매입)", "신용카드 (공제 예상)", "예상 납부세액 (A) − (B)", "참고용", "예정고지", "1/11", 'href="/finance/cards"']) assert.ok(page.includes(text), text);
  assert.match(readFileSync("components/finance/purchase-invoice-panel.tsx", "utf8"), /매입 세금계산서 저장 공간이 아직 준비되지 않았어요\. 관리자 승인 후 사용할 수 있어요\./);
  // 연습용 화면 draws the summary from a fixture and never calls the API.
  assert.match(readFileSync("components/finance/finance-workspace.tsx", "utf8"), /demo \? <VatReferenceDemo \/> : <VatReference token=\{accessToken\} \/>/);
  const demo = page.slice(page.indexOf("export function VatReferenceDemo"), page.indexOf("export function VatReference("));
  assert.ok(demo.includes("VatPayableSummary") && !/apiRequest|fetch\(/.test(demo));
});

// ---- 올린 파일 → 표 ---------------------------------------------------------------------------------------------------

test("홈택스 목록 .xlsx · .csv: the shared reader hands the parser every row, the title row included", async () => {
  const { readImportRows } = await import("../lib/finance/import-file.mjs");
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("목록");
  for (const row of [["전자세금계산서 목록조회"], [], header, line("X1", "2026-11-10", 110000, 100000, 10000), line("X2", "2026-11-11", 55000, 50000, 5000, { supplierNo: "222-33-44444" })]) sheet.addRow(row);
  const fromXlsx = parseHometaxRows(await readImportRows(new File([await book.xlsx.writeBuffer()], "매입.xlsx")), "purchase");
  assert.deepEqual([fromXlsx.errors, fromXlsx.invoices.map(row => [row.approval_no, row.total_amount])], [[], [["X1", 110000], ["X2", 55000]]]);
  const csv = [header, line("C1", "2026-11-10", 110000, 100000, 10000)].map(row => row.join(",")).join("\n");
  const fromCsv = parseHometaxRows(await readImportRows(new File([csv], "매출.csv")));
  assert.deepEqual([fromCsv.errors, fromCsv.invoices.map(row => row.approval_no)], [[], ["C1"]]);
});
