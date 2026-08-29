"use client";

import { ArrowRight, FileText, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NAV_STAGES } from "@/lib/navigation";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
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
    setQuery("");
    window.setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;
  const go = (href: string) => {
    router.push(href);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="빠른 이동">
        <div className="command-input-row">
          <Search size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches[0]) go(matches[0].href);
            }}
            placeholder="페이지나 지식을 검색하세요"
          />
          <button onClick={onClose}><X size={18} /></button>
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
