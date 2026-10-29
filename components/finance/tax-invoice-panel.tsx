"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { readImportFile } from "@/lib/finance/import-file.mjs";
import { parseHometaxRows, TAX_BIZ, type Biz, type MatchState, type ParsedInvoices, type TaxInvoiceInput } from "@/lib/finance/tax-invoices";
import { vatCsv } from "@/lib/finance/vat";

// 재무 요청 a5310134. 매출내역: 홈택스 계산서 올리기 · 출처별 합계 · 같은 매출 확인. 정산입금: 계산서별 실제 입금 확인.

type Deposit = { state: "confirmed" | "likely" | "unclear" | "none"; bank: { id: string; tx_date: string; deposit: number; description: string } | null; count: number };
type Invoice = TaxInvoiceInput & { id: string; biz: Biz; source: string; created_at: string; match: MatchState; deposit: Deposit };
type Totals = { toss: number; invoices: number; external: number; linkedExcluded: number; suspect: number; total: number };
type Listing = { invoices: Invoice[]; totals: Totals; lastImport: Partial<Record<Biz, string>> };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const BIZ_KEYS = Object.keys(TAX_BIZ) as Biz[];
const STATE_LABEL: Record<MatchState["state"], string> = { linked: "같은 매출 확인됨", suspect: "같은 매출 의심", review: "검토 필요", single: "계산서로만 잡힌 매출" };
const DEPOSIT_LABEL: Record<Deposit["state"], string> = { confirmed: "입금 확인", likely: "입금 추정", unclear: "같은 금액 입금 여럿", none: "입금 못 찾음" };

/** The instructions staff paste into Aside: they sign in to 홈택스 themselves; Aside does the rest. */
export function asideHometaxInstruction(from: string, to: string) {
  return [
    "[홈택스 매출 계산서 → 브랜디 OS 올리기]",
    "0. 홈택스 로그인은 담당자가 직접 합니다. 로그인 정보·인증서는 묻거나 입력하지 마세요.",
    "1. 홈택스 › 조회/발급 › 전자세금계산서 › 목록조회 를 엽니다.",
    `2. 「매출」을 고르고, 작성일자 ${from} ~ ${to} 로 조회합니다.`,
    "3. 결과 아래 「내려받기」(엑셀)로 파일을 저장합니다.",
    "4. 면세 매출이 있으면 조회/발급 › 전자계산서 › 목록조회 에서 같은 기간 「매출」을 한 번 더 내려받습니다.",
    "5. 브랜디 OS › 재무관리 › 매출내역 › 세금계산서(홈택스) 칸에서 사업자를 고르고 「홈택스 엑셀 올리기」로 파일을 올립니다.",
    "6. 미리보기에 나온 건수·합계와 오류 줄을 담당자에게 보여 주고, 담당자가 「저장」을 누르게 합니다.",
    "※ 사업자가 여러 개면 사업자마다 1~6을 반복합니다. 같은 파일을 다시 올려도 이미 올린 계산서는 건너뜁니다.",
  ].join("\n");
}

/** 홈택스 .xls downloads are usually an HTML table; read those, and every .csv/.xlsx through the shared reader. */
async function readRows(file: File): Promise<string[][]> {
  if (/\.xls$/i.test(file.name)) {
    const text = await file.text();
    if (!/<table/i.test(text)) throw new Error("이 .xls 파일은 읽지 못해요. 엑셀에서 열어 .xlsx로 저장한 뒤 올려 주세요.");
    const doc = new DOMParser().parseFromString(text, "text/html");
    return [...doc.querySelectorAll("tr")].map(tr => [...tr.querySelectorAll("th,td")].map(cell => (cell.textContent ?? "").trim()));
  }
  return (await readImportFile(file)) as string[][];
}

export function TaxInvoicePanel({ token, mode }: { token: string | null; mode: "sales" | "deposits" }) {
  const [from, setFrom] = useState(() => today().slice(0, 7) + "-01");
  const [to, setTo] = useState(today);
  const [biz, setBiz] = useState<Biz | "">("");
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadBiz, setUploadBiz] = useState<Biz | "">("");
  const [preview, setPreview] = useState<(ParsedInvoices & { file: string }) | null>(null);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    const params = new URLSearchParams({ from, to, ...(biz ? { biz } : {}) });
    try { setData(await apiRequest<Listing>(`/api/v1/finance/tax-invoices?${params}`, { token, signal })); }
    catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "계산서를 불러오지 못했어요."); }
  }, [from, to, biz, token]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, revision]);

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setError(""); setNote("");
    try { await apiRequest("/api/v1/finance/tax-invoices", { token, method: "POST", body: JSON.stringify(body) }); setNote(done); setRevision(value => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); }
    finally { setBusy(false); }
  };
  const pick = async (file: File | undefined) => {
    setPreview(null); setError(""); setNote("");
    if (!file) return;
    try { setPreview({ ...parseHometaxRows(await readRows(file)), file: file.name }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "파일을 읽지 못했어요."); }
  };
  const save = async () => {
    if (!preview || !uploadBiz || !preview.invoices.length) return;
    setBusy(true); setError(""); setNote("");
    try {
      const result = await apiRequest<{ saved: number; skipped: number }>("/api/v1/finance/tax-invoices", { token, method: "POST", body: JSON.stringify({ action: "import", biz: uploadBiz, invoices: preview.invoices }) });
      setNote(`${result.saved}건 저장했어요${result.skipped ? ` · 이미 올린 ${result.skipped}건은 건너뛰었어요` : ""}.`); setPreview(null); setRevision(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); }
    finally { setBusy(false); }
  };
  const copyAside = async () => {
    try { await navigator.clipboard.writeText(asideHometaxInstruction(from, to)); setNote("Aside 지침을 복사했어요. Aside에 붙여 넣고, 홈택스 로그인은 직접 해 주세요."); }
    catch { setError("복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요."); }
  };
  const download = () => {
    const rows = (data?.invoices ?? []).map(row => ({ evidence: row.invoice_class === "exempt" ? "exempt_invoice" as const : "tax_invoice" as const, kind: row.is_modified ? "수정" as const : "발급" as const, date: row.written_date, basis: "작성일자",
      source: "홈택스", title: row.buyer_name, ref: row.approval_no, supply: row.supply_amount, tax: row.tax_amount, total: row.total_amount, note: `${STATE_LABEL[row.match.state]} · ${DEPOSIT_LABEL[row.deposit.state]}` }));
    const url = URL.createObjectURL(new Blob([vatCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `세금계산서_${from}_${to}.csv` });
    link.click(); URL.revokeObjectURL(url);
    void apiRequest("/api/v1/finance/events", { token, method: "POST", body: JSON.stringify({ kind: "csv_export", view: "tax_invoices", ids: [] }) }).catch(() => undefined);
  };

  const invoices = data?.invoices ?? [];
  const stale = BIZ_KEYS.filter(key => data && data.lastImport[key] && Date.now() - Date.parse(data.lastImport[key]!) > 35 * 86_400_000);
  const totalOf = (rows: Invoice[]) => rows.reduce((sum, row) => sum + row.total_amount, 0);
  return <section className="panel finance-tax-panel" aria-label={mode === "sales" ? "세금계산서 (홈택스)" : "계산서 입금 확인"}>
    <header className="panel-header"><div>
      <h2>{mode === "sales" ? "세금계산서 (홈택스)" : "계산서 · 실제 입금 확인"}</h2>
      <p>{mode === "sales" ? "홈택스 매출 계산서를 올리면, 같은 매출인 토스 결제·외부 매출과 짝을 찾아 한 번만 셉니다. 날짜는 계산서 작성일자 기준이에요." : "계산서마다 같은 금액이 통장에 들어왔는지 찾습니다. 작성일 3일 전부터 90일 뒤까지 같은 금액 입금이 하나면 「입금 추정」이에요."}</p>
    </div></header>
    <div className="finance-tax-filters" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label>시작<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>끝<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <label>사업자<select value={biz} onChange={event => setBiz(event.target.value as Biz | "")}><option value="">전체</option>{BIZ_KEYS.map(key => <option key={key} value={key}>{TAX_BIZ[key]}</option>)}</select></label>
      <button type="button" className="secondary-button" disabled={!invoices.length} onClick={download}>CSV 내려받기</button>
    </div>
    {mode === "sales" && data ? <div className="finance-tax-totals" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, margin: "12px 0" }}>
      {[["토스 결제 (취소 뺌)", data.totals.toss], ["세금계산서", data.totals.invoices], ["외부 매출", data.totals.external], ["같은 매출이라 뺀 금액", -data.totals.linkedExcluded], ["합계 (겹친 것 한 번만)", data.totals.total]].map(([label, value]) =>
        <div key={label as string} className="metric"><span>{label}</span><strong>{won(value as number)}</strong></div>)}
    </div> : null}
    {mode === "sales" && data && data.totals.suspect ? <div className="inline-alert" role="status">확인 전인 「같은 매출 의심 · 검토 필요」 계산서 {won(data.totals.suspect)}이 합계에 아직 두 번 들어가 있어요. 아래에서 확인해 주세요.</div> : null}
    {mode === "sales" ? <div className="finance-tax-upload" style={{ display: "grid", gap: 8, margin: "12px 0" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label>올릴 사업자<select value={uploadBiz} onChange={event => setUploadBiz(event.target.value as Biz | "")}><option value="">고르세요</option>{BIZ_KEYS.map(key => <option key={key} value={key}>{TAX_BIZ[key]}</option>)}</select></label>
        <label className="secondary-button" style={{ cursor: "pointer" }}>홈택스 엑셀 올리기<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }} /></label>
        <button type="button" className="secondary-button" onClick={() => void copyAside()}>Aside에 맡기기 (지침 복사)</button>
      </div>
      {stale.length ? <p className="inline-alert">마지막으로 올린 지 한 달이 넘었어요: {stale.map(key => TAX_BIZ[key]).join(", ")}</p> : null}
      {preview ? <div className="panel" role="status" style={{ padding: 12 }}>
        <p><b>{preview.file}</b> · 계산서 {preview.invoices.length}건 · 합계 {won(totalOf(preview.invoices as Invoice[]))}{preview.invoices.some(row => row.is_modified) ? ` · 수정계산서 ${preview.invoices.filter(row => row.is_modified).length}건` : ""}</p>
        {preview.errors.length ? <ul className="inline-alert">{preview.errors.slice(0, 8).map(item => <li key={item}>{item}</li>)}{preview.errors.length > 8 ? <li>외 {preview.errors.length - 8}건</li> : null}</ul> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="primary-button" disabled={busy || !uploadBiz || !preview.invoices.length || preview.supplierRegNos.length > 1} onClick={() => void save()}>{busy ? "저장하는 중…" : uploadBiz ? `${TAX_BIZ[uploadBiz]}로 저장` : "사업자를 먼저 고르세요"}</button>
          <button type="button" className="secondary-button" onClick={() => setPreview(null)}>취소</button>
        </div>
      </div> : null}
    </div> : null}
    {note ? <p role="status">{note}</p> : null}
    {error ? <p className="inline-alert" role="alert">{error}</p> : null}
    {!data && !error ? <p role="status">계산서를 불러오는 중이에요…</p> : null}
    {data && !invoices.length ? <p className="empty-state">이 기간에 올린 계산서가 없어요.{mode === "sales" ? " 홈택스 엑셀을 올리거나 Aside에 맡겨 보세요." : ""}</p> : null}
    {invoices.length ? <div className="table-wrap"><table className="finance-tax-table">
      <thead><tr><th>작성일</th><th>사업자</th><th>거래처</th><th>합계</th>{mode === "sales" ? <th>같은 매출</th> : <th>입금</th>}<th aria-label="확인" /></tr></thead>
      <tbody>{invoices.map(row => <tr key={row.id}>
        <td>{row.written_date}{row.issued_date && row.issued_date !== row.written_date ? <small> · 발급 {row.issued_date}</small> : null}</td>
        <td>{TAX_BIZ[row.biz]}</td>
        <td>{row.buyer_name || "공급받는자 미기재"}{row.is_modified ? <small> · 수정계산서</small> : null}{row.invoice_class === "exempt" ? <small> · 면세</small> : null}<br /><small>{row.item_summary}</small></td>
        <td>{won(row.total_amount)}<br /><small>공급 {won(row.supply_amount)} · 세액 {won(row.tax_amount)}</small></td>
        {mode === "sales" ? <td><b>{STATE_LABEL[row.match.state]}</b>
          {row.match.linked ? <><br /><small>{row.match.linked.label} · {row.match.linked.date}</small></> : null}
          {row.match.candidates.map(candidate => <div key={`${candidate.type}:${candidate.ref}`}><small>{candidate.type === "payment" ? "토스" : "외부 매출"} · {candidate.label} · {candidate.date} · {won(candidate.amount)}</small>{" "}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "link", invoiceId: row.id, targetType: candidate.type, targetRef: candidate.ref, state: "confirmed" }, "같은 매출로 확인했어요. 합계에서 한 번만 셉니다.")}>같은 매출</button>{" "}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "link", invoiceId: row.id, targetType: candidate.type, targetRef: candidate.ref, state: "rejected" }, "다른 매출로 표시했어요.")}>다른 매출</button></div>)}
        </td> : <td><b>{DEPOSIT_LABEL[row.deposit.state]}</b>{row.deposit.bank ? <><br /><small>{row.deposit.bank.tx_date} · {row.deposit.bank.description}</small></> : null}</td>}
        <td>{mode === "sales"
          ? row.match.state === "linked" && row.match.linked ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "link", invoiceId: row.id, targetType: row.match.linked!.type, targetRef: row.match.linked!.ref, state: "clear" }, "되돌렸어요.")}>되돌리기</button> : null
          : row.deposit.state === "likely" && row.deposit.bank ? <>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "link", invoiceId: row.id, targetType: "bank_tx", targetRef: row.deposit.bank!.id, state: "confirmed" }, "입금을 확인했어요.")}>입금 맞음</button>{" "}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "link", invoiceId: row.id, targetType: "bank_tx", targetRef: row.deposit.bank!.id, state: "rejected" }, "이 입금이 아니라고 표시했어요.")}>아님</button></>
          : row.deposit.state === "confirmed" && row.deposit.bank ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "link", invoiceId: row.id, targetType: "bank_tx", targetRef: row.deposit.bank!.id, state: "clear" }, "되돌렸어요.")}>되돌리기</button> : null}</td>
      </tr>)}</tbody>
    </table></div> : null}
  </section>;
}
