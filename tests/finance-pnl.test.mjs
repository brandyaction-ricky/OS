import assert from "node:assert/strict";
import test from "node:test";
import { overviewOf } from "../lib/finance/domain.mjs";
import { cumulative, groupOf, pnlOf, pnlRows, pnlYears, sumCells } from "../lib/finance/pnl.ts";
import { pnlDemoData } from "../lib/finance/pnl-demo.ts";

// 손익 현황: synthetic ledger only. Today is 2026-05-20, so January–May are open and June–December are "not yet".
const TODAY = "2026-05-20";
let seq = 0;
const row = fields => ({ id: `r${++seq}`, version: 1, archived_at: null, ...fields });
const A = "acct-main", B = "acct-outside";
const bankOut = (date, amount, description, category, extra = {}) => row({ account_id: A, tx_date: date, deposit: 0, withdrawal: amount, description, manual_category: category, link_type: null, link_ref: null, ...extra });
const card = (date, merchant, amount, extra = {}) => row({ card_id: "card-1", used_date: date, merchant, amount_krw: amount, canceled: false, manual_category: null, manual_biz: null, manual_vat: null, memo: null, ...extra });

function ledger() {
  const p1 = row({ biz: "edu", status: "DONE", paid_date: "2026-03-05", amount: 100000, fee: 3000, order_name: "강의 A", method: "카드" });
  const p2 = row({ biz: "myin", status: "DONE", paid_date: "2026-03-20", amount: 50000, fee: 1500, order_name: "진단", method: "간편결제" });
  const p3 = row({ biz: "edu", status: "DONE", paid_date: "2026-04-02", amount: 200000, fee: null, order_name: "강의 B", method: "카드" });
  const waiting = row({ biz: "edu", status: "WAITING_FOR_DEPOSIT", paid_date: "2026-03-07", amount: 999999, fee: null, order_name: "입금 대기", method: "가상계좌" });
  const lastYear = row({ biz: "edu", status: "DONE", paid_date: "2025-12-30", amount: 70000, fee: 2000, order_name: "강의 A", method: "카드" });
  const lecture = row({ kind: "lecture", biz: "edu", title: "출강", client: "고객사", revenue_date: "2026-03-15", usd: null, supply: 300000, vat: 30000 });
  const youtubeLinked = row({ kind: "youtube", biz: "ba", title: "유튜브 3월", client: "Google", revenue_date: "2026-03-25", usd: 50, supply: 0, vat: 0 });
  const youtubeEstimate = row({ kind: "youtube", biz: "ba", title: "유튜브 5월", client: "Google", revenue_date: "2026-05-10", usd: 100, supply: 0, vat: 0 });
  const transferOut = bankOut("2026-03-15", 1000000, "예비 통장으로", null, { link_type: "transfer" });
  const transferIn = row({ account_id: B, tx_date: "2026-03-15", deposit: 1000000, withdrawal: 0, description: "운영 통장에서", manual_category: null, link_type: "transfer", link_ref: transferOut.id });
  transferOut.link_ref = transferIn.id;
  return {
    // Settlements and budget rows are here so that 개요 does its full work; the P&L must still match it without reading them.
    stores: [row({ id: "store-edu", biz: "edu", bank_keyword: "토스페이먼츠" })],
    settlements: [row({ store_id: "store-edu", biz: "edu", payment_key: "pk-1", sold_date: "2026-03-05", paid_out_date: "2026-03-10", amount: 100000, fee: 3000, pay_out_amount: 97000, is_cancel: false })],
    budget_items: [row({ kind: "fixed", name: "임대료", biz: "common", monthly_amount: 500000, source: "bank", card_categories: [], bank_categories: ["임대료"], sort_order: 0 })],
    settings: [], budget_actuals: [], payout_notes: [],
    payments: [p1, p2, p3, waiting, lastYear],
    payment_cancels: [row({ payment_id: p1.id, cancel_date: "2026-04-10", cancel_amount: 40000, fee_refund: 1200 }), row({ payment_id: p2.id, cancel_date: "2026-05-03", cancel_amount: 20000, fee_refund: 600 })],
    external_revenues: [lecture, youtubeLinked, youtubeEstimate],
    card_rules: [row({ name: "메타", keywords: ["meta"], category: "광고선전비", biz: "myin", vat_type: "공제 예상", memo_template: "", enabled: true, sort_order: 0 })],
    card_transactions: [
      card("2026-03-03", "Meta Ads", 80000),
      card("2026-03-09", "쿠팡", 12000, { manual_category: "소모품비", manual_biz: "common" }),
      card("2026-04-01", "알 수 없음", 5000),
      card("2026-03-11", "취소건", 99999, { canceled: true, manual_category: "접대비" }),
      card("2026-05-02", "KTX", 30000, { manual_category: "여비교통비", manual_biz: "edu" }),
    ],
    bank_accounts: [row({ id: A, name: "운영", include_in_net: true }), row({ id: B, name: "순수익 제외", include_in_net: false })],
    bank_rules: [row({ name: "세무", keyword: "세무", direction: "out", category: "세무 기장료", enabled: true, sort_order: 0 })],
    bank_transactions: [
      bankOut("2026-03-25", 3000000, "급여 3월", "급여"),
      bankOut("2026-03-10", 500000, "임대료", "임대료"),
      bankOut("2026-03-12", 92000, "카드 대금", "카드 대금"),
      bankOut("2026-04-25", 700000, "부가세", "세금 납부"),
      bankOut("2026-04-03", 15000, "ATM 출금", null),
      bankOut("2026-04-20", 250000, "디자인 외주", "프리랜서"),
      bankOut("2026-05-06", 110000, "세무법인 기장료", null),
      bankOut("2026-03-05", 40000, "제외 통장 출금", "기타 출금", { account_id: B }),
      row({ account_id: A, tx_date: "2026-03-28", deposit: 70000, withdrawal: 0, description: "GOOGLE", manual_category: null, link_type: "external_revenue", link_ref: youtubeLinked.id }),
      row({ account_id: A, tx_date: "2026-03-10", deposit: 97000, withdrawal: 0, description: "토스페이먼츠 정산", manual_category: null, link_type: null, link_ref: null }),
      transferOut, transferIn,
    ],
  };
}
const data = ledger();
const all = pnlOf(data, 2026, "all", TODAY);
const lineOf = (pnl, key) => [pnl.revenue, ...pnl.costs].flatMap(group => group.lines).find(line => line.key === key);
const groupBy = (pnl, key) => [pnl.revenue, ...pnl.costs].find(group => group.key === key);
const open = values => values.slice(0, 5), later = values => values.slice(5);

test("매출: every month equals 개요's 순매출, for every business filter, and the two lines add up to it", () => {
  for (const biz of ["all", "edu", "myin", "hm"]) {
    const pnl = pnlOf(data, 2026, biz, TODAY);
    for (let month = 1; month <= 5; month += 1) {
      const overview = overviewOf(data, `2026-${String(month).padStart(2, "0")}`, biz, TODAY);
      assert.equal(pnl.revenueTotal[month - 1], overview.netRevenue, `${biz} ${month}월`);
      assert.equal(lineOf(pnl, "toss").months[month - 1] + lineOf(pnl, "external").months[month - 1], overview.netRevenue);
      assert.equal(lineOf(pnl, "fee").months[month - 1], overview.fee);
    }
  }
  assert.equal(overviewOf(data, "2026-03", "all", TODAY).budget.income, 97000 + 70000, "개요 really matched the payout and the budget here");
  assert.deepEqual(open(lineOf(all, "toss").months), [0, 0, 150000, 160000, -20000]);
  // 유튜브: the linked deposit (70,000) when there is one, otherwise the USD estimate (100 × 1,390).
  assert.deepEqual(open(lineOf(all, "external").months), [0, 0, 400000, 0, 139000]);
});

test("비용: card and bank rows land in their month, line and group", () => {
  assert.deepEqual(all.costs.map(group => group.label), ["인건비", "그 밖의 통장 출금", "카드지출", "결제 수수료"]);
  assert.deepEqual(open(lineOf(all, "card:광고선전비").months), [0, 0, 80000, 0, 0]);
  assert.deepEqual(open(lineOf(all, "card:소모품비").months), [0, 0, 12000, 0, 0]);
  assert.deepEqual(open(lineOf(all, "card:").months), [0, 0, 0, 5000, 0]);
  assert.equal(lineOf(all, "card:").label, "미분류 카드지출");
  assert.deepEqual(groupBy(all, "card").lines.map(line => line.key), ["card:광고선전비", "card:소모품비", "card:여비교통비", "card:"]);
  assert.deepEqual(open(groupBy(all, "card").months), [0, 0, 92000, 5000, 30000]);
  assert.deepEqual(groupBy(all, "labor").lines.map(line => line.label), ["급여", "프리랜서"]);
  assert.deepEqual(open(groupBy(all, "labor").months), [0, 0, 3000000, 250000, 0]);
  assert.deepEqual(groupBy(all, "bank").lines.map(line => line.label), ["임대료", "세무 기장료"]);
  assert.deepEqual(open(lineOf(all, "bank:세무 기장료").months), [0, 0, 0, 0, 110000], "classified by a bank rule");
  assert.deepEqual(open(groupBy(all, "bank").months), [0, 0, 500000, 0, 110000]);
});

test("카드 대금 · 이체 · 세금 납부 · 미분류 · 순수익 제외 통장 · 취소한 카드 건은 비용에 들어가지 않는다", () => {
  const keys = all.costs.flatMap(group => group.lines.map(line => line.key));
  for (const key of ["bank:카드 대금", "bank:내 통장 간 이체", "bank:세금 납부", "bank:미분류", "bank:기타 출금", "card:접대비"]) assert.ok(!keys.includes(key), key);
  // March costs are exactly 급여 + 임대료 + two card rows + fees: nothing else slipped in.
  assert.equal(all.costTotal[2], 3000000 + 500000 + 80000 + 12000 + 4500);
  assert.deepEqual(all.excluded[3], { tax: 700000, unclassified: 15000, unclassifiedCount: 1 });
  assert.deepEqual(all.excluded[2], { tax: 0, unclassified: 0, unclassifiedCount: 0 });
  assert.equal(all.excluded[5], null);
  assert.equal(pnlRows(data, 2026, "all", "tax", 4)[0].title, "부가세");
  assert.equal(pnlRows(data, 2026, "all", "unclassified", 4).length, 1);
});

test("결제 수수료: known months are numbers, a month with an unknown fee is null (미확인) and adds nothing", () => {
  assert.deepEqual(open(lineOf(all, "fee").months), [0, 0, 4500, null, -600]);
  assert.equal(all.costTotal[3], 250000 + 5000);
  assert.equal(overviewOf(data, "2026-04", "all", TODAY).fee, null);
});

test("아직 오지 않은 달은 null 이고 0 과 다르다; past years are full, future years are empty", () => {
  for (const values of [all.revenueTotal, all.costTotal, all.profit, all.excluded, ...[all.revenue, ...all.costs].flatMap(group => [group.months, ...group.lines.map(line => line.months)])]) {
    assert.equal(values.length, 12);
    assert.ok(later(values).every(value => value === null));
  }
  assert.equal(all.open, 5);
  assert.equal(all.revenueTotal[0], 0);
  const last = pnlOf(data, 2025, "all", TODAY);
  assert.equal(last.open, 12);
  assert.equal(last.revenueTotal[11], 70000);
  assert.ok(last.profit.every(value => value !== null));
  assert.ok(pnlOf(data, 2027, "all", TODAY).profit.every(value => value === null));
  assert.equal(sumCells(pnlOf(data, 2027, "all", TODAY).profit), null);
});

test("손익 = 매출 합계 − 비용 합계, every month, and 비용 합계 is the sum of the groups", () => {
  for (const pnl of [all, pnlOf(data, 2026, "edu", TODAY), pnlOf(data, 2025, "all", TODAY)]) for (let index = 0; index < pnl.open; index += 1) {
    assert.equal(pnl.profit[index], pnl.revenueTotal[index] - pnl.costTotal[index]);
    assert.equal(pnl.costTotal[index], pnl.costs.reduce((sum, group) => sum + (group.months[index] ?? 0), 0));
    for (const group of pnl.costs.filter(group => group.key !== "fee")) assert.equal(group.months[index], group.lines.reduce((sum, line) => sum + line.months[index], 0));
  }
  assert.equal(all.profit[2], 550000 - 3596500);
});

test("사업 필터: revenue and card rows follow the business; bank-paid costs are counted only under 전체", () => {
  const edu = pnlOf(data, 2026, "edu", TODAY);
  assert.equal(edu.bankIncluded, false);
  assert.equal(all.bankIncluded, true);
  assert.deepEqual(open(edu.revenueTotal), [0, 0, 430000, 160000, 0]);
  assert.deepEqual(groupBy(edu, "card").lines.map(line => line.key), ["card:여비교통비"]);
  assert.deepEqual(groupBy(edu, "labor").lines, []);
  assert.deepEqual(open(groupBy(edu, "bank").months), [0, 0, 0, 0, 0]);
  assert.deepEqual(edu.excluded[3], { tax: 0, unclassified: 0, unclassifiedCount: 0 });
  assert.deepEqual(open(lineOf(edu, "fee").months), [0, 0, 3000, null, 0]);
  assert.deepEqual(open(lineOf(pnlOf(data, 2026, "myin", TODAY), "card:광고선전비").months), [0, 0, 80000, 0, 0], "the rule's business");
});

test("내역: the rows behind a cell add up to the cell, for every line and every group", () => {
  for (const biz of ["all", "edu"]) {
    const pnl = pnlOf(data, 2026, biz, TODAY);
    for (const group of [pnl.revenue, ...pnl.costs]) for (const target of [group, ...group.lines]) for (let month = 1; month <= pnl.open; month += 1) {
      const cell = target.months[month - 1];
      if (cell === null) continue;
      assert.equal(pnlRows(data, 2026, biz, target.key, month).reduce((sum, entry) => sum + entry.amount, 0), cell, `${biz} ${target.key} ${month}월`);
    }
  }
  const march = pnlRows(data, 2026, "all", "revenue", 3);
  assert.deepEqual(march.map(entry => [entry.date, entry.kind, entry.amount]), [["2026-03-25", "외부 매출", 70000], ["2026-03-20", "토스 결제", 50000], ["2026-03-15", "외부 매출", 330000], ["2026-03-05", "토스 결제", 100000]]);
  assert.deepEqual(pnlRows(data, 2026, "all", "toss", 4).map(entry => entry.amount).sort((a, b) => a - b), [-40000, 200000]);
  assert.deepEqual(pnlRows(data, 2026, "all", "card:광고선전비", 3)[0], { line: "card:광고선전비", date: "2026-03-03", kind: "카드", category: "광고선전비", title: "Meta Ads", amount: 80000 });
  assert.equal(groupOf("bank:급여"), "labor");
  assert.equal(groupOf("unclassified"), null);
});

test("누적: running totals, a null month stays null", () => {
  assert.deepEqual(cumulative([1, 2, null, 4, null]), [1, 3, null, 7, null]);
  assert.deepEqual(cumulative(all.revenueTotal).slice(0, 6), [0, 0, 550000, 710000, 829000, null]);
  assert.equal(sumCells(all.revenueTotal), 829000);
});

test("연도 목록 and the 연습용 ledger: past years with rows plus this year; the demo fixture runs through the same calculation", () => {
  assert.deepEqual(pnlYears(data, TODAY), [2025, 2026]);
  assert.deepEqual(pnlYears({}, TODAY), [2026]);
  const demo = pnlDemoData(TODAY), pnl = pnlOf(demo, 2026, "all", TODAY);
  assert.ok(sumCells(pnl.revenueTotal) > 0 && sumCells(pnl.costTotal) > 0);
  assert.equal(pnl.revenueTotal[4], overviewOf(demo, "2026-05", "all", TODAY).netRevenue);
  assert.ok(pnl.excluded.some(month => month?.tax) && pnl.excluded.some(month => month?.unclassifiedCount));
  assert.ok(pnl.costs.every(group => group.key === "fee" || group.lines.length > 0));
  assert.ok(groupBy(pnl, "card").lines.some(line => line.key === "card:"));
  assert.ok(sumCells(pnlOf(demo, 2025, "all", TODAY).revenueTotal) > 0, "the previous year has rows for the grey bars");
});
