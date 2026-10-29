import assert from "node:assert/strict";
import test from "node:test";
import { hometaxDate, hometaxWon, matchDeposit, matchInvoices, parseHometaxRows, revenueBySource } from "../lib/finance/tax-invoices.ts";
import { paymentEvidence, splitVat, vatCsv, vatLines, vatPeriod, vatRows } from "../lib/finance/vat.ts";

const header = ["작성일자", "승인번호", "발급일자", "전송일자", "공급자사업자등록번호", "종사업장번호", "상호", "대표자명", "주소", "공급받는자사업자등록번호", "종사업장번호", "상호", "대표자명", "주소", "합계금액", "공급가액", "세액", "전자세금계산서분류", "전자세금계산서종류", "발급유형", "비고", "영수/청구 구분", "공급자 이메일", "공급받는자 이메일1", "공급받는자 이메일2", "품목일자", "품목명"];
const row = (approval, written, total, supply, tax, options = {}) => [written, approval, options.issued ?? written, written, "123-45-67890", "", "브랜디액션", "대표", "주소", options.buyerNo ?? "222-33-44444", "", options.buyer ?? "고객사", "", "", total, supply, tax, options.cls ?? "세금계산서", "일반", "", "", "청구", "", "a@b.c", "", written, options.item ?? "강의"];

test("홈택스 매출 목록: title lines skipped, items collapsed, 수정세금계산서 and bad rows reported", () => {
  const parsed = parseHometaxRows([["전자세금계산서 목록조회"], ["조회기간 2026-10-01 ~ 2026-10-31"], [], header,
    row("20261005-41000000-aaaa0001", "2026-10-05", "1,100,000", "1,000,000", "100,000", { item: "강의 A" }),
    row("20261005-41000000-aaaa0001", "2026-10-05", "1,100,000", "1,000,000", "100,000", { item: "강의 B" }),
    row("20261020-41000000-aaaa0002", "20261020", "-110,000", "-100,000", "-10,000", { cls: "수정세금계산서" }),
    row("20261021-41000000-aaaa0003", "2026.10.21", "1,000", "900", "90"),
    ["", "", "합계"]]);
  assert.equal(parsed.headerRow, 3);
  assert.equal(parsed.invoices.length, 2);
  assert.deepEqual(parsed.invoices[0], { approval_no: "20261005-41000000-aaaa0001", invoice_class: "tax", is_modified: false, kind_label: "일반", written_date: "2026-10-05", issued_date: "2026-10-05", sent_date: "2026-10-05",
    supplier_reg_no: "1234567890", supplier_name: "브랜디액션", buyer_reg_no: "2223344444", buyer_name: "고객사", buyer_email: "a@b.c", item_summary: "강의 A, 강의 B", supply_amount: 1000000, tax_amount: 100000, total_amount: 1100000, receipt_type: "청구", memo: "" });
  assert.equal(parsed.invoices[1].is_modified, true);
  assert.equal(parsed.invoices[1].total_amount, -110000);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /aaaa0003.*합계와 달라요/);
  assert.deepEqual(parsed.supplierRegNos, ["1234567890"]);
});

test("a non-홈택스 file, a missing column and mixed suppliers are refused with a plain reason", () => {
  assert.match(parseHometaxRows([["날짜", "금액"]]).errors[0], /홈택스 목록 파일이 아니에요/);
  assert.match(parseHometaxRows([["승인번호", "작성일자"]]).errors[0], /공급가액/);
  const mixed = parseHometaxRows([header, row("A1", "2026-10-01", 11, 10, 1), [...row("A2", "2026-10-01", 11, 10, 1).slice(0, 4), "999-99-99999", ...row("A2", "2026-10-01", 11, 10, 1).slice(5)]]);
  assert.match(mixed.errors.at(-1), /2개 섞여/);
});

test("전자계산서(면세) lists have no 세액 column and become exempt invoices", () => {
  const exempt = parseHometaxRows([["작성일자", "승인번호", "공급자사업자등록번호", "상호", "공급받는자사업자등록번호", "상호", "합계금액", "공급가액", "전자계산서분류"], ["2026-10-02", "E1", "1234567890", "에듀", "1112233333", "학생", "50,000", "50,000", "계산서"]]);
  assert.deepEqual([exempt.invoices[0].invoice_class, exempt.invoices[0].tax_amount, exempt.invoices[0].total_amount], ["exempt", 0, 50000]);
});

test("dates and amounts read in the formats 홈택스 and Excel write", () => {
  assert.equal(hometaxDate("2026/1/5"), "2026-01-05");
  assert.equal(hometaxDate(46300), "2026-10-05");
  assert.equal(hometaxDate("2026-02-30"), null);
  assert.equal(hometaxWon("-1,100원"), -1100);
  assert.equal(hometaxWon("12a"), null);
});

const invoice = (id, total, date = "2026-10-05", extra = {}) => ({ id, biz: "edu", written_date: date, total_amount: total, supply_amount: Math.round(total / 1.1), is_modified: false, ...extra });

test("same sale: one candidate is suspect, two are review, a confirmed link counts once, a rejected pair is not suggested again", () => {
  const payments = [
    { payment_key: "p1", biz: "edu", paid_date: "2026-10-03", amount: 110000, canceled_amount: 0, order_name: "강의" },
    { payment_key: "p2", biz: "edu", paid_date: "2026-10-20", amount: 220000, canceled_amount: 0 },
    { payment_key: "p3", biz: "edu", paid_date: "2026-10-21", amount: 220000, canceled_amount: 0 },
    { payment_key: "p4", biz: "myin", paid_date: "2026-10-05", amount: 330000, canceled_amount: 0 },
    { payment_key: "p5", biz: "edu", paid_date: "2026-09-01", amount: 440000, canceled_amount: 0 },
  ];
  const externals = [{ id: "x1", biz: "edu", revenue_date: "2026-10-06", supply: 500000, vat: 50000, title: "외주" }];
  const invoices = [invoice("i1", 110000), invoice("i2", 220000, "2026-10-20"), invoice("i3", 330000), invoice("i4", 440000), invoice("i5", 550000), invoice("i6", 110000, "2026-10-04")];
  const links = [{ tax_invoice_id: "i5", target_type: "external_revenue", target_ref: "x1", state: "confirmed" }, { tax_invoice_id: "i6", target_type: "payment", target_ref: "p1", state: "rejected" }];
  const states = matchInvoices(invoices, payments, externals, links);
  assert.equal(states.get("i1").state, "suspect");
  assert.equal(states.get("i1").candidates[0].ref, "p1");
  assert.equal(states.get("i2").state, "review", "two same-amount payments: never guessed");
  assert.equal(states.get("i3").state, "single", "another business's payment is not a candidate");
  assert.equal(states.get("i4").state, "single", "more than 7 days apart");
  assert.equal(states.get("i5").state, "linked");
  assert.equal(states.get("i6").state, "single", "rejected pair is not suggested again");
  assert.equal(matchInvoices([invoice("m", -110000, "2026-10-05", { is_modified: true })], payments, externals, []).get("m").state, "review");
  const totals = revenueBySource(invoices, states, 1000000, 550000);
  assert.equal(totals.linkedExcluded, 550000);
  assert.equal(totals.total, 1000000 + 550000 + (110000 + 220000 + 330000 + 440000 + 550000 + 110000) - 550000);
});

test("deposit check: the only same-amount deposit within the window is likely; two are unclear; a confirmed link wins", () => {
  const banks = [{ id: "b1", tx_date: "2026-10-30", deposit: 1100000, description: "고객사" }, { id: "b2", tx_date: "2027-03-01", deposit: 1100000, description: "late" }];
  assert.equal(matchDeposit(invoice("i", 1100000), banks, []).state, "likely");
  assert.equal(matchDeposit(invoice("i", 1100000), [...banks, { id: "b3", tx_date: "2026-10-10", deposit: 1100000, description: "" }], []).state, "unclear");
  assert.equal(matchDeposit(invoice("i", 1100000), banks, [{ tax_invoice_id: "i", target_type: "bank_tx", target_ref: "b2", state: "confirmed" }]).bank.id, "b2");
  assert.equal(matchDeposit(invoice("i", 1100000), banks, [{ tax_invoice_id: "i", target_type: "bank_tx", target_ref: "b1", state: "rejected" }]).state, "none");
});

test("VAT periods: month, 예정·확정 quarters and halves", () => {
  assert.deepEqual(vatPeriod("2026-10"), { kind: "month", key: "2026-10", label: "2026년 10월", from: "2026-10-01", to: "2026-10-31" });
  assert.equal(vatPeriod("2026-Q3").label, "2026년 2기 예정 (7~9월)");
  assert.deepEqual([vatPeriod("2026-Q4").from, vatPeriod("2026-Q4").to], ["2026-10-01", "2026-12-31"]);
  assert.deepEqual([vatPeriod("2026-H1").from, vatPeriod("2026-H1").to], ["2026-01-01", "2026-06-30"]);
  assert.equal(vatPeriod("2026-13"), null);
  assert.equal(vatPeriod("2026-Q5"), null);
});

test("VAT rows: payments and cancels by their own dates, an invoiced payment counted under the invoice, unlinked external sales flagged", () => {
  const rows = vatRows({ biz: "edu", from: "2026-10-01", to: "2026-12-31",
    payments: [
      { payment_key: "card", biz: "edu", method: "카드", amount: 110000, paid_date: "2026-10-02", order_name: "강의" },
      { payment_key: "bank", biz: "edu", method: "가상계좌", amount: 55000, paid_date: "2026-11-02" },
      { payment_key: "old", biz: "edu", method: "카드", amount: 22000, paid_date: "2026-09-29" },
      { payment_key: "billed", biz: "edu", method: "카드", amount: 330000, paid_date: "2026-10-05" },
      { payment_key: "other", biz: "myin", method: "카드", amount: 999000, paid_date: "2026-10-05" },
    ],
    cancels: [{ payment_key: "card", cancel_amount: 11000, cancel_date: "2026-10-03" }, { payment_key: "old", cancel_amount: 22000, cancel_date: "2026-10-01" }],
    invoices: [
      { id: "t1", biz: "edu", approval_no: "T1", invoice_class: "tax", is_modified: false, written_date: "2026-10-05", issued_date: "2026-11-10", buyer_name: "회사", supply_amount: 300000, tax_amount: 30000, total_amount: 330000 },
      { id: "t2", biz: "edu", approval_no: "T2", invoice_class: "exempt", is_modified: false, written_date: "2026-12-01", issued_date: null, buyer_name: "학생", supply_amount: 50000, tax_amount: 0, total_amount: 50000 },
      { id: "t3", biz: "edu", approval_no: "T3", invoice_class: "tax", is_modified: false, written_date: "2027-01-02", issued_date: null, buyer_name: "다음 기간", supply_amount: 10, tax_amount: 1, total_amount: 11 },
    ],
    externals: [{ id: "e1", biz: "edu", title: "외주", revenue_date: "2026-10-10", supply: 100000, vat: 10000 }],
    links: [{ tax_invoice_id: "t1", target_type: "payment", target_ref: "billed", state: "confirmed" }],
  });
  const lines = Object.fromEntries(vatLines(rows).map(line => [line.evidence, line]));
  assert.equal(lines.card.total, 110000 - 11000 - 22000, "the 9월 payment's 10월 cancel belongs to 10월; the invoiced payment is left out");
  assert.equal(lines.card.cancelCount, 2);
  assert.deepEqual([lines.cash.total, lines.cash.tax], [55000, 5000]);
  assert.deepEqual([lines.tax_invoice.supply, lines.tax_invoice.tax, lines.tax_invoice.total], [300000, 30000, 330000]);
  assert.equal(lines.exempt_invoice.total, 50000);
  assert.equal(lines.external.total, 110000);
  assert.ok(rows.some(row => row.ref === "billed" && row.total === 0 && /세금계산서 줄에서 셈/.test(row.note)));
  assert.ok(rows.some(row => row.ref === "T1" && row.note === "발급일 2026-11-10"));
  assert.ok(!rows.some(row => row.ref === "T3" || row.ref === "other"));
  assert.deepEqual(splitVat(110000), { supply: 100000, tax: 10000 });
  assert.equal(paymentEvidence("휴대폰"), "other_pg");
  const csv = vatCsv([{ evidence: "external", kind: "매출", date: "2026-10-10", basis: "매출일", source: "직접 입력", title: "=HYPERLINK(1)", ref: "e1", supply: 1, tax: 0, total: 1, note: "a,b" }]);
  assert.ok(csv.startsWith("﻿증빙,"));
  assert.match(csv, /'=HYPERLINK\(1\)/);
  assert.match(csv, /"a,b"/);
});

test("tax invoice tables and routes stay behind finance access; Aside never handles 홈택스 sign-in", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("supabase/migrations/20261029120000_finance_tax_invoices.sql", "utf8");
  for (const table of ["tax_invoices", "revenue_links"]) assert.ok(sql.includes(`array['tax_invoices', 'revenue_links']`), table);
  assert.match(sql, /revoke all on public\.os_fin_%I from public, anon, authenticated/);
  assert.match(sql, /os_has_finance_access\(\)\) and created_by = \(select auth\.uid\(\)\)/);
  assert.match(sql, /approval_no text not null unique/);
  assert.match(sql, /os_fin_revenue_links_one_sale/);
  for (const route of ["app/api/v1/finance/tax-invoices/route.ts", "app/api/v1/finance/vat/route.ts"]) assert.match(readFileSync(route, "utf8"), /await financeActor\(request\)/, route);
  const panel = readFileSync("components/finance/tax-invoice-panel.tsx", "utf8");
  assert.match(panel, /로그인 정보·인증서는 묻거나 입력하지 마세요/);
  assert.match(panel, /담당자가 「저장」을 누르게 합니다/);
});
