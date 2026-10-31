"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { ChannelConnection } from "@/lib/channel-types";
import { CTA_MAX_VIDEOS, ctaPreview, ctaQuota, type CtaVideo } from "@/lib/youtube-process/cta";
import { useSession } from "./session-provider";
import { errorMessage, youtubeProcessClient, type CtaChangeView } from "./youtube-process-data";

const when = (iso: string) => { const at = new Date(iso); return `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`; };

/**
 * CTA 일괄 바꾸기 (로건 요청 10/30, 대표 결정 2026-10-31): find the old 진단 링크 · 멘트 in the channel's uploaded descriptions, check
 * each change, change the picked ones at once, undo from the record. Pinned comments and end screens YouTube does not let an app change.
 */
export function CtaBulkScreen() {
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const [channel, setChannel] = useState<ChannelConnection | null | undefined>(undefined);
  const [videos, setVideos] = useState<CtaVideo[] | null>(null);
  const [history, setHistory] = useState<CtaChangeView[]>([]);
  const [find, setFind] = useState(""), [replace, setReplace] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [done, setDone] = useState<CtaChangeView | null>(null);
  const ownerId = channel?.ownerId ?? null;
  useEffect(() => {
    if (demo) { setChannel({ platform: "youtube", ownerId: "demo", accountName: "브랜디액션 (예시)", manageConnected: true } as ChannelConnection); return; }
    if (!accessToken) return;
    apiRequest<{ connections: ChannelConnection[] }>("/api/v1/channels", { token: accessToken })
      .then(result => setChannel(result.connections.find(row => row.platform === "youtube" && row.status === "connected") ?? null), () => setChannel(null));
  }, [accessToken, demo]);
  const load = useCallback(async (withVideos: boolean) => {
    if (!client || channel === undefined) return;
    setBusy(withVideos ? "load" : ""); setError("");
    try { const result = await client.cta(demo ? null : ownerId, withVideos); setHistory(result.history); if (result.videos) setVideos(result.videos); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(""); }
  }, [client, channel, demo, ownerId]);
  useEffect(() => { void load(false); }, [load]);
  const rows = useMemo(() => videos && find ? ctaPreview(videos, find, replace) : [], [videos, find, replace]);
  const picked = rows.filter(row => !off.has(row.id)).slice(0, CTA_MAX_VIDEOS);
  const apply = async () => {
    if (!client || !picked.length || !window.confirm(`유튜브에 올린 영상 ${picked.length}개의 설명란을 바꿀까요?\n「${find}」 → 「${replace || "(지우기)"}」\n바꾼 뒤에도 기록에서 되돌릴 수 있어요.`)) return;
    setBusy("apply"); setError(""); setDone(null);
    try { const result = await client.ctaApply({ ...(demo || !ownerId ? {} : { ownerId }), find, replace, videoIds: picked.map(row => row.id) }); setDone(result.change); setOff(new Set()); await load(true); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(""); }
  };
  const undo = async (change: CtaChangeView) => {
    if (!client || !window.confirm(`${when(change.at)}에 바꾼 영상 ${change.done}개를 되돌릴까요? 그 뒤에 또 고친 영상은 그대로 둬요.`)) return;
    setBusy(change.id); setError("");
    try { await client.ctaUndo({ ...(ownerId ? { ownerId } : {}), changeId: change.id }); await load(Boolean(videos)); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(""); }
  };

  if (channel === undefined) return <p className="yp-hint" role="status">불러오는 중이에요…</p>;
  if (!channel) return <p className="yp-hint">유튜브 채널이 연결되지 않았어요. <Link className="yp-lnk" href="/settings/account">내 계정 › 채널 연결</Link>에서 연결해요.</p>;
  return <div style={{ display: "grid", gap: 12 }}>
    <section className="yp-card"><div className="yp-card-b" style={{ display: "grid", gap: 10 }}>
      <p className="yp-hint" style={{ margin: 0 }}>진단 이름 · 링크 · 멘트가 바뀌면, 「{channel.accountName}」에 올린 영상 설명란에서 옛 말을 찾아 한 번에 바꿔요. 고정 댓글 · 최종 화면은 유튜브가 앱으로 바꾸지 못하게 해서 직접 고쳐야 해요.</p>
      {channel.manageConnected === false ? <p className="yp-note yp-warn" role="status">유튜브 연결에 「영상 관리」 권한이 없어요. 회사 채널을 연결한 분이 <Link className="yp-lnk" href="/settings/account">내 계정 › 채널 연결</Link>에서 「다시 연결」을 눌러 새 권한을 허용하면 바꿀 수 있어요. 찾기 · 미리보기는 지금도 돼요.</p> : null}
      <div className="yp-links" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <input className="yp-in" value={find} maxLength={500} placeholder="찾을 말 (예: 옛 진단 링크)" aria-label="찾을 말" onChange={event => { setFind(event.target.value); setOff(new Set()); setDone(null); }} />
        <input className="yp-in" value={replace} maxLength={1000} placeholder="바꿀 말 (비우면 지워요)" aria-label="바꿀 말" onChange={event => { setReplace(event.target.value); setDone(null); }} /></div>
      <div className="yp-row-btns"><button type="button" className="yp-btn yp-sm" disabled={busy === "load"} onClick={() => void load(true)}>{busy === "load" ? "불러오는 중…" : videos ? "영상 다시 불러오기" : "올린 영상 불러오기 (최근 150개)"}</button>
        {videos ? <span className="yp-hint">영상 {videos.length}개 · {find ? `찾은 영상 ${rows.length}개` : "찾을 말을 쓰면 바뀔 영상이 나와요"}</span> : null}</div>
      {error ? <p className="yp-errline" role="alert">{error}</p> : null}
      {done ? <p className="yp-note yp-ok" role="status">영상 {done.done}개를 바꿨어요.{done.failed.length ? ` 못 바꾼 영상 ${done.failed.length}개: ${done.failed.map(row => row.error).filter(Boolean).slice(0, 2).join(" · ")}` : ""}</p> : null}
    </div></section>
    {rows.length ? <section className="yp-card"><div className="yp-card-h">바뀔 영상 {picked.length} / {rows.length}{rows.length > CTA_MAX_VIDEOS ? ` (한 번에 ${CTA_MAX_VIDEOS}개까지)` : ""}</div>
      <ul className="yp-hist yp-cta-list">{rows.map(row => <li key={row.id}><label style={{ display: "flex", gap: 8, alignItems: "flex-start", minWidth: 0 }}>
        <input type="checkbox" checked={!off.has(row.id)} onChange={event => setOff(set => { const next = new Set(set); if (event.target.checked) next.delete(row.id); else next.add(row.id); return next; })} />
        <span style={{ minWidth: 0 }}><b>{row.title}</b> <small className="yp-muted">· {row.count}곳</small><br /><small className="yp-muted">{row.before}</small><br /><small>{row.after}</small></span></label></li>)}</ul>
      <div className="yp-card-b yp-row-btns"><button type="button" className="yp-btn yp-pri" disabled={!picked.length || Boolean(busy) || channel.manageConnected === false} onClick={() => void apply()}>
        {busy === "apply" ? "바꾸는 중…" : `고른 영상 ${picked.length}개 설명란 바꾸기`}</button><span className="yp-hint">유튜브 한도 약 {ctaQuota(picked.length).toLocaleString("ko-KR")} (하루 10,000)</span></div></section> : null}
    <section className="yp-card"><div className="yp-card-h">바꾼 기록</div><div className="yp-card-b">
      {history.length ? <ul className="yp-hist">{history.map(change => <li key={change.id} style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 260px", minWidth: 0 }}>「{change.find}」 → 「{change.replace || "(지움)"}」<br /><small className="yp-muted">{when(change.at)} · {change.by} · 영상 {change.done}개{change.undoneAt ? ` · 되돌림 ${change.undone}개` : ""}{change.failed.length ? ` · 못 바꿈 ${change.failed.length}개` : ""}</small></span>
        {!change.undoneAt && change.done ? <button type="button" className="yp-btn yp-sm" disabled={Boolean(busy) || channel.manageConnected === false} onClick={() => void undo(change)}>{busy === change.id ? "되돌리는 중…" : "되돌리기"}</button> : null}</li>)}</ul>
        : <p className="yp-pempty">아직 바꾼 기록이 없어요.</p>}</div></section>
  </div>;
}
