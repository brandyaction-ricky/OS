"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { YpCardSource } from "@/lib/youtube-process/stages";
import { useSession } from "./session-provider";

type CanonInfo = { design?: { id: string; title: string; version: number; status: string } | null; canon: { id: string; title: string; version: string; approval: string } | null; voice: { id: string; title: string; version: number } | null };
export function CardCanonContext({ source, focus }: { source?: YpCardSource; focus?: string }) {
  const { accessToken, demo } = useSession();
  const [info, setInfo] = useState<CanonInfo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setInfo(null); setError(false);
    if (accessToken && !demo) apiRequest<CanonInfo>("/api/v1/content/youtube/cards?canon=1", { token: accessToken }).then(
      result => { if (active) setInfo(result); }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [demo, accessToken]);
  return <section className="yp-chips yp-card-context" aria-label="현재 제작 기준"><b>현재 제작 기준</b>
    {demo ? <span>카드뉴스 정본 v0.1 · 데모 예시</span> : info?.canon
      ? <Link href={`/knowledge/doc/${info.canon.id}`}>{info.canon.title} {info.canon.version} · {info.canon.approval}</Link>
      : <span>{error ? "정본 확인 실패" : info ? "정본을 찾을 수 없어요" : "정본 확인 중…"}</span>}
    {info?.design && <Link href={`/knowledge/doc/${info.design.id}`}>{info.design.title} · 문서 v{info.design.version}{info.design.status === "draft" ? " · 작업본" : ""}</Link>}
    {info?.voice ? <Link href={`/knowledge/doc/${info.voice.id}`}>{info.voice.title} · 문서 v{info.voice.version}</Link>
      : <span>원고 말투 정본{demo ? " · 데모" : " · 미확인"}</span>}
    {source && <span>{source.kind === "none" ? "새 주제" : "원본"} · {source.title}</span>}
    {focus && <span>이 부분 위주로 · {focus}</span>}
  </section>;
}
