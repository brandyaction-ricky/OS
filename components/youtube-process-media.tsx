"use client";
import { useEffect, useState } from "react";
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
  return <div className="yp-thumb yp-th-T" aria-label={alt}>
    <div className="yp-tl" style={{ left: "7%", top: "12%", right: "7%", color: "var(--media-text)" }}>{thumb?.copy || <span style={{ color: "var(--media-muted)" }}>{thumb?.screen || "화면 설명을 써 주세요"}</span>}</div>
  </div>;
}

/** The YouTube list look (시안 ytCard): thumbnail, channel mark, title. */
export function YtCard({ page, thumb, path, title }: { page: YpMediaSource; thumb?: YpThumb | null; path?: string | null; title: string }) {
  return <div className="yp-yt"><ThumbView page={page} thumb={thumb} path={path} alt={`${title} 썸네일`} />
    <div className="yp-yt-r"><div className="yp-yt-av">BA</div><div style={{ minWidth: 0 }}><div className="yp-yt-t">{title.trim() || <span style={{ color: "var(--muted)" }}>제목을 골라 주세요</span>}</div><div className="yp-yt-m">브랜디액션 · 조회수 — · 방금</div></div></div>
  </div>;
}
