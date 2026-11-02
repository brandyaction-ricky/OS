"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { YpThumb } from "@/lib/youtube-process/stages";
import type { YpClient } from "./youtube-process-data";

/** What a thumbnail needs to sign its file: the screen's client and project (a step screen's page, or the confirm menu). */
export interface YpMediaSource { client: YpClient | null; bundle: { project: { id: string } } | null }

/** A one-hour link for a project file (thumbnail images live in private storage). */
export function useAssetUrl(page: YpMediaSource, path?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const projectId = page.bundle?.project.id;
  const client = page.client;
  useEffect(() => {
    let active = true;
    if (!path || !client || !projectId) { setUrl(null); return; }
    client.assetUrl(projectId, path).then(next => { if (active) setUrl(next); }, () => { if (active) setUrl(null); });
    return () => { active = false; };
  }, [client, path, projectId]);
  return url;
}

/** A 16:9 thumbnail: the uploaded image, or the 글 설명 drawn as big text (시안 thumbArt 'T'). */
export function ThumbView({ page, thumb, path, alt }: { page: YpMediaSource; thumb?: YpThumb | null; path?: string | null; alt: string }) {
  const url = useAssetUrl(page, path ?? (thumb?.mode === "img" ? thumb.path : null));
  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from private storage
  if (url) return <div className="yp-thumb"><img src={url} alt={alt} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
  // 로건 QA 10/30: a 글 후보 showed only its big words on black — the picture it describes now sits under them.
  return <div className="yp-thumb yp-th-T" aria-label={alt}>
    <div className="yp-tl" style={{ left: "7%", top: "12%", right: "7%", color: "var(--media-text)" }}>{thumb?.copy || <span style={{ color: "var(--media-muted)" }}>{thumb?.screen || "화면 설명을 써 주세요"}</span>}</div>
    {thumb?.copy && thumb.screen ? <div className="yp-th-scr">화면 · {thumb.screen}</div> : null}
  </div>;
}

// 작게 보기 (유쓰 요청 6/8, 2026-11-02): one look for every list preview on the screen, so A · B · C are compared the same way.
// It only changes what this browser shows: nothing is saved, picked or confirmed by it.
export type YtLook = "home" | "search" | "side" | "phone";
const LOOKS: [YtLook, string][] = [["home", "PC 홈"], ["search", "PC 검색"], ["side", "추천 옆 목록"], ["phone", "휴대폰"]];
let look: YtLook = "home";
const lookListeners = new Set<() => void>();
const subscribeLook = (listener: () => void) => { lookListeners.add(listener); return () => { lookListeners.delete(listener); }; };
const useLook = () => useSyncExternalStore(subscribeLook, () => look, () => "home" as YtLook);

export function YtLookPicker() {
  const current = useLook();
  return <div className="yp-seg2 yp-sm" role="group" aria-label="유튜브에서 보이는 크기">{LOOKS.map(([key, label]) =>
    <button key={key} type="button" className={current === key ? "yp-on" : ""} aria-pressed={current === key} onClick={() => { look = key; lookListeners.forEach(listener => listener()); }}>{label}</button>)}</div>;
}

// The connected channel's name, asked once per screen client.
const channelNames = new WeakMap<YpClient, Promise<string | null>>();
function useChannelName(client: YpClient | null) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let active = true;
    if (!channelNames.has(client)) channelNames.set(client, client.channelName().catch(() => null));
    void channelNames.get(client)!.then(next => { if (active) setName(next); });
    return () => { active = false; };
  }, [client]);
  return name;
}

/** The YouTube list look (시안 ytCard): thumbnail, channel mark, title — as on a PC home, a search or watch-page list, or a phone. */
export function YtCard({ page, thumb, path, title, channel }: { page: YpMediaSource; thumb?: YpThumb | null; path?: string | null; title: string; channel?: string | null }) {
  const current = useLook();
  const connected = useChannelName(page.client);
  const name = channel ?? connected ?? "내 채널";
  const text = <div className="yp-yt-t">{title.trim() || <span style={{ color: "var(--muted)" }}>제목을 골라 주세요</span>}</div>;
  const art = <ThumbView page={page} thumb={thumb} path={path} alt={`${title} 썸네일`} />;
  if (current === "search" || current === "side") return <div className={`yp-yt yp-yt-${current}`}>{art}
    <div className="yp-yt-b">{text}<div className="yp-yt-m">{current === "search" ? "조회수 — · 방금" : name}</div>
      <div className="yp-yt-m">{current === "search" ? <><span className="yp-yt-av">{name.slice(0, 2)}</span>{name}</> : "조회수 — · 방금"}</div></div></div>;
  return <div className={current === "phone" ? "yp-ytm" : "yp-yt"}>{art}
    <div className="yp-yt-r"><div className="yp-yt-av">{name.slice(0, 2)}</div><div style={{ minWidth: 0 }}>{text}<div className="yp-yt-m">{name} · 조회수 — · 방금</div></div></div>
  </div>;
}
