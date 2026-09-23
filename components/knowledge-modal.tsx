"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function KnowledgeModal({ title, onClose, busy = false, children, className = "" }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button")?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`knowledge-modal ${className}`} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) closeRef.current(); }
      if (event.key === "Tab") {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? [])];
        if (!items.length) return;
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    }}>{children}</div>
  </div>;
}
