"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { countText, parseNumbers as parse } from "@/lib/count-text";


/**
 * 성과 숫자 (owner 2026-11-25, like a store's running sales total): when a figure arrives it runs up from 0 (or from the figure it
 * showed before) to its value in about 0.7 s, slowing at the end, so the wait for data feels shorter. Only the final number is real;
 * screen readers get it straight away. Text without digits ("—") and reduced-motion settings show the value as it is.
 */
export function CountUp({ children }: { children: ReactNode }) {
  const text = typeof children === "number" ? children.toLocaleString("ko-KR") : typeof children === "string" ? children : null;
  const [shown, setShownState] = useState(() => text === null ? null : countText(text, [], 0));
  // Runs start from what is on screen, so a new figure mid-run carries on from there.
  const onScreen = useRef(shown);
  const setShown = (value: string) => { onScreen.current = value; setShownState(value); };
  useEffect(() => {
    if (text === null) return;
    const to = parse(text), from = parse(onScreen.current ?? "");
    if (!to.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches || to.every((value, i) => value === from[i])) { setShown(text); return; }
    // The clock starts at the first painted frame: a page busy drawing a big table right after its data arrives must not eat the run.
    let frame = 0, start = 0;
    const step = (now: number) => {
      start ||= now;
      const t = Math.min(1, (now - start) / 700);
      setShown(countText(text, from, 1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setShown only writes a ref and state
  }, [text]);
  if (text === null) return <>{children}</>;
  return <span className="count-up"><span className="sr-only">{text}</span><span aria-hidden="true">{shown}</span></span>;
}
