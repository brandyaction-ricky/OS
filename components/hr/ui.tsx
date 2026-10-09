"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export function Button({
  children,
  primary = false,
  danger = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      {...props}
      className={`hr-button${primary ? " primary" : ""}${danger ? " danger" : ""} ${props.className || ""}`}
    >
      {children}
    </button>
  );
}
export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`hr-pill ${tone}`}>{children}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="hr-empty">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
export function Cards({
  items,
}: {
  items: Array<{
    label: string;
    value: ReactNode;
    description: ReactNode;
    tone?: string;
  }>;
}) {
  return (
    <div className="hr-cards">
      {items.map((x) => (
        <div className="hr-card" key={x.label}>
          <span>{x.label}</span>
          <strong className={x.tone}>{x.value}</strong>
          <small>{x.description}</small>
        </div>
      ))}
    </div>
  );
}
export function Tabs({
  items,
  current,
}: {
  items: Array<[string, string]>;
  current: string;
}) {
  const path = usePathname(),
    params = useSearchParams();
  return (
    <nav className="hr-tabs" aria-label="화면 탭">
      {items.map(([key, label]) => {
        const q = new URLSearchParams(params.toString());
        q.set("tab", key);
        return (
          <Link
            key={key}
            href={`${path}?${q}`}
            aria-current={current === key ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
export function Table({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="hr-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${head[0]} 목록`}
    >
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={`${h}:${i}`} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Panel({
  title,
  extra,
  children,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hr-panel">
      {title ? (
        <header>
          <h2>{title}</h2>
          {extra}
        </header>
      ) : null}
      {children}
    </section>
  );
}
export function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="hr-field">
      <span>
        {label}
        {required ? <b aria-hidden="true"> *</b> : null}
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
export function Drawer({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const id = useId(),
    ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose),
    busyRef = useRef(busy);
  close.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLElement>("input,select,textarea,button")
      ?.focus();
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
          ) || [],
        ).filter((x) => x.offsetParent !== null);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = prior;
      old?.focus();
    };
  }, []);
  return (
    <div
      className="hr-drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={ref}
        className="hr-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <Button aria-label="입력 창 닫기" onClick={onClose} disabled={busy}>
            <X size={18} />
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}
