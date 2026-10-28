"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { errorMessage } from "./youtube-process-data";
import { UtmLinkSection } from "./link-manager-utm";

interface ShortLink { key: string; url: string; target: string; label: string; createdAt: string }

/** 링크관리 (기능요청서 2026-10-28): UTM 링크 만들기 + 링크 대장 first; the plain 단축 링크 (owner decision 2026-10-26) stays as it was. */
export function YoutubeLinksScreen() {
  const [mode, setMode] = useState<"utm" | "short">("utm");
  return <>
    <div className="yp-seg2" role="group" aria-label="링크 만들기 방식">
      <button type="button" className={mode === "utm" ? "yp-on" : ""} aria-pressed={mode === "utm"} onClick={() => setMode("utm")}>UTM 링크 만들기</button>
      <button type="button" className={mode === "short" ? "yp-on" : ""} aria-pressed={mode === "short"} onClick={() => setMode("short")}>단축링크만 만들기</button>
    </div>
    {mode === "utm" ? <UtmLinkSection /> : <ShortLinkOnly />}
  </>;
}

function ShortLinkOnly() {
  const { accessToken, demo } = useSession();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<ShortLink | null>(null);
  const [items, setItems] = useState<ShortLink[] | null>(null);
  const [copied, setCopied] = useState("");
  const load = useCallback(async () => {
    if (demo || !accessToken) { setItems([]); return; }
    try { setItems((await apiRequest<{ items: ShortLink[] }>("/api/v1/short-links", { token: accessToken })).items); }
    catch (reason) { setItems([]); setError(errorMessage(reason)); }
  }, [accessToken, demo]);
  useEffect(() => { void load(); }, [load]);
  // Says whether the copy really worked (기능요청서 2026-10-28 §3).
  const copy = async (text: string) => { const ok = await navigator.clipboard.writeText(text).then(() => true, () => false); setCopied(ok ? text : `!${text}`); window.setTimeout(() => setCopied(""), 1800); };
  const make = async () => {
    if (!accessToken) return;
    setBusy(true); setError("");
    try {
      const link = await apiRequest<ShortLink>("/api/v1/short-links", { method: "POST", token: accessToken, body: JSON.stringify({ url: url.trim(), label: label.trim() }) });
      setMade(link); setUrl(""); setLabel(""); void load();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };

  return <>
    <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); void make(); }}>
      <label>줄일 주소<input className="yp-in" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://로 시작하는 주소" aria-label="줄일 주소" /></label>
      <label>이름 (선택 · 목록에서 찾기 쉽게)<input className="yp-in" maxLength={80} value={label} onChange={event => setLabel(event.target.value)} placeholder="예) 인스타 프로필 · 11월 이벤트" /></label>
      <div><button type="submit" className="yp-btn yp-pri" disabled={busy || demo || !url.trim()}><Link2 size={14} aria-hidden="true" /> {busy ? "만드는 중…" : "단축 링크 만들기"}</button>
        {demo ? <span className="yp-hint"> 데모에서는 만들지 않아요.</span> : <span className="yp-hint"> 같은 주소는 같은 링크가 나와요. 한 번 만든 링크는 계속 동작해요.</span>}</div>
      {error ? <div className="yp-errline" role="alert">{error}</div> : null}
      {made ? <div className="yp-note yp-ok" role="status"><div><b>{made.url}</b> <button type="button" className="yp-btn yp-sm" onClick={() => void copy(made.url)}><Copy size={14} aria-hidden="true" /> {copied === made.url ? "복사됨" : copied === `!${made.url}` ? "복사 실패 · 직접 선택해 주세요" : "복사"}</button><br /><span className="yp-hint">{made.target}</span></div></div> : null}
    </form>
    <section className="yp-card" style={{ marginTop: 12 }}><div className="yp-card-h">최근 만든 링크</div><div className="yp-card-b">
      {items === null ? <p className="yp-hint" role="status">불러오는 중이에요…</p> : !items.length ? <p className="yp-hint">아직 없어요.</p>
        : <ul className="yp-open-list">{items.map(item => <li key={item.key} style={{ display: "grid", gap: 2 }}>
          <span><b>{item.label || "이름 없음"}</b> · <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a> <button type="button" className="yp-btn yp-sm" onClick={() => void copy(item.url)}><Copy size={12} aria-hidden="true" /> {copied === item.url ? "복사됨" : copied === `!${item.url}` ? "복사 실패" : "복사"}</button></span>
          <span className="yp-hint" style={{ wordBreak: "break-all" }}>{item.target}</span></li>)}</ul>}
    </div></section>
  </>;
}
