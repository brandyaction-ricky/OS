"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cashOf, cashRows, type Cash } from "@/lib/finance/cashflow";
import { pnlOf, pnlRows, pnlYears, sumCells, type Cell, type Pnl, type PnlGroup, type PnlScreen } from "@/lib/finance/pnl";
import { pnlDemoData } from "@/lib/finance/pnl-demo";
import type { FinanceData } from "@/lib/finance/schema";
import { PnlChart, Swatch, type ChartSeries } from "./pnl-chart";

// 손익 현황 (/finance/pnl): 월별 손익(손익 · 매출·비용 탭)과 통장 자금 흐름(자금 흐름 탭)을 이미 있는 원장에서 계산해 보여 준다.
// 읽기 전용이고 새 API 가 없다. 계산은 lib/finance/pnl.ts · cashflow.ts, 원장 읽기는 재무 작업공간과 같은 loadLedger.
// 연습용(데모)에서는 API 를 부르지 않고 예시 원장을 쓴다.

type Tab = "pnl" | "sales" | "cash";
type Target = { kind: "pnl" | "cash"; key: string; label: string; screen: PnlScreen; month: number };
type TableRow = { key: string; label: string; months: Cell[]; strong?: boolean; sub?: boolean; signed?: boolean; noSum?: boolean; target?: Omit<Target, "month">; expand?: { open: boolean; toggle: () => void } };
const TABS: [Tab, string][] = [["pnl", "손익"], ["sales", "매출·비용"], ["cash", "자금 흐름"]];
const BIZ = [["all", "전체 사업"], ["edu", "에듀"], ["myin", "마이인"], ["hm", "하루멜라"]] as const;
const SCREEN: Record<PnlScreen, string> = { sales: "매출내역", cards: "카드지출", bank: "통장 내역" };
const ROW_LIMIT = 500, NOTICE_KEY = "brandy-os-finance-pnl-notice";
const won = (value: number) => value.toLocaleString("ko-KR");
const seoulToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
// 9/28(월) — the way the neighbouring finance tables write a date.
const dayOf = (date: string) => { const [year, month, day] = date.split("-").map(Number); return { day: `${month}/${day}`, week: "일월화수목금토"[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] }; };
// 사업을 고르면 통장에서 나간 비용은 계산하지 않는다. 0 으로 보이면 「인건비 0원」으로 읽히므로 그 줄은 아예 그리지 않는다.
const shownCosts = (pnl: Pnl) => pnl.costs.filter(group => pnl.bankIncluded || group.screen !== "bank");
const hasRows = (data: FinanceData) => ["payments", "external_revenues", "card_transactions", "bank_transactions"].some(resource => data[resource]?.some(row => !row.archived_at));

export function ProfitLoss({ token, demo }: { token: string | null; demo: boolean }) {
  const pathname = usePathname(), search = useSearchParams();
  const today = seoulToday(), thisYear = Number(today.slice(0, 4));
  const latestToken = useRef(token);
  latestToken.current = token;
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [drill, setDrill] = useState<Target | null>(null);

  useEffect(() => {
    setError("");
    if (demo) { setData(pnlDemoData(seoulToday())); return; }
    const controller = new AbortController();
    setData(null);
    import("@/lib/finance/client").then(({ loadLedger }) => loadLedger(() => latestToken.current, controller.signal)).then(setData)
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "원장을 불러오지 못했어요."); });
    return () => controller.abort();
  }, [demo, attempt]);

  // 탭 · 연도 · 사업은 주소에 둔다 (재무 다른 화면의 period · month · biz · tab 과 같은 방식): 새로고침 · 링크 공유에도 그대로.
  const years = useMemo(() => data ? pnlYears(data, today) : [thisYear], [data, today, thisYear]);
  const tab: Tab = TABS.find(([key]) => key === search.get("tab"))?.[0] ?? "pnl";
  const year = years.includes(Number(search.get("year"))) ? Number(search.get("year")) : thisYear;
  // 통장 거래에는 사업 구분이 없어 자금 흐름 탭은 사업을 고르지 않는다.
  const biz = tab !== "cash" && BIZ.some(([key]) => key === search.get("biz")) ? search.get("biz")! : "all";
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(patch)) if (value === null) next.delete(key); else next.set(key, value);
    // null, not history.state: Next then syncs useSearchParams with the new address (its own state object would skip that).
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`);
  };

  const pnl = useMemo(() => data && tab !== "cash" ? pnlOf(data, year, biz, today) : null, [data, tab, year, biz, today]);
  const previous = useMemo(() => data && tab === "sales" && years.includes(year - 1) ? pnlOf(data, year - 1, biz, today) : null, [data, tab, years, year, biz, today]);
  const cash = useMemo(() => data && tab === "cash" ? cashOf(data, year, today) : null, [data, tab, year, today]);

  return <section className="finance-workspace finance-react" aria-label="손익 현황">
    <div className="fin-ph"><div className="fin-ph-t"><h1>손익 현황</h1>
      <p className="fin-ph-s">매출내역 · 카드지출 · 통장 내역에 있는 자료로 월별 매출과 비용, 손익, 자금 흐름을 계산해요.</p></div></div>
    <div className="fin-tabs" role="tablist" aria-label="손익 현황 보기">{TABS.map(([key, label]) =>
      <button type="button" className="fin-tab" role="tab" key={key} aria-selected={tab === key} onClick={() => go({ tab: key === "pnl" ? null : key })}>{label}</button>)}</div>
    <Notice>{tab === "cash" ? <>
      <li>자금 흐름은 통장 내역의 입금과 출금으로 계산해요. 매출 · 비용이 아니라 실제로 들어오고 나간 돈이에요.</li>
      <li>내 통장 사이에 옮긴 돈(내 통장 간 이체)은 유입 · 유출에서 뺐어요.</li>
      <li>보유 자금은 월말에 각 통장에 남은 잔액을 더한 값이에요. 이번 달은 오늘까지 올라온 거래 기준이에요.</li>
    </> : <>
      <li>금액은 기록된 그대로(부가세 포함)예요. 그래서 개요 · 매출내역 · 카드지출 화면의 숫자와 같아요.</li>
      <li>매출은 토스 결제에서 취소를 뺀 금액에 외부 매출을 더한 값이고, 결제일 · 취소일 · 매출일이 속한 달에 넣어요.</li>
      <li>급여 · 임대료처럼 통장에서 나간 비용은 사업을 나눌 수 없어서 ‘전체 사업’에서만 보여요. 사업을 고르면 그 사업으로 분류한 매출과 카드지출만 보여요.</li>
      <li>카드 대금과 내 통장 간 이체는 두 번 세지 않도록 뺐어요. 세금 납부와 아직 분류하지 않은 출금도 손익에 넣지 않아요.</li>
      <li>결제 수수료를 아직 모르는 달은 ‘미확인’으로 두고 비용 합계에 넣지 않아요.</li>
    </>}</Notice>
    <div className="os-toolbar fin-pnl-bar">
      <div className="fin-pnl-year" role="group" aria-label="연도">
        <button type="button" aria-label="이전 연도" disabled={year <= years[0]} onClick={() => go({ year: String(year - 1) })}><ChevronLeft size={14} aria-hidden="true" /></button>
        <b>{year}</b>
        <button type="button" aria-label="다음 연도" disabled={year >= thisYear} onClick={() => go({ year: year + 1 === thisYear ? null : String(year + 1) })}><ChevronRight size={14} aria-hidden="true" /></button>
      </div>
      {tab !== "cash" ? <div className="fin-chips" role="group" aria-label="사업">{BIZ.map(([key, label]) =>
        <button type="button" className="os-chip" key={key} aria-pressed={biz === key} onClick={() => go({ biz: key === "all" ? null : key })}>{key === "all" ? label : <span className="os-biz" data-biz={key}>{label}</span>}</button>)}</div> : null}
      {demo ? <span className="fin-small fin-muted">연습용 예시 자료예요. 실제 거래가 아니에요.</span> : null}
    </div>
    {error ? <p className="fin-callout fin-bad" role="alert"><span className="fin-grow">{error}</span><button type="button" className="secondary-button compact" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></p> : null}
    {!data && !error ? <p className="fin-small fin-muted" role="status">원장을 불러오는 중이에요…</p> : null}
    {cash ? <CashTab cash={cash} today={today} onDrill={setDrill} /> : null}
    {data && pnl ? !hasRows(data) ? <div className="fin-empty fin-pnl-start" role="status"><b>아직 손익을 계산할 기록이 없어요</b>
        <span>토스 결제를 동기화하거나 카드 · 통장 자료를 올리면 여기에 월별 손익이 나와요.</span>
        <span className="fin-pnl-actions"><Link className="secondary-button compact" href="/finance/sales">매출내역</Link><Link className="secondary-button compact" href="/finance/cards">카드지출</Link><Link className="secondary-button compact" href="/finance/bank">통장 내역</Link></span></div>
      : tab === "sales" ? <SalesTab pnl={pnl} previous={previous} />
      : <PnlTab pnl={pnl} today={today} open={open} onToggle={key => setOpen(value => ({ ...value, [key]: !value[key] }))} onDrill={setDrill} /> : null}
    {data && drill ? <DrillDialog data={data} year={year} biz={biz} target={drill} onClose={() => setDrill(null)} /> : null}
  </section>;
}

// 안내사항: 처음에는 펼쳐 두고(좁은 화면에서는 접어 두고), 접거나 펼친 뒤에는 그 선택을 이 브라우저에 기억한다.
function Notice({ children }: { children: ReactNode }) {
  const node = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(NOTICE_KEY); } catch { /* 저장소를 쓸 수 없는 브라우저: 기본값으로 */ }
    if (node.current) node.current.open = saved ? saved === "open" : !window.matchMedia("(max-width: 639px)").matches;
  }, []);
  // The click comes before the box toggles, so what gets stored is the state it is about to have.
  const remember = () => { try { window.localStorage.setItem(NOTICE_KEY, node.current?.open ? "closed" : "open"); } catch { /* 기억하지 못해도 접고 펼치기는 된다 */ } };
  return <details ref={node} className="fin-pnl-notice" open><summary onClick={remember}>안내사항</summary><ul>{children}</ul></details>;
}

// 월별 표: 항목 · 1월…12월 · 합계. 달 칸은 모두 같은 너비이고, 첫 칸은 가로로 밀어도 남는다.
// 아직 오지 않은 달은 –, 시작한 달인데 값을 모르면 미확인, 0 이 아닌 금액은 눌러서 그 달의 내역을 연다.
function MonthTable({ year, open, today, rows, onDrill }: { year: number; open: number; today: string; rows: TableRow[]; onDrill: (target: Target) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const now = year === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) - 1 : -1;
  // 좁은 화면에서는 이번 달 칸이 보이는 곳까지 밀어 둔다 (연도를 바꾸면 다시). 넓어서 다 보이면 아무 일도 없다.
  useLayoutEffect(() => {
    const box = wrap.current, current = box?.querySelector<HTMLElement>("thead .fin-pnl-now"), sum = box?.querySelector<HTMLElement>("thead .fin-pnl-sum");
    if (!box) return;
    const pinned = sum && getComputedStyle(sum).position === "sticky" ? sum.offsetWidth : 0;
    box.scrollLeft = current ? Math.max(0, current.offsetLeft + current.offsetWidth - (box.clientWidth - pinned)) : 0;
  }, [year]);
  return <div className="fin-tbl-wrap fin-pnl-wrap" ref={wrap}><table className="fin-tbl fin-pnl-mx">
    <colgroup><col className="fin-pnl-c-name" />{Array.from({ length: 12 }, (_, index) => <col key={index} className="fin-pnl-c-month" />)}<col className="fin-pnl-c-sum" /></colgroup>
    <thead><tr><th scope="col">항목</th>{Array.from({ length: 12 }, (_, index) => <th scope="col" key={index} className={index === now ? "fin-r fin-pnl-m fin-pnl-now" : "fin-r fin-pnl-m"}>{index + 1}월</th>)}<th scope="col" className="fin-r fin-pnl-sum">합계</th></tr></thead>
    <tbody>{rows.map(row => {
      const total = row.noSum ? null : sumCells(row.months);
      return <tr key={row.key} className={row.strong ? "fin-pnl-strong" : row.sub ? "fin-pnl-sub" : undefined}>
        <th scope="row">{row.sub ? row.label : row.expand
          ? <button type="button" className="fin-pnl-tw" aria-expanded={row.expand.open} onClick={row.expand.toggle}>{row.expand.open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}{row.label}</button>
          : <span className="fin-pnl-tw"><span aria-hidden="true" />{row.label}</span>}</th>
        {row.months.map((value, index) => <td key={index} className={`fin-r${index === now ? " fin-pnl-now" : ""}${row.signed && value !== null && value < 0 ? " fin-dn" : ""}`}>
          {value === null ? index < open ? <span className="fin-muted">미확인</span> : "–"
            : value !== 0 && row.target ? <button type="button" className="fin-pnl-amt" aria-label={`${index + 1}월 ${row.target.label} ${won(value)}원 내역 보기`} onClick={() => onDrill({ ...row.target!, month: index + 1 })}>{won(value)}</button> : won(value)}
        </td>)}
        <td className={`fin-r fin-pnl-sum${row.signed && (total ?? 0) < 0 ? " fin-dn" : ""}`}>{total === null ? "–" : won(total)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function PnlTab({ pnl, today, open, onToggle, onDrill }: { pnl: Pnl; today: string; open: Record<string, boolean>; onToggle: (key: string) => void; onDrill: (target: Target) => void }) {
  const costs = shownCosts(pnl);
  const series: ChartSeries[] = [
    { label: "토스 결제 순매출", tone: "rev1", stack: "revenue", values: pnl.revenue.lines[0].months },
    { label: "외부 매출", tone: "rev2", stack: "revenue", values: pnl.revenue.lines[1].months },
    ...costs.map(group => ({ label: group.label, tone: group.key, stack: "cost", values: group.months })),
    { label: "손익", tone: "profit", lossTone: "loss", stack: "profit", values: pnl.profit },
  ];
  // A group opens to its lines; a group that is its own single line (결제 수수료) or has none does not.
  const group = (item: PnlGroup, label: string, strong = false): TableRow[] => {
    const expandable = item.lines.length > 1 || (item.lines.length === 1 && item.lines[0].label !== item.label), isOpen = expandable && Boolean(open[item.key]);
    return [{ key: item.key, label, months: item.months, strong, target: { kind: "pnl", key: item.key, label: item.label, screen: item.screen }, expand: expandable ? { open: isOpen, toggle: () => onToggle(item.key) } : undefined },
      ...(isOpen ? item.lines.map((line): TableRow => ({ key: line.key, label: line.label, months: line.months, sub: true, target: { kind: "pnl", key: line.key, label: line.label, screen: item.screen } })) : [])];
  };
  const rows: TableRow[] = [...group(pnl.revenue, "매출 합계", true), ...costs.flatMap(item => group(item, item.label)),
    { key: "cost-total", label: "비용 합계", months: pnl.costTotal, strong: true }, { key: "profit", label: "손익", months: pnl.profit, strong: true, signed: true }];
  const tax = pnl.excluded.reduce((sum, month) => sum + (month?.tax ?? 0), 0), unclassified = pnl.excluded.reduce((sum, month) => sum + (month?.unclassified ?? 0), 0), count = pnl.excluded.reduce((sum, month) => sum + (month?.unclassifiedCount ?? 0), 0);
  return <div role="tabpanel" aria-label="손익">
    <PnlChart title="손익 현황" year={pnl.year} series={series} />
    <section className="fin-card fin-pnl-card" aria-label="손익계산서">
      <div className="fin-card-h"><h2>손익계산서</h2><span className="fin-sub">항목 이름을 누르면 세부 항목이, 금액을 누르면 그 달의 내역이 열려요 · 단위: 원</span></div>
      <MonthTable year={pnl.year} open={pnl.open} today={today} rows={rows} onDrill={onDrill} />
      {!pnl.bankIncluded ? <p className="fin-note fin-pnl-foot">통장에서 나간 비용(인건비 · 임대료 등)은 ‘전체 사업’에서만 보여요. 지금은 이 사업으로 분류한 매출과 카드지출, 결제 수수료만 계산했어요.</p>
        : tax || count ? <div className={`fin-callout fin-pnl-foot ${count ? "fin-warn" : "fin-info"}`}><b>손익에 넣지 않은 출금</b>
          <span className="fin-grow">세금 납부 {won(tax)}원{count ? ` · 미분류 출금 ${count}건 ${won(unclassified)}원. 분류하면 그 달 비용에 들어가요.` : ""}</span>
          <Link href="/finance/bank" className="secondary-button compact">통장 내역에서 {count ? "분류하기" : "보기"}</Link></div> : null}
    </section>
  </div>;
}

function SalesTab({ pnl, previous }: { pnl: Pnl; previous: Pnl | null }) {
  const of = (key: string) => pnl.costs.find(group => group.key === key)!.months;
  const bank = of("labor").map((value, index) => value === null ? null : value + (of("bank")[index] ?? 0));
  const kpis: [string, string, Cell][] = [["매출", "rev1", sumCells(pnl.revenueTotal)], ["비용", "card", sumCells(pnl.costTotal)], ["매출 · 비용 차액", "line", sumCells(pnl.profit)]];
  return <div role="tabpanel" aria-label="매출·비용">
    <div className="fin-pnl-kpis">{kpis.map(([label, tone, value]) => <div className="fin-tile fin-pnl-kpi" key={label}>
      <b><Swatch tone={tone} size={14} />{label}</b>
      <span className="fin-pnl-kpi-v"><span className="fin-l">총 합계</span><span className="fin-v">{value === null ? "–" : `${won(value)}원`}</span></span>
    </div>)}</div>
    <PnlChart title="매출·비용 요약" year={pnl.year} series={[
      { label: "매출", tone: "rev1", stack: "revenue", values: pnl.revenueTotal },
      { label: "비용", tone: "card", stack: "cost", values: pnl.costTotal },
      { label: "매출 · 비용 차액", tone: "line", line: true, values: pnl.profit },
    ]} />
    <PnlChart title="매출 상세" year={pnl.year} series={[
      ...(previous ? [{ label: "전년도 매출", tone: "prev", stack: "previous", values: previous.revenueTotal }] : []),
      { label: "토스 결제 순매출", tone: "rev1", stack: "now", values: pnl.revenue.lines[0].months },
      { label: "외부 매출", tone: "rev2", stack: "now", values: pnl.revenue.lines[1].months },
    ]} />
    <PnlChart title="비용 상세" year={pnl.year} series={[
      ...(previous ? [{ label: "전년도 비용", tone: "prev", stack: "previous", values: previous.costTotal }] : []),
      ...(pnl.bankIncluded ? [{ label: "통장 출금", tone: "labor", stack: "now", values: bank }] : []),
      { label: "카드지출", tone: "card", stack: "now", values: of("card") },
      { label: "결제 수수료", tone: "fee", stack: "now", values: of("fee") },
    ]} />
  </div>;
}

function CashTab({ cash, today, onDrill }: { cash: Cash; today: string; onDrill: (target: Target) => void }) {
  // 통장을 아직 올리지 않은 상태가 기본이다: 빈 표 대신 어디서 시작하는지 알려 준다.
  if (cash.empty) return <div role="tabpanel" aria-label="자금 흐름"><div className="fin-empty fin-pnl-start" role="status"><b>아직 통장 내역이 없어요</b>
    <span>통장 내역에서 은행 거래 파일을 올리면 월별 유입 · 유출과 보유 자금이 여기에 나와요.</span>
    <span className="fin-pnl-actions"><Link className="primary-button compact fin-pnl-cta" href="/finance/bank">통장 내역에서 파일 올리기</Link></span></div></div>;
  const current = cash.year === Number(today.slice(0, 4)), held = cash.open ? cash.balance[cash.open - 1] : null;
  const target = (key: string, label: string): Omit<Target, "month"> => ({ kind: "cash", key, label, screen: "bank" });
  return <div role="tabpanel" aria-label="자금 흐름">
    <div className="fin-card fin-pnl-info">
      <div><span className="fin-l">기준</span><b>{cash.year}년 {current ? `${cash.open}월 · 오늘까지` : "12월 말"}</b></div>
      <div><span className="fin-l">보유 자금</span><b className="fin-num">{held === null ? "잔액 미확인" : `${won(held)}원`}</b></div>
    </div>
    <div className="fin-pnl-kpis">{cash.accounts.map(account => <div className="fin-tile" key={account.id}>
      <span className="fin-l">{account.bank} {account.name}{account.last4 ? ` ••${account.last4}` : ""}</span>
      <span className="fin-v">{account.balance === null ? "잔액 미확인" : `${won(account.balance)}원`}</span>
      <span className="fin-d">{account.asOf ? `지금 잔액 · ${dayOf(account.asOf).day} 거래까지` : "거래 없음"}</span>
    </div>)}</div>
    <PnlChart title="자금 흐름" year={cash.year} series={[
      { label: "유입액", tone: "rev1", stack: "in", values: cash.inflow },
      { label: "유출액", tone: "card", stack: "out", values: cash.outflow },
      { label: "보유 자금", tone: "line", line: true, keep: true, values: cash.balance },
    ]} />
    <PnlChart title="순유입액 추이" year={cash.year} series={[{ label: "순유입액", tone: "profit", lossTone: "loss", stack: "net", values: cash.net }]} />
    <section className="fin-card fin-pnl-card" aria-label="자금 내역">
      <div className="fin-card-h"><h2>자금 내역</h2><span className="fin-sub">금액을 누르면 그 달의 통장 거래가 열려요 · 단위: 원</span></div>
      <MonthTable year={cash.year} open={cash.open} today={today} onDrill={onDrill} rows={[
        { key: "inflow", label: "유입액", months: cash.inflow, target: target("inflow", "유입액") },
        { key: "outflow", label: "유출액", months: cash.outflow, target: target("outflow", "유출액") },
        { key: "net", label: "순유입액", months: cash.net, strong: true, signed: true, target: target("net", "순유입액") },
        { key: "balance", label: "보유 자금", months: cash.balance, strong: true, noSum: true },
      ]} />
    </section>
  </div>;
}

function DrillDialog({ data, year, biz, target, onClose }: { data: FinanceData; year: number; biz: string; target: Target; onClose: () => void }) {
  const rows = useMemo(() => target.kind === "cash" ? cashRows(data, year, target.key as "inflow" | "outflow" | "net", target.month) : pnlRows(data, year, biz, target.key, target.month), [data, year, biz, target]);
  const query = new URLSearchParams({ period: "month", month: `${year}-${String(target.month).padStart(2, "0")}` });
  if (biz !== "all" && target.screen !== "bank") query.set("biz", biz);
  if (target.screen === "sales") query.set("tab", target.key === "external" ? "external" : "toss");
  // A native modal dialog: focus stays inside, Esc and a click on the dimmed area close it. The list scrolls inside; the title, the close button and the column heads stay.
  return <dialog ref={node => { if (node && !node.open) node.showModal(); }} className="fin-pnl-dlg" aria-labelledby="fin-pnl-dlg-title" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
    <div className="fin-pnl-dlg-h"><div><h2 id="fin-pnl-dlg-title">[{year}년 {target.month}월 / {target.label}]</h2>
      <p className="fin-small fin-muted">합계 {won(rows.reduce((sum, row) => sum + row.amount, 0))}원 · {won(rows.length)}건</p></div>
      <button type="button" className="fin-x" aria-label="닫기" onClick={event => event.currentTarget.closest("dialog")?.close()}>✕</button></div>
    <div className="fin-pnl-dlg-b"><div className="fin-tbl-wrap fin-pnl-dlg-t"><table className="fin-tbl">
      {/* 좁은 화면에서는 구분 · 분류 칸을 접어 내용 아래 한 줄로 내린다: 금액이 옆으로 밀려 잘리지 않게. */}
      <thead><tr><th scope="col" className="fin-pnl-d-date">일자</th><th scope="col" className="fin-pnl-d-wide">구분</th><th scope="col" className="fin-pnl-d-wide">분류</th><th scope="col">거래처 · 내용</th><th scope="col" className="fin-r fin-pnl-d-amount">금액</th></tr></thead>
      <tbody>{rows.slice(0, ROW_LIMIT).map((row, index) => { const date = dayOf(row.date); return <tr key={index}>
        <td className="fin-num fin-nw">{date.day}<span className="fin-muted">({date.week})</span></td><td className="fin-nw fin-pnl-d-wide">{row.kind}</td><td className="fin-nw fin-pnl-d-wide">{row.category || "–"}</td>
        <td><span className="fin-ell" title={row.title}>{row.title || "–"}</span><span className="fin-sub2 fin-pnl-d-narrow">{[row.kind, row.category].filter(Boolean).join(" · ")}</span></td>
        <td className="fin-r">{won(row.amount)}</td></tr>; })}</tbody>
    </table></div>
      {rows.length > ROW_LIMIT ? <p className="fin-note">앞의 {won(ROW_LIMIT)}건만 보여요. 나머지는 {SCREEN[target.screen]}에서 확인해 주세요.</p> : null}</div>
    <div className="fin-pnl-dlg-f"><Link className="secondary-button compact" href={`/finance/${target.screen}?${query}`}>{SCREEN[target.screen]}에서 이 달 보기</Link></div>
  </dialog>;
}
