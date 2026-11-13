"use client";
import { useEffect, useRef, useState } from "react";
import { cumulative, type Cell } from "@/lib/finance/pnl";

// 손익 현황 차트 카드: hand-written SVG in the manner of components/performance-daily-chart.tsx. One won axis per chart.
// Bars with the same `stack` pile up; stacks sit side by side inside a month; a `line` series is drawn over them.
// A month that has not come yet is a dotted mark on the baseline (기록 없음); a month whose value is 0 draws nothing.
// Hover or keyboard focus on a month lists every series for that month, and the same text is the month's accessible name.
// `keep` leaves a series out of 누적 보기 (a balance is already a running figure).
export type ChartSeries = { label: string; tone: string; values: Cell[]; stack?: string; line?: boolean; lossTone?: string; keep?: boolean };

const PLOT = 220, TOP = 10, AXIS = 22, GUTTER = 50, MAX_BAR = 24, GAP = 2, TIP = 224;
const won = (value: Cell) => value === null ? "–" : `${value.toLocaleString("ko-KR")}원`;
const compact = (value: number) => {
  const size = Math.abs(value);
  return size >= 1e8 ? `${(value / 1e8).toFixed(2).replace(/\.?0+$/, "")}억` : size >= 1e4 ? `${Math.round(value / 1e4).toLocaleString("ko-KR")}만` : value.toLocaleString("ko-KR");
};
function ticksOf(min: number, max: number) {
  const rough = (max - min) / 4, power = 10 ** Math.floor(Math.log10(rough)), step = [1, 2, 2.5, 5, 10].map(unit => unit * power).find(size => size >= rough)!;
  const ticks: number[] = [];
  for (let value = Math.floor(min / step) * step; value < max + step - 1e-6; value += step) ticks.push(Math.round(value));
  return ticks;
}
// Rounded at the data end, square at the baseline.
const bar = (x: number, width: number, from: number, to: number, round: boolean) => {
  const r = round ? Math.min(4, width / 2, Math.abs(to - from)) : 0, s = to < from ? 1 : -1;
  return `M${x},${from} V${to + s * r} Q${x},${to} ${x + r},${to} H${x + width - r} Q${x + width},${to} ${x + width},${to + s * r} V${from} Z`;
};

export function Swatch({ tone, line, size = 10 }: { tone: string; line?: boolean; size?: number }) {
  return <svg className="fin-pnl-sw" width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
    {line ? <><line className="fin-pnl-line" x1={0} x2={10} y1={5} y2={5} /><circle className="fin-pnl-t-line" cx={5} cy={5} r={2.5} /></> : <rect className={`fin-pnl-t-${tone}`} width={10} height={10} rx={2} />}
  </svg>;
}

export function PnlChart({ title, year, series }: { title: string; year: number; series: ChartSeries[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0), [active, setActive] = useState<number | null>(null), [cum, setCum] = useState(false);
  const hasData = series.some(item => item.values.some(value => value !== null));
  // The plot mounts only once there is a month to draw, so it is measured then.
  useEffect(() => {
    const node = box.current; if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node); return () => observer.disconnect();
  }, [hasData]);

  const shown = series.map(item => cum && !item.keep ? { ...item, values: cumulative(item.values) } : item);
  const bars = shown.filter(item => !item.line), lines = shown.filter(item => item.line);
  const stacks = [...new Set(bars.map(item => item.stack ?? item.label))].map(key => bars.filter(item => (item.stack ?? item.label) === key));
  let max = 10000, min = 0;
  for (let index = 0; index < 12; index += 1) {
    for (const stack of stacks) {
      max = Math.max(max, stack.reduce((sum, item) => sum + Math.max(0, item.values[index] ?? 0), 0));
      min = Math.min(min, stack.reduce((sum, item) => sum + Math.min(0, item.values[index] ?? 0), 0));
    }
    for (const item of lines) { max = Math.max(max, item.values[index] ?? 0); min = Math.min(min, item.values[index] ?? 0); }
  }
  const ticks = ticksOf(min, max), low = ticks[0], high = ticks[ticks.length - 1], unit = PLOT / (high - low);
  const y = (value: number) => TOP + (high - value) * unit, zero = y(0);
  const slot = Math.max(0, width - GUTTER) / 12, thick = Math.max(3, Math.min(MAX_BAR, (slot * 0.72 - GAP * (stacks.length - 1)) / stacks.length));
  const left = (index: number) => GUTTER + index * slot + (slot - (thick * stacks.length + GAP * (stacks.length - 1))) / 2;
  const centre = (index: number) => GUTTER + index * slot + slot / 2;
  const name = (index: number) => `${year}년 ${index + 1}월${cum ? " 누적" : ""}`;
  const every = slot < 30 ? 2 : 1, tipHeight = 40 + shown.length * 18;

  // One stack in one month: segments pile up from the baseline with a 2px gap; only the outermost one is rounded. 0 draws nothing.
  const segments = (stack: ChartSeries[], index: number) => {
    const out: { tone: string; from: number; to: number; end: boolean }[] = [];
    for (const sign of [1, -1]) {
      let edge = zero, last = -1;
      for (const item of stack) {
        const value = item.values[index];
        if (!value || Math.sign(value) !== sign) continue;
        const to = edge - value * unit, from = edge === zero || Math.abs(to - edge) <= GAP + 1 ? edge : edge - sign * GAP;
        last = out.push({ tone: value < 0 && item.lossTone ? item.lossTone : item.tone, from, to: Math.abs(to - from) < 1 ? from - sign : to, end: false }) - 1;
        edge = to;
      }
      if (last >= 0) out[last].end = true;
    }
    return out;
  };

  return <section className="fin-card fin-pnl-card" aria-label={title}>
    <div className="fin-card-h"><h2>{title}</h2>
      {/* The OS kit switch (.switch-label · .switch in os-ui.css): knob left on a plain track = off, knob right on a filled track = on. The word says it too. */}
      <label className="switch-label fin-pnl-cum">
        <button type="button" className="switch fin-pnl-toggle" role="switch" aria-checked={cum} aria-label={`${title} 누적 보기`} onClick={() => setCum(value => !value)} />
        누적 보기<span className={cum ? "fin-pnl-state fin-on" : "fin-pnl-state"} aria-hidden="true">{cum ? "켜짐" : "꺼짐"}</span>
      </label></div>
    {series.length > 1 ? <div className="fin-legend">{series.map(item => <span className="fin-pnl-key" key={item.label}><Swatch tone={item.tone} line={item.line} />{item.label}</span>)}</div> : null}
    {!hasData ? <p className="fin-empty">이 연도에는 아직 기록이 없어요.</p> : <div ref={box} className="fin-pnl-plot">
      {width ? <svg width={width} height={TOP + PLOT + AXIS} role="group" aria-label={`${title} · 월별 차트`} onPointerLeave={() => setActive(null)}>
        {ticks.map(tick => <g key={tick}>
          <line className={tick === 0 ? "fin-pnl-base" : "fin-pnl-grid"} x1={GUTTER} x2={width} y1={Math.round(y(tick)) + 0.5} y2={Math.round(y(tick)) + 0.5} />
          <text className="fin-pnl-axis" x={GUTTER - 8} y={y(tick) + 4} textAnchor="end">{compact(tick)}</text>
        </g>)}
        {active !== null ? <rect className="fin-pnl-band" x={GUTTER + active * slot} y={TOP} width={slot} height={PLOT} /> : null}
        {Array.from({ length: 12 }, (_, index) => <g key={index}>
          {stacks.map((stack, order) => {
            const x = left(index) + order * (thick + GAP);
            return stack.every(item => item.values[index] === null)
              ? <line key={order} className="fin-pnl-missing" x1={x} x2={x + thick} y1={zero - 1} y2={zero - 1} />
              : segments(stack, index).map((part, at) => <path key={`${order}:${at}`} className={`fin-pnl-t-${part.tone}`} d={bar(x, thick, part.from, part.to, part.end)} />);
          })}
          {index % every === 0 ? <text className="fin-pnl-axis" x={centre(index)} y={TOP + PLOT + 16} textAnchor="middle">{index + 1}월</text> : null}
        </g>)}
        {lines.map(item => <g key={item.label}>
          {item.values.map((value, index) => { const next = item.values[index + 1]; return value !== null && next != null ? <line key={index} className="fin-pnl-line" x1={centre(index)} y1={y(value)} x2={centre(index + 1)} y2={y(next)} /> : null; })}
          {item.values.map((value, index) => value === null ? null : <circle key={index} className="fin-pnl-dot" cx={centre(index)} cy={y(value)} r={4} />)}
        </g>)}
        {Array.from({ length: 12 }, (_, index) => <rect key={index} className="fin-pnl-hit" x={GUTTER + index * slot} y={TOP} width={slot} height={PLOT} tabIndex={0} role="img"
          aria-label={`${name(index)}: ${shown.map(item => `${item.label} ${item.values[index] === null ? "기록 없음" : won(item.values[index])}`).join(", ")}`}
          onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />)}
        {active !== null ? <foreignObject className="fin-pnl-tipbox" x={centre(active) + slot / 2 + TIP > width ? Math.max(0, centre(active) - slot / 2 - TIP) : centre(active) + slot / 2} y={TOP} width={TIP} height={tipHeight}>
          <div className="fin-pnl-tip"><b>{name(active)}</b>
            {shown.map(item => { const value = item.values[active]; return <div className="fin-pnl-tr" key={item.label}><Swatch tone={value !== null && value < 0 && item.lossTone ? item.lossTone : item.tone} line={item.line} /><span>{item.label}</span><b>{value === null ? "기록 없음" : won(value)}</b></div>; })}
          </div>
        </foreignObject> : null}
      </svg> : null}
    </div>}
  </section>;
}
