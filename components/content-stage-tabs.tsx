"use client";

type Stage<K extends string> = { key: K; label: string; hint: string; count?: number | null };

/** Presentation only: the owning workspace keeps its existing URL and state. */
export function ContentStageTabs<K extends string>({ label, items, value, onChange }: {
  label: string;
  items: Stage<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return <><span className="stage-scroll-hint" aria-hidden="true">← 좌우로 넘겨 단계 보기 →</span><nav className="step-tabs fullscreen-stage-tabs" aria-label={label}>
    {items.map((item, index) => <button key={item.key} type="button"
      className={`step-tab${value === item.key ? " active" : ""}`}
      aria-pressed={value === item.key} onClick={() => onChange(item.key)}>
      <span className="step-tab-title">{index + 1}. {item.label}{item.count !== undefined ? <small> {item.count === null ? "…" : item.count}</small> : null}</span>
      <span className="step-tab-sub">{item.hint}</span>
    </button>)}
  </nav></>;
}
