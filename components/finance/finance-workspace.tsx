"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { canAccessFinance } from "@/lib/finance/access";
import type { FinanceController } from "@/lib/finance/workspace.mjs";
import { useSession } from "../session-provider";
import "./finance.css";

/** A persistent, client-only adapter for the handoff's seven finance views. */
export function FinanceWorkspace() {
  const { profile, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const url = `${pathname}?${search.toString()}`;
  const currentUrl = useRef(url);
  currentUrl.current = url;
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<FinanceController | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const validPage =
    /^\/finance\/(overview|sales|settlements|bank|cards|recurring|budget)$/.test(
      pathname,
    );
  const allowed = canAccessFinance(profile);
  const actor = profile?.id;

  useEffect(() => {
    if (loading || !allowed || !validPage || !host.current) return;
    let cancelled = false;
    const node = host.current;
    setError(false);
    void import("@/lib/finance/workspace.mjs")
      .then(({ mountFinanceWorkspace }) => {
        if (cancelled) return;
        controller.current = mountFinanceWorkspace(node, {
          url: currentUrl.current,
          navigate: (next) => router.push(next, { scroll: false }),
          replaceUrl: (next) =>
            window.history.replaceState(window.history.state, "", next),
          onReset: () => setRevision((value) => value + 1),
        });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      controller.current?.destroy();
      controller.current = null;
    };
  }, [allowed, loading, actor, revision, router, validPage]);

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
      {error ? (
        <div className="inline-alert" role="alert">
          재무 화면을 불러오지 못했습니다.{" "}
          <button onClick={() => setRevision((value) => value + 1)}>
            다시 시도
          </button>
        </div>
      ) : null}
      <div
        ref={host}
        className="finance-workspace"
        aria-label="재무관리 모의 작업공간"
      />
    </>
  );
}
