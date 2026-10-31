"use client";

import { useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import type { overviewCounts } from "@/lib/youtube-process/overview";
import type { YoutubeV1Mode } from "@/lib/youtube-process/gate";
import { useSession } from "./session-provider";

/** Whether this person may confirm in 유튜브 공정 v1 (D1: the company approver). null while unknown. */
export function useYoutubeCanConfirm(enabled: boolean, token: string | null, demo: boolean, demoAdmin: boolean) {
  const [canConfirm, setCanConfirm] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    // The demo has no approver table; its admin plays the approver so the 대표 메뉴 can be previewed.
    if (demo) { setCanConfirm(demoAdmin); return; }
    if (!token) return;
    let active = true;
    apiRequest<{ canConfirm: boolean }>("/api/v1/content/youtube/me", { token })
      .then(result => { if (active) setCanConfirm(result.canConfirm); })
      .catch(() => { if (active) setCanConfirm(false); });
    return () => { active = false; };
  }, [enabled, token, demo, demoAdmin]);
  return enabled ? canConfirm : false;
}

// One question per page load: whether v1 is on for this person when it is rolled out to some people only.
let accessAsked: { token: string; result: Promise<boolean> } | null = null;
/** Whether 유튜브 공정 v1 is on for this person: off · on for all · on for the listed people (asked once; false while unknown). */
export function useYoutubeV1Access(mode: YoutubeV1Mode) {
  const { accessToken, demo } = useSession();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (mode !== "some" || demo || !accessToken) return;
    if (accessAsked?.token !== accessToken) accessAsked = { token: accessToken, result: apiRequest("/api/v1/content/youtube/me", { token: accessToken }).then(() => true, () => false) };
    let active = true;
    void accessAsked.result.then(result => { if (active) setAllowed(result); });
    return () => { active = false; };
  }, [mode, demo, accessToken]);
  return mode === "all" || (mode === "some" && (demo || allowed));
}

/** A shared address (쇼츠 · 성과) that shows the v1 screen to the people v1 is on for and the earlier screen to everyone else. */
export function YoutubeV1Switch({ mode, v1, old }: { mode: YoutubeV1Mode; v1: ReactNode; old: ReactNode }) {
  return useYoutubeV1Access(mode) ? v1 : old;
}

/** Fired after a 컨펌 decision or a request/cancel, so the 대표 메뉴 number follows at once. */
export const YP_CONFIRM_EVENT = "yp-confirm-changed";
/**
 * How many videos wait for 컨펌: the 대표 메뉴 number (usability QA 2026-10-25 — the group showed its page count, 1, which read as a
 * waiting count that never went down). Asked again on every page and after each decision; null while unknown.
 */
export function useYoutubeConfirmWaiting(enabled: boolean, path: string) {
  const { accessToken, demo } = useSession();
  const [count, setCount] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(value => value + 1);
    window.addEventListener(YP_CONFIRM_EVENT, bump);
    return () => window.removeEventListener(YP_CONFIRM_EVENT, bump);
  }, []);
  useEffect(() => {
    if (!enabled || (!demo && !accessToken)) return;
    let active = true;
    // The demo keeps its projects in the process screens' module; loaded only here so the shell bundle stays small.
    const items = demo ? import("./youtube-process-data").then(module => module.youtubeProcessClient(null, true)?.confirmList("wait") ?? [])
      : apiRequest<{ items: unknown[] }>("/api/v1/content/youtube/confirm?tab=wait", { token: accessToken ?? "" }).then(result => result.items);
    items.then(list => { if (active) setCount(list.length); }, () => undefined);
    return () => { active = false; };
  }, [enabled, accessToken, demo, path, tick]);
  return enabled ? count : null;
}

/**
 * 한눈에 보기 badges (리키 관제실 시안 P2: a menu number is work, not the count of pages under it): decisions and AI jobs per
 * platform. Asked every five minutes while the window is visible and after each decision, not on every page: each ask reads the
 * whole project list on the server, and a menu badge does not need to be fresher than that.
 */
type OverviewCounts = ReturnType<typeof overviewCounts>;
export function useContentOverviewCounts(enabled: boolean) {
  const { accessToken, demo } = useSession();
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  useEffect(() => {
    if (!enabled || (!demo && !accessToken)) return;
    let active = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      // The demo counts in the browser; both modules load only here so the shell bundle stays small.
      const next = demo ? Promise.all([import("./youtube-process-data"), import("@/lib/youtube-process/overview")]).then(async ([data, rules]) => {
        const { projects, jobs, canConfirm } = await data.youtubeProcessClient(null, true)!.overview();
        return rules.overviewCounts(rules.overviewRows(projects, jobs, { id: "demo-ricky", canConfirm }).rows);
      }) : apiRequest<{ counts: OverviewCounts }>("/api/v1/content/youtube/overview?counts=1", { token: accessToken ?? "" }).then(result => result.counts);
      next.then(value => { if (active) setCounts(value); }, () => undefined);
    };
    load();
    const timer = window.setInterval(load, 300_000);
    window.addEventListener(YP_CONFIRM_EVENT, load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener(YP_CONFIRM_EVENT, load); };
  }, [enabled, accessToken, demo]);
  return enabled ? counts : null;
}
