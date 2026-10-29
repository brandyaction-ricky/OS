"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { ChannelConnection } from "@/lib/channel-types";
import type { OsRecord } from "@/lib/record-types";
import { threadsPostLength, threadsPostRole, threadsPostsProblem } from "@/lib/threads-posts";
import { useSession } from "./session-provider";

type Publication = {
  state: "running" | "retryable" | "uncertain" | "published" | "mock_complete";
  mode: "mock" | "live";
  accountOwnerId: string; accountName: string; posts: string[];
  publishedCount: number; total: number; permalink: string; errorCode?: string;
};
type Readiness = {
  mode: "mock" | "live"; enabled: boolean; ready: boolean; reason: string;
  connections: (ChannelConnection & { publicationAccountKey?: string })[]; publication: Publication | null;
};
type Props = { item: OsRecord; onRefresh: () => Promise<void> };
const locksAccount = (publication: Publication | null | undefined) => Boolean(publication && !(publication.state === "retryable" && publication.publishedCount === 0));
const safePermalink = (value: string) => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && ["threads.com", "www.threads.com", "threads.net", "www.threads.net"].includes(url.hostname) ? url.href : null; }
  catch { return null; }
};

/** Only an explicit human confirmation can dispatch. Opening or refreshing reads state. */
export function ThreadsApiPublication({ item, onRefresh }: Props) {
  const { accessToken } = useSession();
  const [status, setStatus] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true), [verified, setVerified] = useState(false), [busy, setBusy] = useState(false);
  const [accountOwnerId, setAccountOwnerId] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(""), [needsCheck, setNeedsCheck] = useState(false);
  const inFlight = useRef(false), sequence = useRef(0), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const endpoint = `/api/v1/content/automation/threads-publication/${item.id}`;
  const applyStatus = useCallback((next: Readiness) => {
    setStatus(next); setVerified(true);
    setAccountOwnerId(previous => {
      if (locksAccount(next.publication)) return next.publication!.accountOwnerId;
      const available = next.connections.filter(row => row.platform === "threads" && row.status === "connected" && row.mock === (next.mode === "mock"));
      return available.find(row => row.ownerId === previous)?.ownerId
        ?? available.find(row => row.ownerId === next.publication?.accountOwnerId)?.ownerId
        ?? available[0]?.ownerId ?? "";
    });
  }, []);
  const read = useCallback(async (manual = false) => {
    const request = ++sequence.current;
    setLoading(true); setVerified(false); setConfirmed(false);
    try {
      const next = await apiRequest<Readiness>(endpoint, { token: accessToken });
      if (!active.current || request !== sequence.current) return;
      applyStatus(next);
      if (manual) { setError(""); setNeedsCheck(false); }
    } catch (issue) {
      if (active.current && request === sequence.current) setError(issue instanceof Error ? issue.message : "발행 상태를 불러오지 못했습니다.");
    } finally { if (active.current && request === sequence.current) setLoading(false); }
  }, [accessToken, endpoint, applyStatus]);
  useEffect(() => { void read(); }, [read, item.version]);
  const publication = status?.publication;
  const posts = publication?.posts ?? (Array.isArray(item.metadata.posts) ? item.metadata.posts.filter((post): post is string => typeof post === "string") : []);
  const connected = status?.connections.filter(row => row.platform === "threads" && row.status === "connected" && row.mock === (status.mode === "mock")) ?? [];
  const account = connected.find(row => row.ownerId === accountOwnerId);
  const terminal = publication?.state === "published" || publication?.state === "mock_complete";
  const uncertain = publication?.state === "uncertain", running = publication?.state === "running";
  const retry = publication?.state === "retryable";
  const accountLocked = locksAccount(publication), partialRetry = retry && publication.publishedCount > 0;
  const approved = ["ready", "scheduled"].includes(item.status);
  const canPublish = Boolean(status?.ready && status.enabled && verified && approved && account && /^[0-9a-f]{64}$/.test(account.publicationAccountKey ?? "") && !threadsPostsProblem(posts, 1)
    && !loading && !busy && !terminal && !uncertain && !running && !needsCheck);
  const permalink = publication?.permalink ? safePermalink(publication.permalink) : null;
  const submit = async () => {
    if (!canPublish || !confirmed || inFlight.current) return;
    inFlight.current = true; setBusy(true); setConfirmed(false); setError("");
    try {
      const result = await apiRequest<Readiness>(endpoint, { token: accessToken, method: "POST", body: JSON.stringify({ expectedVersion: item.version, accountOwnerId, expectedAccountKey: account!.publicationAccountKey, confirm: true }) });
      if (!active.current) return;
      applyStatus(result);
      await onRefresh();
    } catch (issue) {
      if (!active.current) return;
      // A failed response is not proof that nothing was published. Never auto-retry.
      setError(issue instanceof Error ? issue.message : "발행 요청 결과를 확인하지 못했습니다.");
      setNeedsCheck(true);
      await read();
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  };

  return <section className="ca-v07-api-publish" aria-label="Threads 공식 API 발행">
    <header><div><span className="ca-v07-eyebrow">검수 다음 단계</span><h3>Threads에 발행</h3></div><button type="button" disabled={loading || busy} onClick={() => void read(true)}>발행 상태 확인</button></header>
    <p>승인한 글을 Meta 공식 API로 올립니다. Aside는 미승인 초안 저장까지만 맡습니다.</p>
    {loading ? <p role="status">게시 계정과 발행 상태를 확인하고 있습니다…</p> : null}
    {status?.mode === "mock" && (!publication || publication.mode === "mock") ? <div className="ca-v07-note">모의 검수 모드입니다. 아래 동작은 실제 Threads에 게시하지 않습니다.</div> : null}
    {publication ? <div className="ca-v07-api-progress" role="status">
      <strong>{publication.state === "published" ? "발행 완료" : publication.state === "mock_complete" ? "모의 발행 확인 완료" : uncertain ? "게시 결과 확인 필요" : running ? "발행 처리 중" : "남은 글 발행 대기"}</strong>
      <span>{publication.publishedCount}/{publication.total}개 {publication.mode === "mock" ? "모의 처리" : "게시 확인"} · @{publication.accountName.replace(/^@/, "")}</span>
      {permalink ? <a href={permalink} target="_blank" rel="noopener noreferrer">게시된 본문 보기 ↗</a> : null}
    </div> : null}
    {uncertain ? <p className="ca-v07-note">직전 요청이 실제로 게시됐는지 확인해야 합니다. 중복 게시를 막기 위해 다시 발행할 수 없습니다. 게시 계정의 결과를 확인한 뒤 관리자에게 알려주세요.</p>
      : running ? <p className="ca-v07-note">이 창을 닫아도 발행 요청이 취소되지는 않습니다. 잠시 후 ‘발행 상태 확인’을 눌러주세요.</p>
      : partialRetry ? <p className="ca-v07-note">이미 게시된 글은 다시 올리지 않습니다. 같은 계정·원고로 남은 {Math.max(0, publication!.total - publication!.publishedCount)}개를 이어 올립니다.</p>
        : retry ? <p className="ca-v07-note">아직 게시된 글이 없습니다. 게시할 계정을 다시 선택하고 원고를 확인해 주세요.</p> : null}
    {!terminal && !loading && !status?.ready && !uncertain && !running ? <div className="ca-v07-note">{status?.reason || "발행 준비를 확인해 주세요."}</div> : null}
    {!approved && !terminal ? <p><Link href={`/automation/review?sel=${item.id}`}>원고 최종 확인으로 이동 →</Link></p> : null}
    {!terminal ? <label>게시할 Threads 계정
      <select value={accountOwnerId} disabled={busy || loading || accountLocked} onChange={event => { setAccountOwnerId(event.target.value); setConfirmed(false); }}>
        <option value="">계정을 선택해 주세요</option>
        {connected.map(row => <option key={row.ownerId} value={row.ownerId}>@{row.accountName.replace(/^@/, "")}{row.teamShared ? " · 팀 공유" : " · 내 계정"}</option>)}
        {publication && !connected.some(row => row.ownerId === publication.accountOwnerId) ? <option value={publication.accountOwnerId}>@{publication.accountName.replace(/^@/, "")} · 연결 확인 필요</option> : null}
      </select>
    </label> : null}
    {!terminal && !loading && !account ? <p><Link href="/settings/account">내 계정에서 Threads 연결 확인 →</Link></p> : null}
    {!terminal && !loading && account && !/^[0-9a-f]{64}$/.test(account.publicationAccountKey ?? "") ? <p className="ca-v07-note">게시 계정을 다시 확인해야 합니다. ‘발행 상태 확인’을 눌러 최신 연결을 불러와 주세요.</p> : null}
    <details className="ca-v07-api-preview" open>
      <summary>{terminal ? "발행한 원고" : "게시될 원고"} · {posts.length}개</summary>
      <p>본문부터 마지막 답글까지 아래 순서로 이어집니다.</p>
      <ol>{posts.map((post, index) => <li key={index}><div><strong>{threadsPostRole(posts, index)}</strong><small>{threadsPostLength(post)}/500자</small></div><p>{post}</p></li>)}</ol>
    </details>
    {error ? <p role="alert" className="ca-v07-error">{error}</p> : null}
    {needsCheck ? <p className="ca-v07-note">다시 누르기 전에 ‘발행 상태 확인’으로 게시 결과부터 확인해 주세요.</p> : null}
    {!terminal && !uncertain && !running ? <>
      <label className="ca-v07-check"><input type="checkbox" checked={confirmed} disabled={!canPublish} onChange={event => setConfirmed(event.target.checked)} />
        <span>{account ? `@${account.accountName.replace(/^@/, "")} 계정과` : "게시 계정과"} 위 원고를 직접 확인했습니다.</span></label>
      <button type="button" className="primary ca-v07-api-submit" disabled={!canPublish || !confirmed} onClick={() => void submit()}>
        {busy ? "발행 결과 확인 중…" : status?.mode === "mock" ? (partialRetry ? "남은 글 모의 발행" : "모의 API 발행 확인") : partialRetry ? "확인하고 남은 글 발행" : "확인하고 Threads에 발행"}
      </button>
    </> : null}
  </section>;
}
