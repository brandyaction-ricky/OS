"use client";
import { useEffect, useRef, useState } from "react";
import { dayLabel, shortDay } from "@/lib/performance-period";

// 영상 성과 「일별 조회 흐름」: one bar per Korean day of the chosen period. A day without a record is a dash on the
// baseline and says so — never a 0 bar. Hover or keyboard focus reads that day out above the plot.
const PLOT = 132, AXIS = 20;
const number = (value: number) => value.toLocaleString("ko-KR");

export function PerformanceDailyChart({ days }: { days: { day: string; views: number | null }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0), [active, setActive] = useState<number | null>(null);
  const measured = days.filter((d): d is { day: string; views: number } => d.views !== null), hasData = measured.length > 0;
  // The plot mounts only once there is a day to draw, so it is measured then.
  useEffect(() => {
    const node = box.current; if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node); return () => observer.disconnect();
  }, [hasData]);
  const max = Math.max(1, ...measured.map((d) => d.views));
  const best = measured.reduce<typeof measured[number] | null>((top, d) => !top || d.views > top.views ? d : top, null);
  const slot = days.length ? width / days.length : 0, bar = Math.max(2, Math.min(24, slot * 0.64));
  const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(width / 64))));
  const shown = active === null ? null : days[active];
  const readout = shown ? `${dayLabel(shown.day)} · ${shown.views === null ? "기록 없음" : `조회 ${number(shown.views)}회`}`
    : hasData ? `하루 평균 ${number(Math.round(measured.reduce((sum, d) => sum + d.views, 0) / measured.length))}회${best ? ` · 가장 많은 날 ${dayLabel(best.day)} ${number(best.views)}회` : ""}` : "";
  if (!hasData) return <div className="empty-state">이 기간에 하루 기록이 없어요. 기간을 넓혀 보세요.</div>;
  return <div className="perf-chart">
    <p className="perf-chart-readout" aria-live="polite">{readout}</p>
    <div ref={box} className="perf-chart-plot">
      {width ? <svg width={width} height={PLOT + AXIS} role="group" aria-label="일별 조회" onPointerLeave={() => setActive(null)}>
        <line className="perf-chart-base" x1={0} x2={width} y1={PLOT + 0.5} y2={PLOT + 0.5} />
        {days.map((d, index) => {
          const x = index * slot + (slot - bar) / 2, h = d.views === null ? 0 : Math.max(2, d.views / max * (PLOT - 8)), r = Math.min(4, bar / 2, h);
          return <g key={d.day} className={active === index ? "perf-bar is-active" : "perf-bar"}>
            {d.views === null ? <line className="perf-bar-missing" x1={x} x2={x + bar} y1={PLOT - 1} y2={PLOT - 1} />
              : <path d={`M${x},${PLOT} V${PLOT - h + r} Q${x},${PLOT - h} ${x + r},${PLOT - h} H${x + bar - r} Q${x + bar},${PLOT - h} ${x + bar},${PLOT - h + r} V${PLOT} Z`} />}
            {index % every === 0 || (index === days.length - 1 && index % every >= every / 2) ? <text x={index * slot + slot / 2} y={PLOT + 15} textAnchor="middle">{shortDay(d.day)}</text> : null}
            <rect className="perf-bar-hit" x={index * slot} y={0} width={slot} height={PLOT} tabIndex={0}
              aria-label={`${dayLabel(d.day)} ${d.views === null ? "기록 없음" : `조회 ${number(d.views)}회`}`}
              onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />
          </g>;
        })}
      </svg> : null}
    </div>
  </div>;
}
