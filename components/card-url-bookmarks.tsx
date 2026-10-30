"use client";
import { useEffect, useState } from "react";
import { CARD_BOOKMARK_MAX, readCardBookmarks, validCardUrl, type CardUrlBookmark } from "@/lib/cardnews/bookmarks";

/** Explicitly browser-local and account-scoped; loading a URL never marks a project as posted. */
export function CardUrlBookmarks({ ownerId, url, onLoad }: { ownerId: string | undefined; url: string; onLoad: (url: string) => void }) {
  const key = ownerId ? `brandy:card-url-bookmarks:v1:${ownerId}` : "";
  const [items, setItems] = useState<CardUrlBookmark[]>([]), [label, setLabel] = useState(""), [selected, setSelected] = useState(""), [message, setMessage] = useState("");
  const [removed, setRemoved] = useState<CardUrlBookmark | null>(null);
  useEffect(() => {
    setItems([]); setSelected(""); setRemoved(null); setMessage("");
    if (!key) return;
    try { setItems(readCardBookmarks(localStorage.getItem(key))); } catch { setMessage("브라우저 저장을 사용할 수 없어요. 주소는 직접 입력할 수 있습니다."); }
    const sync = (event: StorageEvent) => { if (event.key === key) setItems(readCardBookmarks(event.newValue)); };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, [key]);
  const persist = (change: (current: CardUrlBookmark[]) => CardUrlBookmark[], success: string) => {
    if (!key) return false;
    try {
      const next = change(readCardBookmarks(localStorage.getItem(key)));
      if (next.length > CARD_BOOKMARK_MAX) throw new Error(`즐겨찾기는 ${CARD_BOOKMARK_MAX}개까지예요.`);
      localStorage.setItem(key, JSON.stringify(next)); setItems(next); setMessage(success); return true;
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "즐겨찾기를 저장하지 못했어요."); return false; }
  };
  const add = () => {
    if (!validCardUrl(url.trim())) { setMessage("https로 시작하고 로그인 정보가 없는 주소를 입력해 주세요."); return; }
    const item = { id: crypto.randomUUID(), label: label.trim() || url.trim(), url: url.trim() };
    if (persist(current => [...current.filter(row => row.url !== item.url), item], "주소를 즐겨찾기에 저장했어요.")) { setLabel(""); setSelected(item.id); }
  };
  return <section className="yp-url-bookmarks" aria-label="주소 즐겨찾기">
    <b>주소 즐겨찾기</b><p className="yp-hint">이 브라우저에서 내 계정에만 저장됩니다. 불러온 뒤 [주소 남기기]를 눌러야 게시물에 반영됩니다.</p>
    <div className="yp-row-btns"><input className="yp-in" aria-label="주소 즐겨찾기 이름" maxLength={80} placeholder="주소 이름 (선택)" value={label} onChange={event => setLabel(event.target.value)} />
      <button type="button" className="yp-btn" disabled={!key || !validCardUrl(url.trim())} onClick={add}>현재 주소 즐겨찾기</button></div>
    <div className="yp-row-btns"><select className="yp-in" aria-label="저장한 주소" value={items.some(row => row.id === selected) ? selected : ""} onChange={event => setSelected(event.target.value)}><option value="">즐겨찾기 선택</option>{items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <button type="button" className="yp-btn" disabled={!items.some(row => row.id === selected)} onClick={() => { const item = items.find(row => row.id === selected); if (item) { onLoad(item.url); setMessage("입력칸에 불러왔어요. 주소를 확인한 뒤 남겨 주세요."); } }}>주소 불러오기</button>
      <button type="button" className="yp-btn yp-sm" disabled={!items.some(row => row.id === selected)} onClick={() => { const item = items.find(row => row.id === selected); if (item && persist(current => current.filter(row => row.id !== item.id), "즐겨찾기에서 뺐어요.")) { setRemoved(item); setSelected(""); } }}>즐겨찾기 삭제</button></div>
    {removed && <button type="button" className="yp-btn yp-sm" onClick={() => { if (persist(current => [...current.filter(row => row.url !== removed.url), removed], "즐겨찾기를 복원했어요.")) setRemoved(null); }}>즐겨찾기 삭제 되돌리기</button>}
    {message && <p role="status" className="yp-hint">{message}</p>}
  </section>;
}
