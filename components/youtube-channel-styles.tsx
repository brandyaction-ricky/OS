"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { CHANNEL_FORMAT_LABEL, CHANNEL_FORMATS, channelFormats, channelOf, type ChannelStyle, type ChannelStyleInput } from "@/lib/youtube-process/channel-style";
import type { ChannelConnection } from "@/lib/channel-types";
import { useSession } from "./session-provider";
import { errorMessage } from "./youtube-process-data";

const TONE = { base: "myin" as const, key: "#212CB0", ink: "#1E1D1D", page: "#FFFFFF" };
const blank = (): ChannelStyleInput => ({ id: crypto.randomUUID(), name: "", channel: "", tone: null, ending: "talk", logo: false, purpose: "", concept: "", topics: "", formats: [...CHANNEL_FORMATS], voice: "", youtube: "" });
// 목적 정본 (설계 문서 2026-11-07): a card's 목적 is one of the 「목적 정본 — 목적」 documents, its channel a row of that 정본's 「채널 카드」 table.
type Canon = { id: string; title: string; purpose: string; channels: { name: string; concept: string; topics: string }[] };
type Loaded = { styles: ChannelStyle[]; version: number; purposes?: Canon[] };
type Card = ChannelStyleInput & Partial<Pick<ChannelStyle, "version">>;
const cardOf = (style: ChannelStyle): Card => ({ ...style, purpose: style.purpose ?? "", concept: style.concept ?? "", topics: style.topics ?? "", formats: channelFormats(style), voice: style.voice ?? "", youtube: style.youtube ?? "" });

// The 채널 카드 every screen picks from; read once per page and refreshed when the editor saves.
let cards: Promise<ChannelStyle[]> | null = null;
/** The 채널 카드, first = 기본 채널. Empty in the demo and until loaded; a screen shows channels only when there are two or more. */
export function useChannelCards() {
  const { accessToken, demo } = useSession();
  const [list, setList] = useState<ChannelStyle[]>([]);
  useEffect(() => {
    if (demo || !accessToken) return;
    let active = true;
    cards ??= apiRequest<{ styles: ChannelStyle[] }>("/api/v1/content/youtube/channel-styles", { token: accessToken }).then(result => result.styles, () => { cards = null; return []; });
    void cards.then(styles => { if (active) setList(styles); });
    return () => { active = false; };
  }, [accessToken, demo]);
  return list;
}

/** The YouTube channels this person may upload to: their own and the ones shared with the team. */
function useYoutubeConnections() {
  const { accessToken, demo } = useSession();
  const [rows, setRows] = useState<ChannelConnection[]>([]);
  useEffect(() => {
    if (demo || !accessToken) return;
    let active = true;
    apiRequest<{ connections: ChannelConnection[] }>("/api/v1/channels", { token: accessToken })
      .then(result => { if (active) setRows(result.connections.filter(row => row.platform === "youtube" && row.status === "connected" && row.channelId)); }, () => { if (active) setRows([]); });
    return () => { active = false; };
  }, [accessToken, demo]);
  return rows;
}

/**
 * Where a video goes up (다채널 2단계, 2026-11-07): the YouTube channel picked on the screen, else its channel card's, else one named like
 * the card's 「올릴 유튜브 채널 이름」, else the first. `account` is what the upload calls send.
 */
export function useUploadChannel(channel: string | undefined) {
  const rows = useYoutubeConnections(), card = channelOf(useChannelCards(), channel);
  const [picked, pick] = useState("");
  const chosen = rows.find(row => row.channelId === picked) ?? rows.find(row => card?.youtube && row.channelId === card.youtube)
    ?? rows.find(row => card?.channel.trim() && row.accountName.trim() === card.channel.trim()) ?? rows[0];
  return { rows, chosen, pick, account: chosen ? { connectionOwnerId: chosen.ownerId, connectionChannelId: chosen.channelId } : {} };
}

/**
 * 채널 (채널 모양 2026-11-02; 채널 카드 2026-11-07): per channel, what it is for, its concept and topic axis, the formats
 * it runs, and the look Logan's engine takes today — diagram tone, how the video ends, the MYIN logo. A video keeps the look's version
 * it was started with; saving here only changes videos started after. The first card is the 기본 채널 and cannot be removed or moved.
 */
export function ChannelStyleEditor() {
  const { accessToken, demo } = useSession();
  const youtube = useYoutubeConnections();
  const [version, setVersion] = useState<number | null>(null);
  const [styles, setStyles] = useState<Card[]>([]);
  const [canons, setCanons] = useState<Canon[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => {
    if (demo || !accessToken) { setVersion(0); return; }
    apiRequest<Loaded>("/api/v1/content/youtube/channel-styles", { token: accessToken })
      .then(result => { setStyles(result.styles.map(cardOf)); setVersion(result.version); setCanons(result.purposes ?? []); }, reason => setError(errorMessage(reason)));
  }, [accessToken, demo]);
  const set = (index: number, patch: Partial<ChannelStyleInput>) => { setSaved(false); setStyles(list => list.map((style, at) => at === index ? { ...style, ...patch } : style)); };
  const save = async () => {
    if (version === null || !accessToken) return;
    setBusy(true); setError("");
    try {
      const body = { expectedVersion: version, styles: styles.map(({ id, name, channel, tone, ending, logo, purpose, concept, topics, formats, voice, youtube }) => ({ id, name, channel, tone, ending, logo, purpose, concept, topics, formats, voice, youtube })) };
      const result = await apiRequest<Loaded>("/api/v1/content/youtube/channel-styles", { method: "PUT", token: accessToken, body: JSON.stringify(body) });
      setStyles(result.styles.map(cardOf)); setVersion(result.version); setCanons(result.purposes ?? []); setSaved(true); cards = Promise.resolve(result.styles);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  if (version === null) return error ? <p className="yp-errline" role="alert">{error}</p> : <p className="yp-hint" role="status">불러오는 중이에요…</p>;
  return <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="yp-hint">채널마다 목적 · 컨셉 · 주제 축 · 운영 형식과 영상 모양을 정해요. 새 영상과 카드뉴스는 채널을 골라 만들고, 고르지 않으면 맨 위 <b>기본 채널</b>이에요(예전 영상도 모두 기본 채널). 영상 모양은 음성을 시작할 때 그 영상에 고정돼서, 여기서 고쳐도 이미 만들던 영상은 그대로예요.</p>
    {styles.map((style, index) => { const canon = canons.find(item => item.purpose === style.purpose.trim()), row = index ? canon?.channels.find(item => item.name === style.name.trim()) : undefined; return <fieldset key={style.id} className="yp-chstyle">
      <legend>{style.name || "새 채널"}{index === 0 ? " · 기본 채널" : ""}{style.version ? ` · v${style.version}` : ""}</legend>
      <div className="yp-chstyle-row">
        <label>채널 이름<input className="yp-in" maxLength={30} value={style.name} onChange={event => set(index, { name: event.target.value })} placeholder="채널 이름" /></label>
        <label>올릴 유튜브 채널 이름<input className="yp-in" maxLength={60} value={style.channel} onChange={event => set(index, { channel: event.target.value })} placeholder="다르면 업로드할 때 알려 줘요" /></label>
        {index === 0 && style.version ? null : <button type="button" className="yp-ib" aria-label="이 채널 빼기" onClick={() => { setSaved(false); setStyles(list => list.filter((_, at) => at !== index)); }}><X size={14} /></button>}</div>
      {index === 0 ? <p className="yp-hint">목적 <b>마이인 진단 유입</b> — 기본 채널은 지금 쓰는 마이인 정본을 그대로 읽어요. 컨셉 · 주제 축도 그 정본을 따라서 여기에 따로 적지 않아요.</p> : <>
        <div className="yp-chstyle-row">
          <label>목적<select className="yp-in" value={style.purpose} onChange={event => set(index, { purpose: event.target.value })}>
            <option value="">목적 정본 고르기</option>{canons.map(item => <option key={item.id} value={item.purpose}>{item.purpose}</option>)}
            {style.purpose.trim() && !canon ? <option value={style.purpose}>{style.purpose} (정본 없음)</option> : null}</select></label>
          {canon?.channels.length ? <label>정본의 채널<select className="yp-in" value={row?.name ?? ""}
            onChange={event => { const pick = canon.channels.find(item => item.name === event.target.value); if (pick) set(index, pick); }}>
            <option value="">골라서 채우기</option>{canon.channels.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label> : null}</div>
        <p className="yp-hint">{!canons.length ? "OS에 「목적 정본 — 목적」 문서가 아직 없어요. 문서를 만들면 여기서 목적을 고를 수 있어요."
          : !canon ? "목적을 고르면 이 채널의 AI 작업이 그 목적 정본을 먼저 읽어요."
          : <>목적 정본: <Link className="yp-lnk" href={`/knowledge?document=${canon.id}`}>「{canon.title}」</Link> — 이 채널의 AI 작업은 이 문서를 먼저 읽어요.{canon.channels.length ? " 정본의 채널을 고르면 그 채널의 컨셉 · 주제 축은 정본을 따라가요." : " 정본에 「채널 카드」 표를 넣으면 채널을 골라 정본을 따라가게 할 수 있어요."}</>}</p>
        {row ? <p className="yp-hint">컨셉 <b>{row.concept || "정본에서 아직 안 정했어요"}</b> · 주제 축 <b>{row.topics || "정본에서 아직 안 정했어요"}</b> — 정본 표를 고치면 이 채널과 AI 작업에 바로 반영돼요. <Link className="yp-lnk" href={`/knowledge?document=${canon!.id}`}>정본에서 고치기</Link>{" "}(정본에서 채널 이름을 바꾸면 여기서 한 번 다시 골라 주세요.)</p>
        : <div className="yp-chstyle-row">
          <label>컨셉 한 줄<input className="yp-in" maxLength={200} value={style.concept} onChange={event => set(index, { concept: event.target.value })} placeholder="정본의 채널을 고르면 정본을 따라가요" /></label>
          <label>주제 축 (같은 목적의 다른 채널과 겹치지 않게)<input className="yp-in" maxLength={300} value={style.topics} onChange={event => set(index, { topics: event.target.value })} placeholder="정본의 채널을 고르면 정본을 따라가요" /></label></div>}</>}
      <div className="yp-chstyle-row">
        <label>올릴 유튜브 채널<select className="yp-in" value={style.youtube} onChange={event => set(index, { youtube: event.target.value })}>
          <option value="">이름으로 찾기 · 없으면 첫 연결</option>{youtube.map(row => <option key={row.channelId} value={row.channelId}>{row.accountName}</option>)}
          {style.youtube && !youtube.some(row => row.channelId === style.youtube) ? <option value={style.youtube}>연결이 끊긴 채널</option> : null}</select></label>
        <label>목소리 ID (Fish Audio)<input className="yp-in" maxLength={64} value={style.voice} onChange={event => set(index, { voice: event.target.value.trim() })} placeholder="비우면 기본 목소리" /></label></div>
      <div className="yp-chstyle-row" role="group" aria-label="운영 형식"><span className="yp-hint">운영 형식</span>
        {CHANNEL_FORMATS.map(format => <label key={format} className="yp-chstyle-check"><input type="checkbox" checked={style.formats.includes(format)}
          onChange={event => set(index, { formats: event.target.checked ? CHANNEL_FORMATS.filter(item => item === format || style.formats.includes(item)) : style.formats.filter(item => item !== format) })} /> {CHANNEL_FORMAT_LABEL[format]}</label>)}</div>
      <label className="yp-chstyle-check"><input type="checkbox" checked={Boolean(style.tone)} onChange={event => set(index, { tone: event.target.checked ? TONE : null })} /> 도식 색 바꾸기 (톤앤매너)</label>
      {style.tone ? <div className="yp-chstyle-row">
        <label>모양 틀<select className="yp-in" value={style.tone.base} onChange={event => set(index, { tone: { ...style.tone!, base: event.target.value as "myin" | "card" } })}>
          <option value="myin">흰 바탕</option><option value="card">바탕 위 흰 카드</option></select></label>
        {([["key", "강조색"], ["ink", "글자 · 선"], ["page", "바탕"]] as const).map(([field, name]) => <label key={field}>{name}
          <span className="yp-chstyle-color"><input type="color" aria-label={`${name} 고르기`} value={style.tone![field]} onChange={event => set(index, { tone: { ...style.tone!, [field]: event.target.value.toUpperCase() } })} />
            <input className="yp-in" value={style.tone![field]} maxLength={7} onChange={event => set(index, { tone: { ...style.tone!, [field]: event.target.value } })} /></span></label>)}</div> : null}
      <div className="yp-chstyle-row">
        <label>영상 끝맺음<select className="yp-in" value={style.ending} onChange={event => set(index, { ending: event.target.value as "talk" | "outro" })}>
          <option value="talk">마지막 멘트 동안 정리 화면 → 엔딩 화면</option><option value="outro">마이인 타이틀 → 정리 화면 → 엔딩 화면 (예전 방식)</option></select></label>
        <label className="yp-chstyle-check"><input type="checkbox" checked={style.logo} onChange={event => set(index, { logo: event.target.checked })} /> 오른쪽 위 MYIN 로고</label></div>
    </fieldset>; })}
    <div><button type="button" className="yp-btn yp-sm" onClick={() => { setSaved(false); setStyles(list => [...list, blank()]); }}><Plus size={14} /> 채널 추가</button></div>
    <div><button type="submit" className="yp-btn yp-pri" disabled={busy || demo || styles.some(style => !style.name.trim() || !style.formats.length)}>{busy ? "저장하는 중…" : "저장"}</button>
      {demo ? <span className="yp-hint"> 데모에서는 저장하지 않아요.</span> : saved ? <span className="yp-hint" role="status"> 저장했어요. 바뀐 채널은 버전이 하나 올라가요.</span> : null}</div>
    {error ? <div className="yp-errline" role="alert">{error}</div> : null}
  </form>;
}
