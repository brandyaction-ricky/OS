"use client";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type { ChannelStyle, ChannelStyleInput } from "@/lib/youtube-process/channel-style";
import { useSession } from "./session-provider";
import { errorMessage } from "./youtube-process-data";

const TONE = { base: "myin" as const, key: "#212CB0", ink: "#1E1D1D", page: "#FFFFFF" };
const blank = (): ChannelStyleInput => ({ id: crypto.randomUUID(), name: "", channel: "", tone: null, ending: "talk", logo: false });

/**
 * 채널 모양 (유쓰 요청 5/8, 2026-11-02): per channel, the diagram tone, how the video ends and the MYIN logo — the parts of the look
 * Logan's engine takes today. A video keeps the version it was started with; saving here only changes videos started after.
 */
export function ChannelStyleEditor() {
  const { accessToken, demo } = useSession();
  const [version, setVersion] = useState<number | null>(null);
  const [styles, setStyles] = useState<(ChannelStyleInput & Partial<Pick<ChannelStyle, "version">>)[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => {
    if (demo || !accessToken) { setVersion(0); return; }
    apiRequest<{ styles: ChannelStyle[]; version: number }>("/api/v1/content/youtube/channel-styles", { token: accessToken })
      .then(result => { setStyles(result.styles); setVersion(result.version); }, reason => setError(errorMessage(reason)));
  }, [accessToken, demo]);
  const set = (index: number, patch: Partial<ChannelStyleInput>) => { setSaved(false); setStyles(list => list.map((style, at) => at === index ? { ...style, ...patch } : style)); };
  const save = async () => {
    if (version === null || !accessToken) return;
    setBusy(true); setError("");
    try {
      const body = { expectedVersion: version, styles: styles.map(({ id, name, channel, tone, ending, logo }) => ({ id, name, channel, tone, ending, logo })) };
      const result = await apiRequest<{ styles: ChannelStyle[]; version: number }>("/api/v1/content/youtube/channel-styles", { method: "PUT", token: accessToken, body: JSON.stringify(body) });
      setStyles(result.styles); setVersion(result.version); setSaved(true);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  if (version === null) return error ? <p className="yp-errline" role="alert">{error}</p> : <p className="yp-hint" role="status">불러오는 중이에요…</p>;
  return <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="yp-hint">채널마다 도식 색 · 영상 끝맺음 · 로고를 정해 두면, 영상 만들기에서 음성을 시작할 때 고른 모양이 그 영상에 고정돼요. 여기서 고쳐도 이미 만들던 영상은 그대로예요. 글꼴과 하단 자막 모양은 영상 엔진이 받을 수 있게 되면 여기에 더해요.</p>
    {styles.map((style, index) => <fieldset key={style.id} className="yp-chstyle">
      <legend>{style.name || "새 채널 모양"}{style.version ? ` · v${style.version}` : ""}</legend>
      <div className="yp-chstyle-row">
        <label>이름<input className="yp-in" maxLength={30} value={style.name} onChange={event => set(index, { name: event.target.value })} placeholder="예) 마이인" /></label>
        <label>올릴 유튜브 채널 이름<input className="yp-in" maxLength={60} value={style.channel} onChange={event => set(index, { channel: event.target.value })} placeholder="다르면 업로드할 때 알려 줘요" /></label>
        <button type="button" className="yp-ib" aria-label="이 채널 모양 빼기" onClick={() => { setSaved(false); setStyles(list => list.filter((_, at) => at !== index)); }}><X size={14} /></button></div>
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
    </fieldset>)}
    <div><button type="button" className="yp-btn yp-sm" onClick={() => { setSaved(false); setStyles(list => [...list, blank()]); }}><Plus size={14} /> 채널 모양 추가</button></div>
    <div><button type="submit" className="yp-btn yp-pri" disabled={busy || demo || styles.some(style => !style.name.trim())}>{busy ? "저장하는 중…" : "저장"}</button>
      {demo ? <span className="yp-hint"> 데모에서는 저장하지 않아요.</span> : saved ? <span className="yp-hint" role="status"> 저장했어요. 바뀐 모양은 버전이 하나 올라가요.</span> : null}</div>
    {error ? <div className="yp-errline" role="alert">{error}</div> : null}
  </form>;
}
