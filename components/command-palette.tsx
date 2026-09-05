"use client";

import { ArrowRight, FileText, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NAV_STAGES } from "@/lib/navigation";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");

  const pages = useMemo(
    () => NAV_STAGES.flatMap((stage) => stage.pages.map((page) => ({ ...page, stage: stage.label }))),
    [],
  );
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return pages.slice(0, 8);
    return pages
      .filter((page) => `${page.stage} ${page.label}`.toLocaleLowerCase("ko-KR").includes(normalized))
      .slice(0, 8);
  }, [pages, query]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      const focusable = elements ? Array.from(elements).filter((element) => !element.hidden && element.getClientRects().length > 0) : [];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const keepFocusInDialog = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", keepFocusInDialog);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", keepFocusInDialog);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  const go = (href: string) => {
    router.push(href);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="페이지·지식 검색">
        <div className="command-input-row">
          <Search size={19} />
          <input
            ref={inputRef}
            aria-label="검색할 페이지 또는 지식"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              if (matches[0]) go(matches[0].href);
              else if (query.trim()) go(`/knowledge/search?q=${encodeURIComponent(query.trim())}`);
            }}
            placeholder="페이지나 지식을 검색하세요"
          />
          <button type="button" aria-label="검색 닫기" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="command-results">
          <div className="command-section-title">빠른 이동</div>
          {matches.map((page) => {
            const Icon = page.icon;
            return (
              <button key={page.href} onClick={() => go(page.href)}>
                <span className="command-icon"><Icon size={17} /></span>
                <span><strong>{page.label}</strong><small>{page.stage}</small></span>
                <ArrowRight size={15} />
              </button>
            );
          })}
          {query.trim() ? (
            <button className="knowledge-command" onClick={() => go(`/knowledge/search?q=${encodeURIComponent(query.trim())}`)}>
              <span className="command-icon"><FileText size={17} /></span>
              <span><strong>“{query.trim()}” 지식에서 검색</strong><small>회사 정본과 내 문서</small></span>
              <ArrowRight size={15} />
            </button>
          ) : null}
        </div>
        <footer><span>↵ 이동</span><span>esc 닫기</span></footer>
      </section>
    </div>
  );
}
