"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { TAX_BIZ, type Biz } from "@/lib/finance/tax-invoices";
import { COMPANY, EVIDENCE_LABEL, scopeLabel, vatCsv, type VatLine, type VatPeriod, type VatRow, type VatScope } from "@/lib/finance/vat";
import { payableLabel, type VatPurchase } from "@/lib/finance/vat-payable";
import { PurchaseInvoicePanel, PurchaseNotReady } from "./purchase-invoice-panel";

// 부가세 신고 참고 자료 (재무 요청 a5310134): 월·신고기간별로 결제·취소를 증빙별로 묶어 보고 내려받는다. 신고서가 아니다.
// 2026-11-13: 매입 세금계산서와 공제 예상 카드로 매입세액을 더해 예상 납부세액 (매출세액 − 매입세액)을 보여 준다.
// 2026-11-13: 사업자등록번호가 하나라 신고는 회사 전체로 한다 — 「회사 전체」가 기본이고, 사업별 보기는 안에서 나눠 볼 때 쓴다.

type Purchase = { available: false } | ({ available: true } & VatPurchase);
type Result = { period: VatPeriod; lines: VatLine[]; rows: VatRow[]; review: number; salesTax: number; purchase: Purchase; payable: number | null };
const won = (value: number) => value.toLocaleString("ko-KR");
const SCOPES: VatScope[] = [COMPANY, ...(Object.keys(TAX_BIZ) as Biz[])];

function periodOptions() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const year = now.getFullYear(), month = now.getMonth() + 1;
  const months = Array.from({ length: 12 }, (_, index) => { const date = new Date(year, month - 1 - index, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; });
  const quarters = Array.from({ length: 4 }, (_, index) => { const q = Math.ceil(month / 3) - index; const y = q > 0 ? year : year - 1; return `${y}-Q${((q - 1 + 8) % 4) + 1}`; });
  const halves = [`${year}-H${month > 6 ? 2 : 1}`, month > 6 ? `${year}-H1` : `${year - 1}-H2`];
  return { months, quarters, halves };
}
const labelOf = (key: string) => {
  const [year, part] = key.split("-");
  if (part.startsWith("Q")) { const q = Number(part.slice(1)); return `${year}년 ${q <= 2 ? 1 : 2}기 ${q % 2 ? "예정" : "확정"} (${(q - 1) * 3 + 1}~${q * 3}월)`; }
  if (part.startsWith("H")) return `${year}년 ${part.slice(1)}기 전체`;
  return `${year}년 ${Number(part)}월`;
};

/** 예상 납부세액 = 매출 합계 세액 (A) − 매입 합계 세액 (B), with the evidence behind (B). */
export function VatPayableSummary({ salesTax, purchase, payable }: { salesTax: number; purchase: VatPurchase; payable: number }) {
  return <div className="fin-card fin-gap fin-payable">
    <div className="fin-payable-top"><span className="fin-l">예상 납부세액</span><span className="fin-payable-v">{won(payable)}원</span><span className="status-pill" data-tone={payable < 0 ? "ok" : "progress"}>{payableLabel(payable)}</span></div>
    <div className="fin-tbl-wrap fin-payable-tbl"><table className="fin-tbl">
      <thead><tr><th>항목</th><th className="fin-r">세액</th></tr></thead>
      <tbody>
        <tr><td>매출 합계 세액 (A)</td><td className="fin-r">{won(salesTax)}</td></tr>
        <tr><td>매입 합계 세액 (B)</td><td className="fin-r">{won(purchase.inputTax)}</td></tr>
        <tr className="fin-payable-sub"><td>전자세금계산서 (매입) · {won(purchase.invoice.count)}건</td><td className="fin-r">{won(purchase.invoice.tax)}</td></tr>
        <tr className="fin-payable-sub"><td>신용카드 (공제 예상) · {won(purchase.card.count)}건</td><td className="fin-r">{won(purchase.card.tax)}</td></tr>
      </tbody>
      <tfoot><tr><td>예상 납부세액 (A) − (B)</td><td className="fin-r">{won(payable)}</td></tr></tfoot>
    </table></div>
    <p className="fin-note">참고용 추정이에요 · 세액 공제와 예정고지 세액은 반영하지 않았어요 · 매입 계산서는 모두 공제된다고 보았어요 · 카드는 「공제 예상」으로 분류한 사용액 합계의 1/11을 세액으로 추정했어요.
      {purchase.unassigned.count ? ` 사업 구분이 공통이거나 없는 「공제 예상」 카드 ${won(purchase.unassigned.count)}건 (${won(purchase.unassigned.amount)}원)은 어느 사업자 몫인지 알 수 없어 넣지 않았어요.` : ""}</p>
    {purchase.invoice.count ? null : <p className="fin-callout fin-info" role="status">이 기간에 올린 매입 세금계산서가 없어요. 아래 「매입 세금계산서 (홈택스)」에 올리면 매입세액에 반영돼요.</p>}
    {purchase.undecided.count ? <div className="fin-callout fin-warn"><b>확인 필요</b><span className="fin-grow">공제 여부를 아직 정하지 않은 「판단 필요」 카드가 {won(purchase.undecided.count)}건 ({won(purchase.undecided.amount)}원) 있어요. 공제로 정하면 매입세액이 늘어 예상 납부세액이 줄 수 있어요.</span><Link href="/finance/cards" className="secondary-button compact">카드지출에서 정하기</Link></div> : null}
  </div>;
}

// 연습용 화면: 예시 숫자로 요약 모양만 보여 준다. 서버를 부르지 않는다.
const DEMO_PURCHASE: VatPurchase = { invoice: { count: 12, tax: 1_840_000 }, card: { count: 31, amount: 4_620_000, tax: 420_000 }, inputTax: 2_260_000, undecided: { count: 4, amount: 386_000 }, unassigned: { count: 2, amount: 154_000 } };
export function VatReferenceDemo() {
  return <section className="finance-workspace finance-react" aria-label="부가세 신고 참고 자료">
    <div className="fin-ph"><div className="fin-ph-t"><h1>부가세 신고 참고 자료</h1>
      <p className="fin-ph-s">연습용 화면이에요. 실제 결제·계산서가 없어서, 아래 숫자는 화면 모양을 보여 주는 예시예요.</p></div></div>
    <VatPayableSummary salesTax={5_730_000} purchase={DEMO_PURCHASE} payable={5_730_000 - DEMO_PURCHASE.inputTax} />
  </section>;
}

export function VatReference({ token }: { token: string | null }) {
  const options = periodOptions();
  const [period, setPeriod] = useState(options.quarters[0]);
  const [biz, setBiz] = useState<VatScope>(COMPANY);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const shown = useRef("");
  useEffect(() => {
    const controller = new AbortController(), key = `${period}:${biz}`;
    // A refresh after a 매입 upload keeps the screen (and the panel's note) while the numbers reload.
    if (shown.current !== key) setResult(null);
    setError("");
    apiRequest<Result>(`/api/v1/finance/vat?${new URLSearchParams({ period, biz })}`, { token, signal: controller.signal }).then(next => { shown.current = key; setResult(next); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "자료를 불러오지 못했어요."); });
    return () => controller.abort();
  }, [period, biz, token, revision]);

  const fileName = `부가세참고_${scopeLabel(biz)}_${period}`;
  const log = () => void apiRequest("/api/v1/finance/events", { token, method: "POST", body: JSON.stringify({ kind: "csv_export", view: "vat", ids: [] }) }).catch(() => undefined);
  const saveBlob = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); Object.assign(document.createElement("a"), { href: url, download: name }).click(); URL.revokeObjectURL(url); };
  const csv = () => { if (!result) return; saveBlob(new Blob([vatCsv(result.rows)], { type: "text/csv;charset=utf-8" }), `${fileName}.csv`); log(); };
  const excel = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      const summary = book.addWorksheet("요약");
      summary.addRow([`${scopeLabel(biz)} · ${result.period.label} · 부가세 신고 참고 자료 (신고서가 아닙니다)`]);
      summary.addRow(["증빙", "기준일", "건수", "결제·발급", "취소·수정", "공급가액", "세액", "합계"]);
      for (const line of result.lines) summary.addRow([line.label, line.basis, line.count, line.payCount, line.cancelCount, line.supply, line.tax, line.total]);
      const detail = book.addWorksheet("상세");
      detail.addRow(["증빙", "구분", "기준일", "날짜", "출처", "거래처·상품", "번호", "공급가액", "세액", "합계", "메모"]);
      // Text cells that look like formulas are kept as text.
      const text = (value: string) => /^[=+\-@]/.test(value) ? `'${value}` : value;
      for (const row of result.rows) detail.addRow([EVIDENCE_LABEL[row.evidence], row.kind, row.basis, row.date, row.source, text(row.title), text(row.ref), row.supply, row.tax, row.total, text(row.note)]);
      for (const sheet of [summary, detail]) sheet.columns.forEach(column => { column.width = 18; });
      saveBlob(new Blob([await book.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${fileName}.xlsx`); log();
    } catch { setError("엑셀 파일을 만들지 못했어요. CSV로 내려받아 주세요."); }
    finally { setBusy(false); }
  };

  const sum = (key: "supply" | "tax" | "total") => (result?.lines ?? []).reduce((total, line) => total + line[key], 0);
  const count = (key: "payCount" | "cancelCount") => (result?.lines ?? []).reduce((total, line) => total + line[key], 0);
  // "계좌이체·가상계좌 (토스, …)" reads as a name plus a quiet second line.
  const split = (label: string) => { const [name, ...rest] = label.split(" ("); return { name, hint: rest.join(" (").replace(/\)$/, "") }; };
  return <section className="finance-workspace finance-react" aria-label="부가세 신고 참고 자료">
    <div className="fin-ph"><div className="fin-ph-t"><h1>부가세 신고 참고 자료</h1>
      <p className="fin-ph-s">토스 결제·취소, 홈택스 계산서, 외부 매출을 증빙별로 묶은 참고 자료예요. 실제 신고는 세무사와 홈택스 자료로 확인해 주세요.</p></div>
      <div className="fin-ph-a">
        <button type="button" className="secondary-button compact" disabled={!result?.rows.length} onClick={csv}>CSV 내보내기</button>
        <button type="button" className="primary-button compact" disabled={!result?.rows.length || busy} onClick={() => void excel()}>{busy ? "만드는 중…" : "엑셀 내려받기"}</button>
      </div></div>
    <div className="os-toolbar">
      <label className="fin-pick"><span>사업자</span><select className="fin-sel" value={biz} onChange={event => setBiz(event.target.value as VatScope)}>{SCOPES.map(key => <option key={key} value={key}>{scopeLabel(key)}</option>)}</select></label>
      <label className="fin-pick"><span>기간</span><select className="fin-sel" value={period} onChange={event => setPeriod(event.target.value)}>
        <optgroup label="신고기간 (예정·확정)">{options.quarters.map(key => <option key={key} value={key}>{labelOf(key)}</option>)}</optgroup>
        <optgroup label="반기 (개인사업자 확정)">{options.halves.map(key => <option key={key} value={key}>{labelOf(key)}</option>)}</optgroup>
        <optgroup label="월별">{options.months.map(key => <option key={key} value={key}>{labelOf(key)}</option>)}</optgroup>
      </select></label>
      {result ? <span className="fin-small fin-muted fin-num">{result.period.from} ~ {result.period.to}</span> : null}
    </div>
    <p className="fin-small fin-muted">{biz === COMPANY ? "사업자등록번호가 하나라 부가세 신고는 회사 전체로 해요. 사업별 숫자는 「사업자」에서 골라 볼 수 있어요." : `${scopeLabel(biz)} 몫만 나눠 본 숫자예요. 신고에 쓸 합계는 「회사 전체」에서 확인해 주세요.`}</p>
    {error ? <p className="fin-callout fin-bad" role="alert">{error}</p> : null}
    {!result && !error ? <p className="fin-small fin-muted" role="status">자료를 모으는 중이에요…</p> : null}
    {result ? <>
      {result.purchase.available && result.payable !== null ? <VatPayableSummary salesTax={result.salesTax} purchase={result.purchase} payable={result.payable} /> : null}
      {result.review ? <div className="fin-callout fin-warn"><b>확인 필요</b><span className="fin-grow">같은 매출인지 확인하지 않은 계산서가 {result.review}건 있어요. 확인 전에는 결제·외부 매출 줄과 계산서 줄에 둘 다 들어갈 수 있어요.</span><Link href="/finance/sales" className="secondary-button compact">매출내역에서 확인</Link></div> : null}
      <div className="fin-tiles fin-t4 fin-gap">
        <div className="fin-tile"><span className="fin-l">공급가액</span><span className="fin-v">{won(sum("supply"))}원</span></div>
        <div className="fin-tile"><span className="fin-l">세액</span><span className="fin-v">{won(sum("tax"))}원</span></div>
        <div className="fin-tile fin-total"><span className="fin-l">합계</span><span className="fin-v">{won(sum("total"))}원</span></div>
        <div className="fin-tile"><span className="fin-l">건수</span><span className="fin-v">{won(result.rows.length)}건</span><span className="fin-d">결제·발급 {count("payCount")} · 취소·수정 {count("cancelCount")}</span></div>
      </div>
      <div className="fin-tbl-wrap"><table className="fin-tbl">
        <thead><tr><th>증빙</th><th>기준일</th><th className="fin-r">결제·발급</th><th className="fin-r">취소·수정</th><th className="fin-r">공급가액</th><th className="fin-r">세액</th><th className="fin-r">합계</th></tr></thead>
        <tbody>{result.lines.map(line => { const { name, hint } = split(line.label); return <tr key={line.evidence} className={line.count ? undefined : "fin-zero"}>
          <td><b>{name}</b>{hint ? <span className="fin-sub2">{hint}</span> : null}</td><td className="fin-small fin-nw">{line.basis}</td>
          <td className="fin-r">{line.payCount}</td><td className="fin-r">{line.cancelCount}</td><td className="fin-r">{won(line.supply)}</td><td className="fin-r">{won(line.tax)}</td><td className="fin-r"><b>{won(line.total)}</b></td></tr>; })}</tbody>
        <tfoot><tr><td colSpan={2}>합계</td><td className="fin-r">{count("payCount")}</td><td className="fin-r">{count("cancelCount")}</td><td className="fin-r">{won(sum("supply"))}</td><td className="fin-r">{won(sum("tax"))}</td><td className="fin-r">{won(sum("total"))}</td></tr></tfoot>
      </table></div>
      <ul className="fin-note fin-notes">
        <li>토스 결제는 과세 매출로 보고 합계를 11로 나눠 세액을 계산했어요. 면세 상품이면 달라요.</li>
        <li>계좌이체·가상계좌의 현금영수증 발급 여부는 토스에서 확인해 주세요.</li>
        <li>세금계산서와 같은 매출로 확인한 결제·외부 매출은 계산서 줄에서만 셉니다.</li>
      </ul>
      <details className="fin-details"><summary>상세 {result.rows.length}건 보기</summary><div className="fin-tbl-wrap"><table className="fin-tbl">
        <thead><tr><th>날짜</th><th>증빙</th><th>구분</th><th>거래처 · 상품</th><th className="fin-r">공급가액</th><th className="fin-r">세액</th><th className="fin-r">합계</th><th>메모</th></tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={`${row.ref}:${row.kind}:${index}`}><td className="fin-num">{row.date}<span className="fin-sub2">{row.basis}</span></td><td>{split(EVIDENCE_LABEL[row.evidence]).name}</td><td>{row.kind}</td><td><span className="fin-ell">{row.title}</span></td><td className="fin-r">{won(row.supply)}</td><td className="fin-r">{won(row.tax)}</td><td className="fin-r">{won(row.total)}</td><td className="fin-small fin-muted">{row.note}</td></tr>)}</tbody>
      </table></div></details>
      {result.purchase.available ? <PurchaseInvoicePanel token={token} from={result.period.from} to={result.period.to} biz={biz} onSaved={() => setRevision(value => value + 1)} /> : <PurchaseNotReady />}
    </> : null}
  </section>;
}
