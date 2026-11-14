"use client";

import { useEffect, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { asideHometaxInstruction, parseHometaxRows, TAX_BIZ, type Biz, type ParsedInvoices, type TaxInvoiceInput } from "@/lib/finance/tax-invoices";
import { COMPANY, scopeLabel, type VatScope } from "@/lib/finance/vat";
import { readRows } from "./tax-invoice-panel";

// 재무 2026-11-13. 부가세 참고 자료: 홈택스 매입 계산서 올리기 · 고른 기간에 저장된 매입 계산서. 매입세액 계산의 바탕이다.

type Row = TaxInvoiceInput & { id: string; biz: Biz; source: string; created_at: string };
const won = (value: number) => `${(value || 0).toLocaleString("ko-KR")}원`;
const sum = (rows: TaxInvoiceInput[], key: "supply_amount" | "tax_amount" | "total_amount") => rows.reduce((total, row) => total + row[key], 0);

/** Shown instead of the panel until the purchase table exists (its migration waits for the owner's approval). */
export function PurchaseNotReady() {
  return <p className="fin-callout fin-info fin-mt14" role="status">매입 세금계산서 저장 공간이 아직 준비되지 않았어요. 관리자 승인 후 사용할 수 있어요. 그때까지는 매출 쪽 자료만 보여 드려요.</p>;
}

/** 회사 전체 lists every business's invoices; a file uploaded there is saved as 브랜디액션, the company itself. */
export function PurchaseInvoicePanel({ token, from, to, biz, onSaved }: { token: string | null; from: string; to: string; biz: VatScope; onSaved: () => void }) {
  const saveAs: Biz = biz === COMPANY ? "ba" : biz;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<(ParsedInvoices & { file: string }) | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRows(null); setError("");
    apiRequest<{ invoices: Row[] }>(`/api/v1/finance/purchase-invoices?${new URLSearchParams(biz === COMPANY ? { from, to } : { from, to, biz })}`, { token, signal: controller.signal }).then(result => setRows(result.invoices))
      .catch(reason => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiRequestError && reason.code === "FINANCE_PURCHASE_NOT_READY") setNotReady(true);
        else setError(reason instanceof Error ? reason.message : "매입 계산서를 불러오지 못했어요.");
      });
    return () => controller.abort();
  }, [from, to, biz, token, revision]);

  const pick = async (file: File | undefined) => {
    setPreview(null); setError(""); setNote("");
    if (!file) return;
    try { setPreview({ ...parseHometaxRows(await readRows(file), "purchase"), file: file.name }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "파일을 읽지 못했어요."); }
  };
  const save = async () => {
    if (!preview?.invoices.length) return;
    setBusy(true); setError(""); setNote("");
    try {
      const result = await apiRequest<{ saved: number; skipped: number }>("/api/v1/finance/purchase-invoices", { token, method: "POST", body: JSON.stringify({ action: "import", biz: saveAs, invoices: preview.invoices }) });
      const outside = preview.invoices.filter(row => row.written_date < from || row.written_date > to).length;
      setNote(`${result.saved}건 저장했어요${result.skipped ? ` · 이미 올린 ${result.skipped}건은 건너뛰었어요` : ""}${outside ? ` · ${outside}건은 지금 보는 기간 밖이라 아래 목록에는 없어요` : ""}.`);
      setPreview(null); setRevision(value => value + 1); onSaved();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.code === "FINANCE_PURCHASE_NOT_READY") setNotReady(true);
      else setError(reason instanceof Error ? reason.message : "저장하지 못했어요.");
    } finally { setBusy(false); }
  };

  const copyAside = async () => {
    setError("");
    try { await navigator.clipboard.writeText(asideHometaxInstruction(from, to, "purchase")); setNote("Aside 지침을 복사했어요. Aside에 붙여 넣고, 홈택스 로그인은 직접 해 주세요."); }
    catch { setError("복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요."); }
  };

  if (notReady) return <PurchaseNotReady />;
  const buyers = [...new Set((preview?.invoices ?? []).map(row => row.buyer_reg_no).filter(Boolean))];
  return <div className="fin-card fin-mt14">
    <div className="fin-card-h"><div>
      <h2>매입 세금계산서 (홈택스)</h2>
      <p className="fin-small fin-muted">{from} ~ {to} · {scopeLabel(biz)} · 위에서 고른 사업자와 기간 · 계산서 작성일자 기준</p>
    </div></div>
    <div className="fin-upload">
      <b>매입 계산서 올리기</b>
      <label className="primary-button compact">홈택스 매입 엑셀 올리기<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <button type="button" className="secondary-button compact" onClick={() => void copyAside()}>Aside에 맡기기 (지침 복사)</button>
      <span className="fin-small fin-muted">홈택스 › 전자세금계산서 › 목록조회에서 「매입」으로 내려받은 파일을 {TAX_BIZ[saveAs]} 몫으로 저장해요.</span>
    </div>
    {preview ? <div className="fin-card fin-flat fin-preview" role="status">
      <p><b>{preview.file}</b> · 계산서 {preview.invoices.length}건 · 공급가액 {won(sum(preview.invoices, "supply_amount"))} · 세액 {won(sum(preview.invoices, "tax_amount"))} · 합계 {won(sum(preview.invoices, "total_amount"))}
        {preview.invoices.some(row => row.is_modified) ? ` · 수정계산서 ${preview.invoices.filter(row => row.is_modified).length}건` : ""}{buyers.length === 1 ? ` · 공급받는자 ${preview.invoices[0].buyer_name || buyers[0]}` : ""}</p>
      {preview.errors.length ? <ul className="fin-callout fin-bad">{preview.errors.slice(0, 8).map(item => <li key={item}>{item}</li>)}{preview.errors.length > 8 ? <li>외 {preview.errors.length - 8}건</li> : null}</ul> : null}
      <div className="fin-ph-a">
        <button type="button" className="primary-button compact" disabled={busy || !preview.invoices.length || buyers.length > 1} onClick={() => void save()}>{busy ? "저장하는 중…" : `${TAX_BIZ[saveAs]} 몫으로 저장`}</button>
        <button type="button" className="secondary-button compact fin-ghost" onClick={() => setPreview(null)}>취소</button>
      </div>
    </div> : null}
    {note ? <p className="fin-callout fin-ok-note" role="status">{note}</p> : null}
    {error ? <p className="fin-callout fin-bad" role="alert">{error}</p> : null}
    {!rows && !error ? <p className="fin-small fin-muted" role="status">매입 계산서를 불러오는 중이에요…</p> : null}
    {rows && !rows.length ? <div className="fin-empty"><b>이 기간에 올린 매입 계산서가 없어요</b>홈택스에서 「매입」 목록을 내려받아 올려 주세요.</div> : null}
    {rows?.length ? <div className="fin-tbl-wrap"><table className="fin-tbl">
      <thead><tr><th>작성일자</th><th>거래처</th><th className="fin-r">공급가액</th><th className="fin-r">세액</th><th className="fin-r">합계</th><th>구분</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td className="fin-num">{row.written_date}</td>
        <td>{row.supplier_name || "공급자 미기재"}<span className="fin-sub2">{biz === COMPANY && row.biz !== "ba" ? `${TAX_BIZ[row.biz]} 몫 · ` : ""}{row.item_summary}</span></td>
        <td className="fin-r">{won(row.supply_amount)}</td><td className="fin-r">{won(row.tax_amount)}</td><td className="fin-r">{won(row.total_amount)}</td>
        <td className="fin-nw">{row.invoice_class === "exempt" ? "계산서 (면세)" : "세금계산서"}{row.is_modified ? <span className="status-pill" data-tone="warn">수정</span> : null}</td>
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={2}>합계 {rows.length}건</td><td className="fin-r">{won(sum(rows, "supply_amount"))}</td><td className="fin-r">{won(sum(rows, "tax_amount"))}</td><td className="fin-r">{won(sum(rows, "total_amount"))}</td><td /></tr></tfoot>
    </table></div> : null}
  </div>;
}
