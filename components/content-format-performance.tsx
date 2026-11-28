"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { listMetricWindow } from "@/lib/api-client";
import { kstDay, readPeriod } from "@/lib/performance-period";
import type { OsRecord } from "@/lib/record-types";
import { ChannelMetricsPanel } from "./channel-metrics-panel";
import { ContentPerformanceDashboard } from "./content-performance-dashboard";
import { useSession } from "./session-provider";
import { AdHistoryCard } from "./youtube-process-ads";
import { errorMessage, youtubeProcessClient } from "./youtube-process-data";

const formats = [["all", "유튜브 전체"], ["long", "롱폼"], ["shorts", "숏폼"], ["card", "카드뉴스"], ["threads", "스레드"], ["ad", "광고"]] as const;

export function ContentFormatPerformance() {
  const params = useSearchParams(), pathname = usePathname();
  const format = formats.find(([value]) => value === params.get("format"))?.[0] ?? "all";
  const { from, to } = readPeriod(params, kstDay());
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const youtube = format === "all" || format === "long" || format === "shorts";
  const href = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    return pathname + "?" + next.toString();
  };
  return <div className="perf-root">
    <h1 className="page-title" data-ui="page-title">콘텐츠 성과</h1>
    <nav className="os-toolbar" aria-label="콘텐츠 형식">{formats.map(([value, label]) =>
      <Link className="os-chip" key={value} aria-current={format === value ? "page" : undefined} href={href({ format: value })} scroll={false}>{label}</Link>)}</nav>
    {youtube ? <ContentPerformanceDashboard youtubeOnly fixedFormat={format} /> : <>
      <div className="os-toolbar" aria-label="성과 기간"><strong>{from} ~ {to}</strong>
        {([["7d", "최근 7일"], ["30d", "최근 30일"], ["month", "이번 달"]] as const).map(([value, label]) =>
          <Link className="os-chip" href={href({ period: value })} key={value} scroll={false}>{label}</Link>)}</div>
      {format === "ad" ? <AdHistoryCard client={client} period={{ from, to }} />
        : <PostPerformance key={format} format={format} from={from} to={to} />}
    </>}
  </div>;
}

function PostPerformance({ format, from, to }: { format: "card" | "threads"; from: string; to: string }) {
  const { accessToken, demo } = useSession();
  const [rows, setRows] = useState<OsRecord[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setRows([]); setError(""); setLoading(true);
    if (!demo && accessToken) {
      listMetricWindow(accessToken, from, to, true).then(records => {
        if (active) setRows(records.filter(row => row.metadata.channelSnapshotVersion === 1 && (format === "card"
          ? row.metadata.platform === "instagram" && row.metadata.platformFormat === "ig_carousel" : row.metadata.platform === "threads")));
      }).catch(reason => { if (active) setError(errorMessage(reason)); }).finally(() => { if (active) setLoading(false); });
    } else setLoading(false);
    return () => { active = false; };
  }, [accessToken, demo, format, from, to]);
  if (error) return <p role="alert">{error}</p>;
  return <ChannelMetricsPanel records={rows} loading={loading} from={from} to={to} platform={format === "card" ? "instagram" : "threads"} />;
}
