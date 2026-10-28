"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Link2, Plus } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { UTM_BRANDS, UTM_KINDS, UTM_KIND_LABEL, buildUtmUrl, normalizeUtmCode, parseOriginUrl, utmConflicts, validUtmCode, type UtmKind } from "@/lib/utm";
import { useSession } from "./session-provider";
import { errorMessage } from "./youtube-process-data";

type Option = { id: string; kind: UtmKind; label: string; code: string; active: boolean };
type Param = { code: string; label: string } | null;
type Link = { id: string; brand: string; usage: string; origin_url: string; source_id: string; medium_id: string; campaign_id: string; content_id: string | null;
  params: Record<string, Param>; target: string; location: string; etc: string; utm_url: string; short_url: string | null; ledger_status: "pending" | "saved" | "failed"; created_at: string; creator?: string };
type Saved = { link: Link; ledgerSaved: boolean };
type Form = { brand: string; origin: string; usage: string; target: string; location: string; etc: string; picks: Partial<Record<UtmKind, string>> };

const EMPTY: Form = { brand: "", origin: "", usage: "", target: "", location: "", etc: "", picks: {} };
const brandLabel = (brand: string) => UTM_BRANDS.find(row => row.brand === brand)?.label ?? brand;
const optionText = (option: Option) => `${option.label} · ${option.code}`;
const newRequestId = () => crypto.randomUUID();

/** Copies and says what really happened (기능요청서 §3: success or failure as it is). */
function useCopy() {
  const [note, setNote] = useState("");
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setNote(`${what}를 복사했어요.`); }
    catch { setNote(`${what}를 복사하지 못했어요. 주소를 직접 선택해 복사해 주세요.`); }
    window.setTimeout(() => setNote(""), 2500);
  };
  return { note, copy };
}

/** One UTM key: search the shared choices by name or code (native datalist), or add a new one right here. */
function OptionField({ kind, required, options, value, onChange, onAdded }: { kind: UtmKind; required: boolean; options: Option[]; value?: string; onChange: (id?: string) => void; onAdded: (option: Option) => void }) {
  const { accessToken } = useSession();
  const active = options.filter(option => option.kind === kind && option.active);
  const chosen = active.find(option => option.id === value);
  const [text, setText] = useState(chosen ? optionText(chosen) : "");
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const pick = (next: string) => {
    setText(next);
    const match = active.find(option => optionText(option) === next || option.code === next.trim().toLowerCase() || option.label === next.trim());
    onChange(match?.id);
  };
  const add = async () => {
    const normalized = normalizeUtmCode(code), sameName = label.trim().toLowerCase();
    const existing = options.find(option => option.kind === kind && (option.code === normalized || option.label.trim().toLowerCase() === sameName));
    if (existing) { setError(`이미 있어요: ${existing.label} (${existing.code})${existing.active ? " — 그 값을 고르세요." : " — 꺼져 있는 값이에요. 관리자에게 다시 켜 달라고 해 주세요."}`); if (existing.active) { onChange(existing.id); setText(optionText(existing)); setAdding(false); } return; }
    if (!validUtmCode(normalized)) { setError("URL 코드는 영문 소문자·숫자·밑줄(_)·하이픈(-)만 쓸 수 있어요."); return; }
    try {
      const option = await apiRequest<Option>("/api/v1/utm/options", { method: "POST", token: accessToken, body: JSON.stringify({ kind, label: label.trim(), code: normalized }) });
      onAdded(option); onChange(option.id); setText(optionText(option)); setAdding(false); setLabel(""); setCode(""); setError("");
    } catch (reason) { setError(errorMessage(reason)); }
  };
  return <label>{UTM_KIND_LABEL[kind]} <span className="yp-hint">utm_{kind}{required ? " · 필수" : " · 선택"}</span>
    <input className="yp-in" list={`utm-${kind}`} value={text} onChange={event => pick(event.target.value)} placeholder={active.length ? "이름이나 코드로 찾기" : "아직 선택값이 없어요 · 아래에서 추가"} aria-label={UTM_KIND_LABEL[kind]} />
    <datalist id={`utm-${kind}`}>{active.map(option => <option key={option.id} value={optionText(option)} />)}</datalist>
    {!adding ? <span><button type="button" className="yp-btn yp-sm" onClick={() => setAdding(true)}><Plus size={12} aria-hidden="true" /> 선택값 추가</button></span>
      : <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="yp-in" style={{ flex: "1 1 140px" }} value={label} maxLength={80} onChange={event => setLabel(event.target.value)} placeholder="표시 이름 (예: 유튜브)" aria-label={`${UTM_KIND_LABEL[kind]} 표시 이름`} />
        <input className="yp-in" style={{ flex: "1 1 140px" }} value={code} maxLength={80} onChange={event => setCode(event.target.value)} placeholder="URL 코드 (예: youtube)" aria-label={`${UTM_KIND_LABEL[kind]} URL 코드`} />
        <button type="button" className="yp-btn yp-sm yp-pri" disabled={!label.trim() || !code.trim()} onClick={() => void add()}>저장</button>
        <button type="button" className="yp-btn yp-sm" onClick={() => { setAdding(false); setError(""); }}>취소</button></span>}
    {error ? <span className="yp-errline" role="alert">{error}</span> : null}
  </label>;
}

function ResultCard({ saved, onChange }: { saved: Saved; onChange: (saved: Saved) => void }) {
  const { accessToken } = useSession();
  const { note, copy } = useCopy();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const run = async (what: "short" | "ledger") => {
    setBusy(what); setError("");
    try { onChange(await apiRequest<Saved>(`/api/v1/utm/links/${saved.link.id}/${what}`, { method: "POST", token: accessToken })); }
    catch (reason) { setError(what === "short" ? `단축링크를 만들지 못했어요: ${errorMessage(reason)} (UTM 링크는 그대로 저장돼 있어요.)` : errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const { link, ledgerSaved } = saved;
  return <div className={`yp-note ${ledgerSaved ? "yp-ok" : "yp-warn"}`} role="status"><div style={{ display: "grid", gap: 6 }}>
    <span>링크 저장 완료 · {ledgerSaved ? "회사 문서(링크 대장) 보관 완료" : "회사 문서 보관 실패"}
      {!ledgerSaved ? <> <button type="button" className="yp-btn yp-sm" disabled={busy === "ledger"} onClick={() => void run("ledger")}>{busy === "ledger" ? "다시 보관하는 중…" : "보관 다시 시도"}</button></> : null}</span>
    <span style={{ wordBreak: "break-all" }}><b>{link.utm_url}</b></span>
    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button type="button" className="yp-btn yp-sm" onClick={() => void copy(link.utm_url, "UTM 링크")}><Copy size={12} aria-hidden="true" /> UTM 링크 복사</button>
      {link.short_url ? <button type="button" className="yp-btn yp-sm" onClick={() => void copy(link.short_url!, "단축링크")}><Copy size={12} aria-hidden="true" /> 단축링크 복사 · {link.short_url}</button>
        : <button type="button" className="yp-btn yp-sm" disabled={busy === "short"} onClick={() => void run("short")}><Link2 size={12} aria-hidden="true" /> {busy === "short" ? "만드는 중…" : "단축링크 만들기"}</button>}
    </span>
    {note ? <span>{note}</span> : null}
    {error ? <span className="yp-errline" role="alert">{error}</span> : null}
  </div></div>;
}

export function UtmLinkBuilder({ options, setOptions, prefill, onSaved }: { options: Option[]; setOptions: (next: Option[]) => void; prefill: Form | null; onSaved: () => void }) {
  const { accessToken, demo } = useSession();
  const [form, setForm] = useState<Form>(EMPTY);
  const [requestId, setRequestId] = useState(newRequestId);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  // Remounts the choice fields after a save or a 복제, so their search text follows the form.
  const [generation, setGeneration] = useState(0);
  useEffect(() => { if (prefill) { setForm(prefill); setSaved(null); setRequestId(newRequestId()); setGeneration(value => value + 1); } }, [prefill]);
  const set = (patch: Partial<Form>) => { setForm(current => ({ ...current, ...patch })); setConfirm(false); };
  const codeOf = (kind: UtmKind) => options.find(option => option.id === form.picks[kind])?.code ?? null;
  const parsed = form.origin.trim() ? parseOriginUrl(form.origin) : null;
  const ready = Boolean(parsed && "url" in parsed && codeOf("source") && codeOf("medium") && codeOf("campaign"));
  const codes = { source: codeOf("source") ?? "", medium: codeOf("medium") ?? "", campaign: codeOf("campaign") ?? "", content: codeOf("content") };
  const preview = ready && parsed && "url" in parsed ? buildUtmUrl(parsed.url, codes) : "";
  const conflicts = ready && parsed && "url" in parsed ? utmConflicts(parsed.url, codes) : [];
  const missing = [!form.brand && "브랜드", !(parsed && "url" in parsed) && "원본 URL", !form.usage.trim() && "링크 사용처", !codeOf("source") && "유입 출처", !codeOf("medium") && "마케팅 방식", !codeOf("campaign") && "캠페인명"].filter(Boolean);
  const save = async () => {
    if (!accessToken || missing.length || (conflicts.length && !confirm)) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<Saved>("/api/v1/utm/links", { method: "POST", token: accessToken, body: JSON.stringify({
        requestId, brand: form.brand, usage: form.usage.trim(), originUrl: form.origin.trim(), sourceId: form.picks.source, mediumId: form.picks.medium, campaignId: form.picks.campaign,
        contentId: form.picks.content ?? null, target: form.target.trim(), location: form.location.trim(), etc: form.etc.trim(), confirmOverwrite: confirm }) });
      setSaved(result); setForm(EMPTY); setConfirm(false); setRequestId(newRequestId()); setGeneration(value => value + 1); onSaved();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const added = (option: Option) => setOptions([...options, option]);
  return <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <label>브랜드 <span className="yp-hint">필수</span><select className="yp-in" value={form.brand} onChange={event => set({ brand: event.target.value })} aria-label="브랜드">
      <option value="">고르세요</option>{UTM_BRANDS.map(row => <option key={row.brand} value={row.brand}>{row.label}</option>)}</select></label>
    <label>원본 URL <span className="yp-hint">필수 · UTM을 붙일 실제 목적지. 주소에 개인정보·비밀번호를 넣지 마세요.</span>
      <input className="yp-in" type="url" value={form.origin} maxLength={2000} onChange={event => set({ origin: event.target.value })} placeholder="https://www.myinlab.co.kr/…" aria-label="원본 URL" />
      {parsed && "error" in parsed ? <span className="yp-errline">{parsed.error}</span> : null}</label>
    {UTM_KINDS.map(kind => <OptionField key={`${kind}-${generation}`} kind={kind} required={kind !== "content"} options={options} value={form.picks[kind]} onChange={id => set({ picks: { ...form.picks, [kind]: id } })} onAdded={added} />)}
    <label>링크 사용처 <span className="yp-hint">필수 · 사람이 읽는 설명 (URL에는 안 붙어요)</span>
      <input className="yp-in" value={form.usage} maxLength={200} onChange={event => set({ usage: event.target.value })} placeholder="예: 10월 28일 유튜브 영상 고정댓글" aria-label="링크 사용처" /></label>
    <details><summary className="yp-hint">관리 메모 더 쓰기 (선택 · URL에는 안 붙어요)</summary><div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      <label>target · 대상 고객<input className="yp-in" value={form.target} maxLength={200} onChange={event => set({ target: event.target.value })} aria-label="target 대상 고객" /></label>
      <label>location · 게재 위치<input className="yp-in" value={form.location} maxLength={200} onChange={event => set({ location: event.target.value })} placeholder="예: 설명란, 프로필, 고정댓글" aria-label="location 게재 위치" /></label>
      <label>etc · 기타<input className="yp-in" value={form.etc} maxLength={500} onChange={event => set({ etc: event.target.value })} aria-label="etc 기타" /></label>
    </div></details>
    <div className="yp-note yp-gray"><div><b>미리보기</b><br /><span style={{ wordBreak: "break-all" }}>{preview || "브랜드·원본 URL·필수 선택값 3개를 넣으면 완성 주소가 보여요."}</span></div></div>
    {conflicts.length ? <div className="yp-note yp-warn" role="alert"><div>원본 주소에 이미 UTM 값이 있어요. 저장하면 아래처럼 바뀝니다.
      <ul style={{ margin: "6px 0" }}>{conflicts.map(row => <li key={row.key}>{row.key}: {row.before} → {row.after ?? "(지움)"}</li>)}</ul>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} /> 이대로 바꿉니다</label></div></div> : null}
    <div><button type="submit" className="yp-btn yp-pri" disabled={busy || demo || missing.length > 0 || (conflicts.length > 0 && !confirm)}>{busy ? "저장하는 중…" : "UTM 링크 만들기"}</button>
      {demo ? <span className="yp-hint"> 데모에서는 만들지 않아요.</span> : missing.length ? <span className="yp-hint"> 아직 비어 있어요: {missing.join(" · ")}</span> : null}</div>
    {error ? <div className="yp-errline" role="alert">{error}</div> : null}
    {saved ? <ResultCard saved={saved} onChange={next => { setSaved(next); onSaved(); }} /> : null}
  </form>;
}

function LedgerRow({ link, onChange, onDuplicate }: { link: Link; onChange: () => void; onDuplicate: (link: Link) => void }) {
  const { accessToken } = useSession();
  const { note, copy } = useCopy();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const run = async (what: "short" | "ledger") => {
    setBusy(what); setError("");
    try { await apiRequest(`/api/v1/utm/links/${link.id}/${what}`, { method: "POST", token: accessToken }); onChange(); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(""); }
  };
  const param = (kind: string) => link.params[kind] ? `${link.params[kind]!.label}(${link.params[kind]!.code})` : null;
  return <li style={{ display: "grid", gap: 4, alignItems: "start" }}>
    <span><b>{link.usage}</b> · {brandLabel(link.brand)} · <span className="yp-hint">{link.created_at.slice(0, 10)} · {link.creator}</span></span>
    <span className="yp-hint">{UTM_KINDS.map(param).filter(Boolean).join(" / ")}{[link.target, link.location, link.etc].some(Boolean) ? ` · 메모: ${[link.target, link.location, link.etc].filter(Boolean).join(" · ")}` : ""}</span>
    <span className="yp-hint" style={{ wordBreak: "break-all" }}>{link.utm_url}</span>
    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button type="button" className="yp-btn yp-sm" onClick={() => void copy(link.utm_url, "UTM 링크")}><Copy size={12} aria-hidden="true" /> UTM 링크 복사</button>
      {link.short_url ? <button type="button" className="yp-btn yp-sm" onClick={() => void copy(link.short_url!, "단축링크")}><Copy size={12} aria-hidden="true" /> {link.short_url}</button>
        : <button type="button" className="yp-btn yp-sm" disabled={busy === "short"} onClick={() => void run("short")}><Link2 size={12} aria-hidden="true" /> {busy === "short" ? "만드는 중…" : "단축링크 만들기"}</button>}
      <button type="button" className="yp-btn yp-sm" onClick={() => onDuplicate(link)}>복제하여 새 링크 만들기</button>
      {link.ledger_status !== "saved" ? <button type="button" className="yp-btn yp-sm" disabled={busy === "ledger"} onClick={() => void run("ledger")}>회사 문서 보관 다시 시도</button> : null}
    </span>
    {note ? <span className="yp-hint">{note}</span> : null}
    {error ? <span className="yp-errline" role="alert">{error}</span> : null}
  </li>;
}

function OptionManager({ options, onChange }: { options: Option[]; onChange: () => void }) {
  const { accessToken } = useSession();
  const [error, setError] = useState("");
  const patch = async (option: Option, body: { label?: string; active?: boolean }) => {
    setError("");
    try { await apiRequest(`/api/v1/utm/options/${option.id}`, { method: "PATCH", token: accessToken, body: JSON.stringify(body) }); onChange(); }
    catch (reason) { setError(errorMessage(reason)); }
  };
  const rename = (option: Option) => { const label = window.prompt(`새 표시 이름 (코드 ${option.code}는 바뀌지 않아요)`, option.label)?.trim(); if (label && label !== option.label) void patch(option, { label }); };
  return <details style={{ marginTop: 12 }}><summary className="yp-hint">선택값 관리 (관리자 · 이름 바꾸기·끄기)</summary>
    {UTM_KINDS.map(kind => <div key={kind} style={{ marginTop: 8 }}><b>{UTM_KIND_LABEL[kind]}</b>
      <ul className="yp-open-list" style={{ marginTop: 4 }}>{options.filter(option => option.kind === kind).map(option => <li key={option.id}>
        <span style={{ flex: 1 }}>{option.label} · <code>{option.code}</code>{option.active ? "" : " · 꺼짐"}</span>
        <button type="button" className="yp-btn yp-sm" onClick={() => rename(option)}>이름 바꾸기</button>
        <button type="button" className="yp-btn yp-sm" onClick={() => void patch(option, { active: !option.active })}>{option.active ? "끄기" : "다시 켜기"}</button></li>)}</ul></div>)}
    {error ? <div className="yp-errline" role="alert">{error}</div> : null}
  </details>;
}

/** 링크관리 › UTM 링크 만들기 + the company link ledger (기능요청서 2026-10-28). */
export function UtmLinkSection() {
  const { accessToken, demo } = useSession();
  const [options, setOptions] = useState<Option[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [prefill, setPrefill] = useState<Form | null>(null);
  const loadOptions = useCallback(async () => {
    if (demo || !accessToken) return;
    try { const result = await apiRequest<{ items: Option[]; canManage: boolean }>("/api/v1/utm/options", { token: accessToken }); setOptions(result.items); setCanManage(result.canManage); }
    catch (reason) { setError(errorMessage(reason)); }
  }, [accessToken, demo]);
  const loadLinks = useCallback(async () => {
    if (demo || !accessToken) { setLinks([]); return; }
    try { setLinks((await apiRequest<{ items: Link[] }>("/api/v1/utm/links", { token: accessToken })).items); }
    catch (reason) { setLinks([]); setError(errorMessage(reason)); }
  }, [accessToken, demo]);
  useEffect(() => { void loadOptions(); void loadLinks(); }, [loadOptions, loadLinks]);
  const shown = useMemo(() => (links ?? []).filter(link => (!brand || link.brand === brand) && (!query.trim() || [link.usage, brandLabel(link.brand), ...Object.values(link.params).flatMap(param => param ? [param.code, param.label] : [])]
    .some(text => text.toLowerCase().includes(query.trim().toLowerCase())))), [links, brand, query]);
  const duplicate = (link: Link) => {
    setPrefill({ brand: link.brand, origin: link.origin_url, usage: link.usage, target: link.target, location: link.location, etc: link.etc,
      picks: { source: link.source_id, medium: link.medium_id, campaign: link.campaign_id, ...(link.content_id ? { content: link.content_id } : {}) } });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return <>
    {error ? <div className="yp-errline" role="alert">{error}</div> : null}
    <UtmLinkBuilder options={options} setOptions={setOptions} prefill={prefill} onSaved={() => void loadLinks()} />
    {canManage ? <OptionManager options={options} onChange={() => void loadOptions()} /> : null}
    <section className="yp-card" style={{ marginTop: 12 }}><div className="yp-card-h">링크 대장 <span className="yp-hint" style={{ margin: 0 }}>회사 공용 · 회사 문서 「링크 대장」에도 같이 적혀요</span></div><div className="yp-card-b">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="yp-in" style={{ flex: "1 1 200px" }} value={query} onChange={event => setQuery(event.target.value)} placeholder="사용처·출처·캠페인 코드로 찾기" aria-label="링크 대장 검색" />
        <select className="yp-in" style={{ flex: "0 0 140px" }} value={brand} onChange={event => setBrand(event.target.value)} aria-label="브랜드로 거르기"><option value="">모든 브랜드</option>{UTM_BRANDS.map(row => <option key={row.brand} value={row.brand}>{row.label}</option>)}</select>
      </div>
      {links === null ? <p className="yp-hint" role="status">불러오는 중이에요…</p> : !shown.length ? <p className="yp-hint">{links.length ? "조건에 맞는 링크가 없어요." : "아직 만든 UTM 링크가 없어요."}</p>
        : <ul className="yp-open-list">{shown.map(link => <LedgerRow key={link.id} link={link} onChange={() => void loadLinks()} onDuplicate={duplicate} />)}</ul>}
    </div></section>
  </>;
}
