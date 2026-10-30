"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { TAX_BIZ, type Biz } from "@/lib/finance/tax-invoices";
import { EVIDENCE_LABEL, vatCsv, type VatLine, type VatPeriod, type VatRow } from "@/lib/finance/vat";

// 부가세 신고 참고 자료 (재무 요청 a5310134): 월·신고기간별로 결제·취소를 증빙별로 묶어 보고 내려받는다. 신고서가 아니다.

type Result = { period: VatPeriod; lines: VatLine[]; rows: VatRow[]; review: number };
const won = (value: number) => value.toLocaleString("ko-KR");
const BIZ_KEYS = Object.keys(TAX_BIZ) as Biz[];

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

export function VatReference({ token }: { token: string | null }) {
  const options = periodOptions();
  const [period, setPeriod] = useState(options.quarters[0]);
  const [biz, setBiz] = useState<Biz>("edu");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError("");
    apiRequest<Result>(`/api/v1/finance/vat?${new URLSearchParams({ period, biz })}`, { token, signal: controller.signal }).then(setResult)
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "자료를 불러오지 못했어요."); });
    return () => controller.abort();
  }, [period, biz, token]);

  const fileName = `부가세참고_${TAX_BIZ[biz]}_${period}`;
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
      summary.addRow([`${TAX_BIZ[biz]} · ${result.period.label} · 부가세 신고 참고 자료 (신고서가 아닙니다)`]);
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
    <div className="ph"><div className="ph-t"><h1>부가세 신고 참고 자료</h1>
      <p className="ph-s">토스 결제·취소, 홈택스 계산서, 외부 매출을 증빙별로 묶은 참고 자료예요. 실제 신고는 세무사와 홈택스 자료로 확인해 주세요.</p></div>
      <div className="ph-a">
        <button type="button" className="btn sm" disabled={!result?.rows.length} onClick={csv}>CSV 내보내기</button>
        <button type="button" className="btn sm pri" disabled={!result?.rows.length || busy} onClick={() => void excel()}>{busy ? "만드는 중…" : "엑셀 내려받기"}</button>
      </div></div>
    <div className="toolbar">
      <label className="fin-field"><span>사업자</span><select className="sel" value={biz} onChange={event => setBiz(event.target.value as Biz)}>{BIZ_KEYS.map(key => <option key={key} value={key}>{TAX_BIZ[key]}</option>)}</select></label>
      <label className="fin-field"><span>기간</span><select className="sel" value={period} onChange={event => setPeriod(event.target.value)}>
        <optgroup label="신고기간 (예정·확정)">{options.quarters.map(key => <option key={key} value={key}>{labelOf(key)}</option>)}</optgroup>
        <optgroup label="반기 (개인사업자 확정)">{options.halves.map(key => <option key={key} value={key}>{labelOf(key)}</option>)}</optgroup>
        <optgroup label="월별">{options.months.map(key => <option key={key} value={key}>{labelOf(key)}</option>)}</optgroup>
      </select></label>
      {result ? <span className="small muted num">{result.period.from} ~ {result.period.to}</span> : null}
    </div>
    {error ? <p className="callout bad" role="alert">{error}</p> : null}
    {!result && !error ? <p className="small muted" role="status">자료를 모으는 중이에요…</p> : null}
    {result ? <>
      {result.review ? <div className="callout warn"><b>확인 필요</b><span className="grow">같은 매출인지 확인하지 않은 계산서가 {result.review}건 있어요. 확인 전에는 결제·외부 매출 줄과 계산서 줄에 둘 다 들어갈 수 있어요.</span><Link href="/finance/sales" className="btn sm">매출내역에서 확인</Link></div> : null}
      <div className="tiles t4 fin-gap">
        <div className="tile"><span className="l">공급가액</span><span className="v">{won(sum("supply"))}원</span></div>
        <div className="tile"><span className="l">세액</span><span className="v">{won(sum("tax"))}원</span></div>
        <div className="tile fin-total"><span className="l">합계</span><span className="v">{won(sum("total"))}원</span></div>
        <div className="tile"><span className="l">건수</span><span className="v">{won(result.rows.length)}건</span><span className="d">결제·발급 {count("payCount")} · 취소·수정 {count("cancelCount")}</span></div>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>증빙</th><th>기준일</th><th className="r">결제·발급</th><th className="r">취소·수정</th><th className="r">공급가액</th><th className="r">세액</th><th className="r">합계</th></tr></thead>
        <tbody>{result.lines.map(line => { const { name, hint } = split(line.label); return <tr key={line.evidence} className={line.count ? undefined : "fin-zero"}>
          <td><b>{name}</b>{hint ? <span className="sub2">{hint}</span> : null}</td><td className="small">{line.basis}</td>
          <td className="r">{line.payCount}</td><td className="r">{line.cancelCount}</td><td className="r">{won(line.supply)}</td><td className="r">{won(line.tax)}</td><td className="r"><b>{won(line.total)}</b></td></tr>; })}</tbody>
        <tfoot><tr><td colSpan={2}>합계</td><td className="r">{count("payCount")}</td><td className="r">{count("cancelCount")}</td><td className="r">{won(sum("supply"))}</td><td className="r">{won(sum("tax"))}</td><td className="r">{won(sum("total"))}</td></tr></tfoot>
      </table></div>
      <ul className="note fin-notes">
        <li>토스 결제는 과세 매출로 보고 합계를 11로 나눠 세액을 계산했어요. 면세 상품이면 달라요.</li>
        <li>계좌이체·가상계좌의 현금영수증 발급 여부는 토스에서 확인해 주세요.</li>
        <li>세금계산서와 같은 매출로 확인한 결제·외부 매출은 계산서 줄에서만 셉니다.</li>
      </ul>
      <details className="fin-details"><summary>상세 {result.rows.length}건 보기</summary><div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>날짜</th><th>증빙</th><th>구분</th><th>거래처 · 상품</th><th className="r">공급가액</th><th className="r">세액</th><th className="r">합계</th><th>메모</th></tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={`${row.ref}:${row.kind}:${index}`}><td className="num">{row.date}<span className="sub2">{row.basis}</span></td><td>{split(EVIDENCE_LABEL[row.evidence]).name}</td><td>{row.kind}</td><td><span className="ell">{row.title}</span></td><td className="r">{won(row.supply)}</td><td className="r">{won(row.tax)}</td><td className="r">{won(row.total)}</td><td className="small muted">{row.note}</td></tr>)}</tbody>
      </table></div></details>
    </> : null}
  </section>;
}
