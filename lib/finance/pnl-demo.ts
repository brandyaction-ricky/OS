// 연습용(데모) 화면의 손익 현황이 쓰는 작은 원장. 실제 자료가 아니고, API 를 부르지 않는다.
// 오늘 기준 최근 6개월과 한 해 전 같은 달을 만들어, 언제 열어도 표 · 차트 · 전년도 막대가 보인다.
// 통장은 둘(운영 · 예비)이고 기초 잔액과 거래 후 잔액이 있어 자금 흐름 탭도 같은 원장으로 그려진다.
import type { FinanceData, FinanceRow } from "./schema";

export function pnlDemoData(today: string): FinanceData {
  let count = 0;
  const row = (fields: Record<string, unknown>): FinanceRow => ({ id: `demo-${++count}`, version: 1, archived_at: null, ...fields });
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)), todayDay = Number(today.slice(8, 10));
  // A day in the month `back` months ago; never after today.
  const day = (back: number, value: number) => {
    const first = new Date(Date.UTC(year, month - 1 - back, 1));
    return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(back === 0 ? Math.min(value, todayDay) : value).padStart(2, "0")}`;
  };
  const account = row({ bank: "국민은행", name: "운영 통장", last4: "1234", include_in_net: true, opening_balance: 18000000 });
  const savings = row({ bank: "국민은행", name: "예비 통장", last4: "5678", include_in_net: true, opening_balance: 5000000 });
  const card = row({ issuer: "KB국민카드", name: "법인카드", last4: "1234" });
  const data: FinanceData = {
    stores: [], settlements: [], settings: [], budget_items: [], budget_actuals: [], payout_notes: [], card_rules: [], bank_rules: [],
    bank_accounts: [account, savings], cards: [card], payments: [], payment_cancels: [], external_revenues: [], card_transactions: [], bank_transactions: [],
  };
  const pay = (back: number, at: number, biz: string, name: string, amount: number) => {
    const payment = row({ biz, status: "DONE", paid_date: day(back, at), amount, fee: Math.round(amount * 0.033), order_name: name, method: "카드" });
    data.payments.push(payment);
    return payment;
  };
  const spend = (back: number, at: number, merchant: string, amount: number, category: string | null, biz: string | null, canceled = false) =>
    data.card_transactions.push(row({ card_id: card.id, used_date: day(back, at), time: "10:00", merchant, amount_krw: amount, canceled, manual_category: category, manual_biz: biz, manual_vat: null, memo: null }));
  const out = (back: number, at: number, description: string, amount: number, category: string | null, extra: Record<string, unknown> = {}) => {
    const tx = row({ account_id: account.id, tx_date: day(back, at), time: "09:00", deposit: 0, withdrawal: amount, description, manual_category: category, link_type: null, link_ref: null, ...extra });
    data.bank_transactions.push(tx);
    return tx;
  };
  const receive = (back: number, at: number, description: string, amount: number, category: string) =>
    data.bank_transactions.push(row({ account_id: account.id, tx_date: day(back, at), time: "14:00", deposit: amount, withdrawal: 0, description, manual_category: category, link_type: null, link_ref: null }));
  for (const [index, back] of [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17].entries()) {
    const scale = back >= 12 ? 0.7 : 1 + (5 - back) * 0.06, won = (value: number) => Math.round(value * scale / 1000) * 1000;
    const course = pay(back, 5, "edu", "문샷 챌린지", won(890000) * 6);
    const diagnosis = pay(back, 12, "myin", "정밀 진단", won(129000) * (8 + index % 4));
    receive(back, 20, "토스페이먼츠 정산", Number(course.amount) + Number(diagnosis.amount) - Number(course.fee) - Number(diagnosis.fee), "토스 정산");
    if (back === 1) data.payment_cancels.push(row({ payment_id: course.id, cancel_date: day(0, 2), cancel_amount: 890000, fee_refund: 29370 }));
    if (back % 3 === 1) {
      data.external_revenues.push(row({ kind: "lecture", biz: "edu", title: "기업 출강", client: "예시 고객사", revenue_date: day(back, 18), usd: null, supply: 1500000, vat: 150000 }));
      receive(back, 24, "예시 고객사 출강료", 1650000, "외부 매출");
    }
    if (back === 2) data.external_revenues.push(row({ kind: "youtube", biz: "ba", title: "유튜브 광고 수익", client: "Google", revenue_date: day(back, 22), usd: 420, supply: 0, vat: 0 }));
    spend(back, 3, "Meta Ads", won(640000), "광고선전비", "myin");
    spend(back, 9, "쿠팡", won(58000), "소모품비", "common");
    spend(back, 16, "노션", won(96000), "지급수수료", "common");
    if (back % 2 === 0) spend(back, 20, "KTX", 53800, "여비교통비", "edu");
    if (back === 0) spend(back, 6, "알 수 없는 가맹점", 23000, null, null);
    if (back === 1) spend(back, 11, "취소된 결제", 120000, "접대비", "common", true);
    out(back, 1, "사무실 임대료", 880000, "임대료");
    out(back, 10, "4대보험", won(310000), "4대보험");
    out(back, 14, "세무 기장료", 110000, "세무 기장료");
    out(back, 15, "카드 대금", won(790000), "카드 대금");
    out(back, 25, "급여", won(3200000), "급여");
    if (back === 1) out(back, 25, "부가세 납부", 640000, "세금 납부");
    if (back === 0) out(back, 4, "ATM 출금", 77000, null);
    if (back === 2) {
      const sent = out(back, 8, "예비 통장으로", 1000000, null, { link_type: "transfer" });
      const received = row({ account_id: savings.id, tx_date: sent.tx_date, time: "09:00", deposit: 1000000, withdrawal: 0, description: "운영 통장에서", manual_category: null, link_type: "transfer", link_ref: sent.id });
      sent.link_ref = received.id;
      data.bank_transactions.push(received);
    }
  }
  // 거래 후 잔액: 기초 잔액에서 날짜 · 시각 순으로 더하고 뺀다 (은행 파일에 들어 있는 잔액 칸과 같은 값).
  const balance = new Map([account, savings].map(item => [item.id, Number(item.opening_balance)]));
  data.bank_transactions.sort((a, b) => `${a.tx_date}${a.time}`.localeCompare(`${b.tx_date}${b.time}`));
  for (const tx of data.bank_transactions) {
    const next = balance.get(String(tx.account_id))! + Number(tx.deposit) - Number(tx.withdrawal);
    balance.set(String(tx.account_id), next);
    tx.balance_after = next;
  }
  return data;
}
