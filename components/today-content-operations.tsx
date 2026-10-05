"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, listRecords } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { summarizeTodayContent, type HomeChannel } from "@/lib/today-content";
import { useSession } from "./session-provider";
export function TodayContentOperations() {
  const { accessToken, demo, profile } = useSession();
  const [summary, setSummary] = useState<ReturnType<typeof summarizeTodayContent> | null>(null);
  const [error, setError] = useState(""), [truncated, setTruncated] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setSummary(null); setError("");
    if (demo || !accessToken) return;
    let pending = false;
    async function load() {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const [posts, comments, metrics, channels] = await Promise.all([
          listRecords(accessToken, "content_publish", "limit=200"),
          apiRequest<{ comments: Array<OsRecord & { canRespond: boolean }>; truncated: boolean }>("/api/v1/content/comments", { token: accessToken }),
          listRecords(accessToken, "content_metric", "limit=200"),
          apiRequest<{ connections: HomeChannel[] }>("/api/v1/channels", { token: accessToken }),
        ]);
        if (active) {
          setSummary(summarizeTodayContent(posts.records, comments.comments, metrics.records, channels.connections, profile?.id ?? ""));
          setTruncated(posts.records.length === 200 || metrics.records.length === 200 || comments.truncated);
          setError("");
        }
      } catch { if (active) { setSummary(null); setError("콘텐츠 요약을 불러오지 못했습니다. 채널 저장소·연결 상태를 확인해 주세요."); } }
      finally { pending = false; }
    }
    void load(); const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [accessToken, demo, profile?.id, revision]);
  return <section className="panel today-content-operations" aria-label="오늘 콘텐츠 운영">
    <header className="panel-header"><div><h2>오늘 콘텐츠 운영</h2><p>게시 실행은 사람이 확인합니다. 요약은 접속 중 1분마다 갱신됩니다.</p></div><Link href="/content/publishing?tab=calendar">발행 일정 →</Link></header>
    {demo ? <p>데모 · 실제 운영 데이터 연결 전입니다. 각 화면에서 모의 동작을 검수할 수 있습니다.</p>
      : error ? <p role="alert">{error} <button className="ghost-button" onClick={() => setRevision(value => value + 1)}>다시 불러오기</button></p>
      : !summary ? <p role="status" aria-busy="true">오늘의 운영 정보를 확인하는 중…</p>
      : <><div className="today-content-cards">
        <Link href="/content/publishing?tab=calendar"><span>오늘까지 게시 확인</span><strong>{summary.due.length}</strong><small>기한 지난 항목 포함 · 본인/공유 계정</small></Link>
        <Link href="/content/comments"><span>답할 댓글</span><strong>{summary.unanswered.length}</strong><small>내 담당 또는 처리할 수 있는 댓글</small></Link>
        <Link href="/content/performance"><span>새 성과 기록</span><strong>{summary.measured}</strong><small>최근 24시간 저장된 게시물 수</small></Link>
      </div>{summary.warnings.length ? <div className="inline-alert"><Link href="/settings/account">채널 연결 확인 {summary.warnings.length}건 · 만료 임박 또는 재연결 필요 →</Link></div> : null}
      {truncated ? <small>각 항목은 최근 최대 200건 기준이며 전체 수보다 적을 수 있습니다. 자세한 내용은 해당 화면을 확인하세요.</small> : null}</>}
  </section>;
}
