"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { canAccessFinance } from "@/lib/finance/access";
import type { FinanceController } from "@/lib/finance/workspace.mjs";
import { useSession } from "../session-provider";
import { TossReadPanel } from "./toss-read-panel";
import "./finance.css";

/** A persistent, client-only adapter for the handoff's seven finance views. */
export function FinanceWorkspace() {
  const { profile, loading, demo, accessToken } = useSession();
  const token=useRef(accessToken);
  token.current=accessToken;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const url = `${pathname}?${search.toString()}`;
  const currentUrl = useRef(url);
  currentUrl.current = url;
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<FinanceController | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [fetching,setFetching]=useState(false);
  const validPage =
    /^\/finance\/(overview|sales|settlements|bank|cards|recurring|budget)$/.test(
      pathname,
    );
  const allowed = canAccessFinance(profile);
  const actor = profile?.id;

  useEffect(() => {
    if (loading || !allowed || !validPage || !host.current) return;
    let cancelled = false;
    const abort=new AbortController();
    const node = host.current;
    setError("");setFetching(true);
    void Promise.all([import("@/lib/finance/workspace.mjs"),demo?Promise.resolve(undefined):import("@/lib/finance/client").then(({connectFinance})=>connectFinance(()=>token.current,abort.signal))])
      .then(([{ mountFinanceWorkspace },connection]) => {
        if (cancelled) return;
        controller.current = mountFinanceWorkspace(node, {
          ...connection,
          actorId:demo?undefined:actor,
          url: currentUrl.current,
          navigate: (next) => router.push(next, { scroll: false }),
          replaceUrl: (next) =>
            window.history.replaceState(window.history.state, "", next),
          onReset: () => setRevision((value) => value + 1),
        });
        setFetching(false);
      })
      .catch((reason) => {
        if (!cancelled){setError(reason instanceof Error?reason.message:"재무 화면을 불러오지 못했습니다.");setFetching(false);}
      });
    return () => {
      cancelled = true;
      abort.abort();
      controller.current?.destroy();
      controller.current = null;
      node.replaceChildren();
    };
  }, [allowed, loading, actor, revision, router, validPage, demo]);

  useEffect(() => {
    controller.current?.setUrl(url);
  }, [url]);

  if (!validPage) return null;
  if (loading) return <p role="status">재무 접근 권한을 확인하고 있습니다.</p>;
  if (!allowed)
    return (
      <section className="panel empty-state" role="status">
        <h1>재무관리 접근 권한이 없습니다</h1>
        <p>활성 관리자 또는 재무 권한이 있는 구성원만 이용할 수 있습니다.</p>
        <Link href="/home">내 할 일로 돌아가기</Link>
      </section>
    );
  return (
    <>
      {!demo&&(pathname==="/finance/sales"||pathname==="/finance/settlements")?<TossReadPanel key={`${actor}:${pathname}`} token={accessToken} kind={pathname==="/finance/sales"?"transactions":"settlements"}/>:null}
      {error ? (
        <div className="inline-alert" role="alert">
          {error}{" "}
          <button onClick={() => setRevision((value) => value + 1)}>
            다시 시도
          </button>
        </div>
      ) : null}
      {fetching?<p role="status">재무 내역을 불러오고 있습니다…</p>:null}
      <div
        ref={host}
        className="finance-workspace"
        aria-label={demo?"재무관리 모의 작업공간":"재무관리 작업공간"}
      />
    </>
  );
}
