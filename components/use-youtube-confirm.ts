"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

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
