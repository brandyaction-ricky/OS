"use client";
import { useEffect, useState } from "react";
import type { CardSourceChoice } from "@/lib/cardnews/sources";
import { errorMessage, type YpClient } from "./youtube-process-data";

const NAMES = { longform: "롱폼", short: "숏폼", threads: "스레드" };
export function CardSourcePicker({ client, busy, onPick }: { client: YpClient | null; busy: boolean; onPick: (source: CardSourceChoice) => Promise<void> }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [kind, setKind] = useState("all"), [limit, setLimit] = useState(8);
  const [sources, setSources] = useState<CardSourceChoice[] | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || !client) return;
    let active = true; setError(""); setSources(null);
    client.cardSources().then(rows => { if (active) setSources(rows); }, reason => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [open, client, retry]);
  const rows = (sources ?? []).filter(row => (kind === "all" || row.kind === kind) && row.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="yp-source-picker">
    <button type="button" className="yp-btn" aria-expanded={open} onClick={() => setOpen(value => !value)}>완료한 주제 가져오기</button>
    {open && <section aria-label="완료한 주제 가져오기" className="yp-source-panel">
      <p className="yp-hint">최종 검토를 마친 롱폼·숏폼과 승인된 스레드를 가져옵니다. 원본은 바뀌지 않습니다.</p>
      <div className="yp-row-btns"><input className="yp-in" aria-label="가져올 주제 검색" placeholder="제목으로 찾기" value={query} onChange={event => { setQuery(event.target.value); setLimit(8); }} />
        <select className="yp-in" aria-label="원본 유형" value={kind} onChange={event => { setKind(event.target.value); setLimit(8); }}><option value="all">전체 유형</option>{Object.entries(NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></div>
      {error ? <p role="alert">{error} <button type="button" className="yp-btn yp-sm" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></p>
        : sources === null ? <p role="status">완료한 주제를 불러오는 중이에요…</p>
          : rows.length ? <ul className="yp-source-list">{rows.slice(0, limit).map(source => <li key={`${source.from}:${source.id}`}><span><b>{source.title}</b><small>{NAMES[source.kind]}</small></span>
            <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => void onPick(source)} aria-label={`${source.title} 가져오기`}>{busy ? "가져오는 중…" : "가져오기"}</button></li>)}</ul> : <p className="yp-hint">가져올 수 있는 주제가 없어요.</p>}
      {rows.length > limit && <button type="button" className="yp-btn yp-sm" onClick={() => setLimit(value => value + 8)}>주제 더 보기</button>}
    </section>}
  </div>;
}
