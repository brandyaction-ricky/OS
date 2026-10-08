"use client";

import { useEffect, useState } from "react";
import { getMenuAccess } from "@/lib/api-client";
import { type MenuAccessProfile } from "@/lib/menu-access";

export function useMenuAccess(profile: (MenuAccessProfile & { id: string }) | null, token: string | null, demo: boolean, path: string) {
  const id = profile?.id;
  const bypass = demo || profile?.role === "admin";
  const [state, setState] = useState<{ id?: string; path: string; allowed: string[] | null; error: string; loading: boolean }>({ path: "", allowed: null, error: "", loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (bypass || !id || !token) return;
    let active = true;
    let generation = 0;
    const load = async () => {
      const currentGeneration = ++generation;
      // Refresh in place so returning to the browser does not erase an open form.
      // A different identity/path still waits for its own settings before rendering.
      setState(previous => previous.id === id && previous.path === path && !previous.error
        ? previous : { id, path, allowed: null, error: "", loading: true });
      try {
        const result = await getMenuAccess(token);
        if (active && currentGeneration === generation) setState({ id, path, allowed: result.policies.find(policy => policy.member_id === id)?.allowed_menus ?? null, error: "", loading: false });
      } catch (reason) {
        if (active && currentGeneration === generation) setState({ id, path, allowed: [], error: reason instanceof Error ? reason.message : "메뉴 권한을 확인하지 못했습니다.", loading: false });
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [bypass, id, token, path, attempt]);
  const current = state.id === id && state.path === path;
  return {
    allowed: bypass ? null : state.allowed,
    loading: !bypass && (!current || state.loading),
    error: bypass || !current ? "" : state.error,
    retry: () => setAttempt(value => value + 1),
  };
}
