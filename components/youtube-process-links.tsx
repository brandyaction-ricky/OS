"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, ImagePlus, Link2 } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { errorMessage } from "./youtube-process-data";
import { UtmLinkSection } from "./link-manager-utm";
import { CtaBulkScreen } from "./youtube-process-cta";
import { ChannelStyleEditor, useChannelCards } from "./youtube-channel-styles";
import { ENDSCREEN_CARD_DEFAULT, ENDSCREEN_IMAGE_MAX, type EndscreenCard } from "@/lib/youtube-process/endscreen-card";

interface ShortLink { key: string; url: string; target: string; label: string; createdAt: string }
interface EduLink extends ShortLink { channel: string; active: boolean; clicks: number; lastClickedAt: string | null; created?: boolean }

// Says whether the copy really worked (기능요청서 2026-10-28 §3).
function useCopy() {
  const [copied, setCopied] = useState("");
  const copy = async (text: string) => { const ok = await navigator.clipboard.writeText(text).then(() => true, () => false); setCopied(ok ? text : `!${text}`); window.setTimeout(() => setCopied(""), 1800); };
  const label = (text: string) => copied === text ? "복사됨" : copied === `!${text}` ? "복사 실패 · 직접 선택해 주세요" : "복사";
  return { copy, label };
}

/** 링크관리 (기능요청서 2026-10-28): UTM 링크 만들기 + 링크 대장 first; the plain 단축 링크 (owner decision 2026-10-26) stays as it was. */
export function YoutubeLinksScreen() {
  const [mode, setMode] = useState<"utm" | "short" | "edu" | "card" | "cta" | "style">("utm");
  return <>
    <div><div className="yp-seg2" role="group" aria-label="링크 만들기 방식">
      <button type="button" className={mode === "utm" ? "yp-on" : ""} aria-pressed={mode === "utm"} onClick={() => setMode("utm")}>UTM 링크 만들기</button>
      <button type="button" className={mode === "short" ? "yp-on" : ""} aria-pressed={mode === "short"} onClick={() => setMode("short")}>단축링크만 만들기</button>
      <button type="button" className={mode === "edu" ? "yp-on" : ""} aria-pressed={mode === "edu"} onClick={() => setMode("edu")}>에듀 고정 링크</button>
      <button type="button" className={mode === "card" ? "yp-on" : ""} aria-pressed={mode === "card"} onClick={() => setMode("card")}>최종 화면 진단 카드</button>
      <button type="button" className={mode === "cta" ? "yp-on" : ""} aria-pressed={mode === "cta"} onClick={() => setMode("cta")}>CTA 일괄 바꾸기</button>
      <button type="button" className={mode === "style" ? "yp-on" : ""} aria-pressed={mode === "style"} onClick={() => setMode("style")}>채널</button>
    </div></div>
    {mode === "utm" ? <UtmLinkSection /> : mode === "short" ? <ShortLinkOnly /> : mode === "edu" ? <EduLinks /> : mode === "card" ? <EndscreenCardEditor /> : mode === "style" ? <ChannelStyleEditor /> : <CtaBulkScreen />}
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
  const { copy, label: copyLabel } = useCopy();
  const load = useCallback(async () => {
    if (demo || !accessToken) { setItems([]); return; }
    try { setItems((await apiRequest<{ items: ShortLink[] }>("/api/v1/short-links", { token: accessToken })).items); }
    catch (reason) { setItems([]); setError(errorMessage(reason)); }
  }, [accessToken, demo]);
  useEffect(() => { void load(); }, [load]);
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
      {made ? <div className="yp-note yp-ok" role="status"><div><b>{made.url}</b> <button type="button" className="yp-btn yp-sm" onClick={() => void copy(made.url)}><Copy size={14} aria-hidden="true" /> {copyLabel(made.url)}</button><br /><span className="yp-hint">{made.target}</span></div></div> : null}
    </form>
    <section className="yp-card" style={{ marginTop: 12 }}><div className="yp-card-h">최근 만든 링크</div><div className="yp-card-b">
      {items === null ? <p className="yp-hint" role="status">불러오는 중이에요…</p> : !items.length ? <p className="yp-hint">아직 없어요.</p>
        : <ul className="yp-open-list">{items.map(item => <li key={item.key} style={{ display: "grid", gap: 2 }}>
          <span><b>{item.label || "이름 없음"}</b> · <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a> <button type="button" className="yp-btn yp-sm" onClick={() => void copy(item.url)}><Copy size={12} aria-hidden="true" /> {copyLabel(item.url)}</button></span>
          <span className="yp-hint" style={{ wordBreak: "break-all" }}>{item.target}</span></li>)}</ul>}
    </div></section>
  </>;
}

const when = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "아직 없음";

/** 에듀 고정 링크 (2026-11-08): brandyaction-edu.com/go/… never changes; staff change only where it goes. EDU counts real clicks. */
function EduLinks() {
  const { accessToken, demo } = useSession();
  const cards = useChannelCards();
  const empty = { url: "", label: "", channel: "", key: "" };
  const [form, setForm] = useState(empty);
  const [items, setItems] = useState<EduLink[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [made, setMade] = useState<EduLink | null>(null);
  const [editing, setEditing] = useState<{ key: string; url: string } | null>(null);
  const { copy, label: copyLabel } = useCopy();
  const load = useCallback(async () => {
    if (demo || !accessToken) { setItems([]); return; }
    try { setItems((await apiRequest<{ items: EduLink[] }>("/api/v1/edu-links", { token: accessToken })).items); }
    catch (reason) { setItems([]); setError(errorMessage(reason)); }
  }, [accessToken, demo]);
  useEffect(() => { void load(); }, [load]);
  const send = async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
    if (!accessToken) return null;
    setBusy(true); setError("");
    try { const link = await apiRequest<EduLink>("/api/v1/edu-links", { method, token: accessToken, body: JSON.stringify(body) }); void load(); return link; }
    catch (reason) { setError(errorMessage(reason)); return null; } finally { setBusy(false); }
  };
  const make = async () => { const link = await send("POST", form); if (link) { setMade(link); setForm(empty); } };
  const save = async () => { if (editing && await send("PATCH", editing)) setEditing(null); };
  const toggle = (item: EduLink) => {
    if (item.active && !window.confirm(`「${item.label}」 링크를 끌까요? 끄는 동안 이 주소를 누른 사람은 에듀 첫 화면으로 가요.`)) return;
    void send("PATCH", { key: item.key, active: !item.active });
  };
  const channels = [...new Set([...cards.map(card => card.name), ...(items ?? []).map(item => item.channel)])];
  const set = (patch: Partial<typeof empty>) => setForm(value => ({ ...value, ...patch }));

  return <>
    <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); void make(); }}>
      <p className="yp-hint">한 번 만든 주소는 그대로예요. 카톡방·자료 주소가 바뀌면 아래 목록에서 도착지만 바꾸면 됩니다.</p>
      <label>이름<input className="yp-in" required maxLength={80} value={form.label} onChange={event => set({ label: event.target.value })} placeholder="예) 무료 강의 카톡방" /></label>
      <label>채널<input className="yp-in" required maxLength={40} list="edu-link-channels" value={form.channel} onChange={event => set({ channel: event.target.value })} placeholder="이 주소를 넣을 채널" /></label>
      <datalist id="edu-link-channels">{channels.map(name => <option key={name} value={name} />)}</datalist>
      <label>도착 주소<input className="yp-in" type="url" required maxLength={2000} value={form.url} onChange={event => set({ url: event.target.value })} placeholder="https://로 시작하는 주소" /></label>
      <label>주소 끝부분 (선택)<input className="yp-in" maxLength={40} value={form.key} onChange={event => set({ key: event.target.value.toLowerCase() })} placeholder="예) free-class · 비우면 짧은 글자를 자동으로 붙여요" /></label>
      <div><button type="submit" className="yp-btn yp-pri" disabled={busy || demo || !form.url.trim() || !form.label.trim() || !form.channel.trim()}><Link2 size={14} aria-hidden="true" /> {busy ? "처리하는 중…" : "고정 링크 만들기"}</button>
        {demo ? <span className="yp-hint"> 데모에서는 만들지 않아요.</span> : null}</div>
      {error ? <div className="yp-errline" role="alert">{error}</div> : null}
      {made ? <div className="yp-note yp-ok" role="status"><div><b>{made.url}</b> <button type="button" className="yp-btn yp-sm" onClick={() => void copy(made.url)}><Copy size={14} aria-hidden="true" /> {copyLabel(made.url)}</button><br />
        <span className="yp-hint">{made.created === false ? "같은 이름·채널·도착지 링크가 이미 있어서 그 주소를 보여 드려요. " : ""}{made.target}</span></div></div> : null}
    </form>
    <section className="yp-card yp-edu-links"><div className="yp-card-h">에듀 고정 링크</div><div className="yp-card-b">
      {items === null ? <p className="yp-hint" role="status">불러오는 중이에요…</p> : !items.length ? <p className="yp-hint">아직 없어요.</p>
        : <ul className="yp-open-list">{items.map(item => <li key={item.key}>
          <span><b>{item.label}</b> · {item.channel}{item.active ? null : <> <span className="yp-tag yp-warn">꺼짐</span></>}</span>
          <span><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a> <button type="button" className="yp-btn yp-sm" onClick={() => void copy(item.url)}><Copy size={12} aria-hidden="true" /> {copyLabel(item.url)}</button></span>
          <span className="yp-hint">도착지 {item.target}</span>
          <span className="yp-hint">클릭 {item.clicks.toLocaleString("ko-KR")}회 · 마지막 {when(item.lastClickedAt)}</span>
          {editing?.key === item.key
            ? <form className="yp-row-btns" onSubmit={event => { event.preventDefault(); void save(); }}>
              <input className="yp-in" type="url" required maxLength={2000} value={editing.url} onChange={event => setEditing({ key: item.key, url: event.target.value })} aria-label={`「${item.label}」 새 도착 주소`} />
              <button type="submit" className="yp-btn yp-sm yp-pri" disabled={busy}>저장</button><button type="button" className="yp-btn yp-sm" onClick={() => setEditing(null)}>취소</button></form>
            : <span className="yp-row-btns"><button type="button" className="yp-btn yp-sm" disabled={busy || demo} onClick={() => { setError(""); setEditing({ key: item.key, url: item.target }); }}>도착지 바꾸기</button>
              <button type="button" className="yp-btn yp-sm" disabled={busy || demo} onClick={() => toggle(item)}>{item.active ? "끄기" : "켜기"}</button></span>}
        </li>)}</ul>}
      <p className="yp-hint">클릭은 사람이 실제로 누른 횟수예요. 카톡 미리보기·검색 로봇은 세지 않아요. 에듀 관리자 화면(마케팅 관리 › 고정 링크)에서도 같은 목록을 봐요.</p>
    </div></section>
  </>;
}

/** 최종 화면 진단 카드 (로건 요청 10/30): one place for the diagnosis link element; every 업로드 screen shows it to put in Studio. */
function EndscreenCardEditor() {
  const { accessToken, demo } = useSession();
  const [version, setVersion] = useState<number | null>(null);
  const [form, setForm] = useState<EndscreenCard>(ENDSCREEN_CARD_DEFAULT);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => {
    if (demo || !accessToken) { setVersion(0); return; }
    apiRequest<{ card: EndscreenCard; version: number }>("/api/v1/content/youtube/endscreen-card", { token: accessToken })
      .then(result => { setForm(result.card); setVersion(result.version); }, reason => setError(errorMessage(reason)));
  }, [accessToken, demo]);
  const pick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const image = String(reader.result ?? ""); if (image.length > ENDSCREEN_IMAGE_MAX) setError("300KB 이하 이미지를 올려 주세요."); else { setError(""); setSaved(false); setForm(value => ({ ...value, image })); } };
    reader.readAsDataURL(file);
  };
  const save = async () => {
    if (version === null || !accessToken) return;
    setBusy(true); setError("");
    try { const result = await apiRequest<{ card: EndscreenCard; version: number }>("/api/v1/content/youtube/endscreen-card", { method: "PUT", token: accessToken, body: JSON.stringify({ ...form, expectedVersion: version }) }); setForm(result.card); setVersion(result.version); setSaved(true); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const set = (patch: Partial<EndscreenCard>) => { setSaved(false); setForm(value => ({ ...value, ...patch })); };
  if (version === null) return error ? <p className="yp-errline" role="alert">{error}</p> : <p className="yp-hint" role="status">불러오는 중이에요…</p>;
  return <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="yp-hint" style={{ margin: 0 }}>영상마다 최종 화면 오른쪽에 거는 진단 링크예요. 유튜브는 최종 화면을 API로 받지 않아서, 업로드 화면 4번에 이 값이 보이고 스튜디오에서 넣어요.</p>
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an inline data URL the person just chose */}
      {form.image ? <img src={form.image} alt="진단 썸네일" width={96} height={96} style={{ borderRadius: 8, objectFit: "cover", border: "1px solid var(--line)" }} /> : <span className="yp-hint">이미지 없음</span>}
      <label className="yp-btn yp-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ImagePlus size={14} aria-hidden="true" /> 진단 썸네일 고르기<input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { pick(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <span className="yp-hint">정사각형 · 300KB 이하</span></div>
    <label>맞춤 메시지 (진단명)<input className="yp-in" maxLength={60} value={form.name} onChange={event => set({ name: event.target.value })} placeholder="예) 브랜디액션 기질진단 받아보기" /></label>
    <label>클릭 유도문<input className="yp-in" maxLength={30} value={form.cta} onChange={event => set({ cta: event.target.value })} placeholder="자세히 알아보기" /></label>
    <label>링크 보낼 곳 (선택)<input className="yp-in" type="url" maxLength={500} value={form.link} onChange={event => set({ link: event.target.value.trim() })} placeholder="비우면 영상마다 업로드 1번의 진단 링크를 써요" /></label>
    <div><button type="submit" className="yp-btn yp-pri" disabled={busy || demo}>{busy ? "저장하는 중…" : "저장"}</button>
      {demo ? <span className="yp-hint"> 데모에서는 저장하지 않아요.</span> : saved ? <span className="yp-hint" role="status"> 저장했어요.</span> : null}</div>
    {error ? <div className="yp-errline" role="alert">{error}</div> : null}
  </form>;
}
